import type { Cell, GameState } from "@/lib/vc-tycoon/types";
import { GRID_POSITIONS } from "@/lib/vc-tycoon/board";

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
      <div className="vt-board-label">{`// BOARD · ${state.board.length} CELLS · ROUND ${state.round}`}</div>
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
            />
          );
        })}
        <div className="vt-board-center">
          <div className="vt-center-title">VC<br />TYCOON</div>
          <div className="vt-center-sub">创 投 局</div>
          <div className="vt-dice-section">
            <div className={`vt-dice ${rolling ? "is-rolling" : ""}`}>
              {DICE_FACES[(state.diceFace - 1) || 0]}
            </div>
            <button
              className="vt-btn"
              onClick={onRoll}
              disabled={rollDisabled}
            >
              {state.currentPlayerId === "ai" && state.phase !== "idle" ? "AI 思考中" : "ROLL DICE"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CellView({
  cell, row, col, isHumanHere, isAIHere, isVisited, isTaken,
}: {
  cell: Cell;
  row: number;
  col: number;
  isHumanHere: boolean;
  isAIHere: boolean;
  isVisited: boolean;
  isTaken: boolean;
}) {
  const active = isHumanHere || isAIHere;
  const classes = [
    "vt-cell",
    cell.kind === "corner" ? "vt-cell-corner" : "",
    active ? "is-active" : "",
    isVisited && !active ? "is-visited" : "",
    isTaken ? "is-taken" : "",
  ].filter(Boolean).join(" ");

  return (
    <div
      className={classes}
      style={{ gridRow: row + 1, gridColumn: col + 1 }}
    >
      <div className="vt-cell-content">
        <div className="vt-cell-tag">
          {cell.kind === "corner" ? "CORNER" : labelForTier(cell)}
        </div>
        <div className="vt-cell-name">{cell.name}</div>
      </div>
      <div className={`vt-cell-tier vt-tier-${cell.kind === "corner" ? "event" : cell.tier}`} />
      {isHumanHere && <div className="vt-token vt-token-human" title="你" />}
      {isAIHere && <div className="vt-token vt-token-ai" title="AI" />}
      {isTaken && !active && <div className="vt-cell-locked">●</div>}
    </div>
  );
}

function labelForTier(cell: Extract<Cell, { kind: "deal" }>): string {
  switch (cell.tier) {
    case "seed": return "SEED $20M";
    case "a": return "SERIES A $50M";
    case "b": return "SERIES B $100M";
  }
}
