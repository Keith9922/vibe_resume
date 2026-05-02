import type { GameState, Player, PlayerDecision } from "./types";

export interface PlayerRecap {
  playerId: Player["id"];
  name: string;
  finalCash: number;
  totalInvestments: number;
  unicorns: number;        // 投中的 win
  losses: number;          // 投中的 loss
  hitRate: number;         // unicorns / totalInvestments
  totalPL: number;         // 实际累计盈亏
  bestHit?: PlayerDecision;
  worstHit?: PlayerDecision;
  missedUnicorns: PlayerDecision[];   // pass 掉的 win 项目
  goodPasses: PlayerDecision[];        // pass 掉的 loss 项目（机智！）
  tier: VCTier;
}

export interface VCTier {
  rank: string;
  title: string;
  description: string;
  color: "green" | "amber" | "red" | "cyan";
}

export function buildRecap(state: GameState): { human: PlayerRecap; ai: PlayerRecap } {
  return {
    human: buildPlayerRecap(state.players.human),
    ai: buildPlayerRecap(state.players.ai),
  };
}

function buildPlayerRecap(player: Player): PlayerRecap {
  const invested = player.decisions.filter(d => d.kind === "invest");
  const passed = player.decisions.filter(d => d.kind === "pass");

  const unicorns = invested.filter(d => d.outcome === "win").length;
  const losses = invested.filter(d => d.outcome === "loss").length;
  const totalPL = invested.reduce((s, d) => s + d.pl, 0);
  const hitRate = invested.length > 0 ? unicorns / invested.length : 0;

  const bestHit = invested
    .slice()
    .sort((a, b) => b.pl - a.pl)[0];
  const worstHit = invested
    .slice()
    .sort((a, b) => a.pl - b.pl)[0];

  const missedUnicorns = passed.filter(d => d.outcome === "win").sort((a, b) => b.wouldBePL - a.wouldBePL);
  const goodPasses = passed.filter(d => d.outcome === "loss").sort((a, b) => a.wouldBePL - b.wouldBePL);

  const tier = computeTier({
    cash: player.cash,
    totalInvestments: invested.length,
    unicorns,
    hitRate,
    totalPL,
  });

  return {
    playerId: player.id,
    name: player.name,
    finalCash: player.cash,
    totalInvestments: invested.length,
    unicorns,
    losses,
    hitRate,
    totalPL,
    bestHit,
    worstHit,
    missedUnicorns,
    goodPasses,
    tier,
  };
}

function computeTier(stats: {
  cash: number;
  totalInvestments: number;
  unicorns: number;
  hitRate: number;
  totalPL: number;
}): VCTier {
  const { cash, unicorns, hitRate, totalPL } = stats;

  // 大成 / 神级
  if (cash >= 500 && unicorns >= 4) {
    return {
      rank: "S+",
      title: "Bill Gurley 转世",
      description: "传奇命中率 + 重仓敢下手。Sequoia 想挖你。",
      color: "green",
    };
  }
  if (cash >= 500) {
    return {
      rank: "S",
      title: "未来巨头",
      description: "完成基金清算目标，IPO 路演已排队。",
      color: "green",
    };
  }
  if (cash >= 350 && hitRate >= 0.5) {
    return {
      rank: "A",
      title: "稳健派 GP",
      description: "命中率高、节奏稳。LP 极其满意。",
      color: "green",
    };
  }
  if (cash >= 250) {
    return {
      rank: "B+",
      title: "硅谷新秀",
      description: "有几笔好交易，但风格还不够鲜明。",
      color: "amber",
    };
  }
  if (cash >= 150) {
    return {
      rank: "B",
      title: "中规中矩",
      description: "活下来了，但故事没爆。LP 表情管理失败。",
      color: "amber",
    };
  }
  if (cash > 0 && totalPL >= 0) {
    return {
      rank: "C",
      title: "苟且偷生",
      description: "没赔钱，但也没赚到。这行不靠苟。",
      color: "amber",
    };
  }
  if (cash <= 0) {
    return {
      rank: "F",
      title: "也许你更适合当 Builder",
      description: "基金归零。LP 在群里艾特你。",
      color: "red",
    };
  }
  return {
    rank: "D",
    title: "勉强存活",
    description: "活着就好。下一期基金不一定能融到。",
    color: "red",
  };
}
