import {
  DEFAULT_CONFIG,
  type Cell,
  type Deal,
  type GameConfig,
  type GameState,
  type Investment,
  type LogEntry,
  type LPCheckResult,
  type Player,
  type PlayerDecision,
  type PlayerId,
  type RevealedEvent,
  type RevealedResult,
} from "./types";
import { BOARD_SIZE, buildBoard } from "./board";
import { applyMarketEffect, generateMarketTrends } from "./market";
import { ACHIEVEMENTS, type AchievementId } from "./achievements";

export type Action =
  | { type: "ROLL_DICE"; face: number }
  | { type: "LANDED" }
  | { type: "INVEST" }
  | { type: "ALL_IN" }
  | { type: "PASS" }
  | { type: "CLOSE_RESULT" }
  | { type: "CLOSE_EVENT" }
  | { type: "CLOSE_LP_CHECK" }
  | { type: "DISMISS_TUTORIAL" }
  | { type: "RESET" };

let logIdCounter = 0;
const nextLogId = () => ++logIdCounter;

function log(state: GameState, entry: Omit<LogEntry, "id" | "round">): GameState {
  const e: LogEntry = { id: nextLogId(), round: state.round, ...entry };
  return { ...state, log: [e, ...state.log].slice(0, 60) };
}

function makePlayer(id: PlayerId, kind: "human" | "ai", name: string, cash: number): Player {
  return {
    id, kind, name, cash, position: 0,
    portfolio: [], decisions: [],
    achievements: new Set(),
    passedDeals: 0, avoidedDisasters: 0,
    lpWarnings: 0, lastLPCheckRound: 0,
    bankrupt: false,
  };
}

export function initialState(config: GameConfig = DEFAULT_CONFIG, seed?: number): GameState {
  const rng = seed != null ? mulberry32(seed) : Math.random;
  const board = buildBoard(rng);
  const players: Record<PlayerId, Player> = {
    human: makePlayer("human", "human", "你", config.startingCash),
    ai: makePlayer("ai", "ai", "AI 对手", config.startingCash),
  };
  const marketTrends = generateMarketTrends(rng);

  let s: GameState = {
    phase: "tutorial",
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
    revealedEvent: null,
    lpCheck: null,
    marketTrends,
    winnerId: null,
    showTutorial: true,
  };
  s = log(s, { type: "system", text: `基金启动 · 双方初始资金 $${config.startingCash}M` });
  return s;
}

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
    players: { ...state.players, [id]: { ...state.players[id], ...patch } },
  };
}

function unlockAchievement(state: GameState, playerId: PlayerId, id: AchievementId): GameState {
  const p = state.players[playerId];
  if (p.achievements.has(id)) return state;
  const next = new Set(p.achievements);
  next.add(id);
  let s = setPlayer(state, playerId, { achievements: next });
  if (playerId === "human") {
    const a = ACHIEVEMENTS.find(x => x.id === id);
    if (a) s = log(s, { type: "special", text: `🏆 解锁成就：${a.name}` });
  }
  return s;
}

function currentPlayer(state: GameState): Player {
  return state.players[state.currentPlayerId];
}

function otherId(id: PlayerId): PlayerId {
  return id === "human" ? "ai" : "human";
}

function endTurn(state: GameState, config: GameConfig): GameState {
  const checked = checkGameEnd(state, config);
  if (checked.phase === "ended") return checked;

  // 是否触发 LP 季度考核（每轮结束后判断当前 player 是否到了考核期）
  const justFinishedPlayer = state.currentPlayerId;
  const p = checked.players[justFinishedPlayer];
  const sinceLast = state.round - p.lastLPCheckRound;
  if (sinceLast >= config.lpCheckEvery) {
    return runLPCheck(checked, justFinishedPlayer, config);
  }

  const next = otherId(state.currentPlayerId);
  let s: GameState = {
    ...checked,
    currentPlayerId: next,
    pending: null,
    revealed: null,
    revealedEvent: null,
  };
  if (next === "human") {
    s = { ...s, round: s.round + 1 };
  }
  s = { ...s, phase: next === "human" ? "idle" : "ai_thinking" };
  return s;
}

