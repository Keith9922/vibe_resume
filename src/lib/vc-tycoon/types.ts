export type Tier = "seed" | "a" | "b";
export type Outcome = "win" | "mid" | "loss";
export type CornerType = "start" | "lp_check" | "free_dd" | "black_swan";
export type PlayerKind = "human" | "ai";
export type GamePhase =
  | "idle"
  | "rolling"
  | "moving"
  | "deciding"
  | "result"
  | "ai_thinking"
  | "ended";

export interface Deal {
  id: string;
  name: string;          // 项目假名（玩家看到）
  tagline: string;       // 项目描述（玩家看到）
  tier: Tier;
  cost: number;          // $M
  year: number;
  outcome: Outcome;
  multiplier: number;    // 回报倍数
  real: string;          // 真实公司名（揭晓时显示）
  story: string;         // 真实故事
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
  dealName: string;       // 假名
  realName: string;       // 真名
  invested: number;
  returned: number;
  pl: number;
  outcome: Outcome;
  multiplier: number;
  ownerId: PlayerId;
  round: number;
}

export type PlayerId = "human" | "ai";

export interface Player {
  id: PlayerId;
  kind: PlayerKind;
  name: string;
  cash: number;
  position: number;
  portfolio: Investment[];
  bankrupt: boolean;
}

export interface LogEntry {
  id: number;
  round: number;
  actorId?: PlayerId;
  type: "info" | "win" | "loss" | "action" | "system";
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
  invested: boolean;        // 玩家是否真的投了
  playerId: PlayerId;
}

export interface GameState {
  phase: GamePhase;
  round: number;
  currentPlayerId: PlayerId;
  players: Record<PlayerId, Player>;
  board: Cell[];
  taken: Set<number>;       // 已被某玩家投资过的格子（不能再投）
  visited: Set<number>;     // 视觉用：经过过的格子（淡化）
  log: LogEntry[];
  diceFace: number;
  pending: PendingDecision | null;
  revealed: RevealedResult | null;
  winnerId: PlayerId | null;
}

export interface GameConfig {
  startingCash: number;
  winThreshold: number;
  passingStartBonus: number;
  lpPenalty: number;
  demoDayBonus: number;
  blackSwanBaseLoss: number;
  blackSwanPortfolioHaircut: number; // 0.3 = 30% 折损
}

export const DEFAULT_CONFIG: GameConfig = {
  startingCash: 100,
  winThreshold: 500,
  passingStartBonus: 10,
  lpPenalty: 15,
  demoDayBonus: 20,
  blackSwanBaseLoss: 10,
  blackSwanPortfolioHaircut: 0.3,
};
