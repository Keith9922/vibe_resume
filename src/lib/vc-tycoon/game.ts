import {
  DEFAULT_CONFIG,
  type Cell,
  type GameConfig,
  type GameState,
  type Investment,
  type LogEntry,
  type Player,
  type PlayerId,
} from "./types";
import { BOARD_SIZE, buildBoard } from "./board";

export type Action =
  | { type: "ROLL_DICE"; face: number }
  | { type: "STEP" }                        // 单步移动动画一帧
  | { type: "LANDED" }                      // 移动结束，结算落点
  | { type: "INVEST" }                      // 玩家选择投
  | { type: "PASS" }                         // 玩家选择不投
  | { type: "CLOSE_RESULT" }                // 关闭结果弹窗
  | { type: "AI_DECIDE"; invest: boolean }  // AI 给出决策
  | { type: "RESET" };

let logIdCounter = 0;
const nextLogId = () => ++logIdCounter;

function log(state: GameState, entry: Omit<LogEntry, "id" | "round">): GameState {
  const e: LogEntry = { id: nextLogId(), round: state.round, ...entry };
  return { ...state, log: [e, ...state.log].slice(0, 60) };
}

function makePlayer(id: PlayerId, kind: "human" | "ai", name: string, cash: number): Player {
  return { id, kind, name, cash, position: 0, portfolio: [], bankrupt: false };
}

export function initialState(config: GameConfig = DEFAULT_CONFIG, seed?: number): GameState {
  const rng = seed != null ? mulberry32(seed) : Math.random;
  const board = buildBoard(rng);
  const players: Record<PlayerId, Player> = {
    human: makePlayer("human", "human", "你", config.startingCash),
    ai: makePlayer("ai", "ai", "AI 对手", config.startingCash),
  };
  let s: GameState = {
    phase: "idle",
    round: 1,
    currentPlayerId: "human",
    players,
    board,
    taken: new Set(),
    visited: new Set(),
    log: [],
    diceFace: 1,
    pending: null,
    revealed: null,
    winnerId: null,
  };
  s = log(s, { type: "system", text: `基金启动 · 双方初始资金 $${config.startingCash}M` });
  s = log(s, { type: "info", text: `先手为你，掷骰子开始游戏` });
  return s;
}

/** 简单的可复现随机源 */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function setPlayer(state: GameState, id: PlayerId, patch: Partial<Player>): GameState {
  return {
    ...state,
    players: {
      ...state.players,
      [id]: { ...state.players[id], ...patch },
    },
  };
}

function currentPlayer(state: GameState): Player {
  return state.players[state.currentPlayerId];
}

function otherId(id: PlayerId): PlayerId {
  return id === "human" ? "ai" : "human";
}

function endTurn(state: GameState, config: GameConfig): GameState {
  // 检查胜负
  const checked = checkGameEnd(state, config);
  if (checked.phase === "ended") return checked;

  const next = otherId(state.currentPlayerId);
  let s: GameState = {
    ...checked,
    currentPlayerId: next,
    pending: null,
    revealed: null,
  };
  // 每完成一轮（双方各走一次）round + 1
  if (next === "human") {
    s = { ...s, round: s.round + 1 };
  }
  // 决定下一阶段
  s = { ...s, phase: next === "human" ? "idle" : "ai_thinking" };
  return s;
}

function checkGameEnd(state: GameState, config: GameConfig): GameState {
  const { human, ai } = state.players;
  let winnerId: PlayerId | null = null;

  // 优先：现金达到胜利门槛
  if (human.cash >= config.winThreshold && !human.bankrupt) winnerId = "human";
  else if (ai.cash >= config.winThreshold && !ai.bankrupt) winnerId = "ai";
  // 破产判定
  else if (human.cash <= 0) winnerId = "ai";
  else if (ai.cash <= 0) winnerId = "human";

  if (winnerId) {
    const text = winnerId === "human" ? "🏆 你赢了！基金清算成功" : "💀 AI 赢了，你的基金没能熬过寒冬";
    return log({ ...state, phase: "ended", winnerId }, { type: "system", text });
  }
  return state;
}

/** 落点结算 */
function resolveLanding(state: GameState, config: GameConfig): GameState {
  const player = currentPlayer(state);
  const cell: Cell = state.board[player.position];

  if (cell.kind === "corner") {
    return resolveCorner(state, cell, config);
  }

  // Deal cell
  const idx = player.position;
  if (state.taken.has(idx)) {
    const s = log(state, {
      type: "info",
      actorId: player.id,
      text: `${player.name} 路过 ${cell.name}（已被投资）`,
    });
    return endTurn(s, config);
  }

  if (player.cash < cell.cost) {
    const s = log(state, {
      type: "info",
      actorId: player.id,
      text: `${player.name} 路过 ${cell.name}（资金不足，跳过）`,
    });
    return endTurn(s, config);
  }

  // 进入决策阶段
  return {
    ...state,
    phase: "deciding",
    pending: { cell, cellIndex: idx, playerId: player.id },
  };
}

