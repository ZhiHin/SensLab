"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RoundAggregate, SessionPlan } from "@/test-engine/contracts";
import { ALL_TESTS } from "@/test-engine/tests";
import { useAimEngine } from "@/test-engine/mount";
import type { CalibrationStep } from "@/services/calibration-session-service";
import { MeasuringLayer } from "@/features/test-run/measuring-layer";
import { copyFor } from "@/features/test-run/copy";
import {
  abandonCalibrationAction,
  startCalibrationAction,
  submitCalibrationRoundAction,
} from "./actions";
import { AnalysisStage } from "./analysis-stage";
import {
  CalibrationForm,
  type CalibrationFormValues,
  type HardwareProfileOption,
} from "./calibration-form";

/**
 * The calibration session surface (doc 04 journey J-01 stages 5–9).
 *
 * ```
 *   setup ──► round 0 (baseline, practice, blocks) ──► between ──► round 1 ──► … ──► analysis ──► results
 * ```
 *
 * The client runs one round at a time and asks the server what comes next. It never knows
 * which candidate is which — the plan carries blind labels and the HUD shows none of them — and
 * it never sees a score until the results page (`SENS-BR-007`).
 *
 * Between rounds there is a deliberate, plain interstitial. The analysis stage after the last
 * round shows real work with a minimum hold for legibility (`SENS-UX-021`), and then hands off
 * to the results page by URL.
 */

type Phase =
  | { readonly kind: "setup" }
  | { readonly kind: "starting" }
  | { readonly kind: "briefing"; readonly step: CalibrationStep }
  | { readonly kind: "running"; readonly step: CalibrationStep }
  | { readonly kind: "uploading"; readonly step: CalibrationStep }
  | { readonly kind: "between"; readonly next: CalibrationStep; readonly completed: number }
  | { readonly kind: "analysing"; readonly recommendationId: string; readonly trials: number }
  | { readonly kind: "failed"; readonly message: string };

export interface CalibrationSurfaceProps {
  readonly games: readonly { readonly gameId: string; readonly displayName: string }[];
  /** Saved profiles for a signed-in user; empty for a guest. */
  readonly profiles: readonly HardwareProfileOption[];
}

