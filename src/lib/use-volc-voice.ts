"use client";

/**
 * useVolcVoice — orchestrates a full-duplex 火山豆包端到端实时语音 session.
 *
 *   browser WS ─→ relay (voice.zhangrg.top) ─→ openspeech (auth-injected by relay)
 *
 * Lifecycle:
 *   open()                       → connect WS, send StartConnection + StartSession
 *   ConnectionStarted / SessionStarted → state = "ready", start mic capture
 *   user speaks                  → server emits ASRInfo (interrupt local TTS) → ASRResponse → ASREnded
 *   model thinks/replies         → ChatResponse (text), TTSResponse (PCM audio), ChatEnded, TTSEnded
 *   close()                      → FinishSession → FinishConnection → close
 *
 * Server-side VAD does endpointing for us — no browser silence-timer needed.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  audioFrame, clientInterruptFrame, decodeFrame, EVT, finishConnectionFrame,
  finishSessionFrame, MSG, startConnectionFrame, startSessionFrame,
} from "@/lib/volc-protocol";
import { createAudioCapture, createAudioPlayback } from "@/lib/volc-audio";

export type VoiceUiState = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "error";

export type VoiceTurnEvent =
  | { kind: "user-text"; text: string; isInterim: boolean }
  | { kind: "user-text-final"; text: string }
  | { kind: "ai-text"; text: string }
  | { kind: "ai-text-final"; text: string };

export type UseVoiceArgs = {
  relayUrl: string;
  /** Sent verbatim to StartSession.dialog config (system prompt, voice, etc). */
  sessionConfig: object;
  /** UI ↔ logic: each user/ai utterance, partial or final. */
  onTurnEvent?: (event: VoiceTurnEvent) => void;
};

export type UseVoiceApi = {
  state: VoiceUiState;
  errorMessage: string | null;
  /** Latest in-progress text from each side (for live captions). */
  liveUserText: string;
  liveAiText: string;
  open: () => void;
  close: () => void;
};

export function useVolcVoice(args: UseVoiceArgs): UseVoiceApi {
  const { relayUrl, sessionConfig, onTurnEvent } = args;

  const [state, setState] = useState<VoiceUiState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [liveUserText, setLiveUserText] = useState("");
  const [liveAiText, setLiveAiText] = useState("");

  const wsRef = useRef<WebSocket | null>(null);
  const captureRef = useRef<ReturnType<typeof createAudioCapture> | null>(null);
  const playbackRef = useRef<ReturnType<typeof createAudioPlayback> | null>(null);
  const sessionIdRef = useRef<string>("");
  const sessionReadyRef = useRef(false);
  const aiTextBufferRef = useRef("");

  const cbRef = useRef({ onTurnEvent });
  useEffect(() => { cbRef.current = { onTurnEvent }; }, [onTurnEvent]);

  // ── teardown ─────────────────────────────────────────────────────────
  const teardown = useCallback(() => {
    sessionReadyRef.current = false;
    try { captureRef.current?.stop(); } catch { /* ignore */ }
    try { playbackRef.current?.close(); } catch { /* ignore */ }
    captureRef.current = null;
    playbackRef.current = null;

    const ws = wsRef.current;
    wsRef.current = null;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        if (sessionIdRef.current) ws.send(finishSessionFrame(sessionIdRef.current));
        ws.send(finishConnectionFrame());
      } catch { /* ignore */ }
      // Give the server a moment to send back FinishSession ACK before we yank
      setTimeout(() => { try { ws.close(); } catch { /* ignore */ } }, 250);
    } else if (ws) {
      try { ws.close(); } catch { /* ignore */ }
    }
  }, []);

  const close = useCallback(() => {
    teardown();
    setState("idle");
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

    sessionIdRef.current = crypto.randomUUID();
    aiTextBufferRef.current = "";

    let ws: WebSocket;
    try {
      ws = new WebSocket(relayUrl);
      ws.binaryType = "arraybuffer";
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "WS init failed");
      setState("error");
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
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
      setErrorMessage("WS 连接出错");
      setState("error");
    };

    ws.onclose = (e) => {
      // Don't override an already-set error
      setState((cur) => (cur === "error" ? cur : "idle"));
      sessionReadyRef.current = false;
      if (e.code !== 1000 && !errorMessage) {
        // Unexpected close
        setErrorMessage(`连接关闭 (${e.code})`);
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
          // Now send StartSession
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
          // Open mic + playback
          playbackRef.current = createAudioPlayback();
          playbackRef.current.onIdle = () => {
            // AI finished speaking → back to listening
            setState((cur) => (cur === "speaking" ? "listening" : cur));
          };
          captureRef.current = createAudioCapture((chunk) => {
            const w = wsRef.current;
            if (!w || w.readyState !== WebSocket.OPEN || !sessionReadyRef.current) return;
            try { w.send(audioFrame(sessionIdRef.current, chunk)); } catch { /* ignore */ }
          });
          captureRef.current.start().then(() => {
            setState("listening");
          }).catch((err) => {
            setErrorMessage("麦克风权限被拒绝：" + (err instanceof Error ? err.message : ""));
            setState("error");
            teardown();
          });
          return;
        }

        case EVT.ASRInfo: {
          // User just started speaking — barge-in: interrupt any AI playback
          if (playbackRef.current?.isPlaying()) {
            playbackRef.current.flush();
            try { ws.send(clientInterruptFrame(sessionIdRef.current)); } catch { /* ignore */ }
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
          cbRef.current.onTurnEvent?.({ kind: "user-text", text, isInterim: !!results[0].is_interim });
          return;
        }

        case EVT.ASREnded: {
          // User done — server will start replying soon
          const finalText = liveUserText;
          if (finalText) cbRef.current.onTurnEvent?.({ kind: "user-text-final", text: finalText });
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
          // payload is raw audio bytes (PCM 24kHz Int16 LE since we requested pcm_s16le)
          if (msgType === MSG.AUDIO_ONLY_RESP && payloadBytes.byteLength > 0) {
            // Make sure we have a Int16 view aligned to 2-byte boundary
            const bytes = payloadBytes;
            const aligned = (bytes.byteOffset % 2 === 0)
              ? new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1)
              : new Int16Array(bytes.slice().buffer);
            playbackRef.current?.play(aligned);
            setState("speaking");
          }
          return;
        }

        case EVT.TTSEnded: {
          // Wait for playback to drain (onIdle handler will flip back to listening)
          return;
        }

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

        default:
          return;
      }
    },
    [sessionConfig, teardown, liveUserText],
  );

  // Cleanup on unmount
  useEffect(() => () => teardown(), [teardown]);

  return { state, errorMessage, liveUserText, liveAiText, open, close };
}
