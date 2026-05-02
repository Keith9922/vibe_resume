"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { streamChat } from "@/lib/chat-stream";
import { generateId } from "@/lib/ids";
import { useSpeechToText } from "@/lib/use-stt";
import { useTextToSpeech } from "@/lib/use-tts";
import type { InterviewMessage, InterviewPhase } from "@/lib/types";

type VoiceState = "idle" | "listening" | "thinking" | "speaking";

type VoiceTurn = {
  /** null for the opening greeting (no user input yet). */
  userMessage: InterviewMessage | null;
  aiMessage: InterviewMessage;
  newPhase: InterviewPhase;
  newTurnCount: number;
};

type Props = {
  open: boolean;
  /** Live conversation state, captured at open and updated through onTurnComplete. */
  initialMessages: InterviewMessage[];
  jd: string | null;
  initialPhase: InterviewPhase;
  initialTurnCount: number;
  onClose: () => void;
  /** Called once per voice turn so the parent can persist the new state. */
  onTurnComplete: (turn: VoiceTurn) => void;
};

const PHASE_LABEL: Record<InterviewPhase, string> = {
  intro: "破冰",
  "topic-select": "选题",
  "deep-dive": "深挖",
  closing: "收尾",
  done: "完成",
};

/**
 * Full-screen voice conversation overlay.
 *
 * State machine: idle → speaking (greet) → listening → thinking → speaking → listening → ...
 *
 * - On open, we either greet (if no messages yet) or replay the last AI line so
 *   the conversation feels continuous.
 * - STT auto-finalises on silence (1.5s); the orb tap forces an early stop.
 * - While AI is speaking, the orb tap interrupts TTS and re-opens the mic.
 */
