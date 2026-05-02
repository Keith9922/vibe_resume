"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Web Speech API types
type AnySR = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: AnySREvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type AnySREvent = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    [index: number]: { transcript: string };
  }>;
};

interface VoiceInputProps {
  onTranscript: (text: string) => void;
  className?: string;
}

export function VoiceInput({ onTranscript, className }: VoiceInputProps) {
  const [recording, setRecording] = useState(false);
  const [supported, setSupported] = useState(false);
  const recRef = useRef<AnySR | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const SR =
      (window as unknown as { SpeechRecognition?: new () => AnySR }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => AnySR }).webkitSpeechRecognition;
    setSupported(Boolean(SR));
  }, []);

  const start = useCallback(() => {
    if (typeof window === "undefined") return;
    const SR =
      (window as unknown as { SpeechRecognition?: new () => AnySR }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => AnySR }).webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    r.continuous = false;
    r.interimResults = true;
    r.lang = "zh-CN";
    r.onresult = (event) => {
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) final += result[0].transcript;
      }
      if (final) onTranscript(final);
    };
    r.onerror = () => setRecording(false);
    r.onend = () => setRecording(false);
    r.start();
    recRef.current = r;
    setRecording(true);
  }, [onTranscript]);

  const stop = useCallback(() => {
    recRef.current?.stop();
    setRecording(false);
  }, []);

  if (!supported) return null;

  return (
    <button
      type="button"
      className={`voice-btn ${recording ? "recording" : ""} ${className ?? ""}`}
      onClick={recording ? stop : start}
      aria-label={recording ? "停止录音" : "开始语音输入"}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </svg>
      <span>{recording ? "录音中…" : "语音"}</span>
    </button>
  );
}