function checkGameEnd(state: GameState, config: GameConfig): GameState {
  const { human, ai } = state.players;
  let winnerId: PlayerId | null = null;

  if (human.cash >= config.winThreshold && !human.bankrupt) winnerId = "human";
  else if (ai.cash >= config.winThreshold && !ai.bankrupt) winnerId = "ai";
  else if (human.cash <= 0 || human.bankrupt) winnerId = "ai";
  else if (ai.cash <= 0 || ai.bankrupt) winnerId = "human";

  if (winnerId) {
    if (winnerId === "human" && state.players.human.cash >= config.winThreshold) {
      const s = unlockAchievement(state, "human", "rich");
      return log({ ...s, phase: "ended", winnerId }, {
        type: "system",
        text: "🏆 你赢了！基金清算成功",
      });
    }
    return log({ ...state, phase: "ended", winnerId }, {
      type: "system",
      text: winnerId === "human" ? "🏆 你赢了！" : "💀 AI 赢了，你的基金没能熬过寒冬",
    });
  }
  return state;
}

/** LP 季度 MOIC 考核 */
function runLPCheck(state: GameState, playerId: PlayerId, config: GameConfig): GameState {
  const p = state.players[playerId];
  const totalIn = p.portfolio.reduce((s, x) => s + x.invested, 0);
  const totalOut = p.portfolio.reduce((s, x) => s + x.returned, 0);
  const moic = totalIn === 0 ? 1 : totalOut / totalIn;
  const passed = p.portfolio.length === 0 || moic >= config.lpTargetMOIC;

  let cashDelta = 0;
  let warning = p.lpWarnings;
  let terminated = false;

  if (passed) {
    cashDelta = config.lpPassReward;
    warning = 0;
  } else {
    warning = p.lpWarnings + 1;
    if (warning >= config.lpMaxWarnings) {
      terminated = true;
      cashDelta = -config.lpFailPenalty;
    } else {
      cashDelta = -config.lpFailPenalty;
    }
  }

  const newCash = Math.max(0, p.cash + cashDelta);
  let s = setPlayer(state, playerId, {
    cash: newCash,
    lpWarnings: warning,
    lastLPCheckRound: state.round,
    bankrupt: terminated,
  });
  if (passed) s = unlockAchievement(s, playerId, "lp_pass");

  s = log(s, {
    type: passed ? "win" : "loss",
    actorId: playerId,
    text: passed
      ? `${p.name} 通过 LP 考核（MOIC ${moic.toFixed(2)}x）+$${cashDelta}M`
      : terminated
        ? `${p.name} 第二次 LP 警告，基金强制清盘 -$${Math.abs(cashDelta)}M`
        : `${p.name} LP 警告 ${warning}/${config.lpMaxWarnings}（MOIC ${moic.toFixed(2)}x）-$${Math.abs(cashDelta)}M`,
  });

  const result: LPCheckResult = {
    playerId, passed, terminated, moic,
    warning, cashDelta,
  };

  return { ...s, phase: "lp_check", lpCheck: result };
}

function recordDecision(state: GameState, playerId: PlayerId, decision: PlayerDecision): GameState {
  const player = state.players[playerId];
  return setPlayer(state, playerId, { decisions: [decision, ...player.decisions] });
}

function resolveLanding(state: GameState, config: GameConfig): GameState {
  const player = currentPlayer(state);
  const cell: Cell = state.board[player.position];

  if (cell.kind === "corner") {
    return resolveCorner(state, cell, config);
  }

  const idx = player.position;
  const wouldBePL = Math.round(cell.cost * cell.multiplier) - cell.cost;

  if (state.taken.has(idx)) {
    let s = recordDecision(state, player.id, {
      dealId: cell.id, dealName: cell.name, realName: cell.real,
      outcome: cell.outcome, multiplier: cell.multiplier, cost: cell.cost,
      kind: "skip_taken", pl: 0, wouldBePL, round: state.round,
    });
    s = log(s, { type: "info", actorId: player.id, text: `${player.name} 路过 ${cell.name}（已被投资）` });
    return endTurn(s, config);
  }

  if (player.cash < cell.cost) {
    let s = recordDecision(state, player.id, {
      dealId: cell.id, dealName: cell.name, realName: cell.real,
      outcome: cell.outcome, multiplier: cell.multiplier, cost: cell.cost,
      kind: "skip_poor", pl: 0, wouldBePL, round: state.round,
    });
    s = log(s, { type: "info", actorId: player.id, text: `${player.name} 路过 ${cell.name}（资金不足）` });
    return endTurn(s, config);
  }

  return {
    ...state,
    phase: "deciding",
    pending: { cell, cellIndex: idx, playerId: player.id },
  };
}

