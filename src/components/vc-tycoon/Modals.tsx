import type {
  GameState, LPCheckResult, RevealedEvent, RevealedResult,
} from "@/lib/vc-tycoon/types";
import { buildRecap, type PlayerRecap } from "@/lib/vc-tycoon/recap";
import { ACHIEVEMENTS } from "@/lib/vc-tycoon/achievements";
import { HumanAvatar, AIAvatar, PlayerAvatar } from "./Avatars";

export function ResultModal({
  result, onClose,
}: {
  result: RevealedResult;
  onClose: () => void;
}) {
  const { cell, pl, invested, allIn, effectiveOutcome, effectiveMult, playerId } = result;
  const ownerLabel = playerId === "human" ? "你" : "AI";

  let outcomeClass: string, outcomeText: string;
  if (invested) {
    if (effectiveOutcome === "win") {
      outcomeClass = "win";
      outcomeText = pl > 200 ? "GRAND SLAM" : "BIG WIN";
    } else if (effectiveOutcome === "mid") {
      outcomeClass = "mid";
      outcomeText = "MEDIUM EXIT";
    } else {
      outcomeClass = "loss";
      outcomeText = "WIPED OUT";
    }
  } else {
    if (effectiveOutcome === "win") {
      outcomeClass = "loss";
      outcomeText = `${ownerLabel} MISSED`;
    } else if (effectiveOutcome === "mid") {
      outcomeClass = "mid";
      outcomeText = "PASSED · NEUTRAL";
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
            {allIn && <span className="vt-all-in-badge">ALL IN</span>}
          </div>
          <div className="vt-result-company">{cell.real}</div>
        </div>

        {/* 假新闻头条 */}
        <div className="vt-news-headline">
          {cell.headline}
          <div className="vt-news-source">— {cell.source}</div>
        </div>

        <div className={`vt-result-outcome out-${outcomeClass}`}>{outcomeText}</div>

        {invested ? (
          <div className={`vt-result-pl ${pl > 0 ? "gain" : pl < 0 ? "lose" : "flat"}`}>
            {sign}${pl}M
            <div className="vt-result-mult">{effectiveMult.toFixed(2)}x</div>
          </div>
        ) : (
          <div className="vt-result-would">
            如果投了会是: <span className={pl > 0 ? "pl-pos" : "pl-neg"}>{sign}${pl}M ({effectiveMult.toFixed(2)}x)</span>
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

export function EventModal({
  event, onClose,
}: {
  event: RevealedEvent;
  onClose: () => void;
}) {
  const ownerLabel = event.playerId === "human" ? "你" : "AI";
  const sign = event.cashDelta >= 0 ? "+" : "";

  return (
    <div className="vt-modal-overlay">
      <div className={`vt-event-modal tone-${event.tone}`}>
        <div className="vt-event-corner-tag">{event.cornerName}</div>
        <div className="vt-event-emoji">{event.emoji}</div>
        <div className="vt-event-title">{event.title}</div>
        <div className="vt-event-flavor">{event.flavor}</div>
        <div className={`vt-event-impact tone-${event.tone}`}>
          {ownerLabel} {sign}${event.cashDelta}M
        </div>
        <button className="vt-btn" onClick={onClose}>CONTINUE</button>
      </div>
    </div>
  );
}

export function LPCheckModal({
  result, players, onClose,
}: {
  result: LPCheckResult;
  players: GameState["players"];
  onClose: () => void;
}) {
  const player = players[result.playerId];
  const ownerLabel = result.playerId === "human" ? "你" : "AI";

  if (result.terminated) {
    return (
      <div className="vt-modal-overlay">
        <div className="vt-lp-modal is-fail">
          <div className="vt-lp-title vt-red">FUND TERMINATED</div>
          <div className="vt-lp-sub">{ownerLabel} · 基 金 清 盘</div>
          <LPRow label="MOIC" value={`${result.moic.toFixed(2)}x`} accent="red" />
          <LPRow label="累计警告" value="2 / 2" accent="red" />
          <div className="vt-lp-flavor">LP 失去耐心，强制清盘所有未退出投资。</div>
          <button className="vt-btn vt-btn-red" onClick={onClose}>FACE THE END</button>
        </div>
      </div>
    );
  }

  if (result.passed) {
    return (
      <div className="vt-modal-overlay">
        <div className="vt-lp-modal">
          <div className="vt-lp-title vt-amber">LP MEETING</div>
          <div className="vt-lp-sub">{ownerLabel} · 季度考核通过</div>
          <LPRow label="MOIC" value={`${result.moic.toFixed(2)}x`} accent="green" />
          <LPRow label="目标" value="≥ 1.20x" />
          <div className="vt-lp-flavor">「业绩不错，继续保持。」— LP 们说</div>
          <LPRow label="奖励" value={`+$${result.cashDelta}M 跟投`} accent="green" />
          <button className="vt-btn" onClick={onClose}>CONTINUE</button>
        </div>
      </div>
    );
  }

  return (
    <div className="vt-modal-overlay">
      <div className="vt-lp-modal is-fail">
        <div className="vt-lp-title vt-red">LP WARNING</div>
        <div className="vt-lp-sub">{ownerLabel} · 业 绩 警 告</div>
        <LPRow label="MOIC" value={`${result.moic.toFixed(2)}x`} accent="red" />
        <LPRow label="目标" value="≥ 1.20x" />
        <LPRow label="累计警告" value={`${result.warning} / 2`} accent="amber" />
        <div className="vt-lp-flavor">
          「{player.name === "你" ? "你" : "AI"}最近选的项目让我们很担心。再这样下去，我们要重新考虑这只基金了。」
        </div>
        <LPRow label="惩罚" value={`-$${Math.abs(result.cashDelta)}M`} accent="red" />
        <button className="vt-btn vt-btn-red" onClick={onClose}>ACKNOWLEDGE</button>
      </div>
    </div>
  );
}

function LPRow({ label, value, accent }: { label: string; value: string; accent?: "green" | "red" | "amber" }) {
  return (
    <div className="vt-lp-row">
      <span>{label}</span>
      <span className={accent ? `vt-${accent}` : ""}>{value}</span>
    </div>
  );
}

export function RecapModal({
  state, onReset,
}: {
  state: GameState;
  onReset: () => void;
}) {
  const recaps = buildRecap(state);
  const won = state.winnerId === "human";
  const me = recaps.human;
  const opp = recaps.ai;
  const unlocked = Array.from(state.players.human.achievements);

  return (
    <div className="vt-modal-overlay">
      <div className="vt-recap-modal">
        <div className="vt-recap-header">
          <div className={`vt-recap-result ${won ? "is-win" : "is-loss"}`}>
            {won ? "VICTORY" : "GAME OVER"}
          </div>
          <div className="vt-recap-tier-line">
            <span className={`vt-recap-rank tier-${me.tier.color}`}>{me.tier.rank}</span>
            <div className="vt-recap-tier-text">
              <div className="vt-recap-tier-title">{me.tier.title}</div>
              <div className="vt-recap-tier-desc">{me.tier.description}</div>
            </div>
          </div>
        </div>

        <div className="vt-recap-vs">
          <PlayerScore recap={me} avatar={<HumanAvatar size={36} />} highlight />
          <div className="vt-recap-vs-divider">VS</div>
          <PlayerScore recap={opp} avatar={<AIAvatar size={36} />} />
        </div>

        <div className="vt-recap-section">
          <div className="vt-recap-section-title">▸ KEY MOMENTS</div>
          <div className="vt-recap-moments">
            {me.bestHit && (
              <Moment label="最佳出手" tone="win"
                primary={me.bestHit.realName}
                secondary={`+$${me.bestHit.pl}M · ${me.bestHit.multiplier.toFixed(1)}x`} />
            )}
            {me.worstHit && me.worstHit.pl < 0 && (
              <Moment label="最大翻车" tone="loss"
                primary={me.worstHit.realName}
                secondary={`-$${Math.abs(me.worstHit.pl)}M · 归零`} />
            )}
            {me.missedUnicorns[0] && (
              <Moment label="错过的独角兽" tone="amber"
                primary={me.missedUnicorns[0].realName}
                secondary={`本可 +$${me.missedUnicorns[0].wouldBePL}M`} />
            )}
            {me.goodPasses[0] && (
              <Moment label="机智一拒" tone="cyan"
                primary={me.goodPasses[0].realName}
                secondary={`躲过 -$${Math.abs(me.goodPasses[0].wouldBePL)}M`} />
            )}
          </div>
        </div>

        {/* 解锁成就 */}
        <div className="vt-recap-section">
          <div className="vt-recap-section-title">
            ▸ ACHIEVEMENTS · {unlocked.length}/{ACHIEVEMENTS.length}
          </div>
          <div className="vt-recap-achievements">
            {ACHIEVEMENTS.map(a => {
              const got = state.players.human.achievements.has(a.id);
              return (
                <div key={a.id} className={`vt-recap-achievement ${got ? "is-unlocked" : ""}`}>
                  <div className="vt-recap-achievement-icon">{a.icon}</div>
                  <div className="vt-recap-achievement-name">{a.name}</div>
                </div>
              );
            })}
          </div>
        </div>

        {(me.missedUnicorns.length > 0 || me.goodPasses.length > 0) && (
          <div className="vt-recap-section">
            <div className="vt-recap-section-title">▸ THE LIST</div>
            {me.missedUnicorns.length > 0 && (
              <div className="vt-recap-list">
                <div className="vt-recap-list-label tone-loss">
                  你 PASS 掉的爆款（{me.missedUnicorns.length}）
                </div>
                {me.missedUnicorns.slice(0, 4).map(d => (
                  <div key={d.dealId} className="vt-recap-row">
                    <span className="vt-recap-row-name">{d.realName}</span>
                    <span className="vt-recap-row-meta">
                      <span className="pl-pos">+${d.wouldBePL}M</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
            {me.goodPasses.length > 0 && (
              <div className="vt-recap-list">
                <div className="vt-recap-list-label tone-win">
                  你 PASS 掉的烂项目（{me.goodPasses.length}）
                </div>
                {me.goodPasses.slice(0, 4).map(d => (
                  <div key={d.dealId} className="vt-recap-row">
                    <span className="vt-recap-row-name">{d.realName}</span>
                    <span className="vt-recap-row-meta">
                      <span className="pl-neg">${d.wouldBePL}M</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="vt-recap-footer">
          <button className={`vt-btn ${won ? "" : "vt-btn-red"}`} onClick={onReset}>
            {won ? "再来一局" : "RESTART"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PlayerScore({ recap, avatar, highlight }: {
  recap: PlayerRecap;
  avatar: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className={`vt-recap-player ${highlight ? "is-me" : ""}`}>
      <div className="vt-recap-player-head">
        {avatar}
        <span className="vt-recap-player-name">{recap.name}</span>
      </div>
      <div className="vt-recap-player-cash">${recap.finalCash}M</div>
      <div className="vt-recap-player-stats">
        <Stat label="出手" value={recap.totalInvestments} />
        <Stat label="独角兽" value={recap.unicorns} accent="green" />
        <Stat label="翻车" value={recap.losses} accent="red" />
        <Stat label="命中率" value={`${Math.round(recap.hitRate * 100)}%`} />
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number | string; accent?: "green" | "red" }) {
  return (
    <div className="vt-recap-stat">
      <div className="vt-recap-stat-label">{label}</div>
      <div className={`vt-recap-stat-value ${accent ? `vt-${accent}` : ""}`}>{value}</div>
    </div>
  );
}

function Moment({ label, tone, primary, secondary }: {
  label: string;
  tone: "win" | "loss" | "amber" | "cyan";
  primary: string;
  secondary: string;
}) {
  return (
    <div className={`vt-recap-moment moment-${tone}`}>
      <div className="vt-recap-moment-label">{label}</div>
      <div className="vt-recap-moment-primary">{primary}</div>
      <div className="vt-recap-moment-secondary">{secondary}</div>
    </div>
  );
}

// Re-export the avatar helper so VCTycoon can use it inline if needed
export { PlayerAvatar };
