"use client";

import type { InterviewMessage, InterviewPhase } from "@/lib/types";

type StarItemState = "done" | "active" | "pending";

const STAR_ORDER: { phase: InterviewPhase; key: string; label: string }[] = [
  { phase: "intro", key: "intro", label: "Background · 背景" },
  { phase: "topic-select", key: "topic", label: "Focus · 聚焦经历" },
  { phase: "deep-dive", key: "situation", label: "Situation · 情境" },
  { phase: "deep-dive", key: "task", label: "Task · 你负责什么" },
  { phase: "deep-dive", key: "action", label: "Action · 你做了什么" },
  { phase: "deep-dive", key: "result", label: "Result · 结果" },
  { phase: "closing", key: "closing", label: "Wrap-up · 收尾" },
];

interface Props {
  phase: InterviewPhase;
  turnCount: number;
  messages: InterviewMessage[];
}

export function StarSidebar({ phase, turnCount, messages }: Props) {
  // Determine which step is active by phase + turnCount within deep-dive
  const items = STAR_ORDER.map((item, idx) => {
    let state: StarItemState = "pending";
    if (phase === "done") state = "done";
    else if (phase === "intro" && item.key === "intro") state = "active";
    else if (phase === "topic-select" && item.key === "topic") state = "active";
    else if (phase === "deep-dive") {
      // Map deep-dive turns: turn 3-4 = situation/task, 5-6 = action, 7 = result
      const ddTurn = Math.max(0, turnCount - 3);
      const targetKey =
        ddTurn <= 0 ? "situation" :
        ddTurn === 1 ? "task" :
        ddTurn <= 3 ? "action" :
        "result";
      if (item.key === targetKey) state = "active";
      else if (idx < STAR_ORDER.findIndex((x) => x.key === targetKey)) state = "done";
    } else if (phase === "closing") {
      if (item.key === "closing") state = "active";
      else state = "done";
    }
    // Items before the active phase are done
    const phaseOrder: InterviewPhase[] = ["intro", "topic-select", "deep-dive", "closing", "done"];
    const itemPhaseIdx = phaseOrder.indexOf(item.phase);
    const currentPhaseIdx = phaseOrder.indexOf(phase);
    if (state === "pending" && itemPhaseIdx < currentPhaseIdx) state = "done";
    return { ...item, state };
  });

  // Pull a recent user-utterance summary as detail for done items
  const userMessages = messages.filter((m) => m.role === "user");
  const detailFor = (key: string): string => {
    if (key === "intro" && userMessages[0]) return excerpt(userMessages[0].content);
    if (key === "topic" && userMessages[1]) return excerpt(userMessages[1].content);
    if (key === "situation" && userMessages[2]) return excerpt(userMessages[2].content);
    return "";
  };

  return (
    <aside className="star-sidebar">
      <div className="star-sidebar-header">
        <span className="eyebrow">Your story · so far</span>
        <h2 className="heading-2" style={{ marginTop: 8, marginBottom: 0 }}>
          {userMessages[1] ? excerpt(userMessages[1].content, 16) : "正在了解中…"}
        </h2>
      </div>
      <div className="star-list">
        {items.map((item) => (
          <div key={item.key} className={`star-item ${item.state === "active" ? "star-item-active" : ""}`}>
            <div
              className={`star-circle ${
                item.state === "done" ? "star-circle-done" :
                item.state === "active" ? "star-circle-active" :
                "star-circle-pending"
              }`}
            >
              {item.state === "done" ? "✓" : item.state === "active" ? "·" : ""}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="star-label">{item.label}</div>
              {item.state !== "pending" && (
                <div className="star-detail">
                  {item.state === "done" ? detailFor(item.key) || "已完成" : "正在挖掘…"}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

function excerpt(s: string, max = 30): string {
  const trimmed = s.trim().replace(/\s+/g, " ");
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}
