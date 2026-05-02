"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type TtsOptions = {
  rate?: number;
  pitch?: number;
  /** Preferred BCP-47 prefix; default zh. */
  langPrefix?: string;
};

type TtsApi = {
  supported: boolean;
  isSpeaking: boolean;
  speak: (text: string, opts?: { onStart?: () => void; onEnd?: () => void }) => void;
  cancel: () => void;
};

/**
 * Browser SpeechSynthesis wrapper.
 *
 * - Picks the best Chinese voice once voices have loaded
 * - Long text is split into ~120-char sentences before queueing, otherwise
 *   Chrome's synthesizer cuts off at ~250 chars
 * - cancel() flushes the queue immediately
 */
export function useTextToSpeech(options: TtsOptions = {}): TtsApi {
  const { rate = 1.0, pitch = 1.0, langPrefix = "zh" } = options;
  const [supported, setSupported] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const utteranceCountRef = useRef(0);
  const finishedCountRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setSupported(false);
      return;
    }
    setSupported(true);

    const pickVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length === 0) return;
      const zhVoices = voices.filter((v) => v.lang.toLowerCase().startsWith(langPrefix));
      // Prefer (1) local zh-CN voices, (2) any zh-CN, (3) any zh.
      const localZhCn = zhVoices.find((v) => v.localService && v.lang.toLowerCase().startsWith("zh-cn"));
      const anyZhCn = zhVoices.find((v) => v.lang.toLowerCase().startsWith("zh-cn"));
      voiceRef.current = localZhCn || anyZhCn || zhVoices[0] || voices[0] || null;
    };

    pickVoice();
    window.speechSynthesis.addEventListener("voiceschanged", pickVoice);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", pickVoice);
  }, [langPrefix]);

  const cancel = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    utteranceCountRef.current = 0;
    finishedCountRef.current = 0;
    setIsSpeaking(false);
  }, []);

  const speak = useCallback(
    (text: string, opts: { onStart?: () => void; onEnd?: () => void } = {}) => {
      if (!supported || !text.trim()) return;
      // Flush any in-progress speech
      window.speechSynthesis.cancel();
      utteranceCountRef.current = 0;
      finishedCountRef.current = 0;

      const sentences = splitForTts(text);
      utteranceCountRef.current = sentences.length;

      sentences.forEach((sentence, idx) => {
        const u = new SpeechSynthesisUtterance(sentence);
        if (voiceRef.current) u.voice = voiceRef.current;
        u.lang = voiceRef.current?.lang || "zh-CN";
        u.rate = rate;
        u.pitch = pitch;

        if (idx === 0) {
          u.onstart = () => {
            setIsSpeaking(true);
            opts.onStart?.();
          };
        }

        u.onend = () => {
          finishedCountRef.current += 1;
          if (finishedCountRef.current >= utteranceCountRef.current) {
            setIsSpeaking(false);
            opts.onEnd?.();
          }
        };
        u.onerror = () => {
          finishedCountRef.current += 1;
          if (finishedCountRef.current >= utteranceCountRef.current) {
            setIsSpeaking(false);
            opts.onEnd?.();
          }
        };

        window.speechSynthesis.speak(u);
      });
    },
    [supported, rate, pitch],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  return { supported, isSpeaking, speak, cancel };
}

/** Split a string into TTS-friendly chunks at sentence boundaries. */
function splitForTts(text: string, maxLen = 120): string[] {
  const result: string[] = [];
  // Split at Chinese / English sentence enders, keep delimiters
  const parts = text.split(/([。！？!?\n]+)/).filter(Boolean);
  let buffer = "";
  for (let i = 0; i < parts.length; i++) {
    buffer += parts[i];
    const next = parts[i + 1] ?? "";
    if (/[。！？!?\n]/.test(next)) {
      buffer += next;
      i++;
    }
    if (buffer.length >= maxLen || i >= parts.length - 1) {
      const trimmed = buffer.trim();
      if (trimmed) result.push(trimmed);
      buffer = "";
    }
  }
  return result.length > 0 ? result : [text];
}
