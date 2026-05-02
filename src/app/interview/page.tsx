"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { StarSidebar } from "@/components/StarSidebar";
import { VoiceInput } from "@/components/VoiceInput";
import { VoiceMode } from "@/components/VoiceMode";
import type { InterviewApiResponse, InterviewMessage, InterviewPhase } from "@/lib/types";
import { loadState, patchState } from "@/lib/storage";
import { generateId } from "@/lib/ids";

const PHASE_LABEL: Record<InterviewPhase, string> = {
  "intro": "破冰 · 了解背景",
  "topic-select": "选题 · 聚焦经历",
  "deep-dive": "深挖 · STAR 框架",
  "closing": "收尾 · 最后补充",
  "done": "已完成",
};

const TOTAL_STEPS = 8; // approximate target turn count

export default function InterviewPage() {
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [jd, setJd] = useState<string | null>(null);
  const [messages, setMessages] = useState<InterviewMessage[]>([]);
  const [phase, setPhase] = useState<InterviewPhase>("intro");
  const [turnCount, setTurnCount] = useState(0);
  const [draft, setDraft] = useState("");
  const [isPending, startTransition] = useTransition();
  const [synthesizing, setSynthesizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Hydrate from localStorage and ask for the very first question if needed.
  useEffect(() => {
    const s = loadState();
    setJd(s.jd);
    setMessages(s.messages);
    setPhase(s.phase);
    setTurnCount(s.turnCount);
    setHydrated(true);

    if (s.messages.length === 0) {
      void askInitialQuestion(s.jd);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const askInitialQuestion = useCallback(async (jdText: string | null) => {
    setError(null);
    try {
      const res = await fetch("/api/interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "interview", messages: [], jd: jdText, phase: "intro", turnCount: 0 }),
      });
      const data = (await res.json()) as InterviewApiResponse;
      const firstMessage: InterviewMessage = {
        id: generateId("m"),
        role: "assistant",
        content: data.message,
        createdAt: new Date().toISOString(),
      };
      setMessages([firstMessage]);
      setPhase(data.phase);
      patchState({ messages: [firstMessage], phase: data.phase, turnCount: 0 });
    } catch (e) {
      console.error(e);
      setError("无法连接到访谈服务，请稍后再试。");
    }
  }, []);

  const submit = useCallback(() => {
    const value = draft.trim();
    if (!value || isPending) return;

    const userMsg: InterviewMessage = {
      id: generateId("m"),
      role: "user",
      content: value,
      createdAt: new Date().toISOString(),
    };
    const next = [...messages, userMsg];
    const newTurn = turnCount + 1;
    setMessages(next);
    setTurnCount(newTurn);
    setDraft("");
    setError(null);

    startTransition(async () => {
      try {
        const res = await fetch("/api/interview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "interview",
            messages: next.map((m) => ({ role: m.role, content: m.content })),
            jd,
            phase,
            turnCount: newTurn,
          }),
        });
        const data = (await res.json()) as InterviewApiResponse;
        const aiMsg: InterviewMessage = {
          id: generateId("m"),
          role: "assistant",
          content: data.message,
          createdAt: new Date().toISOString(),
        };
        const final = [...next, aiMsg];
        setMessages(final);
        setPhase(data.phase);
        patchState({ messages: final, phase: data.phase, turnCount: newTurn });
      } catch (e) {
        console.error(e);
        setError("发送失败，请重试。");
      }
    });
  }, [draft, isPending, messages, turnCount, jd, phase]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const synthesize = useCallback(async () => {
    setSynthesizing(true);
    setError(null);
    try {
      const res = await fetch("/api/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "synthesize",
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          jd,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "整理失败");
        setSynthesizing(false);
        return;
      }
      patchState({ stories: data.stories, phase: "done" });
      router.push("/result");
    } catch (e) {
      console.error(e);
      setError("整理失败，请重试。");
      setSynthesizing(false);
    }
  }, [messages, jd, router]);

  const lastQuestion = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === "assistant") return messages[i].content;
    }
    return "";
  }, [messages]);

  const progressPct = Math.min(100, Math.round((turnCount / TOTAL_STEPS) * 100));
  const canSynthesize = turnCount >= 4 && messages.filter((m) => m.role === "user").length >= 3;
  const interviewDone = phase === "done" || phase === "closing";

  // Voice mode merges turns back into the same conversation state.
  // Uses functional setState so rapid turns don't trample each other.
  const handleVoiceTurn = useCallback(
    (turn: { userMessage: InterviewMessage | null; aiMessage: InterviewMessage; newPhase: InterviewPhase; newTurnCount: number }) => {
      setMessages((prev) => {
        const additions = turn.userMessage ? [turn.userMessage, turn.aiMessage] : [turn.aiMessage];
        const final = [...prev, ...additions];
        patchState({ messages: final, phase: turn.newPhase, turnCount: turn.newTurnCount });
        return final;
      });
      setPhase(turn.newPhase);
      setTurnCount(turn.newTurnCount);
    },
    [],
  );

  return (
    <div className="app">
      <nav className="app-nav">
        <Link href="/start" className="btn btn-text" style={{ padding: "0 0", fontSize: 13 }}>
          <span aria-hidden style={{ fontSize: 18, marginRight: 6 }}>←</span> 保存并退出
        </Link>
        <div className="nav-step" style={{ flex: 1, justifyContent: "center", maxWidth: 480 }}>
          <span className="nav-step-num">02 / 03</span>
          <div className="progress-bar"><div className="progress-fill" style={{ width: `${progressPct}%` }} /></div>
          <span className="nav-step-label">{PHASE_LABEL[phase]}</span>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm voice-launch-btn"
          onClick={() => setVoiceOpen(true)}
          title="改用语音对话"
          aria-label="打开语音对话模式"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
          <span>语音聊</span>
        </button>
      </nav>

      <div className="interview-body">
        <div className="interview-main">
          <div className="section-stack">
            <div className="q-phase-tag">
              {phaseLabelFor(phase)}
              <span className="q-phase-count">第 {Math.max(1, turnCount + 1)} 问 · 共约 {TOTAL_STEPS} 问</span>
            </div>

            {!hydrated || (messages.length === 0 && !lastQuestion) ? (
              <div className="q-display fade-up">
                <span className="typing"><span /><span /><span /></span>
              </div>
            ) : (
              <h1 key={lastQuestion} className="q-display fade-up">{lastQuestion}</h1>
            )}

            <p className="q-hint">
              {interviewDone
                ? "好了，足够了。我可以帮你整理成故事卡。"
                : "放轻松——一次只想一件事，越具体越好。如果只想说一句话也完全可以，我会接着问。"}
            </p>
          </div>

          <div className="composer">
            {error && <div className="banner" style={{ borderLeftColor: "var(--danger)" }}>{error}</div>}

            {interviewDone ? (
              <button
                className="btn btn-primary btn-lg"
                onClick={synthesize}
                disabled={synthesizing}
                style={{ alignSelf: "flex-end" }}
              >
                {synthesizing ? "正在整理…" : "整理成故事卡"}
                <span aria-hidden>→</span>
              </button>
            ) : (
              <>
                <div className="composer-field">
                  <div className="composer-head">
                    <span className="composer-head-label">你的回答</span>
                    <VoiceInput onTranscript={(t) => setDraft((d) => `${d}${d ? " " : ""}${t}`.trim())} />
                  </div>
                  <textarea
                    ref={textareaRef}
                    className="composer-textarea"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={isPending ? "教练正在思考下一个问题…" : "在这里输入你的回答，回车提交。"}
                    rows={4}
                    disabled={isPending}
                  />
                </div>

                <div className="composer-foot">
                  <div className="composer-hints">
                    <span>⏎ 提交</span>
                    <span>⇧⏎ 换行</span>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    {canSynthesize && (
                      <button className="btn btn-ghost btn-sm" onClick={synthesize} disabled={synthesizing}>
                        {synthesizing ? "整理中…" : "提前整理"}
                      </button>
                    )}
                    <button className="btn btn-primary btn-sm" onClick={submit} disabled={isPending || !draft.trim()}>
                      {isPending ? <span className="typing"><span /><span /><span /></span> : <>继续 <span aria-hidden>→</span></>}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <StarSidebar phase={phase} turnCount={turnCount} messages={messages} />
      </div>

      <VoiceMode
        open={voiceOpen}
        initialMessages={messages}
        jd={jd}
        initialPhase={phase}
        initialTurnCount={turnCount}
        onClose={() => setVoiceOpen(false)}
        onTurnComplete={handleVoiceTurn}
      />
    </div>
  );
}

function phaseLabelFor(phase: InterviewPhase): string {
  switch (phase) {
    case "intro": return "INTRO · 破冰";
    case "topic-select": return "FOCUS · 选题";
    case "deep-dive": return "STAR · 深挖";
    case "closing": return "WRAP-UP · 收尾";
    case "done": return "READY · 整理";
  }
}