export function CalibrationSurface({ games, profiles }: CalibrationSurfaceProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "setup" });
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<CalibrationFormValues | null>(null);

  const aggregates = useRef<RoundAggregate[]>([]);
  const trialsSoFar = useRef(0);
  const step = phaseStep(phase);

  const onRoundComplete = useCallback((aggregate: RoundAggregate) => {
    aggregates.current.push(aggregate);
    trialsSoFar.current += aggregate.trials.length;
  }, []);

  const onFinished = useCallback(() => {
    setPhase((current) =>
      current.kind === "running" ? { kind: "uploading", step: current.step } : current,
    );
  }, []);

  const plan = step?.plan;
  const engine = useAimEngine({
    plan: plan ?? emptyPlan(),
    definitions: ALL_TESTS,
    onRoundComplete,
    onFinished,
  });

  // Upload the finished round and find out what comes next. Runs once per `uploading` phase.
  const uploadingFor = useRef<string | null>(null);
  useEffect(() => {
    if (phase.kind !== "uploading" || values === null) return;
    const key = `${phase.step.sessionId}:${phase.step.roundIndex}`;
    if (uploadingFor.current === key) return;
    uploadingFor.current = key;

    const current = phase.step;
    const batch = aggregates.current;
    aggregates.current = [];

    void (async () => {
      const result = await submitCalibrationRoundAction({
        sessionId: current.sessionId,
        roundIndex: current.roundIndex,
        aggregates: batch,
        qualityFlags: engine.qualityFlags,
        aspectRatio: values.aspectRatio,
      });
      if (!result.ok) {
        setPhase({ kind: "failed", message: result.message });
        return;
      }
      if (result.data.kind === "finished") {
        setPhase({
          kind: "analysing",
          recommendationId: result.data.recommendationId,
          trials: trialsSoFar.current,
        });
        return;
      }
      setPhase({ kind: "between", next: result.data.step, completed: current.roundIndex + 1 });
    })();
  }, [phase, values, engine.qualityFlags]);

  // Lock the page behind the measuring layer: a scrollbar appearing mid-session would resize
  // the canvas and pause the run.
  useEffect(() => {
    if (phase.kind !== "running") return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [phase.kind]);

  async function begin(form: CalibrationFormValues) {
    setPhase({ kind: "starting" });
    setError(null);
    setValues(form);
    const started = await startCalibrationAction({
      mode: form.mode,
      dpi: form.dpi,
      dpiSource: form.dpiSource,
      currentCmPer360: form.currentCmPer360,
      padWidthCm: form.padWidthCm,
      gameId: form.gameId,
      hardwareProfileId: form.hardwareProfileId,
      aspectRatio: form.aspectRatio,
      environment: {
        devicePixelRatio: window.devicePixelRatio,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      },
    });
    if (!started.ok) {
      setError(started.message);
      setPhase({ kind: "setup" });
      return;
    }
    setPhase({ kind: "briefing", step: started.data });
  }

  const testsInPlan = useMemo(() => {
    if (plan === undefined) return [];
    const keys = [...new Set(plan.rounds.map((round) => round.testKey))];
    return keys.map((key) => ALL_TESTS.find((test) => test.key === key)).filter(Boolean);
  }, [plan]);

  if (phase.kind === "analysing") {
    return (
      <AnalysisStage
        trials={phase.trials}
        onDone={() => router.push(`/results/${phase.recommendationId}`)}
      />
    );
  }

  if (phase.kind === "running" && step !== null) {
    const stageRound = engine.stage.kind === "round" ? engine.stage.round : null;
    const label =
      stageRound === null
        ? `Round ${step.roundIndex + 1} of ${step.roundBudget}`
        : `Round ${step.roundIndex + 1} of ${step.roundBudget} · ${copyFor({ key: stageRound.testKey }).name}${stageRound.isPractice ? " (practice)" : ""}`;
    return (
      <MeasuringLayer
        engine={engine}
        progressLabel={label}
        onAbandon={() => {
          void abandonCalibrationAction(step.sessionId);
          setPhase({ kind: "setup" });
        }}
      />
    );
  }

  return (
    <main id="main" className="mx-auto w-full max-w-[860px] px-6 py-12">
      <header className="mb-8 flex items-baseline justify-between gap-4">
        <div>
          <span className="type-label">Calibration</span>
          <h1 className="type-display-s">FIND YOUR TRUE SENS</h1>
        </div>
        <Link href="/" className="type-label underline" data-testid="exit-link">
          Exit
        </Link>
      </header>

      {(phase.kind === "setup" || phase.kind === "starting") && (
        <CalibrationForm
          games={games}
          profiles={profiles}
          busy={phase.kind === "starting"}
          error={error}
          onSubmit={(form) => void begin(form)}
        />
      )}

      {phase.kind === "briefing" && (
        <section className="flex flex-col gap-6" data-testid="session-briefing">
          <p className="max-w-[60ch] text-text-2">
            Round {phase.step.roundIndex + 1} of {phase.step.roundBudget}. You will run{" "}
            {phase.step.plan.candidates.length} sensitivities, shown only as letters — which is
            which is decided on the server and not revealed until the end, so your expectations
            cannot shape the measurement.
          </p>
          <div className="border border-hairline p-6">
            <h2 className="type-label mb-3">Tests in this round</h2>
            <ul className="flex flex-col gap-2 text-text-2">
              {testsInPlan.map((test) =>
                test === undefined ? null : (
                  <li key={test.key}>
                    <span className="type-label text-text-1">{copyFor(test).name}</span>
                    <span className="ml-3 text-sm text-text-3">{copyFor(test).summary}</span>
                  </li>
                ),
              )}
            </ul>
          </div>
          <p className="text-sm text-text-3">
            Continuous motion can be uncomfortable for some people. Press Escape at any time to
            pause; what you have completed is kept.
          </p>
          <button
            type="button"
            className="self-start border border-hairline px-6 py-3 type-label"
            onClick={() => setPhase({ kind: "running", step: phase.step })}
            data-testid="begin-round"
          >
            Begin round {phase.step.roundIndex + 1}
          </button>
        </section>
      )}

      {phase.kind === "uploading" && (
        <p className="type-label" data-testid="uploading">
          Saving round {phase.step.roundIndex + 1}…
        </p>
      )}

      {phase.kind === "between" && (
        <section className="flex flex-col gap-6" data-testid="between-rounds">
          <h2 className="type-display-s">ROUND {phase.completed} COMPLETE</h2>
          <p className="max-w-[60ch] text-text-2">
            The next round narrows in on what this one found. Take a moment if you need one —
            fatigue is modelled, but it is still better measured than pushed through.
          </p>
          <button
            type="button"
            className="self-start border border-hairline px-6 py-3 type-label"
            onClick={() => setPhase({ kind: "briefing", step: phase.next })}
            data-testid="continue-round"
          >
            Continue to round {phase.next.roundIndex + 1}
          </button>
        </section>
      )}

      {phase.kind === "failed" && (
        <section className="flex flex-col gap-4" data-testid="session-failed">
          <p className="text-critical" role="alert">
            {phase.message}
          </p>
          <button
            type="button"
            className="self-start border border-hairline px-6 py-3 type-label"
            onClick={() => setPhase({ kind: "setup" })}
          >
            Start again
          </button>
        </section>
      )}
    </main>
  );
}

function phaseStep(phase: Phase): CalibrationStep | null {
  switch (phase.kind) {
    case "briefing":
    case "running":
    case "uploading":
      return phase.step;
    default:
      return null;
  }
}

function emptyPlan(): SessionPlan {
  return {
    sessionId: "00000000-0000-7000-8000-000000000000",
    mode: "quick",
    seed: "pending",
    fovHorizontalHalfDeg: 51.5,
    aspectRatio: 16 / 9,
    candidates: [],
    rounds: [],
    testConfigVersion: "1.0.0",
    baselineCountsPer360: 9448.82 as SessionPlan["baselineCountsPer360"],
    maxImpliedCountsPerSecond: 4_000_000,
  };
}
