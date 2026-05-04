"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Step = { id: string; label: string };

const STEPS: Step[] = [
  { id: "/start", label: "目标岗位" },
  { id: "/interview", label: "深度访谈" },
  { id: "/result", label: "你的故事" },
];

export function AppNav({ showSteps = true }: { showSteps?: boolean }) {
  const pathname = usePathname();
  const stepIndex = STEPS.findIndex((s) => pathname?.startsWith(s.id));
  const currentStep = stepIndex === -1 ? null : STEPS[stepIndex];

  return (
    <nav className="app-nav">
      <Link href="/" className="nav-brand">Stori</Link>

      {showSteps && currentStep ? (
        <div className="nav-step">
          <span className="nav-step-num">{String(stepIndex + 1).padStart(2, "0")} / 03</span>
          <span className="nav-step-label">{currentStep.label}</span>
        </div>
      ) : (
        <div className="nav-links">
          <Link href="#how" className="nav-link">如何运作</Link>
          <Link href="#about" className="nav-link">关于</Link>
          <Link href="/start" className="btn btn-ghost btn-sm">开始使用</Link>
        </div>
      )}
    </nav>
  );
}