function resolveCorner(
  state: GameState,
  corner: Extract<Cell, { kind: "corner" }>,
  config: GameConfig,
): GameState {
  const player = currentPlayer(state);
  let s = state;

  switch (corner.type) {
    case "start":
      // 实际经过 START 的奖励在 step 中处理；停留在 START 不重复发
      s = log(s, {
        type: "info",
        actorId: player.id,
        text: `${player.name} 停在 START`,
      });
      break;

    case "lp_check": {
      const totalPL = player.portfolio.reduce((sum, p) => sum + p.pl, 0);
      if (player.portfolio.length >= 2 && totalPL < 0) {
        s = setPlayer(s, player.id, { cash: player.cash - config.lpPenalty });
        s = log(s, {
          type: "loss",
          actorId: player.id,
          text: `${player.name} LP 不满意业绩，撤资 -$${config.lpPenalty}M`,
        });
      } else {
        s = log(s, {
          type: "win",
          actorId: player.id,
          text: `${player.name} 通过 LP 述职`,
        });
      }
      break;
    }

    case "free_dd":
      s = setPlayer(s, player.id, { cash: player.cash + config.demoDayBonus });
      s = log(s, {
        type: "win",
        actorId: player.id,
        text: `${player.name} 路演成功，LP 加注 +$${config.demoDayBonus}M`,
      });
      break;

    case "black_swan": {
      const haircut = Math.round(player.cash * 0.05) + config.blackSwanBaseLoss;
      const newCash = Math.max(0, player.cash - haircut);
      s = setPlayer(s, player.id, { cash: newCash });
      s = log(s, {
        type: "loss",
        actorId: player.id,
        text: `${player.name} 黑天鹅来袭，损失 -$${haircut}M`,
      });
      break;
    }
  }

  return endTurn(s, config);
}

export function reducer(state: GameState, action: Action, config: GameConfig = DEFAULT_CONFIG): GameState {
  switch (action.type) {
    case "ROLL_DICE": {
      if (state.phase !== "idle" && state.phase !== "ai_thinking") return state;
      const player = currentPlayer(state);
      const startPos = player.position;
      const newPos = (startPos + action.face) % BOARD_SIZE;
      // 经过起点检查（不包括停在起点本身的额外奖励）
      const passedStart = action.face > 0 && newPos < startPos;

      let s: GameState = {
        ...state,
        phase: "moving",
        diceFace: action.face,
      };
      // 标记沿途为 visited
      const visited = new Set(s.visited);
      for (let i = 1; i <= action.face; i++) {
        visited.add((startPos + i) % BOARD_SIZE);
      }
      s = { ...s, visited };
      s = setPlayer(s, player.id, { position: newPos });

      if (passedStart) {
        s = setPlayer(s, player.id, {
          position: newPos,
          cash: s.players[player.id].cash + config.passingStartBonus,
        });
        s = log(s, {
          type: "win",
          actorId: player.id,
          text: `${player.name} 经过 START，LP 注资 +$${config.passingStartBonus}M`,
        });
      }
      s = log(s, {
        type: "action",
        actorId: player.id,
        text: `${player.name} 掷出 ${action.face} 点`,
      });
      return s;
    }

    case "LANDED": {
      if (state.phase !== "moving") return state;
      return resolveLanding(state, config);
    }

    case "INVEST": {
      if (state.phase !== "deciding" || !state.pending) return state;
      const { cell, cellIndex, playerId } = state.pending;
      const player = state.players[playerId];
      if (player.cash < cell.cost) return state;

      const returned = Math.round(cell.cost * cell.multiplier);
      const pl = returned - cell.cost;

      const investment: Investment = {
        dealId: cell.id,
        dealName: cell.name,
        realName: cell.real,
        invested: cell.cost,
        returned,
        pl,
        outcome: cell.outcome,
        multiplier: cell.multiplier,
        ownerId: playerId,
        round: state.round,
      };

      let s = setPlayer(state, playerId, {
        cash: player.cash - cell.cost + returned,
        portfolio: [investment, ...player.portfolio],
      });
      const taken = new Set(s.taken);
      taken.add(cellIndex);
      s = { ...s, taken };
      s = log(s, {
        type: cell.outcome === "win" ? "win" : cell.outcome === "loss" ? "loss" : "info",
        actorId: playerId,
        text: `${player.name} 投资 ${cell.name} → ${cell.real}（${formatPL(pl)}）`,
      });
      s = {
        ...s,
        phase: "result",
        revealed: { cell, pl, invested: true, playerId },
        pending: null,
      };
      return s;
    }

    case "PASS": {
      if (state.phase !== "deciding" || !state.pending) return state;
      const { cell, playerId } = state.pending;
      const player = state.players[playerId];
      const wouldBePL = Math.round(cell.cost * cell.multiplier) - cell.cost;

      let s = log(state, {
        type: "action",
        actorId: playerId,
        text: `${player.name} Pass：${cell.name}`,
      });
      s = {
        ...s,
        phase: "result",
        revealed: { cell, pl: wouldBePL, invested: false, playerId },
        pending: null,
      };
      return s;
    }

    case "CLOSE_RESULT": {
      if (state.phase !== "result") return state;
      return endTurn({ ...state, revealed: null }, config);
    }

    case "RESET":
      logIdCounter = 0;
      return initialState(config);

    default:
      return state;
  }
}

function formatPL(pl: number): string {
  const sign = pl >= 0 ? "+" : "";
  return `${sign}$${pl}M`;
}