export function VoiceMode({ open, initialMessages, jd, initialPhase, initialTurnCount, onClose, onTurnComplete }: Props) {
  const [state, setState] = useState<VoiceState>("idle");
  const [userCaption, setUserCaption] = useState("");
  const [aiCaption, setAiCaption] = useState("");
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Live refs so the loop callbacks always see the latest snapshot
  const messagesRef = useRef<InterviewMessage[]>(initialMessages);
  const phaseRef = useRef<InterviewPhase>(initialPhase);
  const turnCountRef = useRef<number>(initialTurnCount);
  const stateRef = useRef<VoiceState>("idle");
  const aliveRef = useRef(true);

  useEffect(() => { stateRef.current = state; }, [state]);

  const tts = useTextToSpeech({ rate: 1.05 });

  // Forward refs to break the dependency cycle between STT callback and the loop.
  const startListeningRef = useRef<() => void>(() => {});
  const handleUserUtteranceRef = useRef<(text: string) => Promise<void>>(async () => {});

  const stt = useSpeechToText({
    silenceMs: 1500,
    onInterim: (text) => setUserCaption(text),
    onFinal: (text) => {
      if (!aliveRef.current) return;
      void handleUserUtteranceRef.current(text);
    },
    onError: (code) => {
      if (code === "no-speech" && aliveRef.current && stateRef.current === "listening") {
        // User didn't say anything — re-arm quietly
        startListeningRef.current();
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
        setState("speaking");
        // No TTS available — give the caption a comfortable read time then advance
        setTimeout(() => {
          if (aliveRef.current) after();
        }, Math.min(4500, 800 + text.length * 80));
        return;
      }
      setState("speaking");
      tts.speak(text, { onEnd: () => { if (aliveRef.current) after(); } });
    },
    [tts],
  );

  const handleUserUtterance = useCallback(
    async (text: string) => {
      if (!text.trim() || !aliveRef.current) return;
      setState("thinking");
      setUserCaption(text);

      const userMsg: InterviewMessage = {
        id: generateId("m"),
        role: "user",
        content: text,
        createdAt: new Date().toISOString(),
      };
      const newHistory = [...messagesRef.current, userMsg];
      const newTurnCount = turnCountRef.current + 1;
      messagesRef.current = newHistory;
      turnCountRef.current = newTurnCount;

      let aiText = "";
      let nextPhase: InterviewPhase = phaseRef.current;

      try {
        await streamChat(
          {
            messages: newHistory.map((m) => ({ role: m.role, content: m.content })),
            jd,
            phase: phaseRef.current,
            turnCount: newTurnCount,
          },
          {
            onChunk: (delta) => {
              aiText += delta;
              setAiCaption(aiText);
            },
            onMeta: (info) => { nextPhase = info.phase; },
            onError: (msg) => console.error("Stream error:", msg),
          },
        );
      } catch (err) {
        console.error(err);
        const fallback = "网络好像有点问题。要不再说一次？";
        const aiMsg: InterviewMessage = { id: generateId("m"), role: "assistant", content: fallback, createdAt: new Date().toISOString() };
        messagesRef.current = [...messagesRef.current, aiMsg];
        speakAndThen(fallback, startListening);
        onTurnComplete({ userMessage: userMsg, aiMessage: aiMsg, newPhase: phaseRef.current, newTurnCount });
        return;
      }

      const finalText = aiText.trim() || "嗯，我听到了。能再多说一点吗？";
      const aiMsg: InterviewMessage = { id: generateId("m"), role: "assistant", content: finalText, createdAt: new Date().toISOString() };
      messagesRef.current = [...messagesRef.current, aiMsg];
      phaseRef.current = nextPhase;
      onTurnComplete({ userMessage: userMsg, aiMessage: aiMsg, newPhase: nextPhase, newTurnCount });
      speakAndThen(finalText, startListening);
    },
    [jd, speakAndThen, startListening, onTurnComplete],
  );

  startListeningRef.current = startListening;
  handleUserUtteranceRef.current = handleUserUtterance;

  // Open / close lifecycle
  useEffect(() => {
    if (!open) return;
    aliveRef.current = true;
    setErrorBanner(null);
    setUserCaption("");
    messagesRef.current = initialMessages;
    phaseRef.current = initialPhase;
    turnCountRef.current = initialTurnCount;

    // Decide opening line: replay last AI message if conversation is in progress,
    // otherwise let the streaming endpoint generate a fresh greeting.
    const lastAi = [...initialMessages].reverse().find((m) => m.role === "assistant");
    if (lastAi) {
      speakAndThen(lastAi.content, startListening);
    } else {
      // Fire a turn-0 stream call to generate an opening question
      setState("thinking");
      let opening = "";
      let nextPhase: InterviewPhase = "intro";
      streamChat(
        { messages: [], jd, phase: "intro", turnCount: 0 },
        {
          onChunk: (delta) => { opening += delta; setAiCaption(opening); },
          onMeta: (info) => { nextPhase = info.phase; },
        },
      )
        .then(() => {
          if (!aliveRef.current) return;
          const text = opening.trim() || "嗨，先简单介绍一下你自己吧——现在在校还是已经工作了？";
          const aiMsg: InterviewMessage = { id: generateId("m"), role: "assistant", content: text, createdAt: new Date().toISOString() };
          messagesRef.current = [...messagesRef.current, aiMsg];
          phaseRef.current = nextPhase;
          onTurnComplete({ userMessage: null, aiMessage: aiMsg, newPhase: nextPhase, newTurnCount: 0 });
          speakAndThen(text, startListening);
        })
        .catch((err) => {
          console.error(err);
          setErrorBanner("教练初始化失败，请关闭重试。");
          setState("idle");
        });
    }

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

  // Tap centre orb to interrupt / advance
  const handleOrbTap = useCallback(() => {
    if (state === "speaking") {
      tts.cancel();
      startListening();
    } else if (state === "listening") {
      stt.stop();
    } else if (state === "idle") {
      startListening();
    }
    // 'thinking' → no-op
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
          <span className="voice-mode-dot" aria-hidden />
          <span>语音对话 · {PHASE_LABEL[phaseRef.current]}</span>
        </div>
        <button className="voice-mode-close" type="button" onClick={onClose} aria-label="退出语音模式">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="voice-mode-stage">
        <div className="voice-caption voice-caption-ai" aria-live="polite">
          {aiCaption || (state === "idle" ? "" : "...")}
        </div>

        <button
          type="button"
          className={`voice-orb voice-orb-${state}`}
          onClick={handleOrbTap}
          aria-label={stateLabel[state]}
        >
          <span className="voice-orb-glow" aria-hidden />
          <span className="voice-orb-pulse" aria-hidden />
          <span className="voice-orb-pulse voice-orb-pulse-2" aria-hidden />
          <span className="voice-orb-icon" aria-hidden>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </svg>
          </span>
        </button>

        <div className="voice-state-label">{stateLabel[state]}</div>

        <div className="voice-caption voice-caption-user" aria-live="polite">
          {userCaption}
        </div>
      </div>

      {errorBanner && <div className="voice-error" role="alert">{errorBanner}</div>}

      <div className="voice-mode-hint">
        {state === "speaking" && "点击中央可打断"}
        {state === "listening" && "讲完会自动收尾，也可以点击中央立即结束"}
        {state === "thinking" && "教练正在想下一个问题…"}
        {state === "idle" && "点击右上角 X 退出"}
      </div>
    </div>
  );
}
