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
  initialMessages: InterviewMessage[];
  jd: string | null;
  initialPhase: InterviewPhase;
  initialTurnCount: number;
  onClose: () => void;
  onTurnComplete: (turn: VoiceTurn) => void;
};

const PHASE_LABEL: Record<InterviewPhase, string> = {
  intro: "开场",
  "topic-select": "聊经历",
  "deep-dive": "聊细节",
  closing: "收尾",
  done: "完成",
};

/**
 * Full-screen voice conversation overlay.
 *
 * State machine:  idle ─▶ speaking (greet) ─▶ listening ─▶ thinking ─▶ speaking ─▶ listening …
 *
 * Reliability invariants:
 *  - The orb tap ALWAYS does something visible (no silent no-op).
 *  - STT.onFinal always fires on stop (even with empty transcript) so the loop
 *    can never get wedged in the listening state.
 *  - Empty utterances (no speech detected) gently nudge the user to retry
 *    instead of silently rebooting the mic forever.
 *  - A visible "结束" button in the header is the always-available escape hatch.
 */
export function VoiceMode({ open, initialMessages, jd, initialPhase, initialTurnCount, onClose, onTurnComplete }: Props) {
  const [state, setState] = useState<VoiceState>("idle");
  const [userCaption, setUserCaption] = useState("");
  const [aiCaption, setAiCaption] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Live refs so loop callbacks always see latest snapshot
  const messagesRef = useRef<InterviewMessage[]>(initialMessages);
  const phaseRef = useRef<InterviewPhase>(initialPhase);
  const turnCountRef = useRef<number>(initialTurnCount);
  const stateRef = useRef<VoiceState>("idle");
  const aliveRef = useRef(true);
  // Number of consecutive empty STT results — bail out of retry loop after a few
  const emptyStrikesRef = useRef(0);

  useEffect(() => { stateRef.current = state; }, [state]);

  const tts = useTextToSpeech({ rate: 1.05 });

  // Forward refs to break the dependency cycle between STT callbacks and the loop
  const startListeningRef = useRef<() => void>(() => {});
  const handleUserUtteranceRef = useRef<(text: string) => Promise<void>>(async () => {});
  const handleEmptyTranscriptRef = useRef<() => void>(() => {});

  const stt = useSpeechToText({
    silenceMs: 1200,
    onInterim: (text) => setUserCaption(text),
    onFinal: (text) => {
      if (!aliveRef.current) return;
      const cleaned = text.trim();
      if (cleaned) {
        emptyStrikesRef.current = 0;
        void handleUserUtteranceRef.current(cleaned);
      } else {
        handleEmptyTranscriptRef.current();
      }
    },
    onError: (code) => {
      if (code === "not-allowed") {
        setErrorBanner("麦克风权限被拒绝，请在浏览器地址栏左侧允许麦克风。");
        setState("idle");
        return;
      }
      // For 'no-speech', 'aborted', etc. let the regular onend → onFinal flow
      // handle the empty transcript path. Don't fight it here.
      console.warn("STT error:", code);
    },
  });

  // ── State transitions ──────────────────────────────────────────────────

  const startListening = useCallback(() => {
    if (!aliveRef.current) return;
    setUserCaption("");
    setHint(null);
    setState("listening");
    if (stt.supported) {
      stt.start();
    } else {
      setErrorBanner("当前浏览器不支持语音识别。请改用 Chrome / Edge / Safari 14+。");
      setState("idle");
    }
  }, [stt]);

  const handleEmptyTranscript = useCallback(() => {
    if (!aliveRef.current) return;
    emptyStrikesRef.current += 1;
    setUserCaption("");
    if (emptyStrikesRef.current >= 3) {
      // Give up the auto-retry loop — let the user kick it off again
      setHint("没听清，点中间圆球再试一次。");
      setState("idle");
      return;
    }
    setHint("没听清，再说一次试试…");
    // Brief pause, then retry mic
    setTimeout(() => {
      if (aliveRef.current && stateRef.current !== "speaking" && stateRef.current !== "thinking") {
        startListening();
      }
    }, 800);
  }, [startListening]);

  const speakAndThen = useCallback(
    (text: string, after: () => void) => {
      setAiCaption(text);
      setHint(null);
      setState("speaking");

      // Hard safety net so the orb never gets stuck even if both TTS engines fail to fire onEnd
      const maxMs = Math.min(60_000, 4000 + text.length * 250);
      let advanced = false;
      const advance = () => {
        if (advanced) return;
        advanced = true;
        if (aliveRef.current) after();
      };
      const safetyTimer = setTimeout(advance, maxMs);

      if (!tts.supported) {
        const readMs = Math.min(8000, 1000 + text.length * 100);
        setTimeout(() => { clearTimeout(safetyTimer); advance(); }, readMs);
        return;
      }

      tts.speak(text, {
        onEnd: () => { clearTimeout(safetyTimer); advance(); },
      });
    },
    [tts],
  );

  const handleUserUtterance = useCallback(
    async (text: string) => {
      if (!text || !aliveRef.current) return;
      setState("thinking");
      setHint(null);
      setUserCaption(text);

      const userMsg: InterviewMessage = {
        id: generateId("m"), role: "user", content: text, createdAt: new Date().toISOString(),
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
            onChunk: (delta) => { aiText += delta; setAiCaption(aiText); },
            onMeta: (info) => { nextPhase = info.phase; },
            onError: (msg) => console.error("Stream error:", msg),
          },
        );
      } catch (err) {
        console.error(err);
        const fallback = "网络好像有点问题，能再说一次吗？";
        const aiMsg: InterviewMessage = {
          id: generateId("m"), role: "assistant", content: fallback, createdAt: new Date().toISOString(),
        };
        messagesRef.current = [...messagesRef.current, aiMsg];
        onTurnComplete({ userMessage: userMsg, aiMessage: aiMsg, newPhase: phaseRef.current, newTurnCount });
        speakAndThen(fallback, startListening);
        return;
      }

      const finalText = aiText.trim() || "嗯，我听到了。能再多说一点吗？";
      const aiMsg: InterviewMessage = {
        id: generateId("m"), role: "assistant", content: finalText, createdAt: new Date().toISOString(),
      };
      messagesRef.current = [...messagesRef.current, aiMsg];
      phaseRef.current = nextPhase;
      onTurnComplete({ userMessage: userMsg, aiMessage: aiMsg, newPhase: nextPhase, newTurnCount });
      speakAndThen(finalText, startListening);
    },
    [jd, speakAndThen, startListening, onTurnComplete],
  );

  startListeningRef.current = startListening;
  handleUserUtteranceRef.current = handleUserUtterance;
  handleEmptyTranscriptRef.current = handleEmptyTranscript;

  // ── Open / close lifecycle ─────────────────────────────────────────────

  useEffect(() => {
    if (!open) return;
    aliveRef.current = true;
    emptyStrikesRef.current = 0;
    setErrorBanner(null);
    setUserCaption("");
    setHint(null);
    messagesRef.current = initialMessages;
    phaseRef.current = initialPhase;
    turnCountRef.current = initialTurnCount;

    const lastAi = [...initialMessages].reverse().find((m) => m.role === "assistant");
    if (lastAi) {
      // Conversation in progress — replay last AI line so it feels continuous
      speakAndThen(lastAi.content, startListening);
    } else {
      // Fresh start — let the streaming endpoint generate an opening
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
          const text = opening.trim() || "嗨，先随便聊聊吧——你最近在忙啥？";
          const aiMsg: InterviewMessage = {
            id: generateId("m"), role: "assistant", content: text, createdAt: new Date().toISOString(),
          };
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
      setHint(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ── User actions ───────────────────────────────────────────────────────

  /** Tap the central orb. Always does something visible — never a silent no-op. */
  const handleOrbTap = useCallback(() => {
    if (state === "speaking") {
      // Interrupt AI, jump straight to listening
      tts.cancel();
      startListening();
      return;
    }
    if (state === "listening") {
      // If we already have something in interim, ship it. Otherwise treat as
      // "user gave up this turn" — go back to idle, wait for next tap.
      const interim = stt.interim.trim();
      if (interim) {
        // Force-finalise via stop(); STT will fire onFinal with the interim text
        stt.stop();
      } else {
        stt.cancel();
        emptyStrikesRef.current = 0;
        setState("idle");
        setHint("点击中间圆球继续说话。");
      }
      return;
    }
    if (state === "idle") {
      startListening();
      return;
    }
    // 'thinking' — already busy; tell the user we're working
    setHint("教练在想下一句…稍等。");
  }, [state, tts, stt, startListening]);

  /** Big "结束" button — always works. Cancels STT, TTS, exits modal. */
  const handleEnd = useCallback(() => {
    tts.cancel();
    stt.cancel();
    onClose();
  }, [tts, stt, onClose]);

  if (!open) return null;

  const stateLabel: Record<VoiceState, string> = {
    idle: "点中间开始",
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
        <button className="voice-mode-end" type="button" onClick={handleEnd} aria-label="结束语音通话">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
          <span>结束</span>
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

      <div className="voice-mode-hint" aria-live="polite">
        {hint || (
          state === "speaking" ? "点中间可打断"
          : state === "listening" ? "讲完会自动收尾，也可以点中间立即结束"
          : state === "thinking" ? "教练正在想下一句…"
          : "点击右上角结束通话"
        )}
      </div>
    </div>
  );
}
