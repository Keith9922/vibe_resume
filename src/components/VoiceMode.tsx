"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { generateId } from "@/lib/ids";
import { useVolcVoice, type VoiceTurnEvent } from "@/lib/use-volc-voice";
import type { InterviewMessage, InterviewPhase } from "@/lib/types";

type VoiceTurn = {
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

const RELAY_URL = process.env.NEXT_PUBLIC_VOICE_RELAY_URL || "wss://voice.zhangrg.top/voice";
const PHASE_LABEL: Record<InterviewPhase, string> = {
  intro: "开场",
  "topic-select": "聊经历",
  "deep-dive": "聊细节",
  closing: "收尾",
  done: "完成",
};

/**
 * Full-screen voice mode powered by 火山豆包端到端实时语音.
 *
 * Browser opens WebSocket to a server-side relay (voice.zhangrg.top) that holds
 * the auth headers and proxies frames byte-for-byte to the volc endpoint. The
 * model handles ASR, response generation, and TTS end-to-end → real "phone call"
 * latency, server-side VAD, and barge-in.
 */
export function VoiceMode({ open, initialMessages, jd, initialPhase, initialTurnCount, onClose, onTurnComplete }: Props) {
  const phaseRef = useRef<InterviewPhase>(initialPhase);
  const turnCountRef = useRef<number>(initialTurnCount);
  const userTurnRef = useRef<InterviewMessage | null>(null);

  // Build the StartSession payload from JD + conversation history. Sent verbatim
  // to volc, so it must match their schema exactly (asr.extra and tts.extra are
  // required to be objects, even if empty — empty triggers 42000020).
  const sessionConfig = useMemo(() => {
    const recentTurns = initialMessages
      .slice(-20)
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, text: m.content }));

    const systemRole = [
      "你是 Stori，一位有思考、有温度的简历教练。你和用户**自由地聊**，目的是把模糊的经历变成清晰、量化、有说服力的简历素材。",
      "对话风格：像朋友打电话，不要书面腔。听到模糊的（参与/负责/帮忙）要追问具体动作。听到结果就问数据，听到数据就问怎么做到的。",
      "一次只问一件事。用户聊得起劲就跟着聊，卡住就主动开新话题。绝不编造用户没说过的公司/数字/职位/学历。",
      jd ? `\n用户目标岗位（背景信息，不要直接复读）：${jd.slice(0, 1000)}` : "",
    ].filter(Boolean).join("\n");

    return {
      tts: {
        audio_config: { channel: 1, format: "pcm_s16le", sample_rate: 24000 },
        extra: {},
      },
      asr: {
        extra: { end_smooth_window_ms: 800 },
      },
      dialog: {
        bot_name: "Stori",
        system_role: systemRole,
        speaking_style: "温暖、自然、像朋友聊天。",
        dialog_context: recentTurns,
        extra: { input_mod: "keep_alive", model: "1.2.1.1" },
      },
    };
  }, [jd, initialMessages]);

  const handleTurnEvent = useCallback((evt: VoiceTurnEvent) => {
    if (evt.kind === "user-text-final") {
      // Capture user message; AI message will arrive shortly via ai-text-final
      const text = evt.text.trim();
      if (text) {
        userTurnRef.current = {
          id: generateId("m"), role: "user", content: text, createdAt: new Date().toISOString(),
        };
      }
      return;
    }
    if (evt.kind === "ai-text-final") {
      const text = evt.text.trim();
      if (!text) return;
      const aiMsg: InterviewMessage = {
        id: generateId("m"), role: "assistant", content: text, createdAt: new Date().toISOString(),
      };
      const userMsg = userTurnRef.current;
      userTurnRef.current = null;
      const newTurnCount = turnCountRef.current + 1;
      turnCountRef.current = newTurnCount;
      onTurnComplete({
        userMessage: userMsg, aiMessage: aiMsg,
        newPhase: phaseRef.current, newTurnCount,
      });
    }
  }, [onTurnComplete]);

  const voice = useVolcVoice({ relayUrl: RELAY_URL, sessionConfig, onTurnEvent: handleTurnEvent });

  // Open / close lifecycle
  useEffect(() => {
    if (open) {
      phaseRef.current = initialPhase;
      turnCountRef.current = initialTurnCount;
      userTurnRef.current = null;
      voice.open();
    } else {
      voice.close();
    }
    return () => { voice.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const [orbHint, setOrbHint] = useState<string | null>(null);
  useEffect(() => { setOrbHint(null); }, [voice.state]);

  const handleOrbTap = useCallback(() => {
    // 豆包 server-side VAD handles endpointing and barge-in for us. The orb tap
    // here is a no-op nudge to the user; we just show a brief hint.
    if (voice.state === "speaking") {
      setOrbHint("自然开口就能打断我");
    } else if (voice.state === "listening") {
      setOrbHint("我在听，慢慢说");
    } else if (voice.state === "thinking") {
      setOrbHint("我在想，稍等");
    } else if (voice.state === "connecting") {
      setOrbHint("正在连接豆包…");
    }
  }, [voice.state]);

  const handleEnd = useCallback(() => {
    voice.close();
    onClose();
  }, [voice, onClose]);

  if (!open) return null;

  const stateLabel = {
    idle: "未连接",
    connecting: "连接中…",
    listening: "在听你说",
    thinking: "在想…",
    speaking: "在说…",
    error: "出错了",
  }[voice.state];

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
          {voice.liveAiText || (voice.state === "idle" ? "" : "...")}
        </div>

        <button
          type="button"
          className={`voice-orb voice-orb-${voice.state}`}
          onClick={handleOrbTap}
          aria-label={stateLabel}
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

        <div className="voice-state-label">{stateLabel}</div>

        <div className="voice-caption voice-caption-user" aria-live="polite">
          {voice.liveUserText}
        </div>
      </div>

      {voice.errorMessage && <div className="voice-error" role="alert">{voice.errorMessage}</div>}

      <div className="voice-mode-hint" aria-live="polite">
        {orbHint || (
          voice.state === "speaking" ? "你随时可以开口打断我"
          : voice.state === "listening" ? "服务端 VAD 自动判断说完，无需手动结束"
          : voice.state === "thinking" ? "豆包正在生成回复…"
          : voice.state === "connecting" ? "正在连接豆包…"
          : voice.state === "error" ? "点右上角结束，或刷新页面重试"
          : "点击右上角结束通话"
        )}
      </div>
    </div>
  );
}
