import type { Cell, GameState } from "@/lib/vc-tycoon/types";
import { GRID_POSITIONS } from "@/lib/vc-tycoon/board";
import { SECTOR_LABEL } from "@/lib/vc-tycoon/sectors";
import { HumanAvatar, AIAvatar } from "./Avatars";

interface Props {
  state: GameState;
  onRoll: () => void;
  rollDisabled: boolean;
  rolling: boolean;
}

const DICE_FACES = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

export default function Board({ state, onRoll, rollDisabled, rolling }: Props) {
  const { human, ai } = state.players;

  return (
    <div className="vt-board-wrap">
      <div className="vt-board-label">{`// 28 GRID · ROUND ${state.round}`}</div>
      <div className="vt-board">
        {state.board.map((cell, idx) => {
          const [row, col] = GRID_POSITIONS[idx];
          return (
            <CellView
              key={idx}
              cell={cell}
              row={row}
              col={col}
              isHumanHere={human.position === idx}
              isAIHere={ai.position === idx}
              isVisited={state.visited.has(idx) && human.position !== idx && ai.position !== idx}
              isTaken={state.taken.has(idx)}
              sectorTrend={
                cell.kind === "deal"
                  ? state.marketTrends[cell.sector]
                  : "neutral"
              }
            />
          );
        })}
        <div className="vt-board-center">
          <div className="vt-center-title">VC<br />TYCOON</div>
          <div className="vt-center-sub">创 投 局</div>
          <div className="vt-center-target">
            🎯 TARGET: <b>$500M</b> · <span className="vt-red">$0M = OUT</span>
          </div>
          <div className="vt-dice-section">
            <div className={`vt-dice ${rolling ? "is-rolling" : ""}`}>
              {DICE_FACES[(state.diceFace - 1) || 0]}
            </div>
            <button className="vt-btn" onClick={onRoll} disabled={rollDisabled}>
              {state.currentPlayerId === "ai" && state.phase !== "idle" && state.phase !== "tutorial"
                ? "AI 思考中"
                : "ROLL DICE"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CellView({
  cell, row, col,
  isHumanHere, isAIHere, isVisited, isTaken, sectorTrend,
}: {
  cell: Cell;
  row: number;
  col: number;
  isHumanHere: boolean;
  isAIHere: boolean;
  isVisited: boolean;
  isTaken: boolean;
  sectorTrend: "hot" | "cold" | "neutral";
}) {
  const active = isHumanHere || isAIHere;
  const classes = [
    "vt-cell",
    cell.kind === "corner" ? `vt-cell-corner corner-${cell.type}` : "",
    active ? "is-active" : "",
    isVisited && !active ? "is-visited" : "",
    isTaken ? "is-taken" : "",
  ].filter(Boolean).join(" ");

  const isDeal = cell.kind === "deal";

  return (
    <div className={classes} style={{ gridRow: row + 1, gridColumn: col + 1 }}>
      {/* 风口/寒冬指示器 */}
      {isDeal && sectorTrend === "hot" && <div className="vt-cell-hot" title="风口" />}
      {isDeal && sectorTrend === "cold" && <div className="vt-cell-cold" title="寒冬" />}

      <div className="vt-cell-content">
        <div className="vt-cell-tag">
          {cell.kind === "corner" ? labelForCorner(cell.type) : labelForTier(cell as Extract<Cell, { kind: "deal" }>)}
        </div>
        {isDeal && (
          <div className="vt-cell-sector">
            {SECTOR_LABEL[(cell as Extract<Cell, { kind: "deal" }>).sector]}
          </div>
        )}
        <div className="vt-cell-name">{cell.name}</div>
      </div>
      <div className={`vt-cell-tier vt-tier-${cell.kind === "corner" ? "event" : (cell as Extract<Cell, { kind: "deal" }>).tier}`} />

      {isHumanHere && (
        <div className="vt-token vt-token-human" title="你">
          <HumanAvatar size={24} />
        </div>
      )}
      {isAIHere && (
        <div className="vt-token vt-token-ai" title="AI">
          <AIAvatar size={24} />
        </div>
      )}
      {isTaken && !active && <div className="vt-cell-locked">●</div>}
    </div>
  );
}

function labelForTier(cell: Extract<Cell, { kind: "deal" }>): string {
  switch (cell.tier) {
    case "seed": return "SEED $20M";
    case "a": return "A $50M";
    case "b": return "B $100M";
  }
}

function labelForCorner(t: string): string {
  switch (t) {
    case "start": return "$ START";
    case "lp_check": return "◆ LP";
    case "free_dd": return "◆ DEMO";
    case "black_swan": return "◆ SWAN";
    default: return "◆";
  }
}
