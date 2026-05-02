import type { GameState } from "@/lib/vc-tycoon/types";

interface Props {
  state: GameState;
  onInvest: () => void;
  onPass: () => void;
}

export default function Sidebar({ state, onInvest, onPass }: Props) {
  return (
    <aside className="vt-sidebar">
      <DecisionPanel state={state} onInvest={onInvest} onPass={onPass} />
      <PortfolioPanel state={state} />
      <LogPanel state={state} />
    </aside>
  );
}

function DecisionPanel({ state, onInvest, onPass }: Props) {
  const { phase, pending, currentPlayerId, players } = state;

  if (phase === "deciding" && pending && pending.playerId === "human") {
    const { cell } = pending;
    const tierLabel = cell.tier === "seed" ? "Seed Round" : cell.tier === "a" ? "Series A" : "Series B";
    const canAfford = players.human.cash >= cell.cost;
    return (
      <div className="vt-panel">
        <div className="vt-panel-header">
          <div className="vt-panel-title">▸ Current Decision</div>
          <div className="vt-panel-badge vt-amber-badge">DECIDE</div>
        </div>
        <div className="vt-deal-card">
          <div className="vt-deal-status">▸ INCOMING PITCH · {cell.year}</div>
          <div className="vt-deal-name">{cell.name}</div>
          <div className="vt-deal-tagline">&ldquo;{cell.tagline}&rdquo;</div>
          <div className="vt-deal-meta">
            <Meta label="ROUND" value={tierLabel} />
            <Meta label="TICKET SIZE" value={`$${cell.cost}M`} />
          </div>
          <div className="vt-deal-actions">
            <button className="vt-btn" onClick={onInvest} disabled={!canAfford}>INVEST</button>
            <button className="vt-btn vt-btn-red" onClick={onPass}>PASS</button>
          </div>
          {!canAfford && <div className="vt-warning">资金不足，无法投资</div>}
        </div>
      </div>
    );
  }

  // AI 决策中
  if (phase === "deciding" && pending && pending.playerId === "ai") {
    return (
      <div className="vt-panel">
        <div className="vt-panel-header">
          <div className="vt-panel-title">▸ AI Decision</div>
          <div className="vt-panel-badge vt-red-badge">THINKING</div>
        </div>
        <div className="vt-deal-card vt-deal-card-ai">
          <div className="vt-deal-status">▸ AI 正在评估 · {pending.cell.year}</div>
          <div className="vt-deal-name">{pending.cell.name}</div>
          <div className="vt-deal-tagline">&ldquo;{pending.cell.tagline}&rdquo;</div>
          <div className="vt-deal-meta">
            <Meta label="ROUND" value={pending.cell.tier.toUpperCase()} />
            <Meta label="TICKET" value={`$${pending.cell.cost}M`} />
          </div>
          <div className="vt-thinking">
            <span className="vt-thinking-dot" /><span className="vt-thinking-dot" /><span className="vt-thinking-dot" />
          </div>
        </div>
      </div>
    );
  }

  // 等待 / 移动 / 结果
  let badgeText = "WAITING";
  let bodyText: React.ReactNode;
  if (phase === "rolling" || phase === "moving") {
    badgeText = "MOVING";
    bodyText = <>骰子已掷出，正在移动…</>;
  } else if (phase === "result") {
    badgeText = "RESULT";
    bodyText = <>查看揭晓的真实结局</>;
  } else if (phase === "ai_thinking") {
    badgeText = "AI TURN";
    bodyText = <>AI 正在行动…</>;
  } else if (phase === "ended") {
    badgeText = "GAME OVER";
    bodyText = <>游戏已结束</>;
  } else {
    bodyText = (
      <>
        {currentPlayerId === "human" ? "轮到你掷骰子" : "等待 AI 行动"}<br />
        <span className="vt-dim">CASH: ${players[currentPlayerId].cash}M</span>
      </>
    );
  }

  return (
    <div className="vt-panel">
      <div className="vt-panel-header">
        <div className="vt-panel-title">▸ Current Decision</div>
        <div className="vt-panel-badge">{badgeText}</div>
      </div>
      <div className="vt-empty-state">
        <div className="vt-empty-icon">⚄</div>
        {bodyText}
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="vt-meta-item">
      <div className="vt-meta-label">{label}</div>
      <div className="vt-meta-value">{value}</div>
    </div>
  );
}

function PortfolioPanel({ state }: { state: GameState }) {
  const { human, ai } = state.players;
  const all = [
    ...human.portfolio.map(p => ({ ...p, owner: "human" as const, ownerName: "你" })),
    ...ai.portfolio.map(p => ({ ...p, owner: "ai" as const, ownerName: "AI" })),
  ].sort((a, b) => b.round - a.round);

  return (
    <div className="vt-panel">
      <div className="vt-panel-header">
        <div className="vt-panel-title">▸ Portfolio</div>
        <div className="vt-panel-badge vt-cyan-badge">{all.length} DEALS</div>
      </div>
      {all.length === 0 ? (
        <div className="vt-empty-state vt-empty-pad">还没有投资记录</div>
      ) : (
        <div className="vt-portfolio-list">
          {all.map((p, i) => (
            <div
              key={`${p.dealId}-${p.owner}-${i}`}
              className={`vt-portfolio-item exit-${p.outcome} owner-${p.owner}`}
            >
              <div>
                <div className="vt-pi-name">
                  <span className={`vt-owner-tag owner-${p.owner}`}>{p.ownerName}</span>
                  {p.realName}
                </div>
                <div className="vt-pi-status">
                  {p.outcome === "win" ? `IPO/退出 ${p.multiplier}x`
                    : p.outcome === "mid" ? `中等退出 ${p.multiplier}x`
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
          state.log.map(entry => (
            <div key={entry.id} className={`vt-log-entry log-${entry.type}`}>
              <span className="vt-log-time">[R{entry.round}]</span>
              {entry.text}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
