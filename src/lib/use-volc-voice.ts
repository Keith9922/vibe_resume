"use client";

/**
 * useVolcVoice — orchestrates a full-duplex 火山豆包端到端实时语音 session.
 *
 *   browser WS ─→ relay (voice.zhangrg.top?session=ID) ─→ openspeech
 *
 * Lifecycle:
 *   open()  → connect WS → StartConnection → SessionStarted → mic on
 *   server VAD does endpointing; ASRInfo triggers barge-in (flush playback)
 *   close() → FinishSession → FinishConnection → close
 *
 * Exposes everything the UI needs to render a phone-call experience: state,
 * captions, mic level (RMS), session ID (for progress probe), mute, and a
 * structured connection-step indicator.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  audioFrame, clientInterruptFrame, decodeFrame, EVT, finishConnectionFrame,
  finishSessionFrame, MSG, startConnectionFrame, startSessionFrame, encodeFrame, SER, FLAG,
} from "@/lib/volc-protocol";
import { createAudioCapture, createAudioPlayback } from "@/lib/volc-audio";

export type VoiceUiState = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error";

/** Connection sub-steps for the "正在连接" indicator. */
export type ConnectStep = "ws" | "session" | "mic" | "ready";

export type VoiceTurnEvent =
  | { kind: "user-text"; text: string; isInterim: boolean }
  | { kind: "user-text-final"; text: string }
  | { kind: "ai-text"; text: string }
  | { kind: "ai-text-final"; text: string }
  | { kind: "barge-in" };

export type UseVoiceArgs = {
  relayUrl: string;
  sessionConfig: object;
  onTurnEvent?: (event: VoiceTurnEvent) => void;
};

export type UseVoiceApi = {
  state: VoiceUiState;
  /** Fine-grained step within "connecting" — for the multi-step UI indicator. */
  connectStep: ConnectStep | null;
  errorMessage: string | null;
  liveUserText: string;
  liveAiText: string;
  /** RMS audio level 0-1, ~16fps. Drive orb pulse / waveform. */
  micLevel: number;
  /** True briefly (~200ms) right after ASRInfo arrives — for orange flash on orb. */
  bargeInFlash: boolean;
  /** Stable per-session UUID; passed to the relay so the progress probe can read transcript. */
  sessionId: string;
  isMuted: boolean;
  open: () => void;
  close: () => void;
  toggleMute: () => void;
  /** Send a SayHello event mid-session (used by frontend to nudge the AI to propose wrapping up). */
  sendSayHello: (content: string) => void;
};

const ACK_SOUND_HZ = 880;     // gentle "I heard you" ping when ASR ends
const ACK_SOUND_MS = 90;
const BARGE_FLASH_MS = 250;

