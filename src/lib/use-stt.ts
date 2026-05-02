"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Web Speech API minimal types.
 *
 * The DOM lib types for SpeechRecognition are incomplete or missing in many TS
 * setups, so we declare just what we need. Casts are limited to the factory
 * lookup and event-shape narrowing.
 */
type SpeechRec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: SpeechRecEvent) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

type SpeechRecEvent = {
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
  resultIndex: number;
};

type SttOptions = {
  /** Called as the user is talking with the running transcript. */
  onInterim?: (text: string) => void;
  /** Called once when the user has stopped (silence timer or explicit stop). */
  onFinal?: (text: string) => void;
  /** Called on any error (no-speech, not-allowed, network). */
  onError?: (code: string) => void;
  /** Silence threshold in ms before auto-finalising. Default 1500ms. */
  silenceMs?: number;
  /** Max single utterance length in ms before forced cut. Default 30s. */
  maxUtteranceMs?: number;
};

type SttApi = {
  supported: boolean;
  isListening: boolean;
  /** Latest interim transcript (clears on stop). */
  interim: string;
  start: () => void;
  stop: () => void;
  /** Hard-abort without firing onFinal. */
  cancel: () => void;
};

const DEFAULT_SILENCE_MS = 1500;
const DEFAULT_MAX_MS = 30000;

export function useSpeechToText(options: SttOptions = {}): SttApi {
  const { onInterim, onFinal, onError, silenceMs = DEFAULT_SILENCE_MS, maxUtteranceMs = DEFAULT_MAX_MS } = options;

  const [supported, setSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [interim, setInterim] = useState("");

  const recRef = useRef<SpeechRec | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalTextRef = useRef("");
  const interimTextRef = useRef("");
  const aborted = useRef(false);

  // Latest-callback refs so we don't have to re-create the recognizer.
  const cbRef = useRef({ onInterim, onFinal, onError });
  useEffect(() => {
    cbRef.current = { onInterim, onFinal, onError };
  }, [onInterim, onFinal, onError]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    setSupported(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  const clearTimers = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (maxTimerRef.current) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
  }, []);

  const finalise = useCallback(() => {
    const text = (finalTextRef.current + interimTextRef.current).trim();
    finalTextRef.current = "";
    interimTextRef.current = "";
    setInterim("");
    clearTimers();
    if (text && !aborted.current) cbRef.current.onFinal?.(text);
  }, [clearTimers]);

  const stop = useCallback(() => {
    aborted.current = false;
    try {
      recRef.current?.stop();
    } catch {
      // already stopped
    }
  }, []);

  const cancel = useCallback(() => {
    aborted.current = true;
    finalTextRef.current = "";
    interimTextRef.current = "";
    setInterim("");
    clearTimers();
    try {
      recRef.current?.abort();
    } catch {
      // ignore
    }
  }, [clearTimers]);

  const armSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(() => {
      // Silence threshold reached → stop the recogniser; finalise() runs onend.
      try {
        recRef.current?.stop();
      } catch {
        // ignore
      }
    }, silenceMs);
  }, [silenceMs]);

  const start = useCallback(() => {
    if (!supported || isListening) return;

    const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;

    const rec = new Ctor();
    rec.lang = "zh-CN";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    aborted.current = false;
    finalTextRef.current = "";
    interimTextRef.current = "";

    rec.onstart = () => {
      setIsListening(true);
      armSilenceTimer();
      if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
      maxTimerRef.current = setTimeout(() => {
        try {
          rec.stop();
        } catch {
          // ignore
        }
      }, maxUtteranceMs);
    };

    rec.onresult = (e) => {
      let interimDelta = "";
      let finalDelta = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const t = r[0]?.transcript ?? "";
        if (r.isFinal) finalDelta += t;
        else interimDelta += t;
      }
      if (finalDelta) finalTextRef.current += finalDelta;
      interimTextRef.current = interimDelta;

      const combined = (finalTextRef.current + interimDelta).trim();
      setInterim(combined);
      cbRef.current.onInterim?.(combined);

      armSilenceTimer();
    };

    rec.onerror = (e) => {
      cbRef.current.onError?.(e.error || "unknown");
    };

    rec.onend = () => {
      setIsListening(false);
      finalise();
    };

    try {
      rec.start();
      recRef.current = rec;
    } catch (err) {
      console.error("STT start failed:", err);
      cbRef.current.onError?.("start-failed");
      setIsListening(false);
    }
  }, [supported, isListening, armSilenceTimer, finalise, maxUtteranceMs]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimers();
      try {
        recRef.current?.abort();
      } catch {
        // ignore
      }
    };
  }, [clearTimers]);

  return { supported, isListening, interim, start, stop, cancel };
}
