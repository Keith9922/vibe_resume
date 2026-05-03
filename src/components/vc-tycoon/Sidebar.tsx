import type { GameState } from "@/lib/vc-tycoon/types";
import { ACHIEVEMENTS } from "@/lib/vc-tycoon/achievements";
import { HumanAvatar, AIAvatar } from "./Avatars";

interface Props {
  state: GameState;
}

export default function Sidebar({ state }: Props) {
  return (
    <aside className="vt-sidebar">
      <DecisionStatus state={state} />
      <PortfolioPanel state={state} />
      <AchievementsPanel state={state} />
      <LogPanel state={state} />
    </aside>
  );
}

function DecisionStatus({ state }: { state: GameState }) {
  const { phase, currentPlayerId } = state;

  let badge = "WAITING";
  let badgeColor = "vt-cyan-badge";
  let icon = "⚄";
  let primary: React.ReactNode = "";
  let secondary: React.ReactNode = null;

  if (phase === "tutorial") {
    badge = "INTRO";
    badgeColor = "vt-amber-badge";
    primary = "查看新手指南";
    secondary = "了解游戏规则";
  } else if (phase === "deciding") {
    badge = "PITCHING";
    badgeColor = "vt-amber-badge";
    icon = "🎤";
    primary = currentPlayerId === "human" ? "创始人正在向你 pitch" : "AI 正在评估项目";
    secondary = state.pending?.cell.name;
  } else if (phase === "result") {
    badge = "REVEAL";
    badgeColor = "vt-amber-badge";
    primary = "查看真实结局";
  } else if (phase === "event") {
    badge = "EVENT";
    badgeColor = "vt-amber-badge";
    primary = "事件触发";
  } else if (phase === "lp_check") {
    badge = "LP CHECK";
    badgeColor = "vt-red-badge";
    primary = "LP 季度考核中";
  } else if (phase === "rolling" || phase === "moving") {
    badge = "MOVING";
    primary = "棋子移动中…";
  } else if (phase === "ai_thinking") {
    badge = "AI TURN";
    badgeColor = "vt-red-badge";
    primary = "AI 正在行动";
  } else if (phase === "ended") {
    badge = "GAME OVER";
    primary = "游戏已结束";
  } else {
    primary = currentPlayerId === "human" ? "轮到你掷骰子" : "等待 AI 行动";
    secondary = `CASH: $${state.players[currentPlayerId].cash}M`;
  }

  return (
    <div className="vt-panel">
      <div className="vt-panel-header">
        <div className="vt-panel-title">▸ Current Phase</div>
        <div className={`vt-panel-badge ${badgeColor}`}>{badge}</div>
      </div>
      <div className="vt-empty-state">
        <div className="vt-empty-icon">{icon}</div>
        {primary}
        {secondary && (
          <>
            <br />
            <span className="vt-dim">{secondary}</span>
          </>
        )}
      </div>
    </div>
  );
}

function PortfolioPanel({ state }: { state: GameState }) {
  const { human, ai } = state.players;
  const all = [
    ...human.portfolio.map(p => ({ ...p, owner: "human" as const })),
    ...ai.portfolio.map(p => ({ ...p, owner: "ai" as const })),
  ].sort((a, b) => b.round - a.round);

  const myIn = human.portfolio.reduce((s, p) => s + p.invested, 0);
  const myOut = human.portfolio.reduce((s, p) => s + p.returned, 0);

  return (
    <div className="vt-panel">
      <div className="vt-panel-header">
        <div className="vt-panel-title">▸ Portfolio</div>
        <div className="vt-panel-badge vt-cyan-badge">{all.length} DEALS</div>
      </div>
      <div className="vt-portfolio-summary">
        <span className="vt-pf-label">你的总投入 / 总回报</span>
        <span className="vt-pf-value">${myIn}M / ${myOut}M</span>
      </div>
      {all.length === 0 ? (
        <div className="vt-empty-state vt-empty-pad">还没有投资记录</div>
      ) : (
        <div className="vt-portfolio-list">
          {all.map((p, i) => (
            <div key={`${p.dealId}-${p.owner}-${i}`} className={`vt-portfolio-item exit-${p.outcome}`}>
              <div className="vt-pi-meta">
                <div className="vt-pi-name">
                  <span className="vt-pi-owner">
                    {p.owner === "human"
                      ? <HumanAvatar size={14} />
                      : <AIAvatar size={14} />}
                  </span>
                  {p.realName}
                  {p.allIn && <span className="vt-all-in-badge">2x</span>}
                </div>
                <div className="vt-pi-status">
                  {p.outcome === "win" ? `IPO/退出 ${p.multiplier.toFixed(1)}x`
                    : p.outcome === "mid" ? `中等 ${p.multiplier.toFixed(1)}x`
                    : "归零"}
                </div>
              </div>
              <div className={`vt-pi-pl ${p.pl > 0 ? "pl-pos" : p.pl < 0 ? "pl-neg" : "pl-flat"}`}>
                {p.pl >= 0 ? "+" : ""}${p.pl}M
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AchievementsPanel({ state }: { state: GameState }) {
  const unlocked = state.players.human.achievements;
  return (
    <div className="vt-panel">
      <div className="vt-panel-header">
        <div className="vt-panel-title">▸ Achievements</div>
        <div className="vt-panel-badge vt-gold-badge">{unlocked.size}/{ACHIEVEMENTS.length}</div>
      </div>
      <div className="vt-achievements">
        {ACHIEVEMENTS.map(a => {
          const isUnlocked = unlocked.has(a.id);
          return (
            <div key={a.id} className={`vt-achievement ${isUnlocked ? "is-unlocked" : ""}`}>
              <div className="vt-achievement-icon">{a.icon}</div>
              <div className="vt-achievement-name">{a.name}</div>
              <div className="vt-achievement-tooltip">{a.desc}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LogPanel({ state }: { state: GameState }) {
  return (
    <div className="vt-panel">
      <div className="vt-panel-header">
        <div className="vt-panel-title">▸ Activity Log</div>
      </div>
      <div className="vt-log">
        {state.log.length === 0 ? (
          <div className="vt-empty-state vt-empty-pad">暂无活动</div>
        ) : (
          state.log.map(e => (
            <div key={e.id} className={`vt-log-entry log-${e.type}`}>
              <span className="vt-log-time">[R{e.round}]</span>
              {e.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
