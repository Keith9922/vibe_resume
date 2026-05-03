import type { Deal, GameState } from "./types";

export type AIDecision = "invest" | "all_in" | "pass";

/**
 * AI 决策（基于公开信息：tier / cost / sector trend / signals）
 * 与玩家信息对称，不偷看 outcome。
 */
export function aiDecide(state: GameState, deal: Deal): AIDecision {
  const ai = state.players.ai;
  const human = state.players.human;
  const cashAfterInvest = ai.cash - deal.cost;
  const cashAfterAllIn = ai.cash - deal.cost * 2;

  if (cashAfterInvest < 10) return "pass";

  const lead = human.cash - ai.cash;

  let baseProb: number;
  switch (deal.tier) {
    case "seed": baseProb = 0.7; break;
    case "a": baseProb = 0.55; break;
    case "b": baseProb = 0.4; break;
  }

  // 信号情绪：正/负 信号微调概率
  const positives = deal.signals.filter(s => s[0] === "+").length;
  const negatives = deal.signals.filter(s => s[0] === "-").length;
  baseProb += positives * 0.08;
  baseProb -= negatives * 0.12;

  // 赛道冷热
  const trend = state.marketTrends[deal.sector];
  if (trend === "hot") baseProb += 0.15;
  else if (trend === "cold") baseProb -= 0.15;

  // 落后追赶
  if (lead > 0) baseProb += Math.min(0.2, (lead / 50) * 0.08);
  else if (lead < -50) baseProb -= 0.1;

  if (ai.cash < 60) baseProb -= 0.15;
  if (ai.cash < 30) baseProb -= 0.25;
  if (ai.portfolio.length >= 5) baseProb -= 0.1;

  const noise = (Math.random() - 0.5) * 0.18;
  const finalProb = Math.max(0.05, Math.min(0.95, baseProb + noise));

  const investRoll = Math.random();
  if (investRoll >= finalProb) return "pass";

  // 决定是否 ALL IN：高确信度 + hot 赛道 + 现金充裕
  if (
    cashAfterAllIn >= 30 &&
    trend === "hot" &&
    positives >= 1 &&
    negatives === 0 &&
    Math.random() < 0.35
  ) {
    return "all_in";
  }

  return "invest";
}

export const AI_THINK_DELAY = {
  beforeRoll: 700,
  afterMove: 400,
  beforeDecide: 1100,
  afterReveal: 1300,
  afterLPCheck: 1500,
} as const;
