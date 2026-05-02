import type { GameState } from "@/lib/vc-tycoon/types";

interface Props {
  state: GameState;
}

export default function Header({ state }: Props) {
  const { human, ai } = state.players;
  return (
    <header className="vt-header">
      <div className="vt-logo">
        VC TYCOON
        <span className="vt-logo-cn">创 投 大 富 翁</span>
      </div>
      <div className="vt-header-stats">
        <PlayerStat label="YOU" cash={human.cash} portfolio={human.portfolio.length} active={state.currentPlayerId === "human"} accent="green" />
        <div className="vt-vs">VS</div>
        <PlayerStat label="AI" cash={ai.cash} portfolio={ai.portfolio.length} active={state.currentPlayerId === "ai"} accent="red" />
        <div className="vt-stat">
          <div className="vt-stat-label">ROUND</div>
          <div className="vt-stat-value vt-amber">{state.round}</div>
        </div>
      </div>
    </header>
  );
}

function PlayerStat({
  label, cash, portfolio, active, accent,
}: { label: string; cash: number; portfolio: number; active: boolean; accent: "green" | "red" }) {
  return (
    <div className={`vt-player-stat ${active ? "is-active" : ""} accent-${accent}`}>
      <div className="vt-stat-label">{label}{active && <span className="vt-turn-dot" />}</div>
      <div className="vt-player-stat-row">
        <span className="vt-player-cash">${cash}M</span>
        <span className="vt-player-port">· {portfolio}P</span>
      </div>
    </div>
  );
}
