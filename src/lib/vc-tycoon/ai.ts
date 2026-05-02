import type { Deal, GameState } from "./types";

/**
 * AI 决策逻辑（保守的 VC）
 *
 * 输入信息：玩家只能看到 Deal 的"假名 + tagline + tier + cost"。
 * AI 也按这个信息做决策——不能作弊偷看 outcome。
 *
 * 策略：
 *   - 余额低于 30M 时只投种子轮
 *   - 余额低于 80M 时不投 B 轮
 *   - 已经领先则更保守（保持优势）
 *   - 已经落后则更激进（追赶）
 *   - tier 越高，决策门槛越高
 *   - 加入随机扰动避免决策可预测
 */
export function aiDecide(state: GameState, deal: Deal): boolean {
  const ai = state.players.ai;
  const human = state.players.human;
  const cashAfterInvest = ai.cash - deal.cost;

  // 硬约束：投资后必须保留至少 10M 安全垫
  if (cashAfterInvest < 10) return false;

  // 落后多少（人类领先则 lead > 0）
  const lead = human.cash - ai.cash;

  let baseProb: number;
  switch (deal.tier) {
    case "seed":
      baseProb = 0.7; // 种子轮便宜，多投
      break;
    case "a":
      baseProb = 0.55;
      break;
    case "b":
      baseProb = 0.4; // B 轮贵，挑剔
      break;
  }

  // 落后追赶：每落后 50M，激进度 +10%
  if (lead > 0) {
    baseProb += Math.min(0.25, (lead / 50) * 0.1);
  } else if (lead < -50) {
    // 大幅领先时保守
    baseProb -= 0.15;
  }

  // 现金紧张时降低投资意愿
  if (ai.cash < 60) baseProb -= 0.15;
  if (ai.cash < 30) baseProb -= 0.25;

  // 投资组合多样化偏好：已经投了 5+ 个项目时减缓投资速度
  if (ai.portfolio.length >= 5) baseProb -= 0.1;

  // 随机扰动 ±0.1
  const noise = (Math.random() - 0.5) * 0.2;
  const finalProb = Math.max(0.05, Math.min(0.95, baseProb + noise));

  return Math.random() < finalProb;
}

/** AI 思考延迟（毫秒）—— 让游戏节奏更舒服 */
export const AI_THINK_DELAY = {
  beforeRoll: 600,
  afterMove: 400,
  beforeDecide: 800,
  afterReveal: 1200,
} as const;
