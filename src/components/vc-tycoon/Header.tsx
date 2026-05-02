import type { GameState } from "@/lib/vc-tycoon/types";
import { SECTOR_LABEL } from "@/lib/vc-tycoon/sectors";
import { HumanAvatar, AIAvatar } from "./Avatars";

interface Props {
  state: GameState;
}

export default function Header({ state }: Props) {
  const { human, ai } = state.players;
  const totalPL = human.portfolio.reduce((s, p) => s + p.pl, 0);
  const winThreshold = 500;
  const startCash = 100;
  const pct = Math.min(100, Math.max(0, (human.cash / winThreshold) * 100));

  return (
    <header className="vt-header">
      <div className="vt-header-top">
        <div className="vt-logo">
          VC TYCOON
          <span className="vt-logo-cn">创 投 大 富 翁</span>
        </div>
        <div className="vt-header-stats">
          <PlayerStat
            avatar={<HumanAvatar size={32} />}
            label="YOU"
            cash={human.cash}
            portfolio={human.portfolio.length}
            active={state.currentPlayerId === "human"}
            accent="green"
          />
          <div className="vt-vs">VS</div>
          <PlayerStat
            avatar={<AIAvatar size={32} />}
            label="AI"
            cash={ai.cash}
            portfolio={ai.portfolio.length}
            active={state.currentPlayerId === "ai"}
            accent="red"
          />
          <div className="vt-stat">
            <div className="vt-stat-label">UNREALIZED</div>
            <div className={`vt-stat-value ${totalPL >= 0 ? "vt-cyan" : "vt-red"}`}>
              {totalPL >= 0 ? "+" : ""}${totalPL}M
            </div>
          </div>
          <div className="vt-stat">
            <div className="vt-stat-label">ROUND</div>
            <div className="vt-stat-value vt-amber">{state.round}</div>
          </div>
        </div>
      </div>

      {/* 进度条 */}
      <div className="vt-progress-bar">
        <div className="vt-progress-fill" style={{ width: `${pct}%` }} />
        <div className="vt-progress-marker" style={{ left: `${(startCash / winThreshold) * 100}%` }} />
      </div>
      <div className="vt-progress-markers">
        <span className="vt-progress-loss">$0 BANKRUPT</span>
        <span className="vt-progress-start">$100M START</span>
        <span className="vt-progress-win">$500M FUND OF YEAR</span>
      </div>

      {/* 市场冷热 */}
      <div className="vt-market-conditions">
        {Object.entries(state.marketTrends).map(([sector, trend]) => {
          const label = SECTOR_LABEL[sector as keyof typeof SECTOR_LABEL];
          const prefix = trend === "hot" ? "🔥 " : trend === "cold" ? "❄️ " : "";
          return (
            <div key={sector} className={`vt-market-tag ${trend}`}>
              {prefix}{label}
            </div>
          );
        })}
      </div>
    </header>
  );
}

function PlayerStat({
  avatar, label, cash, portfolio, active, accent,
}: {
  avatar: React.ReactNode;
  label: string;
  cash: number;
  portfolio: number;
  active: boolean;
  accent: "green" | "red";
}) {
  return (
    <div className={`vt-player-stat accent-${accent} ${active ? "is-active" : ""}`}>
      <div className="vt-player-avatar">{avatar}</div>
      <div className="vt-player-stat-text">
        <div className="vt-stat-label">
          {label}
          {active && <span className="vt-turn-dot" />}
        </div>
        <div className="vt-player-stat-row">
          <span className="vt-player-cash">${cash}M</span>
          <span className="vt-player-port">· {portfolio}P</span>
        </div>
      </div>
    </div>
  );
}
