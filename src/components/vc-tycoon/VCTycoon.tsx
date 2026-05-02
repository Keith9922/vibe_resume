"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { initialState, reducer, type Action } from "@/lib/vc-tycoon/game";
import { aiDecide, AI_THINK_DELAY } from "@/lib/vc-tycoon/ai";
import { DEFAULT_CONFIG } from "@/lib/vc-tycoon/types";
import Header from "./Header";
import Board from "./Board";
import Sidebar from "./Sidebar";
import { GameOverModal, ResultModal } from "./Modals";

const config = DEFAULT_CONFIG;

export default function VCTycoon() {
  const [state, dispatch] = useReducer(
    (s: ReturnType<typeof initialState>, a: Action) => reducer(s, a, config),
    undefined,
    () => initialState(config),
  );
  const [diceAnimating, setDiceAnimating] = useState(false);
  const timersRef = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(t => window.clearTimeout(t));
    timersRef.current = [];
  }, []);

  const after = useCallback((ms: number, fn: () => void) => {
    const t = window.setTimeout(fn, ms);
    timersRef.current.push(t);
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  // ============== 玩家操作 ==============
  const handleRoll = useCallback(() => {
    if (state.phase !== "idle" || state.currentPlayerId !== "human") return;
    rollAndMove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.currentPlayerId]);

  const handleInvest = useCallback(() => {
    dispatch({ type: "INVEST" });
  }, []);

  const handlePass = useCallback(() => {
    dispatch({ type: "PASS" });
  }, []);

  const handleCloseResult = useCallback(() => {
    dispatch({ type: "CLOSE_RESULT" });
  }, []);

  const handleReset = useCallback(() => {
    clearTimers();
    dispatch({ type: "RESET" });
  }, [clearTimers]);

  // ============== 移动动画 + 落点结算 ==============
  /**
   * 掷骰子 + 移动动画 + 落点。
   * 这里没有把每一步独立 dispatch（reducer 已经在 ROLL_DICE 直接更新到终点），
   * 我们用一段延时模拟"骰子滚动 + 移动"的视觉。
   */
  const rollAndMove = useCallback(() => {
    setDiceAnimating(true);
    // 视觉：先翻滚骰子
    const face = Math.floor(Math.random() * 6) + 1;
    after(500, () => {
      setDiceAnimating(false);
      dispatch({ type: "ROLL_DICE", face });
      // 模拟移动时长（每步 ~180ms）
      after(face * 180 + 150, () => {
        dispatch({ type: "LANDED" });
      });
    });
  }, [after]);

  // ============== AI 自动行动 ==============
  // AI 回合：自动 Roll → Land → 决策 → 关闭结果
  useEffect(() => {
    if (state.winnerId) return;

    if (state.phase === "ai_thinking" && state.currentPlayerId === "ai") {
      after(AI_THINK_DELAY.beforeRoll, () => {
        rollAndMove();
      });
    }

    if (state.phase === "deciding" && state.pending && state.pending.playerId === "ai") {
      after(AI_THINK_DELAY.beforeDecide, () => {
        const decision = aiDecide(state, state.pending!.cell);
        dispatch({ type: decision ? "INVEST" : "PASS" });
      });
    }

    if (state.phase === "result" && state.revealed && state.revealed.playerId === "ai") {
      after(AI_THINK_DELAY.afterReveal, () => {
        dispatch({ type: "CLOSE_RESULT" });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.currentPlayerId, state.pending?.playerId, state.revealed?.playerId]);

  const showResultModal =
    state.phase === "result" &&
    state.revealed &&
    state.revealed.playerId === "human";

  const showGameOver = state.phase === "ended" && state.winnerId !== null;

  const rollDisabled =
    state.phase !== "idle" ||
    state.currentPlayerId !== "human" ||
    diceAnimating;

  return (
    <div className="vt-app">
      <Header state={state} />
      <Board
        state={state}
        onRoll={handleRoll}
        rollDisabled={rollDisabled}
        rolling={diceAnimating}
      />
      <Sidebar
        state={state}
        onInvest={handleInvest}
        onPass={handlePass}
      />
      {showResultModal && state.revealed && (
        <ResultModal result={state.revealed} onClose={handleCloseResult} />
      )}
      {showGameOver && (
        <GameOverModal state={state} onReset={handleReset} />
      )}
    </div>
  );
}
