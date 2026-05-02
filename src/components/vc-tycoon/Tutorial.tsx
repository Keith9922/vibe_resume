import { HumanAvatar, AIAvatar } from "./Avatars";

interface Props {
  onStart: () => void;
}

export default function Tutorial({ onStart }: Props) {
  return (
    <div className="vt-modal-overlay">
      <div className="vt-tutorial">
        <div className="vt-tutorial-title">VC TYCOON</div>
        <div className="vt-tutorial-sub">投 资 人 入 门 手 册</div>

        <div className="vt-tutorial-vs">
          <div className="vt-tutorial-side">
            <HumanAvatar size={56} />
            <div className="vt-tutorial-side-name">你</div>
            <div className="vt-tutorial-side-tag">GP · 绿色</div>
          </div>
          <div className="vt-tutorial-vs-text">VS</div>
          <div className="vt-tutorial-side">
            <AIAvatar size={56} />
            <div className="vt-tutorial-side-name">AI 对手</div>
            <div className="vt-tutorial-side-tag">GP · 红色</div>
          </div>
        </div>

        <div className="vt-tutorial-section">
          <h3>▸ 你是谁</h3>
          <p>
            你是一只新基金的 GP，LP 给了你 <span className="hl">$100M</span> 起步资金。和一个 AI 对手同台竞技——
            谁先把基金做到 $500M 谁就是<strong>年度最佳基金</strong>。
          </p>
        </div>

        <div className="vt-tutorial-section">
          <h3>▸ 怎么赢 / 怎么输</h3>
          <p><span className="ok">✓ 胜利</span>：基金累计达到 <span className="hl">$500M</span>，或对手破产。</p>
          <p><span className="bad">✗ 失败</span>：基金归零（破产清算）。</p>
          <p><span className="bad">✗ 失败</span>：连续两次 LP 季度考核未达标，被强制清盘。</p>
        </div>

        <div className="vt-tutorial-section">
          <h3>▸ 核心玩法</h3>
          <p>掷骰子移动到项目格，触发<span className="hl">完整路演现场</span>，包含：</p>
          <p>· 创始人背景 + 创业初衷自述</p>
          <p>· 市场理念、商业模式、当前进展、融资条件</p>
          <p>· <span className="hl">2 条市场情报信号</span>（团队/财务/产品/市场情绪）—— 你的判断依据</p>
          <p>· 三个选项：<span className="ok">投资</span> / <span className="purple">ALL IN</span>（双倍下注）/ <span className="bad">PASS</span></p>
        </div>

        <div className="vt-tutorial-section">
          <h3>▸ 关键机制</h3>
          <p>· <span className="hl">PASS 不是免费的</span>：每次 PASS 扣 $2M（基金管理费 + 机会成本）</p>
          <p>· <span className="hl">市场冷热</span>：每局开始随机决定哪些赛道是「风口」或「寒冬」，影响项目实际回报</p>
          <p>· <span className="hl">LP 季度考核</span>：每 8 轮考核一次，回报率 &lt; 1.2x 触发警告，连续两次警告基金清盘</p>
          <p>· 经过 START 格 LP 注资 +$10M；DEMO DAY +$25M；BLACK SWAN 随机历史危机</p>
        </div>

        <div className="vt-tutorial-section">
          <h3>▸ 一个忠告</h3>
          <p className="warn">
            真实 VC 投十个项目能中一个就算很好。这游戏里你会遇到 Theranos、ofo、FTX 那样的大坑——它们的早期 pitch
            和真正的独角兽长得几乎一样。看清楚信号，做好踩雷准备。
          </p>
        </div>

        <div className="vt-tutorial-actions">
          <button className="vt-btn vt-btn-amber" onClick={onStart}>START INVESTING</button>
        </div>
      </div>
    </div>
  );
}
