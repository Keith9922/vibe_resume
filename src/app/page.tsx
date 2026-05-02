import Link from "next/link";
import { AppNav } from "@/components/AppNav";

export default function LandingPage() {
  return (
    <div className="app">
      <AppNav showSteps={false} />

      <section className="hero">
        <div className="hero-content fade-up">
          <span className="eyebrow eyebrow-row">Where careers begin with stories</span>
          <h1 className="display-1">把你的经历，<br />讲成一个好故事。</h1>
          <p className="body-lg" style={{ maxWidth: 540 }}>
            Stori 是一位耐心的简历教练，通过自然对话引导你把模糊的经历，变成清晰、量化、有说服力的简历素材——一次只问一件事，五分钟一段经历。
          </p>
          <div className="hero-actions">
            <Link href="/start" className="btn btn-primary btn-lg">
              开始整理我的故事
              <span aria-hidden>→</span>
            </Link>
            <Link href="/result" className="btn btn-text">看看示例 →</Link>
          </div>
        </div>

        <div className="hero-photo fade-up-delay-1" aria-hidden />
      </section>

      <footer className="meta-strip">
        <span>AI 引导对话</span>
        <span>STAR 框架</span>
        <span>语音输入</span>
        <span>一键导出 PDF</span>
      </footer>
    </div>
  );
}
