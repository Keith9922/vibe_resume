"use client";

import {
  AlertTriangle,
  BookOpen,
  BriefcaseBusiness,
  ChevronDown,
  ChevronUp,
  Download,
  FileText,
  Gauge,
  Layers3,
  MessageSquare,
  Mic,
  Phone,
  Printer,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { VoiceMode } from "@/components/voice-mode";
import { streamChat } from "@/lib/chat-stream";
import { createInitialState } from "@/lib/initial-state";
import { createId, nowIso } from "@/lib/ids";
import {
  calculateReadiness,
  createDemoState,
  getCoverageCounts,
  updateCoverage,
} from "@/lib/resume-engine";
import { clearState, loadState, saveState } from "@/lib/storage";
import { useSpeechToText } from "@/lib/use-stt";
import type {
  AppState,
  ChatMessage,
  CoachRequest,
  CoachResponse,
  ResumeData,
  StoryCard,
} from "@/lib/types";

type WorkspaceTab = "chat" | "resume";

const SAMPLE_STORY =
  "我做过一个校园二手交易小程序，负责产品和增长。我们发现新用户发布商品很少，我访谈了 12 个同学，发现流程太长、分类不清。后来我把发布流程从 5 步改到 3 步，加了默认分类和价格建议。上线两周后，发布转化率从 18% 到 31%，日均商品数从 80 到 140。";

const SAMPLE_JD =
  "公司：晨河科技。岗位：产品经理实习生。职责包括用户增长、需求分析、用户访谈、数据分析、A/B 实验、跨团队推进。要求能够把模糊问题拆解成产品方案，推动设计和研发落地，并用指标评估效果。";

const VOICE_OPENING = "嗨，我是 Stori。准备好聊聊你最想放进简历的那段经历了吗？";

function makeMsg(content: string, role: ChatMessage["role"] = "assistant"): ChatMessage {
  return { id: createId("msg"), role, content, createdAt: nowIso() };
}

function getErrMsg(err: unknown): string {
  if (err instanceof Error) return `请求失败：${err.message}。可以稍后重试。`;
  return "请求失败，未知错误。可以稍后重试。";
}

export function ResumeWorkspace() {
  const [state, setState] = useState<AppState>(() => createInitialState());
  const [draft, setDraft] = useState("");
  const [jdDraft, setJdDraft] = useState(SAMPLE_JD);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("chat");
  const [isReady, setIsReady] = useState(false);
  const [isAnalyzing, startAnalyzing] = useTransition();
  const [isGenerating, startGenerating] = useTransition();
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null);
  const [jdExpanded, setJdExpanded] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);

  // Hydrate from localStorage
  useEffect(() => {
    setState(loadState());
    setIsReady(true);
  }, []);

  // Persist
  useEffect(() => {
    if (!isReady) return;
    saveState(state);
  }, [isReady, state]);

  const coverageCounts = useMemo(() => getCoverageCounts(state.jobAnalysis), [state.jobAnalysis]);
  const readiness = useMemo(
    () => calculateReadiness(state.stories, state.jobAnalysis),
    [state.stories, state.jobAnalysis],
  );

  const updateApp = useCallback((updater: (prev: AppState) => AppState) => {
    setState((prev) => updater(prev));
  }, []);

  const pushMsg = useCallback(
    (role: ChatMessage["role"], content: string) => {
      updateApp((s) => ({ ...s, messages: [...s.messages, makeMsg(content, role)] }));
    },
    [updateApp],
  );

  // ── Streaming chat send ─────────────────────────────────────
  async function handleSendText(answer: string) {
    if (!answer.trim() || isStreaming) return;
    setDraft("");
    const userMsg = makeMsg(answer, "user");
    const aiMsgId = createId("msg");
    const aiPlaceholder: ChatMessage = { id: aiMsgId, role: "assistant", content: "", createdAt: nowIso() };

    // Snapshot history+stories before append (the API needs the user message too)
    const history = [...state.messages, userMsg];
    const jobAnalysis = state.jobAnalysis;
    const stories = state.stories;

    updateApp((s) => ({ ...s, messages: [...s.messages, userMsg, aiPlaceholder] }));
    setStreamingMsgId(aiMsgId);
    setIsStreaming(true);

    let acc = "";
    try {
      await streamChat(
        { mode: "text", history, jobAnalysis, stories },
        {
          onChunk: (delta) => {
            acc += delta;
            setState((s) => ({
              ...s,
              messages: s.messages.map((m) => (m.id === aiMsgId ? { ...m, content: acc } : m)),
            }));
          },
          onMeta: (story) => {
            if (!story) return;
            setState((s) => {
              const newStories = [...s.stories, story];
              const ja = s.jobAnalysis ? updateCoverage(s.jobAnalysis, newStories) : null;
              return { ...s, stories: newStories, jobAnalysis: ja };
            });
          },
          onError: (msg) => console.error("Stream error:", msg),
        },
      );
    } catch (err) {
      const fallback = getErrMsg(err);
      setState((s) => ({
        ...s,
        messages: s.messages.map((m) => (m.id === aiMsgId ? { ...m, content: acc || fallback } : m)),
      }));
    } finally {
      setIsStreaming(false);
      setStreamingMsgId(null);
    }
  }

  // ── Non-streaming legacy actions ─────────────────────────────
  async function callCoach(req: CoachRequest): Promise<CoachResponse> {
    const res = await fetch("/api/coach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as CoachResponse;
  }

  function handleAnalyzeJd() {
    const jdText = jdDraft.trim();
    if (!jdText) {
      pushMsg("assistant", "粘贴一段 JD 再点分析。");
      return;
    }
    startAnalyzing(async () => {
      try {
        const res = await callCoach({ action: "analyze-jd", jdText, stories: state.stories });
        if (res.action !== "analyze-jd") return;
        updateApp((s) => ({
          ...s,
          jobAnalysis: updateCoverage(res.analysis, s.stories),
          messages: [...s.messages, makeMsg(res.message)],
        }));
        setJdExpanded(false);
      } catch (err) {
        pushMsg("assistant", getErrMsg(err));
      }
    });
  }

  function handleGenerateResume() {
    startGenerating(async () => {
      try {
        const res = await callCoach({
          action: "generate-resume",
          stories: state.stories,
          jobAnalysis: state.jobAnalysis,
          baseResume: state.resume,
        });
        if (res.action !== "generate-resume") return;
        updateApp((s) => ({
          ...s,
          resume: res.resume,
          messages: [...s.messages, makeMsg(res.message)],
        }));
        setActiveTab("resume");
      } catch (err) {
        pushMsg("assistant", getErrMsg(err));
      }
    });
  }

  function handleDemo() {
    const demo = createDemoState();
    setState(demo);
    setJdDraft(demo.jobAnalysis?.rawText ?? SAMPLE_JD);
    setDraft("");
    setActiveTab("resume");
  }

  function handleReset() {
    clearState();
    setState(createInitialState());
    setDraft("");
    setJdDraft(SAMPLE_JD);
    setActiveTab("chat");
  }

  function handlePrint() {
    window.print();
  }

  function handleExportJson() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "stori-workspace.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Voice mode integration ───────────────────────────────────
  const handleVoiceTurn = useCallback(
    (turn: { userMessage: ChatMessage; aiMessage: ChatMessage; story: StoryCard | null }) => {
      setState((s) => {
        const stories = turn.story ? [...s.stories, turn.story] : s.stories;
        const ja = s.jobAnalysis && turn.story ? updateCoverage(s.jobAnalysis, stories) : s.jobAnalysis;
        return {
          ...s,
          messages: [...s.messages, turn.userMessage, turn.aiMessage],
          stories,
          jobAnalysis: ja,
        };
      });
    },
    [],
  );

  const hasJd = Boolean(state.jobAnalysis);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-logo" aria-hidden="true">
            <Sparkles size={20} />
          </div>
          <div>
            <div className="brand-name">Stori</div>
            <div className="brand-tag">讲好你的故事，拿到心仪的 Offer</div>
          </div>
        </div>

        <div className="topbar-actions">
          <div className={`status-badge ${hasJd ? "" : "idle"}`}>
            <ShieldCheck size={13} />
            {hasJd ? `JD：${state.jobAnalysis!.title}` : "未接入 JD"}
          </div>
          <button className="btn btn-primary btn-sm voice-launch" type="button" onClick={() => setVoiceOpen(true)}>
            <Phone size={14} />
            语音聊
          </button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={handleDemo} title="一键载入示例">
            <BookOpen size={14} />
            示例
          </button>
          <button className="btn btn-ghost btn-sm danger" type="button" onClick={handleReset} title="清空所有数据">
            <RotateCcw size={14} />
            重置
          </button>
        </div>
      </header>

      {/* JD strip — collapsed by default to keep chat focal */}
      <section className="jd-strip" aria-label="岗位 JD">
        <div className="jd-header" onClick={() => setJdExpanded((v) => !v)} role="button" tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && setJdExpanded((v) => !v)}>
          <div className="jd-header-left">
            <div className="jd-icon"><BriefcaseBusiness size={16} /></div>
            <div>
              <div className="jd-title">{hasJd ? `岗位：${state.jobAnalysis!.title}` : "粘贴 JD（可选）"}</div>
              <div className="jd-desc">
                {hasJd
                  ? "AI 会悄悄把追问引向 JD 关键能力"
                  : "加上 JD 后，AI 会按缺口追问，更对位"}
              </div>
            </div>
          </div>
          {jdExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </div>

        {jdExpanded && (
          <div className="jd-body">
            <textarea
              className="jd-textarea"
              value={jdDraft}
              onChange={(e) => setJdDraft(e.target.value)}
              placeholder="粘贴岗位 JD…"
              aria-label="岗位 JD 文本"
            />
            <button
              className="btn btn-primary"
              type="button"
              onClick={handleAnalyzeJd}
              disabled={isAnalyzing || !jdDraft.trim()}
            >
              <Layers3 size={15} />
              {isAnalyzing ? "分析中…" : "分析 JD"}
            </button>
          </div>
        )}
      </section>

      <nav className="desktop-tabs" aria-label="工作区切换">
        {(["chat", "resume"] as WorkspaceTab[]).map((tab) => {
          const labels: Record<WorkspaceTab, string> = { chat: "对话", resume: "简历" };
          const icons: Record<WorkspaceTab, React.ReactNode> = {
            chat: <MessageSquare size={15} />,
            resume: <FileText size={15} />,
          };
          return (
            <button
              key={tab}
              className={`desktop-tab ${activeTab === tab ? "is-active" : ""}`}
              type="button"
              onClick={() => setActiveTab(tab)}
            >
              {icons[tab]}
              {labels[tab]}
            </button>
          );
        })}
      </nav>

      <div className="workspace-grid workspace-grid-2col" role="main">
        <div className={`workspace-panel chat-column ${activeTab === "chat" ? "is-active" : ""}`}>
          <ChatPanel
            messages={state.messages}
            draft={draft}
            isStreaming={isStreaming}
            streamingMsgId={streamingMsgId}
            onDraftChange={setDraft}
            onSend={() => handleSendText(draft)}
            onUseSample={() => setDraft(SAMPLE_STORY)}
            onOpenVoice={() => setVoiceOpen(true)}
          />
        </div>

        <div className={`workspace-panel resume-column ${activeTab === "resume" ? "is-active" : ""}`}>
          <ResumePanel
            resume={state.resume}
            readiness={readiness}
            coverageCounts={coverageCounts}
            messageCount={state.messages.filter((m) => m.role === "user").length}
            isPending={isGenerating}
            onGenerate={handleGenerateResume}
            onPrint={handlePrint}
            onExportJson={handleExportJson}
          />
        </div>
      </div>

      <nav className="mobile-tabs" aria-label="移动端导航">
        <MobileTab icon={<MessageSquare size={20} />} label="对话" active={activeTab === "chat"} onClick={() => setActiveTab("chat")} />
        <MobileTab icon={<Phone size={20} />} label="语音" active={false} onClick={() => setVoiceOpen(true)} />
        <MobileTab icon={<FileText size={20} />} label="简历" active={activeTab === "resume"} onClick={() => setActiveTab("resume")} />
      </nav>

      <VoiceMode
        open={voiceOpen}
        history={state.messages}
        jobAnalysis={state.jobAnalysis}
        stories={state.stories}
        openingLine={state.messages.length <= 1 ? VOICE_OPENING : "继续聊吧。刚才说到哪了？"}
        onClose={() => setVoiceOpen(false)}
        onTurnComplete={handleVoiceTurn}
      />
    </div>
  );
}

