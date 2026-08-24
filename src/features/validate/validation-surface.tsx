"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import type { RoundAggregate } from "@/test-engine/contracts";
import type { SessionQualityFlag } from "@/core/types/vocabulary";
import type { ValidationStep } from "@/services/validation-service";
import { PlanRunner } from "@/features/session-run/plan-runner";
import { AnalysisStage } from "@/features/calibrate/analysis-stage";
import { abandonValidationAction, startValidationAction, submitValidationAction } from "./actions";

/**
 * The validation run (doc 17 §17.2, SCR-033's capture half).
 *
 * ```
 *   briefing ──► blocks (one plan, ABBA/BAAB) ──► uploading ──► analysis ──► result
 * ```
 *
 * What the player is told: "you are comparing two sensitivities". What they are not told:
 * which is which, or what either is. The briefing names the two blind labels and nothing
 * else — the plan carries counts for the engine, and nothing on this surface reads them.
 */

type Phase =
  | { readonly kind: "briefing" }
  | { readonly kind: "starting" }
  | { readonly kind: "running"; readonly step: ValidationStep }
  | { readonly kind: "uploading"; readonly step: ValidationStep }
  | { readonly kind: "analysing"; readonly recommendationId: string; readonly trials: number }
  | { readonly kind: "insufficient"; readonly pairs: number; readonly required: number }
  | { readonly kind: "failed"; readonly message: string };

export interface ValidationSurfaceProps {
  readonly recommendationId: string;
  readonly framing: "vs_current" | "vs_starting_point";
  readonly blocks: number;
}

export function ValidationSurface({ recommendationId, framing, blocks }: ValidationSurfaceProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "briefing" });

  async function begin() {
    setPhase({ kind: "starting" });
    const started = await startValidationAction({
      recommendationId,
      aspectRatio: window.innerWidth / Math.max(1, window.innerHeight),
      environment: {
        devicePixelRatio: window.devicePixelRatio,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      },
    });
    if (!started.ok) {
      setPhase({ kind: "failed", message: started.message });
      return;
    }
    setPhase({ kind: "running", step: started.data });
  }

  const onComplete = useCallback(
    (aggregates: readonly RoundAggregate[], qualityFlags: readonly SessionQualityFlag[]) => {
      setPhase((current) => {
        if (current.kind !== "running") return current;
        const { step } = current;
        void (async () => {
          const result = await submitValidationAction({
            sessionId: step.sessionId,
            aggregates,
            qualityFlags,
            aspectRatio: step.plan.aspectRatio,
          });
          if (!result.ok) {
            setPhase({ kind: "failed", message: result.message });
            return;
          }
          if (result.data.kind === "insufficient") {
            setPhase({
              kind: "insufficient",
              pairs: result.data.pairs,
              required: result.data.required,
            });
            return;
          }
          setPhase({
            kind: "analysing",
            recommendationId: result.data.recommendationId,
            trials: aggregates.reduce((sum, aggregate) => sum + aggregate.trials.length, 0),
          });
        })();
        return { kind: "uploading", step };
      });
    },
    [],
  );

  if (phase.kind === "running") {
    return (
      <PlanRunner
        plan={phase.step.plan}
        stageLabel={`Validation · ${phase.step.blocks} blocks`}
        onComplete={onComplete}
        onAbandon={() => {
          void abandonValidationAction(phase.step.sessionId);
          router.push(`/results/${recommendationId}`);
        }}
      />
    );
  }

  if (phase.kind === "analysing") {
    return (
      <AnalysisStage
        trials={phase.trials}
        onDone={() => router.push(`/results/${phase.recommendationId}/validation`)}
      />
    );
  }

  return (
    <main id="main" className="mx-auto w-full max-w-[860px] px-6 py-12">
      <header className="mb-8 flex items-baseline justify-between gap-4">
        <div>
          <span className="type-label">Validation</span>
          <h1 className="type-display-s">DOES IT ACTUALLY HOLD UP?</h1>
        </div>
        <Link href={`/results/${recommendationId}`} className="type-label underline">
          Back to result
        </Link>
      </header>

      {(phase.kind === "briefing" || phase.kind === "starting") && (
        <section className="flex flex-col gap-6" data-testid="validation-briefing">
          <p className="max-w-[60ch] text-text-2">
            You are comparing two sensitivities:{" "}
            {framing === "vs_current"
              ? "the one you came in with and the one SensLab recommended."
              : "your starting point and the one SensLab recommended."}{" "}
            They are shown only as letters, in an order that cancels warm-up and fatigue. Which
            letter is which is decided on the server and revealed with the result.
          </p>
          <div className="border border-hairline p-6">
            <h2 className="type-label mb-3">What runs</h2>
            <ul className="flex flex-col gap-2 text-text-2">
              <li>
                <span className="type-label text-text-1">{blocks} short blocks</span>
                <span className="ml-3 text-sm text-text-3">
                  Flick, Micro and Tracking in each — about forty seconds a block.
                </span>
              </li>
              <li>
                <span className="type-label text-text-1">Matched targets</span>
                <span className="ml-3 text-sm text-text-3">
                  Paired blocks see the same targets, so the comparison is between the
                  sensitivities, not between two different runs of luck.
                </span>
              </li>
            </ul>
          </div>
          <p className="text-sm text-text-3">
            Press Escape at any time to pause. A comparison with fewer than two complete block pairs
            is not analysed.
          </p>
          <button
            type="button"
            className="self-start border border-hairline px-6 py-3 type-label"
            onClick={() => void begin()}
            disabled={phase.kind === "starting"}
            data-testid="begin-validation"
          >
            {phase.kind === "starting" ? "Preparing…" : "Begin the comparison"}
          </button>
        </section>
      )}

      {phase.kind === "uploading" && (
        <p className="type-label" data-testid="uploading">
          Saving your blocks…
        </p>
      )}

      {phase.kind === "insufficient" && (
        <section className="flex flex-col gap-4" data-testid="validation-insufficient">
          <h2 className="type-display-s">NOT ENOUGH TO COMPARE</h2>
          <p className="max-w-[60ch] text-text-2">
            Only {phase.pairs} complete block pair{phase.pairs === 1 ? "" : "s"} came through; the
            analysis needs {phase.required}. Nothing was decided and nothing about your result
            changed.
          </p>
          <Link href={`/results/${recommendationId}`} className="type-label underline">
            Back to your result
          </Link>
        </section>
      )}

      {phase.kind === "failed" && (
        <section className="flex flex-col gap-4" data-testid="validation-failed">
          <p className="text-critical" role="alert">
            {phase.message}
          </p>
          <Link href={`/results/${recommendationId}`} className="type-label underline">
            Back to your result
          </Link>
        </section>
      )}
    </main>
  );
}
