import type { Deal, GameState } from "@/lib/vc-tycoon/types";
import { SECTOR_LABEL } from "@/lib/vc-tycoon/sectors";

interface Props {
  state: GameState;
  cell: Deal;
  onInvest: () => void;
  onAllIn: () => void;
  onPass: () => void;
}

export default function PitchModal({ state, cell, onInvest, onAllIn, onPass }: Props) {
  const tierLabel = cell.tier === "seed" ? "SEED ROUND" : cell.tier === "a" ? "SERIES A" : "SERIES B";
  const cash = state.players.human.cash;
  const canAfford = cash >= cell.cost;
  const canAllIn = cash >= cell.cost * 2;

  const trend = state.marketTrends[cell.sector];
  const marketBadge =
    trend === "hot" ? <span className="vt-pitch-market-badge hot">🔥 风口赛道</span> :
    trend === "cold" ? <span className="vt-pitch-market-badge cold">❄️ 寒冬赛道</span> :
    null;

  const founderName = cell.founder.split("，")[0];

  return (
    <div className="vt-modal-overlay">
      <div className="vt-pitch-modal">
        <div className="vt-pitch-banner">
          <div className="vt-pitch-banner-row">
            <div className="vt-pitch-banner-tag">REC · LIVE PITCH</div>
            <div className="vt-pitch-banner-meta">
              {cell.year} · {tierLabel} · {SECTOR_LABEL[cell.sector]}
              {marketBadge}
            </div>
          </div>
          <div className="vt-pitch-name">{cell.name}</div>
          <div className="vt-pitch-tagline">&ldquo;{cell.tagline}&rdquo;</div>
        </div>

        <div className="vt-pitch-body">
          <Section num="01" title="创始人 · FOUNDER">
            <div className="vt-pitch-founder-card">
              <div className="vt-pitch-founder-name">{founderName}</div>
              <div className="vt-pitch-founder-info">{cell.founder}</div>
            </div>
          </Section>

          <Section num="02" title="创业初衷 · ORIGIN STORY">
            <div className="vt-pitch-quote">{cell.founderStory}</div>
          </Section>

          <Section num="03" title="市场理念 · VISION">
            <div className="vt-pitch-text">{cell.vision}</div>
          </Section>

          <Section num="04" title="商业模式 · BUSINESS MODEL">
            <div className="vt-pitch-text">{cell.business}</div>
          </Section>

          <Section num="05" title="当前进展 · TRACTION">
            <div className="vt-pitch-text">{cell.progress}</div>
          </Section>

          <Section num="06" title="融资条件 · TERMS">
            <div className="vt-pitch-stats">
              <Stat label="本轮金额" value={`$${cell.cost}M`} />
              <Stat label="轮次" value={tierLabel} />
              <div className="vt-pitch-stat-item vt-pitch-stat-full">
                <div className="vt-pitch-stat-label">详情</div>
                <div className="vt-pitch-stat-detail">{cell.funding}</div>
              </div>
            </div>
          </Section>

          <Section num="07" title="市场情报 · DUE DILIGENCE">
            <div className="vt-pitch-signals">
              {cell.signals.map(([tone, text], idx) => {
                const cls = tone === "+" ? "positive" : tone === "-" ? "negative" : "neutral";
                const icon = tone === "+" ? "+" : tone === "-" ? "–" : "?";
                return (
                  <div key={idx} className={`vt-pitch-signal ${cls}`}>
                    <div className="vt-pitch-signal-icon">{icon}</div>
                    <div className="vt-pitch-signal-text">{text}</div>
                  </div>
                );
              })}
            </div>
          </Section>
        </div>

        <div className="vt-pitch-decision-bar">
          <div className="vt-pitch-decision-prompt">▸ Your Move, GP</div>
          <div className="vt-pitch-actions">
            <button className="vt-btn" onClick={onInvest} disabled={!canAfford}>
              <span>INVEST</span>
              <span className="vt-btn-sub">${cell.cost}M</span>
            </button>
            <button className="vt-btn vt-btn-purple" onClick={onAllIn} disabled={!canAllIn}>
              <span>ALL IN</span>
              <span className="vt-btn-sub">${cell.cost * 2}M · 2x</span>
            </button>
            <button className="vt-btn vt-btn-red" onClick={onPass}>
              <span>PASS</span>
              <span className="vt-btn-sub">机会成本 -$2M</span>
            </button>
          </div>
          {!canAfford && <div className="vt-warning">⚠ 资金不足，无法投资</div>}
        </div>
      </div>
    </div>
  );
}

function Section({ num, title, children }: { num: string; title: string; children: React.ReactNode }) {
  return (
    <div className="vt-pitch-section">
      <div className="vt-pitch-section-title">
        <span className="vt-pitch-section-num">{num}</span> {title}
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="vt-pitch-stat-item">
      <div className="vt-pitch-stat-label">{label}</div>
      <div className="vt-pitch-stat-value">{value}</div>
    </div>
  );
}
