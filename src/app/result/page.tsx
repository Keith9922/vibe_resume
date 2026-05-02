"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AppNav } from "@/components/AppNav";
import { loadState, patchState, resetState, DEFAULT_RESUME } from "@/lib/storage";
import type { GenerateResumeResponse, ResumeData, StoryCard } from "@/lib/types";

type Tab = "stories" | "resume";

export default function ResultPage() {
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [stories, setStories] = useState<StoryCard[]>([]);
  const [resume, setResume] = useState<ResumeData | null>(null);
  const [jd, setJd] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("stories");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = loadState();
    setStories(s.stories);
    setResume(s.resume);
    setJd(s.jd);
    setHydrated(true);

    if (s.stories.length === 0) {
      // No stories — redirect to start
      router.replace("/");
    }
  }, [router]);

  const generate = useCallback(() => {
    if (stories.length === 0 || isPending) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/generate-resume", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "generate-resume",
            stories,
            jd,
            baseResume: resume ?? DEFAULT_RESUME,
          }),
        });
        const data = (await res.json()) as GenerateResumeResponse;
        if ("resume" in data) {
          setResume(data.resume);
          patchState({ resume: data.resume });
        } else {
          setError("生成失败，请重试。");
        }
      } catch (e) {
        console.error(e);
        setError("生成失败，请重试。");
      }
    });
  }, [stories, jd, isPending, resume]);

  // Auto-generate the resume on first load if not yet generated
  useEffect(() => {
    if (hydrated && stories.length > 0 && !resume) {
      generate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, stories.length, resume]);

  const restart = () => {
    if (!confirm("确定要清空当前进度，重新开始吗？")) return;
    resetState();
    router.push("/");
  };

  const printResume = () => {
    window.print();
  };

  if (!hydrated) return <div className="app"><AppNav /></div>;

  return (
    <div className="app">
      <AppNav />

      <header style={{ padding: "56px var(--gutter-desktop) 32px" }} className="no-print">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 24, flexWrap: "wrap" }}>
          <div className="section-stack" style={{ maxWidth: 720 }}>
            <span className="eyebrow eyebrow-row">Your Story · Draft</span>
            <h1 className="display-2">你的故事，已经成型。</h1>
            <p className="body">
              基于你刚才的访谈，已整理出 {stories.length} 张故事卡{resume ? "和一份简历草稿" : ""}。
              先确认事实是否准确，再导出使用。
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={restart}>重新访谈</button>
            <button className="btn btn-ghost btn-sm" onClick={generate} disabled={isPending}>
              {isPending ? "重新生成中…" : "重新生成"}
            </button>
            <button className="btn btn-primary btn-sm" onClick={printResume}>
              导出 PDF <span aria-hidden>↓</span>
            </button>
          </div>
        </div>
        {error && <div className="banner" style={{ marginTop: 16, borderLeftColor: "var(--danger)" }}>{error}</div>}
      </header>

      {/* Mobile tabs */}
      <div className="tabs no-print" data-mobile>
        <button className={`tab ${tab === "stories" ? "active" : ""}`} onClick={() => setTab("stories")}>故事卡</button>
        <button className={`tab ${tab === "resume" ? "active" : ""}`} onClick={() => setTab("resume")}>简历草稿</button>
      </div>

      <section className="two-col" style={{ paddingTop: 16, paddingBottom: 72 }}>
        <div className={`section-stack-tight ${tab === "stories" ? "tab-active" : ""}`} data-tab="stories">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }} className="no-print">
            <span className="eyebrow">故事卡 · {stories.length} 张</span>
          </div>
          {stories.map((story, i) => (
            <StoryCardView key={story.id} story={story} index={i + 1} />
          ))}
        </div>

        <div className={`section-stack-tight ${tab === "resume" ? "tab-active" : ""}`} data-tab="resume">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }} className="no-print">
            <span className="eyebrow">简历草稿</span>
            <span className="field-hint">基于已确认事实生成</span>
          </div>
          {resume ? (
            <ResumePaper resume={resume} />
          ) : isPending ? (
            <div className="empty-paper">
              <span className="typing"><span /><span /><span /></span>
              <p style={{ marginTop: 16 }}>正在生成简历草稿…</p>
            </div>
          ) : (
            <div className="empty-paper">
              <p>简历草稿尚未生成。</p>
              <button className="btn btn-ghost btn-sm" onClick={generate} style={{ marginTop: 16 }}>
                立即生成
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

// ─── Story Card ────────────────────────────────────────────────────────────

function StoryCardView({ story, index }: { story: StoryCard; index: number }) {
  return (
    <article className="story-card fade-up">
      <header className="story-card-head">
        <div className="story-card-tag">
          <span className="story-card-num">{String(index).padStart(2, "0")}</span>
          {story.skills.slice(0, 2).join(" · ").toUpperCase() || "EXPERIENCE"}
        </div>
        <h2 className="story-card-title">{story.title}</h2>
      </header>
      <div className="story-card-divider" />
      <div className="story-card-body">
        {story.context && <Block label="S · 背景" value={story.context} />}
        {story.role && <Block label="T · 任务" value={story.role} />}
        {story.actions.length > 0 && (
          <Block label="A · 行动" value={story.actions.map((a) => `· ${a}`).join("\n")} />
        )}
        {story.result && <Block label="R · 结果" value={story.result} />}
        {story.followUps.length > 0 && (
          <div className="banner" style={{ borderLeftColor: "var(--accent)" }}>
            <strong style={{ fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase" }}>
              建议补充
            </strong>
            <ul style={{ margin: "8px 0 0 18px", padding: 0, fontSize: 12 }}>
              {story.followUps.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          </div>
        )}
      </div>
    </article>
  );
}

function Block({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="story-block-label">{label}</div>
      <p className="story-block-value">{value}</p>
    </div>
  );
}

// ─── Resume Paper ──────────────────────────────────────────────────────────

function ResumePaper({ resume }: { resume: ResumeData }) {
  return (
    <div className="resume-paper">
      <div>
        <h1 className="resume-name">{resume.name || "你的姓名"}</h1>
        <p className="resume-headline">{resume.headline || resume.targetRole || "目标岗位"}</p>
      </div>

      <div className="resume-contact">
        {[resume.email, resume.phone, resume.location, ...resume.links]
          .filter(Boolean)
          .map((c, i, arr) => (
            <span key={i}>
              {c}
              {i < arr.length - 1 && <span style={{ marginLeft: 16 }} aria-hidden>·</span>}
            </span>
          ))}
        {resume.email === "" && resume.phone === "" && (
          <span style={{ fontStyle: "italic", color: "var(--text-3)" }}>（请补充联系方式）</span>
        )}
      </div>

      {resume.summary && (
        <>
          <div className="resume-divider" />
          <section className="resume-section">
            <span className="resume-section-label">Summary · 个人简介</span>
            <p className="resume-summary">{resume.summary}</p>
          </section>
        </>
      )}

      {resume.skills.length > 0 && (
        <>
          <div className="resume-divider" />
          <section className="resume-section">
            <span className="resume-section-label">Skills · 核心技能</span>
            <div className="resume-skills">
              {resume.skills.map((s, i) => <span key={i} className="resume-skill">{s}</span>)}
            </div>
          </section>
        </>
      )}

      {resume.experiences.length > 0 && (
        <>
          <div className="resume-divider" />
          <section className="resume-section">
            <span className="resume-section-label">Experience · 经历</span>
            {resume.experiences.map((exp) => (
              <div key={exp.id} className="resume-exp">
                <div className="resume-exp-head">
                  <h3 className="resume-exp-name">
                    {exp.title}
                    {exp.organization && <span style={{ fontWeight: 400, color: "var(--text-2)" }}> · {exp.organization}</span>}
                  </h3>
                  {exp.period && <span className="resume-exp-date">{exp.period}</span>}
                </div>
                <ul className="resume-bullets">
                  {exp.bullets.map((b, i) => <li key={i}>{b}</li>)}
                </ul>
              </div>
            ))}
          </section>
        </>
      )}

      {resume.education.length > 0 && (
        <>
          <div className="resume-divider" />
          <section className="resume-section">
            <span className="resume-section-label">Education · 教育</span>
            <ul className="resume-bullets">
              {resume.education.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
