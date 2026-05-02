"use client";

import { Mic, Phone, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { streamChat } from "@/lib/chat-stream";
import { createId, nowIso } from "@/lib/ids";
import { useSpeechToText } from "@/lib/use-stt";
import { useTextToSpeech } from "@/lib/use-tts";
import type { ChatMessage, JobAnalysis, StoryCard } from "@/lib/types";

type VoiceState = "idle" | "listening" | "thinking" | "speaking";

type Props = {
  open: boolean;
  history: ChatMessage[];
  jobAnalysis: JobAnalysis | null;
  stories: StoryCard[];
  /** Greeting spoken on open. */
  openingLine: string;
  onClose: () => void;
  /** Called for each completed turn so the parent can update chat + stories. */
  onTurnComplete: (turn: { userMessage: ChatMessage; aiMessage: ChatMessage; story: StoryCard | null }) => void;
};

export function VoiceMode({ open, history, jobAnalysis, stories, openingLine, onClose, onTurnComplete }: Props) {
  const [state, setState] = useState<VoiceState>("idle");
  const [userCaption, setUserCaption] = useState("");
  const [aiCaption, setAiCaption] = useState("");
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Refs to avoid stale closures inside the state machine
  const historyRef = useRef(history);
  const jdRef = useRef(jobAnalysis);
  const storiesRef = useRef(stories);
  const stateRef = useRef<VoiceState>("idle");
  const aliveRef = useRef(true);
  useEffect(() => { historyRef.current = history; }, [history]);
  useEffect(() => { jdRef.current = jobAnalysis; }, [jobAnalysis]);
  useEffect(() => { storiesRef.current = stories; }, [stories]);
  useEffect(() => { stateRef.current = state; }, [state]);

  const tts = useTextToSpeech({ rate: 1.05 });

  // Forward declarations so the STT callback can call into the loop.
  const startListeningRef = useRef<() => void>(() => {});
  const handleUserUtteranceRef = useRef<(text: string) => Promise<void>>(async () => {});

  const stt = useSpeechToText({
    onInterim: (text) => setUserCaption(text),
    onFinal: (text) => {
      if (!aliveRef.current) return;
      void handleUserUtteranceRef.current(text);
    },
    onError: (code) => {
      if (code === "no-speech") {
        // User didn't say anything — quietly re-arm the mic.
        if (aliveRef.current && stateRef.current === "listening") {
          startListeningRef.current();
        }
        return;
      }
      if (code === "not-allowed") {
        setErrorBanner("麦克风权限被拒绝，请在浏览器地址栏左侧允许麦克风。");
        setState("idle");
        return;
      }
      console.warn("STT error:", code);
    },
  });

  const startListening = useCallback(() => {
    if (!aliveRef.current) return;
    setUserCaption("");
    setState("listening");
    if (stt.supported) {
      stt.start();
    } else {
      setErrorBanner("当前浏览器不支持语音识别。请改用 Chrome / Edge / Safari 14+。");
      setState("idle");
    }
  }, [stt]);

  const speakAndThen = useCallback(
    (text: string, after: () => void) => {
      setAiCaption(text);
      if (!tts.supported) {
        // No TTS — just show the caption and proceed
        setState("speaking");
        setTimeout(() => {
          if (aliveRef.current) after();
        }, Math.min(4000, 800 + text.length * 80));
        return;
      }
      setState("speaking");
      tts.speak(text, {
        onEnd: () => {
          if (aliveRef.current) after();
        },
      });
    },
    [tts],
  );

  const handleUserUtterance = useCallback(
    async (text: string) => {
      if (!text.trim() || !aliveRef.current) return;
      setState("thinking");
      setUserCaption(text);

      const userMsg: ChatMessage = { id: createId("msg"), role: "user", content: text, createdAt: nowIso() };
      const newHistory = [...historyRef.current, userMsg];
      historyRef.current = newHistory;

      let aiText = "";
      let extracted: StoryCard | null = null;

      try {
        await streamChat(
          { mode: "voice", history: newHistory, jobAnalysis: jdRef.current, stories: storiesRef.current },
          {
            onChunk: (delta) => {
              aiText += delta;
              setAiCaption(aiText);
            },
            onMeta: (story) => { extracted = story; },
            onError: (msg) => { console.error("Stream error:", msg); },
          },
        );
      } catch (err) {
        console.error(err);
        const fallback = "网络好像有点问题。要不再说一次？";
        const aiMsg: ChatMessage = { id: createId("msg"), role: "assistant", content: fallback, createdAt: nowIso() };
        speakAndThen(fallback, startListening);
        onTurnComplete({ userMessage: userMsg, aiMessage: aiMsg, story: null });
        return;
      }

      const finalText = aiText.trim() || "嗯，我听到了。再多说一点？";
      const aiMsg: ChatMessage = { id: createId("msg"), role: "assistant", content: finalText, createdAt: nowIso() };
      historyRef.current = [...historyRef.current, aiMsg];
      onTurnComplete({ userMessage: userMsg, aiMessage: aiMsg, story: extracted });
      speakAndThen(finalText, startListening);
    },
    [speakAndThen, startListening, onTurnComplete],
  );

  startListeningRef.current = startListening;
  handleUserUtteranceRef.current = handleUserUtterance;

  // Open / close lifecycle
  useEffect(() => {
    if (!open) return;
    aliveRef.current = true;
    setErrorBanner(null);
    setUserCaption("");

    // Speak the opening, then start listening
    speakAndThen(openingLine, startListening);

    return () => {
      aliveRef.current = false;
      tts.cancel();
      stt.cancel();
      setState("idle");
      setAiCaption("");
      setUserCaption("");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Tap centre circle: interrupt
  const handleCircleTap = useCallback(() => {
    if (state === "speaking") {
      tts.cancel();
      startListening();
    } else if (state === "listening") {
      // Force-finalise whatever the user has said
      stt.stop();
    } else if (state === "idle") {
      startListening();
    }
    // 'thinking' → no-op (waiting on AI)
  }, [state, tts, stt, startListening]);

  if (!open) return null;

  const stateLabel: Record<VoiceState, string> = {
    idle: "点击中央开始",
    listening: "在听你说…",
    thinking: "在想…",
    speaking: "在说…",
  };

  return (
    <div className="voice-mode" role="dialog" aria-modal="true" aria-label="语音对话模式">
      <div className="voice-mode-header">
        <div className="voice-mode-title">
          <Phone size={14} />
          <span>语音对话</span>
        </div>
        <button className="voice-mode-close" type="button" onClick={onClose} aria-label="退出语音模式">
          <X size={20} />
        </button>
      </div>

      <div className="voice-mode-stage">
        <div className="voice-caption voice-caption-ai" aria-live="polite">
          {aiCaption || (state === "idle" ? "" : "...")}
        </div>

        <button
          type="button"
          className={`voice-orb voice-orb-${state}`}
          onClick={handleCircleTap}
          aria-label={stateLabel[state]}
        >
          <span className="voice-orb-glow" aria-hidden="true" />
          <span className="voice-orb-pulse" aria-hidden="true" />
          <span className="voice-orb-pulse voice-orb-pulse-2" aria-hidden="true" />
          <span className="voice-orb-icon">
            <Mic size={36} />
          </span>
        </button>

        <div className="voice-state-label">{stateLabel[state]}</div>

        <div className="voice-caption voice-caption-user" aria-live="polite">
          {userCaption}
        </div>
      </div>

      {errorBanner && (
        <div className="voice-error" role="alert">{errorBanner}</div>
      )}

      <div className="voice-mode-hint">
        {state === "speaking" && "点击中央可打断"}
        {state === "listening" && "讲完后会自动收尾，也可以点击中央立即结束"}
        {state === "thinking" && "请稍等"}
        {state === "idle" && "点击右上角 X 退出"}
      </div>
    </div>
  );
}
