"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type TtsOptions = {
  rate?: number;
  pitch?: number;
  /** Preferred BCP-47 prefix for browser fallback. Default zh. */
  langPrefix?: string;
};

type SpeakOptions = { onStart?: () => void; onEnd?: () => void };

type TtsApi = {
  supported: boolean;
  isSpeaking: boolean;
  speak: (text: string, opts?: SpeakOptions) => void;
  cancel: () => void;
  /** Which engine actually played the most recent utterance. */
  lastEngine: "minimax" | "browser" | null;
};

/**
 * Two-tier TTS:
 *   1. Try /api/tts (MiniMax proxy) → play returned mp3 with HTMLAudioElement
 *   2. On any failure, fall back to browser SpeechSynthesis. Mark MiniMax as
 *      unavailable for the rest of the session so we don't keep paying the
 *      round-trip cost.
 *
 * The proxy returns 503 with a JSON body when MiniMax TTS is unconfigured,
 * the plan doesn't support it, or the API errors — any non-200 triggers fallback.
 */
export function useTextToSpeech(options: TtsOptions = {}): TtsApi {
  const { rate = 1.0, pitch = 1.0, langPrefix = "zh" } = options;

  const [supported, setSupported] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [lastEngine, setLastEngine] = useState<"minimax" | "browser" | null>(null);

  const browserVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const minimaxAvailableRef = useRef<boolean>(true);
  // Increments on every cancel / new speak so stale callbacks no-op.
  const tokenRef = useRef(0);

  // ── Browser-side feature detect + voice picking ─────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Always advertise as supported; the MiniMax proxy may work even when the
    // browser has no zh voice installed.
    setSupported(true);

    if (!("speechSynthesis" in window)) return;
    const pickVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length === 0) return;
      const zhVoices = voices.filter((v) => v.lang.toLowerCase().startsWith(langPrefix));
      const localZhCn = zhVoices.find((v) => v.localService && v.lang.toLowerCase().startsWith("zh-cn"));
      const anyZhCn = zhVoices.find((v) => v.lang.toLowerCase().startsWith("zh-cn"));
      browserVoiceRef.current = localZhCn || anyZhCn || zhVoices[0] || voices[0] || null;
    };
    pickVoice();
    window.speechSynthesis.addEventListener("voiceschanged", pickVoice);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", pickVoice);
  }, [langPrefix]);

  const cancel = useCallback(() => {
    tokenRef.current += 1;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }, []);

  const speakWithBrowser = useCallback(
    (text: string, myToken: number, opts: SpeakOptions) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        // Last-resort: estimate read time and fire onEnd so caller advances
        opts.onStart?.();
        const ms = Math.min(6000, 800 + text.length * 80);
        setTimeout(() => {
          if (myToken !== tokenRef.current) return;
          setIsSpeaking(false);
          opts.onEnd?.();
        }, ms);
        return;
      }

      window.speechSynthesis.cancel();
      const sentences = splitForBrowserTts(text);
      let finished = 0;
      let started = false;

      sentences.forEach((sentence, idx) => {
        const u = new SpeechSynthesisUtterance(sentence);
        if (browserVoiceRef.current) u.voice = browserVoiceRef.current;
        u.lang = browserVoiceRef.current?.lang || "zh-CN";
        u.rate = rate;
        u.pitch = pitch;

        if (idx === 0) {
          u.onstart = () => {
            if (myToken !== tokenRef.current) return;
            started = true;
            setIsSpeaking(true);
            setLastEngine("browser");
            opts.onStart?.();
          };
        }

        const advance = () => {
          if (myToken !== tokenRef.current) return;
          finished += 1;
          if (finished >= sentences.length) {
            setIsSpeaking(false);
            opts.onEnd?.();
          }
        };
        u.onend = advance;
        u.onerror = advance;

        window.speechSynthesis.speak(u);
      });

      // Browser TTS occasionally swallows utterances silently; guarantee onStart fires
      setTimeout(() => {
        if (myToken === tokenRef.current && !started) {
          opts.onStart?.();
          started = true;
        }
      }, 600);
    },
    [rate, pitch],
  );

  const speak = useCallback(
    (text: string, opts: SpeakOptions = {}) => {
      const trimmed = text.trim();
      if (!trimmed) {
        opts.onEnd?.();
        return;
      }

      cancel();
      const myToken = tokenRef.current;

      // Tier 1: MiniMax proxy (only if not previously failed this session)
      if (!minimaxAvailableRef.current) {
        speakWithBrowser(trimmed, myToken, opts);
        return;
      }

      fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      })
        .then(async (res) => {
          if (myToken !== tokenRef.current) return;
          if (!res.ok) {
            const reason = await res.json().catch(() => null);
            console.warn("MiniMax TTS unavailable, falling back:", reason?.reason ?? res.status);
            minimaxAvailableRef.current = false;
            speakWithBrowser(trimmed, myToken, opts);
            return;
          }
          const blob = await res.blob();
          if (myToken !== tokenRef.current) return;

          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audioRef.current = audio;

          let started = false;
          const finish = () => {
            if (myToken !== tokenRef.current) return;
            URL.revokeObjectURL(url);
            audioRef.current = null;
            setIsSpeaking(false);
            opts.onEnd?.();
          };
          audio.addEventListener("playing", () => {
            if (myToken !== tokenRef.current || started) return;
            started = true;
            setIsSpeaking(true);
            setLastEngine("minimax");
            opts.onStart?.();
          });
          audio.addEventListener("ended", finish);
          audio.addEventListener("error", () => {
            console.warn("Audio playback error, falling back to browser TTS");
            URL.revokeObjectURL(url);
            audioRef.current = null;
            speakWithBrowser(trimmed, myToken, opts);
          });

          audio.play().catch((err) => {
            console.warn("audio.play() rejected:", err);
            URL.revokeObjectURL(url);
            audioRef.current = null;
            speakWithBrowser(trimmed, myToken, opts);
          });
        })
        .catch((err) => {
          if (myToken !== tokenRef.current) return;
          console.warn("MiniMax TTS fetch error, falling back:", err);
          minimaxAvailableRef.current = false;
          speakWithBrowser(trimmed, myToken, opts);
        });
    },
    [cancel, speakWithBrowser],
  );

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  return { supported, isSpeaking, speak, cancel, lastEngine };
}

/** Split a string into TTS-friendly sentence chunks. Browser SpeechSynthesis
 *  on Chrome cuts off at ~250 chars per utterance; we batch by sentence. */
function splitForBrowserTts(text: string, maxLen = 120): string[] {
  const result: string[] = [];
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
