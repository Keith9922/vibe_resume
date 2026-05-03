"use client";

/**
 * useConversationProgress — periodically asks /api/voice-progress what the
 * conversation has covered so far. Drives the live "已采集" sidebar in voice
 * mode.
 *
 * - Reads the transcript from the relay (`/sessions/:id/transcript`) so we
 *   include both ASR-recognised user text AND the AI's textual replies. This
 *   is more accurate than just relying on what the local hook captured.
 * - Polls every N completed user turns (default 2), with a 6s minimum gap so
 *   we never run two probes back-to-back during a fast back-and-forth.
 * - Failures are silent — UI just keeps showing whatever it had last.
 */

import { useEffect, useMemo, useRef, useState } from "react";

export type ProgressSlot = 0 | 1 | 2;

export type ProgressStory = {
  id: string;
  label: string;
  slots: { context: ProgressSlot; role: ProgressSlot; actions: ProgressSlot; result: ProgressSlot };
  notes?: string;
};

export type ConversationProgress = {
  stories: ProgressStory[];
  ready_to_wrap: boolean;
  hint?: string;
  /** Total slot points filled across all stories: max = 8 per story × N. */
  totalScore: number;
  /** Sum of slot rating ÷ max possible — UI uses this for the gauge bar (0..1). */
  completeness: number;
};

const EMPTY: ConversationProgress = { stories: [], ready_to_wrap: false, totalScore: 0, completeness: 0 };

export type UseProgressArgs = {
  /** When non-null, hook is active. When null, it idles. */
  sessionId: string | null;
  /** Increments each time a USER finishes saying something. The hook polls when this changes by ≥pollEveryNTurns. */
  userTurnCount: number;
  /** Default 2: probe every 2 user turns. */
  pollEveryNTurns?: number;
  /** Hard min gap between probes (ms). Default 6000. */
  minIntervalMs?: number;
  /** Where to read the transcript from (the relay). */
  transcriptBaseUrl: string;
};

export function useConversationProgress(args: UseProgressArgs): ConversationProgress {
  const { sessionId, userTurnCount, pollEveryNTurns = 2, minIntervalMs = 6000, transcriptBaseUrl } = args;

  const [progress, setProgress] = useState<ConversationProgress>(EMPTY);
  const lastPolledTurnRef = useRef(0);
  const lastPolledAtRef = useRef(0);
  const inFlightRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setProgress(EMPTY);
      lastPolledTurnRef.current = 0;
      lastPolledAtRef.current = 0;
      return;
    }
    if (userTurnCount === 0) return;

    // Throttle: only run if both turn-gap AND time-gap are met
    const turnGap = userTurnCount - lastPolledTurnRef.current;
    const timeGap = Date.now() - lastPolledAtRef.current;
    if (turnGap < pollEveryNTurns) return;
    if (timeGap < minIntervalMs && lastPolledAtRef.current !== 0) return;

    lastPolledTurnRef.current = userTurnCount;
    lastPolledAtRef.current = Date.now();

    inFlightRef.current?.abort();
    const ac = new AbortController();
    inFlightRef.current = ac;

    void runProbe(sessionId, transcriptBaseUrl, ac.signal)
      .then((p) => { if (!ac.signal.aborted) setProgress(p); })
      .catch(() => { /* silent */ });

    return () => { ac.abort(); };
  }, [sessionId, userTurnCount, pollEveryNTurns, minIntervalMs, transcriptBaseUrl]);

  // Reset when sessionId clears (modal closed)
  useEffect(() => () => { inFlightRef.current?.abort(); }, []);

  return useMemo(() => progress, [progress]);
}

async function runProbe(sessionId: string, transcriptBaseUrl: string, signal: AbortSignal): Promise<ConversationProgress> {
  // 1. Fetch transcript from relay
  const transcriptUrl = `${transcriptBaseUrl.replace(/\/$/, "")}/sessions/${sessionId}/transcript`;
  // The transcriptBaseUrl might be a wss:// URL — convert to https://
  const httpUrl = transcriptUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/voice/, "");
  const tRes = await fetch(httpUrl, { signal, credentials: "omit" });
  if (!tRes.ok) throw new Error(`transcript ${tRes.status}`);
  const tBody = (await tRes.json()) as { turns: Array<{ ts: number; role: "user" | "assistant"; text: string }> };
  if (!tBody.turns?.length) return EMPTY;

  // 2. Send to /api/voice-progress
  const pRes = await fetch("/api/voice-progress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ turns: tBody.turns.map((t) => ({ role: t.role, text: t.text })) }),
    signal,
  });
  if (!pRes.ok) throw new Error(`probe ${pRes.status}`);
  const data = (await pRes.json()) as Omit<ConversationProgress, "totalScore" | "completeness">;

  const totalScore = (data.stories ?? []).reduce(
    (n, s) => n + s.slots.context + s.slots.role + s.slots.actions + s.slots.result, 0,
  );
  const maxPossible = Math.max(8, (data.stories?.length ?? 1) * 8);
  return {
    stories: data.stories ?? [],
    ready_to_wrap: !!data.ready_to_wrap,
    hint: data.hint,
    totalScore,
    completeness: maxPossible > 0 ? Math.min(1, totalScore / 16) : 0, // 16 = 2 完整经历
  };
}

/** Helper for the UI to convert the wss relay URL to the matching https base. */
export function relayHttpsBase(relayUrl: string): string {
  return relayUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/voice.*$/, "");
}