/** 黑天鹅事件池（v3 风格） */
const BLACK_SWANS = [
  { name: "美联储加息 75 bp", loss: 15, msg: "市场流动性收紧，基金管理费 -$15M" },
  { name: "AI 寒冬来袭", loss: 10, msg: "估值下调，跨基金减记 -$10M" },
  { name: "监管风暴", loss: 20, msg: "监管动作影响整个赛道 -$20M" },
  { name: "GP 流感大流行", loss: 5, msg: "你病了一周，错过几个好项目 -$5M" },
  { name: "某大基金爆雷", loss: 12, msg: "同行翻车，LP 紧张要求保守 -$12M" },
  { name: "雷曼时刻重演", loss: 25, msg: "金融危机重演，组合大幅缩水 -$25M" },
  { name: "中概股寒冬", loss: 18, msg: "中概股监管加严 -$18M" },
] as const;

function resolveCorner(
  state: GameState,
  corner: Extract<Cell, { kind: "corner" }>,
  config: GameConfig,
): GameState {
  const player = currentPlayer(state);
  let s = state;

  switch (corner.type) {
    case "start": {
      // 经过/停留 START 都加注资（passing 已经在 ROLL_DICE 中处理；这里是停留）
      s = setPlayer(s, player.id, { cash: player.cash + config.passingStartBonus });
      s = log(s, { type: "win", actorId: player.id, text: `${player.name} 停在 START，LP 持续注资 +$${config.passingStartBonus}M` });
      break;
    }

    case "lp_check": {
      // 直接走 LP 考核流程
      return runLPCheck(s, player.id, config);
    }

    case "free_dd": {
      s = setPlayer(s, player.id, { cash: player.cash + config.demoDayBonus });
      s = log(s, { type: "win", actorId: player.id, text: `${player.name} 路演成功，LP 加注 +$${config.demoDayBonus}M` });
      // 包装成事件揭晓
      const ev: RevealedEvent = {
        cardId: "demo_day",
        title: "Demo Day 路演成功",
        flavor: "你压注的项目在 Demo Day 大放异彩，LP 主动加注。",
        emoji: "🎤",
        tone: "good",
        cornerName: "DEMO DAY",
        cashDelta: config.demoDayBonus,
        playerId: player.id,
      };
      return { ...s, phase: "event", revealedEvent: ev };
    }

    case "black_swan": {
      const e = BLACK_SWANS[Math.floor(Math.random() * BLACK_SWANS.length)];
      const newCash = Math.max(0, player.cash - e.loss);
      s = setPlayer(s, player.id, { cash: newCash });
      s = log(s, { type: "loss", actorId: player.id, text: `🦢 ${e.name}：${e.msg}` });
      const ev: RevealedEvent = {
        cardId: "black_swan",
        title: e.name,
        flavor: e.msg,
        emoji: "🦢",
        tone: "bad",
        cornerName: "BLACK SWAN",
        cashDelta: -e.loss,
        playerId: player.id,
      };
      return { ...s, phase: "event", revealedEvent: ev };
    }
  }

  return endTurn(s, config);
}

/** 投资结算 */
function executeInvest(
  state: GameState,
  allIn: boolean,
): GameState {
  if (!state.pending) return state;
  const { cell, cellIndex, playerId } = state.pending;
  const player = state.players[playerId];
  const investAmount = allIn ? cell.cost * 2 : cell.cost;
  if (player.cash < investAmount) return state;

  // 应用市场冷热
  const { mult, outcome } = applyMarketEffect(cell, state.marketTrends);
  const returned = Math.round(investAmount * mult);
  const pl = returned - investAmount;

  const investment: Investment = {
    dealId: cell.id, dealName: cell.name, realName: cell.real,
    invested: investAmount, returned, pl,
    outcome, multiplier: mult, ownerId: playerId,
    round: state.round, allIn,
  };

  let s = setPlayer(state, playerId, {
    cash: player.cash - investAmount + returned,
    portfolio: [investment, ...player.portfolio],
  });
  s = recordDecision(s, playerId, {
    dealId: cell.id, dealName: cell.name, realName: cell.real,
    outcome, multiplier: mult, cost: cell.cost,
    kind: allIn ? "all_in" : "invest", pl, wouldBePL: pl, round: state.round,
    allIn,
  });
  const taken = new Set(s.taken);
  taken.add(cellIndex);
  s = { ...s, taken };

  // 成就
  s = unlockAchievement(s, playerId, "first_invest");
  if (outcome === "win" && mult >= 5) s = unlockAchievement(s, playerId, "first_win");
  if (mult >= 10) s = unlockAchievement(s, playerId, "unicorn");
  if (allIn && outcome === "win") s = unlockAchievement(s, playerId, "all_in_win");

  s = log(s, {
    type: outcome === "win" ? "win" : outcome === "loss" ? "loss" : "info",
    actorId: playerId,
    text: `${player.name} ${allIn ? "ALL IN" : "投资"} ${cell.name} → ${cell.real}（${formatPL(pl)}）`,
  });

  const revealed: RevealedResult = {
    cell: cell as Deal, pl, invested: true, allIn,
    effectiveMult: mult, effectiveOutcome: outcome, playerId,
  };

  return { ...s, phase: "result", revealed, pending: null };
}