export function useVolcVoice(args: UseVoiceArgs): UseVoiceApi {
  const { relayUrl, sessionConfig, onTurnEvent } = args;

  const [state, setState] = useState<VoiceUiState>("idle");
  const [connectStep, setConnectStep] = useState<ConnectStep | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [liveUserText, setLiveUserText] = useState("");
  const [liveAiText, setLiveAiText] = useState("");
  const [micLevel, setMicLevel] = useState(0);
  const [bargeInFlash, setBargeInFlash] = useState(false);
  const [isMuted, setIsMuted] = useState(false);

  // Session ID is generated once per open() and remains stable across the session
  const [sessionId, setSessionId] = useState<string>(() =>
    typeof crypto !== "undefined" ? crypto.randomUUID() : "ssn-" + Date.now(),
  );

  const wsRef = useRef<WebSocket | null>(null);
  const captureRef = useRef<ReturnType<typeof createAudioCapture> | null>(null);
  const playbackRef = useRef<ReturnType<typeof createAudioPlayback> | null>(null);
  const ackContextRef = useRef<AudioContext | null>(null);
  const sessionReadyRef = useRef(false);
  const aiTextBufferRef = useRef("");
  const lastUserTextRef = useRef("");
  const sessionIdRef = useRef(sessionId);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  const cbRef = useRef({ onTurnEvent });
  useEffect(() => { cbRef.current = { onTurnEvent }; }, [onTurnEvent]);

  // ── helpers ──────────────────────────────────────────────────────────

  /**
   * Web-Audio-synthesised "I heard you" tick. ~90ms, sine + envelope.
   * Plays after ASREnded so the user knows the system is now thinking,
   * not silently dead.
   */
  const playAckSound = useCallback(() => {
    try {
      if (!ackContextRef.current || ackContextRef.current.state === "closed") {
        ackContextRef.current = new AudioContext();
      }
      const ctx = ackContextRef.current;
      if (ctx.state === "suspended") void ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = ACK_SOUND_HZ;
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + ACK_SOUND_MS / 1000);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + ACK_SOUND_MS / 1000 + 0.05);
    } catch { /* best-effort */ }
  }, []);

  // ── teardown ─────────────────────────────────────────────────────────
  const teardown = useCallback(() => {
    sessionReadyRef.current = false;
    setMicLevel(0);
    setIsMuted(false);
    try { captureRef.current?.stop(); } catch { /* ignore */ }
    try { playbackRef.current?.close(); } catch { /* ignore */ }
    try { ackContextRef.current?.close(); } catch { /* ignore */ }
    captureRef.current = null;
    playbackRef.current = null;
    ackContextRef.current = null;

    const ws = wsRef.current;
    wsRef.current = null;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        if (sessionIdRef.current) ws.send(finishSessionFrame(sessionIdRef.current));
        ws.send(finishConnectionFrame());
      } catch { /* ignore */ }
      setTimeout(() => { try { ws.close(); } catch { /* ignore */ } }, 250);
    } else if (ws) {
      try { ws.close(); } catch { /* ignore */ }
    }
  }, []);

  const close = useCallback(() => {
    teardown();
    setState("idle");
    setConnectStep(null);
    setLiveUserText("");
    setLiveAiText("");
  }, [teardown]);

  // ── open ──────────────────────────────────────────────────────────────
  const open = useCallback(() => {
    if (state !== "idle" && state !== "error") return;
    setErrorMessage(null);
    setLiveUserText("");
    setLiveAiText("");
    setState("connecting");
    setConnectStep("ws");

    const newSession = typeof crypto !== "undefined" ? crypto.randomUUID() : "ssn-" + Date.now();
    setSessionId(newSession);
    sessionIdRef.current = newSession;
    aiTextBufferRef.current = "";
    lastUserTextRef.current = "";

    // Pass sessionId to relay so transcripts are stored under that file
    const url = relayUrl.includes("?")
      ? `${relayUrl}&session=${newSession}`
      : `${relayUrl}?session=${newSession}`;

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "WS init failed");
      setState("error");
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      setConnectStep("session");
      try {
        ws.send(startConnectionFrame());
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "send StartConnection failed");
        setState("error");
      }
    };

    ws.onmessage = (e) => {
      // Relay-level errors come through as JSON text frames
      if (typeof e.data === "string") {
        try {
          const j = JSON.parse(e.data);
          if (j.relayError) {
            setErrorMessage("中继错误：" + j.relayError);
            setState("error");
            teardown();
          }
        } catch { /* ignore */ }
        return;
      }

      const frame = decodeFrame(e.data as ArrayBuffer);
      if (!frame || frame.eventId === null) return;
      handleServerEvent(frame.eventId, frame.payload, frame.payloadBytes, frame.msgType);
    };

    ws.onerror = () => {
      setErrorMessage("连接出错，请检查网络后重试");
      setState("error");
    };

    ws.onclose = (e) => {
      setState((cur) => (cur === "error" ? cur : "idle"));
      setConnectStep(null);
      sessionReadyRef.current = false;
      if (e.code !== 1000 && !errorMessage) {
        setErrorMessage(`连接关闭 (${e.code})，请重新进入语音模式`);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, relayUrl, teardown]);

  // ── server event dispatch ────────────────────────────────────────────
  const handleServerEvent = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (eventId: number, payload: any, payloadBytes: Uint8Array, msgType: number) => {
      const ws = wsRef.current;
      if (!ws) return;

      switch (eventId) {
        case EVT.ConnectionStarted: {
          try {
            ws.send(startSessionFrame(sessionIdRef.current, sessionConfig));
          } catch (err) {
            setErrorMessage(err instanceof Error ? err.message : "send StartSession failed");
            setState("error");
          }
          return;
        }

        case EVT.SessionStarted: {
          sessionReadyRef.current = true;
          setConnectStep("mic");
          playbackRef.current = createAudioPlayback();
          playbackRef.current.onIdle = () => {
            setState((cur) => (cur === "speaking" ? "listening" : cur));
          };
          captureRef.current = createAudioCapture({
            onChunk: (chunk) => {
              const w = wsRef.current;
              if (!w || w.readyState !== WebSocket.OPEN || !sessionReadyRef.current) return;
              try { w.send(audioFrame(sessionIdRef.current, chunk)); } catch { /* ignore */ }
            },
            onLevel: (rms) => setMicLevel(rms),
          });
          captureRef.current.start().then(() => {
            setConnectStep("ready");
            setState("listening");
            // Tiny delay so the UI gets a moment of "ready" before slipping into "listening"
            setTimeout(() => setConnectStep(null), 600);
          }).catch((err) => {
            setErrorMessage("麦克风权限被拒绝：" + (err instanceof Error ? err.message : ""));
            setState("error");
            teardown();
          });
          return;
        }

        case EVT.ASRInfo: {
          // User just started speaking — barge-in: kill AI playback
          if (playbackRef.current?.isPlaying()) {
            playbackRef.current.flush();
            try { ws.send(clientInterruptFrame(sessionIdRef.current)); } catch { /* ignore */ }
            cbRef.current.onTurnEvent?.({ kind: "barge-in" });
            // Visual flash: 250ms orange pulse on orb
            setBargeInFlash(true);
            setTimeout(() => setBargeInFlash(false), BARGE_FLASH_MS);
          }
          setState("listening");
          aiTextBufferRef.current = "";
          setLiveAiText("");
          return;
        }

        case EVT.ASRResponse: {
          const results = payload?.results as Array<{ text?: string; is_interim?: boolean }> | undefined;
          if (!results?.length) return;
          const text = results.map((r) => r.text ?? "").join("").trim();
          setLiveUserText(text);
          lastUserTextRef.current = text;
          cbRef.current.onTurnEvent?.({ kind: "user-text", text, isInterim: !!results[0].is_interim });
          return;
        }

        case EVT.ASREnded: {
          // Confirm: user finished talking, gentle ack tone, switch to thinking
          if (lastUserTextRef.current) {
            cbRef.current.onTurnEvent?.({ kind: "user-text-final", text: lastUserTextRef.current });
          }
          playAckSound();
          setState("thinking");
          return;
        }

        case EVT.ChatResponse: {
          const piece = (payload?.content as string) ?? "";
          if (piece) {
            aiTextBufferRef.current += piece;
            setLiveAiText(aiTextBufferRef.current);
            cbRef.current.onTurnEvent?.({ kind: "ai-text", text: aiTextBufferRef.current });
          }
          return;
        }

        case EVT.ChatEnded: {
          if (aiTextBufferRef.current) {
            cbRef.current.onTurnEvent?.({ kind: "ai-text-final", text: aiTextBufferRef.current });
          }
          return;
        }

        case EVT.TTSResponse: {
          if (msgType === MSG.AUDIO_ONLY_RESP && payloadBytes.byteLength > 0) {
            const bytes = payloadBytes;
            const aligned = (bytes.byteOffset % 2 === 0)
              ? new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1)
              : new Int16Array(bytes.slice().buffer);
            playbackRef.current?.play(aligned);
            setState("speaking");
          }
          return;
        }

        case EVT.TTSEnded: return;

        case EVT.SessionFailed:
        case EVT.ConnectionFailed:
        case EVT.DialogCommonError: {
          const msg = (payload as { error?: string; message?: string })?.error
            || (payload as { message?: string })?.message
            || `event ${eventId}`;
          setErrorMessage("豆包：" + msg);
          setState("error");
          return;
        }

        default: return;
      }
    },
    [sessionConfig, teardown, playAckSound],
  );

  // ── public API ────────────────────────────────────────────────────────

  const toggleMute = useCallback(() => {
    setIsMuted((muted) => {
      if (muted) {
        captureRef.current?.resume();
      } else {
        captureRef.current?.pause();
        // Drop any in-progress AI playback when user mutes mid-talk
        playbackRef.current?.flush();
      }
      return !muted;
    });
  }, []);

  const sendSayHello = useCallback((content: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !sessionReadyRef.current) return;
    try {
      const frame = encodeFrame({
        msgType: MSG.FULL_CLIENT,
        flags: FLAG.EVENT,
        serialization: SER.JSON,
        eventId: EVT.SayHello,
        sessionId: sessionIdRef.current,
        payload: JSON.stringify({ content }),
      });
      ws.send(frame);
    } catch { /* ignore */ }
  }, []);

  // Cleanup on unmount
  useEffect(() => () => teardown(), [teardown]);

  return useMemo(() => ({
    state, connectStep, errorMessage, liveUserText, liveAiText,
    micLevel, bargeInFlash, sessionId, isMuted,
    open, close, toggleMute, sendSayHello,
  }), [state, connectStep, errorMessage, liveUserText, liveAiText, micLevel, bargeInFlash, sessionId, isMuted, open, close, toggleMute, sendSayHello]);
}
