"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { initialState, reducer, type Action } from "@/lib/vc-tycoon/game";
import { aiDecide, AI_THINK_DELAY } from "@/lib/vc-tycoon/ai";
import { DEFAULT_CONFIG } from "@/lib/vc-tycoon/types";
import Header from "./Header";
import Board from "./Board";
import Sidebar from "./Sidebar";
import Tutorial from "./Tutorial";
import PitchModal from "./PitchModal";
import { EventModal, LPCheckModal, RecapModal, ResultModal } from "./Modals";

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

  const rollAndMove = useCallback(() => {
    setDiceAnimating(true);
    const face = Math.floor(Math.random() * 6) + 1;
    after(500, () => {
      setDiceAnimating(false);
      dispatch({ type: "ROLL_DICE", face });
      after(face * 180 + 150, () => dispatch({ type: "LANDED" }));
    });
  }, [after]);

  const handleRoll = useCallback(() => {
    if (state.phase !== "idle" || state.currentPlayerId !== "human") return;
    rollAndMove();
  }, [state.phase, state.currentPlayerId, rollAndMove]);

  const handleInvest = useCallback(() => dispatch({ type: "INVEST" }), []);
  const handleAllIn = useCallback(() => dispatch({ type: "ALL_IN" }), []);
  const handlePass = useCallback(() => dispatch({ type: "PASS" }), []);
  const handleCloseResult = useCallback(() => dispatch({ type: "CLOSE_RESULT" }), []);
  const handleCloseEvent = useCallback(() => dispatch({ type: "CLOSE_EVENT" }), []);
  const handleCloseLP = useCallback(() => dispatch({ type: "CLOSE_LP_CHECK" }), []);
  const handleStart = useCallback(() => dispatch({ type: "DISMISS_TUTORIAL" }), []);

  const handleReset = useCallback(() => {
    clearTimers();
    dispatch({ type: "RESET" });
  }, [clearTimers]);

  // AI 自动行动
  useEffect(() => {
    if (state.winnerId || state.showTutorial) return;

    if (state.phase === "ai_thinking" && state.currentPlayerId === "ai") {
      after(AI_THINK_DELAY.beforeRoll, () => rollAndMove());
    }

    if (state.phase === "deciding" && state.pending && state.pending.playerId === "ai") {
      after(AI_THINK_DELAY.beforeDecide, () => {
        const decision = aiDecide(state, state.pending!.cell);
        dispatch({
          type: decision === "all_in" ? "ALL_IN" : decision === "invest" ? "INVEST" : "PASS",
        });
      });
    }

    if (state.phase === "result" && state.revealed && state.revealed.playerId === "ai") {
      after(AI_THINK_DELAY.afterReveal, () => dispatch({ type: "CLOSE_RESULT" }));
    }

    if (state.phase === "event" && state.revealedEvent && state.revealedEvent.playerId === "ai") {
      after(AI_THINK_DELAY.afterReveal, () => dispatch({ type: "CLOSE_EVENT" }));
    }

    if (state.phase === "lp_check" && state.lpCheck && state.lpCheck.playerId === "ai") {
      after(AI_THINK_DELAY.afterLPCheck, () => dispatch({ type: "CLOSE_LP_CHECK" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.phase,
    state.currentPlayerId,
    state.pending?.playerId,
    state.revealed?.playerId,
    state.revealedEvent?.playerId,
    state.lpCheck?.playerId,
  ]);

  const showTutorial = state.showTutorial;

  const showPitch =
    state.phase === "deciding" &&
    state.pending &&
    state.pending.playerId === "human";

  const showResult =
    state.phase === "result" &&
    state.revealed &&
    state.revealed.playerId === "human";

  const showEvent =
    state.phase === "event" &&
    state.revealedEvent &&
    state.revealedEvent.playerId === "human";

  const showLPCheck =
    state.phase === "lp_check" &&
    state.lpCheck &&
    state.lpCheck.playerId === "human";

  const showRecap = state.phase === "ended" && state.winnerId !== null;

  const rollDisabled =
    state.phase !== "idle" ||
    state.currentPlayerId !== "human" ||
    diceAnimating ||
    showTutorial;

  return (
    <div className="vt-app">
      <Header state={state} />
      <Board
        state={state}
        onRoll={handleRoll}
        rollDisabled={rollDisabled}
        rolling={diceAnimating}
      />
      <Sidebar state={state} />

      {showTutorial && <Tutorial onStart={handleStart} />}

      {showPitch && state.pending && (
        <PitchModal
          state={state}
          cell={state.pending.cell}
          onInvest={handleInvest}
          onAllIn={handleAllIn}
          onPass={handlePass}
        />
      )}

      {showResult && state.revealed && (
        <ResultModal result={state.revealed} onClose={handleCloseResult} />
      )}

      {showEvent && state.revealedEvent && (
        <EventModal event={state.revealedEvent} onClose={handleCloseEvent} />
      )}

      {showLPCheck && state.lpCheck && (
        <LPCheckModal
          result={state.lpCheck}
          players={state.players}
          onClose={handleCloseLP}
        />
      )}

      {showRecap && <RecapModal state={state} onReset={handleReset} />}
    </div>
  );
}
