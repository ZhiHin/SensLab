"use client";

import { useCallback, useEffect, useRef } from "react";
import type { RoundAggregate, SessionPlan } from "@/test-engine/contracts";
import type { SessionQualityFlag } from "@/core/types/vocabulary";
import { ALL_TESTS } from "@/test-engine/tests";
import { useAimEngine } from "@/test-engine/mount";
import { MeasuringLayer } from "@/features/test-run/measuring-layer";
import { copyFor } from "@/features/test-run/copy";

/**
 * Runs one server-issued plan to completion and hands back what was measured.
 *
 * Shared by the calibration rounds, the validation blocks and the fine-tune stages: each is
 * "a plan the server made, run by the engine, uploaded as aggregates". The surface that owns
 * the phase machine decides what to do with the aggregates; this component only measures.
 *
 * The HUD label is the caller's, because what a round is called differs by stage — and it
 * never names a sensitivity (`SENS-BR-007`).
 */

export interface PlanRunnerProps {
  readonly plan: SessionPlan;
  /** Prefix for the HUD, e.g. "Round 2 of 3" or "Block 5 of 8". */
  readonly stageLabel: string;
  readonly onComplete: (
    aggregates: readonly RoundAggregate[],
    qualityFlags: readonly SessionQualityFlag[],
  ) => void;
  readonly onAbandon: () => void;
}

export function PlanRunner({ plan, stageLabel, onComplete, onAbandon }: PlanRunnerProps) {
  const aggregates = useRef<RoundAggregate[]>([]);
  const completed = useRef(false);

  const onRoundComplete = useCallback((aggregate: RoundAggregate) => {
    aggregates.current.push(aggregate);
  }, []);

  // The hand-off happens from the effect below, once the hook has re-rendered with the final
  // state and the quality flags it accumulated — not from the engine's own callback.
  const engine = useAimEngine({ plan, definitions: ALL_TESTS, onRoundComplete });
  const { state, qualityFlags } = engine;
  useEffect(() => {
    if (state !== "finished" || completed.current) return;
    completed.current = true;
    onComplete(aggregates.current, qualityFlags);
  }, [state, qualityFlags, onComplete]);

  // Lock the page behind the measuring layer: a scrollbar appearing mid-session would resize
  // the canvas and pause the run.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const stageRound = engine.stage.kind === "round" ? engine.stage.round : null;
  const label =
    stageRound === null
      ? stageLabel
      : `${stageLabel} · ${copyFor({ key: stageRound.testKey }).name}${stageRound.isPractice ? " (practice)" : ""}`;

  return <MeasuringLayer engine={engine} progressLabel={label} onAbandon={onAbandon} />;
}