export function reducer(state: GameState, action: Action, config: GameConfig = DEFAULT_CONFIG): GameState {
  switch (action.type) {
    case "DISMISS_TUTORIAL": {
      if (!state.showTutorial) return state;
      const s = log({ ...state, showTutorial: false, phase: "idle" }, {
        type: "info", text: "先手为你，掷骰子开始游戏",
      });
      return s;
    }

    case "ROLL_DICE": {
      if (state.phase !== "idle" && state.phase !== "ai_thinking") return state;
      const player = currentPlayer(state);
      const startPos = player.position;
      const newPos = (startPos + action.face) % BOARD_SIZE;
      const passedStart = action.face > 0 && newPos < startPos;

      let s: GameState = { ...state, phase: "moving", diceFace: action.face };
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
      s = log(s, { type: "action", actorId: player.id, text: `${player.name} 掷出 ${action.face} 点` });
      return s;
    }

    case "LANDED": {
      if (state.phase !== "moving") return state;
      return resolveLanding(state, config);
    }

    case "INVEST":
      if (state.phase !== "deciding") return state;
      return executeInvest(state, false);

    case "ALL_IN":
      if (state.phase !== "deciding") return state;
      return executeInvest(state, true);

    case "PASS": {
      if (state.phase !== "deciding" || !state.pending) return state;
      const { cell, playerId } = state.pending;
      const player = state.players[playerId];

      // PASS 机会成本
      const passCost = config.passCost;
      let s = setPlayer(state, playerId, {
        cash: Math.max(0, player.cash - passCost),
        passedDeals: player.passedDeals + 1,
      });

      const { mult, outcome } = applyMarketEffect(cell, state.marketTrends);
      const wouldBePL = Math.round(cell.cost * mult) - cell.cost;

      s = recordDecision(s, playerId, {
        dealId: cell.id, dealName: cell.name, realName: cell.real,
        outcome, multiplier: mult, cost: cell.cost,
        kind: "pass", pl: 0, wouldBePL, round: state.round,
      });

      // 避雷成就
      if (outcome === "loss") {
        const newAvoided = s.players[playerId].avoidedDisasters + 1;
        s = setPlayer(s, playerId, { avoidedDisasters: newAvoided });
        if (newAvoided === 1) s = unlockAchievement(s, playerId, "avoid_disaster");
        if (newAvoided >= 3) s = unlockAchievement(s, playerId, "avoid_three");
      }

      s = log(s, {
        type: "action", actorId: playerId,
        text: `${player.name} Pass：${cell.name}（机会成本 -$${passCost}M）`,
      });

      const revealed: RevealedResult = {
        cell: cell as Deal, pl: wouldBePL, invested: false, allIn: false,
        effectiveMult: mult, effectiveOutcome: outcome, playerId,
      };

      return { ...s, phase: "result", revealed, pending: null };
    }

    case "CLOSE_RESULT":
      if (state.phase !== "result") return state;
      return endTurn({ ...state, revealed: null }, config);

    case "CLOSE_EVENT":
      if (state.phase !== "event") return state;
      return endTurn({ ...state, revealedEvent: null }, config);

    case "CLOSE_LP_CHECK": {
      if (state.phase !== "lp_check") return state;
      const result = state.lpCheck;
      let s: GameState = { ...state, lpCheck: null };
      if (result?.terminated) {
        // 直接进入结束阶段
        s = checkGameEnd(s, config);
        if (s.phase !== "ended") {
          // bankrupt 标记应触发 endgame
          s = checkGameEnd(s, config);
        }
        return s;
      }
      // 否则继续下一回合
      const next = otherId(state.currentPlayerId);
      s = { ...s, currentPlayerId: next };
      if (next === "human") s = { ...s, round: s.round + 1 };
      s = { ...s, phase: next === "human" ? "idle" : "ai_thinking" };
      return s;
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