// ─────────────────────────────────────────────
// ChatPanel
// ─────────────────────────────────────────────

function ChatPanel({
  messages,
  draft,
  isStreaming,
  streamingMsgId,
  onDraftChange,
  onSend,
  onUseSample,
  onOpenVoice,
}: {
  messages: ChatMessage[];
  draft: string;
  isStreaming: boolean;
  streamingMsgId: string | null;
  onDraftChange: (v: string) => void;
  onSend: () => void;
  onUseSample: () => void;
  onOpenVoice: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, isStreaming]);

  // Inline mic — append transcript into the draft
  const stt = useSpeechToText({
    silenceMs: 1500,
    onFinal: (text) => onDraftChange((draft ? draft + " " : "") + text),
  });

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSend();
    }
  }

  return (
    <>
      <div className="panel-header">
        <div className="panel-icon"><MessageSquare size={16} /></div>
        <div>
          <div className="panel-title">和 Stori 聊聊</div>
          <div className="panel-subtitle">像跟朋友说话一样讲，AI 会帮你整理</div>
        </div>
        <button
          className="btn btn-outline btn-sm"
          type="button"
          onClick={onOpenVoice}
          style={{ marginLeft: "auto" }}
        >
          <Phone size={13} />
          语音聊
        </button>
      </div>

      <div className="panel-body" ref={listRef}>
        <div className="message-list" aria-live="polite" aria-label="对话记录">
          {messages.map((msg) => {
            const isStreamingMsg = msg.id === streamingMsgId && msg.content === "";
            return (
              <div key={msg.id} className={`message-row ${msg.role}`}>
                {msg.role === "assistant" && (
                  <div className="message-avatar" aria-hidden="true">AI</div>
                )}
                {isStreamingMsg ? (
                  <div className="typing-bubble" aria-label="AI 正在回复">
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                  </div>
                ) : (
                  <div className="message-bubble">{msg.content || "…"}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="panel-footer composer">
        <div className="composer-chips">
          <button className="chip" type="button" onClick={onUseSample}>
            <Sparkles size={12} />
            填入示例经历
          </button>
        </div>

        <div className="composer-input-row">
          <label className="sr-only" htmlFor="chat-input">讲述你的经历</label>
          <textarea
            id="chat-input"
            className="composer-textarea"
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="像和朋友聊天一样讲——背景、你做了什么、结果是什么…"
            rows={3}
          />
          <div className="composer-actions">
            {stt.supported && (
              <button
                className={`btn btn-outline btn-icon btn-sm ${stt.isListening ? "recording-pulse" : ""}`}
                type="button"
                onClick={() => (stt.isListening ? stt.stop() : stt.start())}
                aria-label={stt.isListening ? "停止录音" : "按住说话"}
                title={stt.isListening ? "停止录音" : "语音输入（Chrome/Edge/Safari）"}
                style={stt.isListening ? { color: "var(--danger)", borderColor: "var(--danger)" } : {}}
              >
                <Mic size={15} />
              </button>
            )}
            <button
              className="btn btn-primary btn-icon btn-sm"
              type="button"
              onClick={onSend}
              disabled={!draft.trim() || isStreaming}
              aria-label="发送"
              title="发送 (Ctrl+Enter)"
            >
              <Send size={15} />
            </button>
          </div>
        </div>

        <div className="mt-1" style={{ fontSize: ".72rem", color: "var(--muted-2)", textAlign: "right" }}>
          {stt.isListening ? "正在听… 停顿 1.5 秒自动收尾" : "Ctrl+Enter 发送 · 想边走边聊点 “语音聊”"}
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────
// ResumePanel
// ─────────────────────────────────────────────

function ResumePanel({
  resume,
  readiness,
  coverageCounts,
  messageCount,
  isPending,
  onGenerate,
  onPrint,
  onExportJson,
}: {
  resume: ResumeData;
  readiness: number;
  coverageCounts: { covered: number; weak: number; missing: number };
  messageCount: number;
  isPending: boolean;
  onGenerate: () => void;
  onPrint: () => void;
  onExportJson: () => void;
}) {
  return (
    <>
      <div className="panel-header">
        <div className="panel-icon"><FileText size={16} /></div>
        <div>
          <div className="panel-title">简历预览</div>
          <div className="panel-subtitle">基于你聊到的内容生成</div>
        </div>
      </div>

      <div className="resume-metrics">
        <div className="metric-card">
          <Gauge size={15} className="metric-icon" />
          <div className="metric-val">{readiness}%</div>
          <div className="metric-lbl">素材成熟度</div>
        </div>
        <div className="metric-card">
          <ShieldCheck size={15} className="metric-icon" />
          <div className="metric-val">{coverageCounts.covered + coverageCounts.weak}</div>
          <div className="metric-lbl">已覆盖能力</div>
        </div>
        <div className="metric-card">
          <AlertTriangle size={15} className="metric-icon" />
          <div className="metric-val">{coverageCounts.missing}</div>
          <div className="metric-lbl">待补充缺口</div>
        </div>
      </div>

      <div className="resume-toolbar">
        <button
          className="btn btn-primary btn-sm"
          type="button"
          onClick={onGenerate}
          disabled={isPending || messageCount === 0}
        >
          <Sparkles size={14} />
          {isPending ? "生成中…" : "生成 / 刷新简历"}
        </button>
        <button className="btn btn-outline btn-sm" type="button" onClick={onPrint}>
          <Printer size={14} />
          打印 / PDF
        </button>
        <button className="btn btn-ghost btn-sm" type="button" onClick={onExportJson}>
          <Download size={14} />
          导出数据
        </button>
        <span style={{ marginLeft: "auto", fontSize: ".75rem", color: "var(--muted)", fontWeight: 700 }}>
          {messageCount > 0 ? `已聊 ${messageCount} 段` : "先去聊几段"}
        </span>
      </div>

      <div className="panel-body">
        <ResumePreview resume={resume} />
      </div>
    </>
  );
}

function ResumePreview({ resume }: { resume: ResumeData }) {
  const hasContent =
    resume.experiences.length > 0 ||
    resume.skills.length > 0 ||
    !resume.summary.startsWith("当你确认");

  if (!hasContent) {
    return (
      <div className="resume-empty">
        <FileText size={36} style={{ opacity: .3 }} />
        <p>先在「对话」区聊几段经历，然后点击「生成简历」。</p>
        <p style={{ fontSize: ".75rem", color: "var(--muted-2)" }}>所有内容仅基于你聊过的话生成，不会编造。</p>
      </div>
    );
  }

  const contacts = [resume.location, resume.email, resume.phone, ...resume.links].filter(Boolean);

  return (
    <div className="resume-paper">
      <div className="resume-paper-inner">
        <h1 className="resume-name">{resume.name}</h1>
        {resume.headline && <div className="resume-headline">{resume.headline}</div>}
        {contacts.length > 0 && (
          <div className="resume-contact">
            {contacts.map((c) => <span key={c}>{c}</span>)}
          </div>
        )}

        <div className="resume-divider" />

        {resume.summary && !resume.summary.startsWith("当你确认") && (
          <div className="resume-section">
            <div className="resume-section-title">个人摘要</div>
            <p style={{ fontSize: ".875rem", lineHeight: 1.65, color: "#374151" }}>{resume.summary}</p>
          </div>
        )}

        {resume.skills.length > 0 && (
          <div className="resume-section">
            <div className="resume-section-title">核心能力</div>
            <div className="resume-skills-wrap">
              {resume.skills.map((sk) => <span key={sk} className="resume-skill-chip">{sk}</span>)}
            </div>
          </div>
        )}

        {resume.experiences.length > 0 && (
          <div className="resume-section">
            <div className="resume-section-title">项目 / 经历</div>
            {resume.experiences.map((exp) => (
              <div key={exp.id} className="resume-experience-item">
                <div className="resume-exp-header">
                  <span className="resume-exp-title">{exp.title}</span>
                  <span className="resume-exp-period">{exp.period}</span>
                </div>
                <div className="resume-exp-org">{exp.organization}</div>
                {exp.bullets.length > 0 && (
                  <ul className="resume-exp-bullets">
                    {exp.bullets.map((b, i) => <li key={i}>{b}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}

        {resume.education.length > 0 && (
          <div className="resume-section">
            <div className="resume-section-title">教育经历</div>
            {resume.education.map((edu) => (
              <div key={edu} style={{ fontSize: ".875rem", color: "#374151", marginBottom: 4 }}>{edu}</div>
            ))}
          </div>
        )}

        {resume.notes.length > 0 && (
          <div className="resume-section">
            <div className="resume-section-title">待补充提示</div>
            <ul className="resume-notes-list">
              {resume.notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function MobileTab({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`mobile-tab ${active ? "is-active" : ""}`}
      type="button"
      onClick={onClick}
      aria-pressed={active}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
