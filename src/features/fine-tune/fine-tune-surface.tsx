"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import type { RoundAggregate } from "@/test-engine/contracts";
import type { SessionQualityFlag } from "@/core/types/vocabulary";
import type { FineTuneStep } from "@/services/fine-tune-service";
import { PlanRunner } from "@/features/session-run/plan-runner";
import { AnalysisStage } from "@/features/calibrate/analysis-stage";
import { abandonFineTuneAction, startFineTuneAction, submitFineTuneAction } from "./actions";

/**
 * The fine-tune run (doc 17 §17.7, SCR-034's capture half).
 *
 * ```
 *   briefing ──► screening (five blinded candidates) ──► duel quartet ──► … ──► reveal
 * ```
 *
 * The candidates are around the recommendation, but nothing here says which is which: the
 * labels "Lower / Recommended / Higher" exist only on the reveal page, after the run
 * (FR-089, `SENS-BR-007`). Between stages the surface says how far along the run is and
 * nothing about how it is going.
 */

type Phase =
  | { readonly kind: "briefing" }
  | { readonly kind: "starting" }
  | { readonly kind: "running"; readonly step: FineTuneStep }
  | { readonly kind: "uploading"; readonly step: FineTuneStep }
  | { readonly kind: "between"; readonly next: FineTuneStep }
  | { readonly kind: "analysing"; readonly sessionId: string; readonly trials: number }
  | { readonly kind: "failed"; readonly message: string };

function stageLabel(step: FineTuneStep): string {
  return step.stage === "screening"
    ? `Fine-tune · screening ${step.plan.candidates.length} candidates`
    : `Fine-tune · head-to-head ${step.quartet} of ${step.quartetBudget}`;
}

export function FineTuneSurface({ recommendationId }: { recommendationId: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "briefing" });
  const [trials, setTrials] = useState(0);

  async function begin() {
    setPhase({ kind: "starting" });
    const started = await startFineTuneAction({
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
        setTrials((count) => count + aggregates.reduce((sum, a) => sum + a.trials.length, 0));
        void (async () => {
          const result = await submitFineTuneAction({
            sessionId: step.sessionId,
            aggregates,
            qualityFlags,
            aspectRatio: step.plan.aspectRatio,
          });
          if (!result.ok) {
            setPhase({ kind: "failed", message: result.message });
            return;
          }
          if (result.data.kind === "finished") {
            setPhase({
              kind: "analysing",
              sessionId: result.data.sessionId,
              trials: trials + aggregates.reduce((sum, a) => sum + a.trials.length, 0),
            });
            return;
          }
          setPhase({ kind: "between", next: result.data.step });
        })();
        return { kind: "uploading", step };
      });
    },
    [trials],
  );

  if (phase.kind === "running") {
    return (
      <PlanRunner
        plan={phase.step.plan}
        stageLabel={stageLabel(phase.step)}
        onComplete={onComplete}
        onAbandon={() => {
          void abandonFineTuneAction(phase.step.sessionId);
          router.push(`/results/${recommendationId}`);
        }}
      />
    );
  }

  if (phase.kind === "analysing") {
    return (
      <AnalysisStage
        trials={phase.trials}
        onDone={() => router.push(`/fine-tune/${recommendationId}/${phase.sessionId}`)}
      />
    );
  }

  return (
    <main id="main" className="mx-auto w-full max-w-[860px] px-6 py-12">
      <header className="mb-8 flex items-baseline justify-between gap-4">
        <div>
          <span className="type-label">Fine-tune</span>
          <h1 className="type-display-s">REFINE INSIDE THE UNCERTAINTY</h1>
        </div>
        <Link href={`/results/${recommendationId}`} className="type-label underline">
          Back to result
        </Link>
      </header>

      {(phase.kind === "briefing" || phase.kind === "starting") && (
        <section className="flex flex-col gap-6" data-testid="fine-tune-briefing">
          <p className="max-w-[62ch] text-text-2">
            Five sensitivities around your recommendation, close enough together that the
            calibration could not separate them. You will run a short block on each, then the two
            that scored best go head to head. Every candidate is a letter until the end — including
            the one that is your current recommendation.
          </p>
          <div className="border border-hairline p-6">
            <h2 className="type-label mb-3">What runs</h2>
            <ul className="flex flex-col gap-2 text-text-2">
              <li>
                <span className="type-label text-text-1">Screening</span>
                <span className="ml-3 text-sm text-text-3">
                  One block per candidate — Flick and Micro, the fastest signal per second.
                </span>
              </li>
              <li>
                <span className="type-label text-text-1">Head-to-head</span>
                <span className="ml-3 text-sm text-text-3">
                  The top two in counterbalanced blocks. It stops early if the difference is clear,
                  which is decided before the run, not after.
                </span>
              </li>
            </ul>
          </div>
          <p className="text-sm text-text-3">
            The most common honest outcome is that your recommendation held up and nothing changes.
            That is a result, not a wasted run.
          </p>
          <button
            type="button"
            className="self-start border border-hairline px-6 py-3 type-label"
            onClick={() => void begin()}
            disabled={phase.kind === "starting"}
            data-testid="begin-fine-tune"
          >
            {phase.kind === "starting" ? "Preparing…" : "Begin screening"}
          </button>
        </section>
      )}

      {phase.kind === "uploading" && (
        <p className="type-label" data-testid="uploading">
          Saving…
        </p>
      )}

      {phase.kind === "between" && (
        <section className="flex flex-col gap-6" data-testid="fine-tune-between">
          <h2 className="type-display-s">
            {phase.next.stage === "duel" && phase.next.quartet === 1
              ? "SCREENING COMPLETE"
              : `ROUND ${phase.next.quartet - 1} COMPLETE`}
          </h2>
          <p className="max-w-[60ch] text-text-2">
            {phase.next.stage === "duel" && phase.next.quartet === 1
              ? "Two candidates go forward. Which two is not shown — knowing would change how you play them."
              : "The two are still too close to call, so another set of blocks runs."}
          </p>
          <button
            type="button"
            className="self-start border border-hairline px-6 py-3 type-label"
            onClick={() => setPhase({ kind: "running", step: phase.next })}
            data-testid="continue-fine-tune"
          >
            Continue
          </button>
        </section>
      )}

      {phase.kind === "failed" && (
        <section className="flex flex-col gap-4" data-testid="fine-tune-failed">
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
