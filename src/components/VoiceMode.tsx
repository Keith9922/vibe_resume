"use client";

/**
 * VoiceMode — the full-screen real-time voice conversation overlay.
 *
 * Architecture: this file is a single component composed of section sub-
 * components defined inline (kept here so the state flow is visible at a
 * glance — they all share the same hook outputs).
 *
 * Layout:
 *   ┌────────────────────────────────────────────────────────┐
 *   │ TopBar:  ⏱ timer · N 段 ·          [✨ 立即整理] [挂断] │
 *   │ Stage:   AI caption / orb (mic level) / user caption / │
 *   │          story sidebar (right column on desktop)       │
 *   │ BottomBar: 🔇 / 📜 / tip                                │
 *   └────────────────────────────────────────────────────────┘
 *
 * The orb's pulse animation is augmented with the mic RMS so it visibly
 * reacts to the user's voice. Barge-in flashes the orb orange briefly.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { generateId } from "@/lib/ids";
import { relayHttpsBase, useConversationProgress } from "@/lib/use-conversation-progress";
import {
  useVolcVoice, type ConnectStep, type VoiceTurnEvent, type VoiceUiState,
} from "@/lib/use-volc-voice";
import type { InterviewMessage, InterviewPhase } from "@/lib/types";

const RELAY_URL = process.env.NEXT_PUBLIC_VOICE_RELAY_URL || "wss://voice.zhangrg.top/voice";

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
  /** Called when user (or auto-wrap) opts to synthesise a resume right now. */
  onSynthesizeNow?: () => void;
};

// ──────────────────────────────────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────────────────────────────────

