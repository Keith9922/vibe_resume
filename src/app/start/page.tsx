"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppNav } from "@/components/AppNav";
import { loadState, patchState, DEFAULT_STATE } from "@/lib/storage";

export default function StartPage() {
  const router = useRouter();
  const [jd, setJd] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const s = loadState();
    setJd(s.jd ?? "");
    setHydrated(true);
  }, []);

  function begin(jdText: string | null) {
    // Reset interview state when starting fresh
    patchState({
      ...DEFAULT_STATE,
      jd: jdText,
      messages: [],
      phase: "intro",
      turnCount: 0,
      stories: [],
      resume: null,
    });
    router.push("/interview");
  }

  return (
    <div className="app">
      <AppNav />

      <section className="two-col">
        <div className="section-stack fade-up">
          <span className="eyebrow eyebrow-row">Step One · 目标岗位</span>
          <h1 className="display-2">你在应聘<br />什么职位？</h1>
          <p className="body">
            贴入职位描述（JD），后续提问会更有针对性，更贴合岗位关键能力。
            <br /><br />
            如果你还没确定方向，也可以跳过——我会用更通用的方式陪你聊。
          </p>
          <blockquote className="pull-quote">
            <p className="pull-quote-text">&ldquo;有 JD 时，我能帮你针对性挖掘对岗位最相关的经历。&rdquo;</p>
            <span className="pull-quote-author">— Stori</span>
          </blockquote>
        </div>

        <div className="section-stack-tight fade-up-delay-1">
          <div className="card">
            <div className="card-header">
              <span className="field-label">职位描述（JD）</span>
              <span className="field-hint">选填 · 粘贴或输入</span>
            </div>
            <textarea
              className="textarea-large"
              placeholder={"例如：\n\n公司：晨河科技\n岗位：产品经理实习生\n职责：用户增长、需求分析、用户访谈、数据分析、A/B 实验、跨团队推进\n要求：能够把模糊问题拆解成产品方案，推动设计和研发落地，并用指标评估效果。"}
              value={jd}
              onChange={(e) => setJd(e.target.value)}
              rows={14}
              disabled={!hydrated}
            />
            <div className="card-header" style={{ borderBottom: 0, borderTop: "1px solid var(--border-subtle)", padding: "12px 28px" }}>
              <span className="field-hint">{jd.length} / 4000 字</span>
              <span className="field-hint">⌘ V 粘贴</span>
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button className="btn btn-text" onClick={() => begin(null)}>
              跳过这步
            </button>
            <button
              className="btn btn-primary"
              onClick={() => begin(jd.trim() || null)}
              disabled={!hydrated}
            >
              开始访谈
              <span aria-hidden>→</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
