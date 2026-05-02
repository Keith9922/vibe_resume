import type { GameState, RevealedResult } from "@/lib/vc-tycoon/types";

export function ResultModal({
  result, onClose,
}: {
  result: RevealedResult;
  onClose: () => void;
}) {
  const { cell, pl, invested, playerId } = result;
  const ownerLabel = playerId === "human" ? "你" : "AI";

  let outcomeClass: string, outcomeText: string;
  if (invested) {
    if (cell.outcome === "win") {
      outcomeClass = "win";
      outcomeText = pl > 100 ? "GRAND SLAM" : "BIG WIN";
    } else if (cell.outcome === "mid") {
      outcomeClass = "mid";
      outcomeText = "MEDIUM EXIT";
    } else {
      outcomeClass = "loss";
      outcomeText = "WIPED OUT";
    }
  } else {
    // PASS 时，看本来会怎样来决定情绪
    if (cell.outcome === "win") {
      outcomeClass = "loss";
      outcomeText = playerId === "human" ? "YOU MISSED" : "AI MISSED";
    } else if (cell.outcome === "mid") {
      outcomeClass = "mid";
      outcomeText = "PASSED · MEDIUM";
    } else {
      outcomeClass = "win";
      outcomeText = "GOOD CALL";
    }
  }

  const sign = pl >= 0 ? "+" : "";

  return (
    <div className="vt-modal-overlay">
      <div className="vt-result-modal">
        <div className="vt-result-header">
          <div className="vt-result-year">
            {cell.year} · {invested ? `${ownerLabel} 投资了` : `${ownerLabel} PASSED`}
          </div>
          <div className="vt-result-company">{cell.real}</div>
        </div>
        <div className={`vt-result-outcome out-${outcomeClass}`}>{outcomeText}</div>
        {invested ? (
          <div className={`vt-result-pl ${pl > 0 ? "gain" : pl < 0 ? "lose" : "flat"}`}>
            {sign}${pl}M
          </div>
        ) : (
          <div className="vt-result-would">
            如果投了会是: <span className={pl > 0 ? "pl-pos" : "pl-neg"}>{sign}${pl}M</span>
          </div>
        )}
        <div className="vt-result-story">{cell.story}</div>
        <div className="vt-result-actions">
          <button className="vt-btn" onClick={onClose}>CONTINUE</button>
        </div>
      </div>
    </div>
  );
}

export function GameOverModal({
  state, onReset,
}: {
  state: GameState;
  onReset: () => void;
}) {
  const { winnerId, players, round } = state;
  const won = winnerId === "human";
  const winner = winnerId ? players[winnerId] : null;
  const loser = winnerId ? players[winnerId === "human" ? "ai" : "human"] : null;

  return (
    <div className="vt-modal-overlay">
      <div className={`vt-modal ${won ? "" : "is-loss"}`}>
        <div className="vt-modal-title">{won ? "YOU WIN" : "GAME OVER"}</div>
        <div className="vt-modal-sub">{won ? "基 金 大 成" : "基 金 清 算"}</div>
        <div className="vt-modal-text">
          {winner && (
            <>
              胜者：<strong>{winner.name}</strong> · 最终基金 <span className={won ? "vt-green" : "vt-red"}>${winner.cash}M</span><br />
              {loser && <>败者：{loser.name} · ${loser.cash}M<br /></>}
              共 {round} 轮，胜者投资 {winner.portfolio.length} 个项目<br />
              {won ? (
                <span className="vt-flavor">你证明了自己是一名合格的 VC</span>
              ) : (
                <span className="vt-flavor">&ldquo;也许你更适合当一个 Builder&rdquo;</span>
              )}
            </>
          )}
        </div>
        <button className={`vt-btn ${won ? "" : "vt-btn-red"}`} onClick={onReset}>
          {won ? "PLAY AGAIN" : "RESTART"}
        </button>
      </div>
    </div>
  );
}