export function VoiceMode({
  open, initialMessages, jd, initialPhase, initialTurnCount, onClose, onTurnComplete, onSynthesizeNow,
}: Props) {
  const phaseRef = useRef<InterviewPhase>(initialPhase);
  const turnCountRef = useRef<number>(initialTurnCount);
  const userTurnRef = useRef<InterviewMessage | null>(null);
  const nudgeSentRef = useRef(false);

  // Per-render UI state
  const [callStartMs, setCallStartMs] = useState<number | null>(null);
  const [callDurationMs, setCallDurationMs] = useState(0);
  const [userTurnCount, setUserTurnCount] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<Array<{ role: "user" | "assistant"; text: string; ts: number }>>([]);

  // Build StartSession payload (system prompt + JD + history seed)
  const sessionConfig = useMemo(() => buildSessionConfig(jd, initialMessages), [jd, initialMessages]);

  // Per-turn handler — stitches transcript into the global Stori state
  const handleTurnEvent = useCallback((evt: VoiceTurnEvent) => {
    const ts = Date.now();
    if (evt.kind === "user-text-final") {
      const text = evt.text.trim();
      if (!text) return;
      userTurnRef.current = {
        id: generateId("m"), role: "user", content: text, createdAt: new Date().toISOString(),
      };
      setHistory((h) => [...h, { role: "user", text, ts }]);
      setUserTurnCount((n) => n + 1);
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
      setHistory((h) => [...h, { role: "assistant", text, ts }]);
      onTurnComplete({
        userMessage: userMsg, aiMessage: aiMsg,
        newPhase: phaseRef.current, newTurnCount,
      });
    }
  }, [onTurnComplete]);

  const voice = useVolcVoice({ relayUrl: RELAY_URL, sessionConfig, onTurnEvent: handleTurnEvent });

  // Live progress polling — only active during a real session
  const progress = useConversationProgress({
    sessionId: voice.state === "idle" || voice.state === "connecting" || voice.state === "error" ? null : voice.sessionId,
    userTurnCount,
    pollEveryNTurns: 2,
    minIntervalMs: 6000,
    transcriptBaseUrl: relayHttpsBase(RELAY_URL),
  });

  // Lifecycle: open/close + reset state
  useEffect(() => {
    if (open) {
      phaseRef.current = initialPhase;
      turnCountRef.current = initialTurnCount;
      userTurnRef.current = null;
      nudgeSentRef.current = false;
      setHistory([]);
      setUserTurnCount(0);
      setCallStartMs(Date.now());
      setCallDurationMs(0);
      voice.open();
    } else {
      voice.close();
      setCallStartMs(null);
    }
    return () => { voice.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Live timer — ticks every 1s while connected
  useEffect(() => {
    if (callStartMs === null) return;
    const tick = setInterval(() => setCallDurationMs(Date.now() - callStartMs), 1000);
    return () => clearInterval(tick);
  }, [callStartMs]);

  // Auto-wrap nudge — when progress is "ready" AND state is listening AND not yet nudged
  useEffect(() => {
    if (!progress.ready_to_wrap) return;
    if (nudgeSentRef.current) return;
    if (voice.state !== "listening") return;
    nudgeSentRef.current = true;
    voice.sendSayHello("现在我们攒到的素材已经够整理一版简历了。请用温和、自然的语气主动建议一下：'我们聊到的这些已经够攒一版简历草稿了，要不要现在帮你整理出来？'。如果用户答应就停下不要再问，等系统接管；如果用户想继续，那就继续陪 ta 聊。");
  }, [progress.ready_to_wrap, voice.state, voice]);

  // Handlers
  const handleEnd = useCallback(() => { voice.close(); onClose(); }, [voice, onClose]);
  const handleSynthesize = useCallback(() => {
    voice.close();
    onClose();
    onSynthesizeNow?.();
  }, [voice, onClose, onSynthesizeNow]);

  if (!open) return null;

  return (
    <div className="voice-mode" role="dialog" aria-modal="true" aria-label="语音对话模式">
      <TopBar
        callDurationMs={callDurationMs}
        storyCount={progress.stories.length}
        completeness={progress.completeness}
        canSynthesize={progress.totalScore >= 6 || userTurnCount >= 4}
        onSynthesize={handleSynthesize}
        onEnd={handleEnd}
      />

      <div className="voice-mode-stage-wrap">
        <Stage
          state={voice.state}
          connectStep={voice.connectStep}
          aiCaption={voice.liveAiText}
          userCaption={voice.liveUserText}
          micLevel={voice.micLevel}
          bargeInFlash={voice.bargeInFlash}
          isMuted={voice.isMuted}
        />
        <Sidebar progress={progress} />
      </div>

      {voice.errorMessage && (
        <div className="voice-error" role="alert">{voice.errorMessage}</div>
      )}

      {progress.hint && voice.state !== "connecting" && (
        <div className="voice-progress-hint" aria-live="polite">💡 {progress.hint}</div>
      )}

      <BottomBar
        isMuted={voice.isMuted}
        onToggleMute={voice.toggleMute}
        onShowHistory={() => setShowHistory(true)}
        historyCount={history.length}
        state={voice.state}
      />

      {showHistory && (
        <HistoryDrawer history={history} onClose={() => setShowHistory(false)} />
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────────

function TopBar({ callDurationMs, storyCount, completeness, canSynthesize, onSynthesize, onEnd }: {
  callDurationMs: number;
  storyCount: number;
  completeness: number;
  canSynthesize: boolean;
  onSynthesize: () => void;
  onEnd: () => void;
}) {
  return (
    <div className="voice-topbar">
      <div className="voice-topbar-left">
        <span className="voice-topbar-dot" aria-hidden />
        <span className="voice-topbar-timer">{fmtDuration(callDurationMs)}</span>
        <span className="voice-topbar-sep" aria-hidden>·</span>
        <span className="voice-topbar-meta">{storyCount} 段经历</span>
      </div>
      <div className="voice-topbar-progress">
        <div className="voice-topbar-progress-bar">
          <div
            className="voice-topbar-progress-fill"
            style={{ width: `${Math.round(completeness * 100)}%` }}
          />
        </div>
      </div>
      <div className="voice-topbar-right">
        <button
          type="button"
          className={`voice-synth-btn ${canSynthesize ? "is-ready" : ""}`}
          onClick={onSynthesize}
          disabled={!canSynthesize}
          title={canSynthesize ? "整理素材生成简历" : "再多聊一会就能整理了"}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l1.9 5.8L20 8l-5 4 1.5 6L12 14l-4.5 4L9 12 4 8l6.1-.2L12 2z" />
          </svg>
          <span>立即整理</span>
        </button>
        <button className="voice-mode-end" type="button" onClick={onEnd} aria-label="结束语音通话">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
          <span>挂断</span>
        </button>
      </div>
    </div>
  );
}

const STATE_LABEL: Record<VoiceUiState, string> = {
  idle: "未连接",
  connecting: "连接中…",
  listening: "在听你说",
  thinking: "在想…",
  speaking: "在说…",
  error: "出错了",
};

const CONNECT_STEP_LABEL: Record<ConnectStep, string> = {
  ws: "建立通道",
  session: "准备会话",
  mic: "请求麦克风",
  ready: "准备就绪",
};

function Stage({ state, connectStep, aiCaption, userCaption, micLevel, bargeInFlash, isMuted }: {
  state: VoiceUiState;
  connectStep: ConnectStep | null;
  aiCaption: string;
  userCaption: string;
  micLevel: number;
  bargeInFlash: boolean;
  isMuted: boolean;
}) {
  // Apply orb-internal scale based on mic level when listening
  const levelScale = state === "listening" && !isMuted
    ? 1 + Math.min(0.18, micLevel * 4)  // RMS is small (~0.05), amplify for visible scale
    : 1;

  const orbStateClass = bargeInFlash ? "voice-orb-bargein" : `voice-orb-${state}`;

  return (
    <div className="voice-mode-stage">
      <div className={`voice-caption voice-caption-ai ${aiCaption ? "is-visible" : ""}`} aria-live="polite">
        {aiCaption || (state === "thinking" ? "..." : "")}
      </div>

      <div className="voice-orb-wrap">
        <div
          className={`voice-orb ${orbStateClass} ${isMuted ? "voice-orb-muted" : ""}`}
          aria-label={STATE_LABEL[state]}
          role="img"
        >
          <span className="voice-orb-glow" aria-hidden />
          <span className="voice-orb-pulse" aria-hidden />
          <span className="voice-orb-pulse voice-orb-pulse-2" aria-hidden />
          <span
            className="voice-orb-icon"
            aria-hidden
            style={{ transform: `scale(${levelScale.toFixed(3)})` }}
          >
            {isMuted ? (
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="1" y1="1" x2="23" y2="23" />
                <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
                <line x1="12" y1="19" x2="12" y2="23" />
              </svg>
            ) : (
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            )}
          </span>
        </div>
        <div className="voice-state-label">
          {state === "connecting" && connectStep ? (
            <ConnectingSteps current={connectStep} />
          ) : (
            STATE_LABEL[state]
          )}
        </div>
      </div>

      <div className={`voice-caption voice-caption-user ${userCaption ? "is-visible" : ""}`} aria-live="polite">
        {userCaption}
      </div>
    </div>
  );
}

function ConnectingSteps({ current }: { current: ConnectStep }) {
  const steps: ConnectStep[] = ["ws", "session", "mic", "ready"];
  return (
    <div className="voice-connect-steps">
      {steps.map((s, i) => {
        const reached = steps.indexOf(current) >= i;
        const isCurrent = s === current;
        return (
          <div key={s} className={`voice-connect-step ${reached ? "is-done" : ""} ${isCurrent ? "is-current" : ""}`}>
            <span className="voice-connect-dot" aria-hidden>{reached ? "●" : "○"}</span>
            <span>{CONNECT_STEP_LABEL[s]}</span>
          </div>
        );
      })}
    </div>
  );
}

function Sidebar({ progress }: { progress: ReturnType<typeof useConversationProgress> }) {
  const slotLabels: Record<keyof typeof progress.stories[number]["slots"], string> = {
    context: "场景", role: "我的角色", actions: "做了什么", result: "结果 / 反馈",
  };
  return (
    <aside className="voice-sidebar" aria-label="实时采集进度">
      <div className="voice-sidebar-head">
        <span>📁 已采集</span>
        <span className="voice-sidebar-count">{progress.stories.length}</span>
      </div>
      {progress.stories.length === 0 ? (
        <div className="voice-sidebar-empty">
          聊到具体经历，会在这里显示
          <br />
          已采集的素材进度
        </div>
      ) : (
        <ul className="voice-sidebar-list">
          {progress.stories.map((s) => (
            <li key={s.id} className="voice-sidebar-card">
              <div className="voice-sidebar-card-title">{s.label}</div>
              <ul className="voice-sidebar-slots">
                {(Object.keys(s.slots) as Array<keyof typeof s.slots>).map((k) => {
                  const v = s.slots[k];
                  const cls = v === 2 ? "is-full" : v === 1 ? "is-partial" : "is-empty";
                  return (
                    <li key={k} className={`voice-sidebar-slot ${cls}`}>
                      <span className="voice-sidebar-slot-mark" aria-hidden>{v === 2 ? "✓" : v === 1 ? "~" : "○"}</span>
                      <span>{slotLabels[k]}</span>
                    </li>
                  );
                })}
              </ul>
              {s.notes && <div className="voice-sidebar-card-note">{s.notes}</div>}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function BottomBar({ isMuted, onToggleMute, onShowHistory, historyCount, state }: {
  isMuted: boolean;
  onToggleMute: () => void;
  onShowHistory: () => void;
  historyCount: number;
  state: VoiceUiState;
}) {
  return (
    <div className="voice-bottombar">
      <button
        type="button"
        className={`voice-bb-btn ${isMuted ? "is-on" : ""}`}
        onClick={onToggleMute}
        aria-pressed={isMuted}
        title={isMuted ? "取消静音" : "暂停麦克风"}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {isMuted ? (
            <>
              <line x1="1" y1="1" x2="23" y2="23" />
              <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
              <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
              <line x1="12" y1="19" x2="12" y2="23" />
            </>
          ) : (
            <>
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
              <line x1="8" y1="23" x2="16" y2="23" />
            </>
          )}
        </svg>
        <span>{isMuted ? "已静音" : "静音"}</span>
      </button>
      <button
        type="button"
        className="voice-bb-btn"
        onClick={onShowHistory}
        disabled={historyCount === 0}
        title="查看本次对话历史"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="14" y2="18" />
        </svg>
        <span>历史</span>
        {historyCount > 0 && <span className="voice-bb-badge">{historyCount}</span>}
      </button>
      <span className="voice-bb-tip">
        {state === "speaking"
          ? "💬 想说就说，我会自动让位"
          : state === "listening" && isMuted
            ? "🔇 麦克风已暂停"
            : state === "listening"
              ? "🎙 在听，慢慢说"
              : state === "thinking"
                ? "💭 在想下一句…"
                : ""}
      </span>
    </div>
  );
}

function HistoryDrawer({ history, onClose }: {
  history: Array<{ role: "user" | "assistant"; text: string; ts: number }>;
  onClose: () => void;
}) {
  const startTs = history[0]?.ts ?? Date.now();
  return (
    <div className="voice-history-backdrop" onClick={onClose} role="presentation">
      <div className="voice-history-drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="voice-history-head">
          <span>本次对话 · {history.length} 条</span>
          <button className="voice-history-close" type="button" onClick={onClose} aria-label="关闭历史">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="voice-history-body">
          {history.length === 0 ? (
            <div className="voice-history-empty">还没说话呢</div>
          ) : (
            history.map((t, i) => (
              <div key={i} className={`voice-history-bubble ${t.role}`}>
                <div className="voice-history-bubble-meta">
                  {t.role === "user" ? "你" : "Stori"} · {fmtMmSs(t.ts - startTs)}
                </div>
                <div className="voice-history-bubble-text">{t.text}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`;
}

function fmtMmSs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function buildSessionConfig(jd: string | null, initialMessages: InterviewMessage[]) {
  const recentTurns = initialMessages
    .slice(-20)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, text: m.content }));

  // Writer-not-interrogator prompt. Template literal to dodge JS quote-nesting hell.
  const jdLine = jd
    ? `   ta 的目标岗位（不要直接复读）：${jd.slice(0, 800)}`
    : "   （ta 没提供目标岗位，保持通用方向）";

  const systemRole = `你是 Stori，一个温和、专注的简历写作助手。
你和用户**坐在一起聊**——帮 ta 把零零碎碎做过的事，挖出可以写进简历的部分。

# 你心里清楚的 3 件事

1. 大多数人不知道自己做过的事值得写。ta 可能说『就做了个普通的小项目』『就是日常工作』——你要看见这里面的价值，主动说出来：
   『这个不算小事啊，你协调了几个人？』
   『其实你说的这个，就是 PM 简历里很值钱的"跨部门推进"。』

2. 你是**写作助手**，不是审问者。
   - 不要让 ta 觉得在被考核
   - 不要追着问 KPI 数字，ta 不知道才来找你
   - 帮 ta 想起来：当时大概多少人、做了多久、有没有什么反馈
   - 用 ta 的语言，不是简历八股语

3. JD 是悄悄的指南针，不是压在头上的标尺。听到沾边的事，主动帮 ta 翻译成简历语言：
   『你说的这个排查流程，其实算是"数据驱动决策"——HR 看到这种就来劲。』
${jdLine}

# 你怎么聊

- 先回应内容本身（『哦，二手交易小程序啊』），再发现亮点
- 听到值得展开的，温和邀请：『这块挺有意思，能再说说吗？』
- 听到模糊（『参与』、『帮忙』），不批判，只是好奇：『嗯，那你具体负责哪一块？』
- 一段聊到差不多（场景 + 角色 + 做了什么 + 大致结果），温和切下一段：
  『这段我心里有数了。还有别的项目可以聊吗？』

# 绝对不能
× 上来就 KPI 式提问 × 让用户感到压力 × 编造没说过的公司/数字/职位
× 用面试官腔（『请详细描述』）× 重复确认（『所以你的意思是...』）

# 收尾
等系统通过 SayHello 提示你『已经攒够』了，再温和提议帮 ta 整理。
用户答应 → 说一句『好，这就帮你整理』，然后停下不要再问。
用户想继续 → 那就继续聊，过 2-3 轮可以再温和提一次（最多 3 次）。

# 输出
1-2 句，纯口语，结尾是问句或自然停顿。`;

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
}
