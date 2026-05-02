import { ALL_SECTORS, type MarketTrend, type Sector } from "./sectors";
import type { Deal, Outcome } from "./types";

export type MarketTrends = Record<Sector, MarketTrend>;

/** 每局开始随机：1-2 个 hot 赛道 + 1 个 cold 赛道 + 其他 neutral */
export function generateMarketTrends(rng: () => number = Math.random): MarketTrends {
  const sectors = [...ALL_SECTORS];
  for (let i = sectors.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [sectors[i], sectors[j]] = [sectors[j], sectors[i]];
  }
  const hot1 = sectors[0];
  const hot2 = rng() < 0.5 ? sectors[1] : null;
  const cold = sectors[sectors.length - 1];

  const trends = {} as MarketTrends;
  ALL_SECTORS.forEach(s => {
    if (s === hot1 || s === hot2) trends[s] = "hot";
    else if (s === cold) trends[s] = "cold";
    else trends[s] = "neutral";
  });
  return trends;
}

/**
 * 应用赛道冷热对项目结局/倍数的修正：
 *  - hot 赛道：win 倍数 ×1.3；mid 倍数 ×1.6 且有 50% 概率升级为 win；loss 至少能套现 0.4x
 *  - cold 赛道：win 倍数 ×0.6；mid 倍数 ×0.5；loss 倍数 ×0.5
 */
export function applyMarketEffect(
  deal: Deal,
  trends: MarketTrends,
  rng: () => number = Math.random,
): { mult: number; outcome: Outcome } {
  const trend = trends[deal.sector] ?? "neutral";
  let mult = deal.multiplier;
  let outcome: Outcome = deal.outcome;

  if (trend === "hot") {
    if (outcome === "win") {
      mult *= 1.3;
    } else if (outcome === "mid") {
      mult *= 1.6;
      if (mult >= 2.5 && rng() < 0.5) outcome = "win";
    } else {
      mult = Math.max(mult, 0.4);
    }
  } else if (trend === "cold") {
    if (outcome === "win") mult *= 0.6;
    else if (outcome === "mid") mult *= 0.5;
    else mult *= 0.5;
  }
  return { mult: Math.round(mult * 100) / 100, outcome };
}
