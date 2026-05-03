import type { AchievementId } from "./achievements";
import type { MarketTrends } from "./market";
import type { Sector } from "./sectors";

export type Tier = "seed" | "a" | "b";
export type Outcome = "win" | "mid" | "loss";
export type CornerType = "start" | "lp_check" | "free_dd" | "black_swan";
export type PlayerKind = "human" | "ai";
export type GamePhase =
  | "tutorial"
  | "idle"
  | "rolling"
  | "moving"
  | "deciding"
  | "result"
  | "event"
  | "lp_check"
  | "ai_thinking"
  | "ended";

export type DecisionKind = "invest" | "all_in" | "pass" | "skip_taken" | "skip_poor";

export type SignalTone = "+" | "-" | "~";
export type Signal = readonly [SignalTone, string];

export interface PlayerDecision {
  dealId: string;
  dealName: string;        // 假名
  realName: string;        // 真名
  outcome: Outcome;
  multiplier: number;
  cost: number;
  kind: DecisionKind;
  pl: number;
  wouldBePL: number;
  round: number;
  allIn?: boolean;
}

export interface Deal {
  id: string;
  name: string;
  tagline: string;
  tier: Tier;
  cost: number;
  year: number;
  outcome: Outcome;
  multiplier: number;
  real: string;
  story: string;

  sector: Sector;

  // 富 Pitch 内容
  founder: string;
  founderStory: string;
  vision: string;
  business: string;
  progress: string;
  funding: string;
  signals: readonly Signal[];

  // 揭晓时的假新闻头条
  headline: string;
  source: string;
}

export interface Corner {
  id: string;
  name: string;
  tagline: string;
  type: CornerType;
}

export type Cell =
  | ({ kind: "deal" } & Deal)
  | ({ kind: "corner" } & Corner);

export interface Investment {
  dealId: string;
  dealName: string;
  realName: string;
  invested: number;
  returned: number;
  pl: number;
  outcome: Outcome;
  multiplier: number;
  ownerId: PlayerId;
  round: number;
  allIn: boolean;
}

export type PlayerId = "human" | "ai";

export interface Player {
  id: PlayerId;
  kind: PlayerKind;
  name: string;
  cash: number;
  position: number;
  portfolio: Investment[];
  decisions: PlayerDecision[];
  achievements: Set<AchievementId>;
  passedDeals: number;
  avoidedDisasters: number;
  lpWarnings: number;
  lastLPCheckRound: number;
  bankrupt: boolean;
}

export interface LogEntry {
  id: number;
  round: number;
  actorId?: PlayerId;
  type: "info" | "win" | "loss" | "action" | "system" | "special";
  text: string;
}

export interface PendingDecision {
  cell: Deal;
  cellIndex: number;
  playerId: PlayerId;
}

export interface RevealedResult {
  cell: Deal;
  pl: number;
  invested: boolean;
  allIn: boolean;
  effectiveMult: number;
  effectiveOutcome: Outcome;
  playerId: PlayerId;
}

export interface RevealedEvent {
  cardId: string;
  title: string;
  flavor: string;
  emoji: string;
  tone: "good" | "bad" | "neutral";
  cornerName: string;
  cashDelta: number;
  portfolioMul?: number;
  playerId: PlayerId;
}

export interface LPCheckResult {
  playerId: PlayerId;
  passed: boolean;
  terminated: boolean;     // 第二次警告 → 直接破产
  moic: number;
  warning: number;         // 当前累计警告
  cashDelta: number;
}

export interface GameState {
  phase: GamePhase;
  round: number;
  currentPlayerId: PlayerId;
  players: Record<PlayerId, Player>;
  board: Cell[];
  taken: Set<number>;
  visited: Set<number>;
  log: LogEntry[];
  diceFace: number;
  pending: PendingDecision | null;
  revealed: RevealedResult | null;
  revealedEvent: RevealedEvent | null;
  lpCheck: LPCheckResult | null;
  marketTrends: MarketTrends;
  winnerId: PlayerId | null;
  showTutorial: boolean;
}

export interface GameConfig {
  startingCash: number;
  winThreshold: number;
  passingStartBonus: number;
  passCost: number;             // PASS 的机会成本（每次 -$2M）
  lpCheckEvery: number;         // 每 N 轮一次 LP 考核
  lpTargetMOIC: number;         // 1.2x 目标
  lpPassReward: number;         // 通过：+$30M
  lpFailPenalty: number;        // 失败：-$20M
  lpMaxWarnings: number;        // 累计警告达到则破产
  demoDayBonus: number;
  blackSwanBaseLoss: number;
  blackSwanPortfolioHaircut: number;
}

export const DEFAULT_CONFIG: GameConfig = {
  startingCash: 100,
  winThreshold: 500,
  passingStartBonus: 10,
  passCost: 2,
  lpCheckEvery: 8,
  lpTargetMOIC: 1.2,
  lpPassReward: 30,
  lpFailPenalty: 20,
  lpMaxWarnings: 2,
  demoDayBonus: 25,
  blackSwanBaseLoss: 10,
  blackSwanPortfolioHaircut: 0.3,
};
