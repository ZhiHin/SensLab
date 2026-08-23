"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RoundAggregate, SessionPlan } from "@/test-engine/contracts";
import { getTestDefinition } from "@/test-engine/tests";
import { useAimEngine } from "@/test-engine/mount";
import { abandonRunAction, completeRunAction, startRunAction, submitRoundAction } from "./actions";
import { copyFor } from "./copy";
import { MeasuringLayer } from "./measuring-layer";

/**
 * The test surface (doc 04 stage 7, doc 09 §9.0.8).
 *
 * ## Distraction-free means structurally distraction-free
 *
 * While a trial is being measured there is **no site navigation on the page at all** — not
 * hidden, not disabled: not rendered. A nav bar that is merely styled away is one stray Tab
 * keypress from stealing focus, and focus loss invalidates the open trial. The header and the
 * exit link exist before the test starts and after it ends, and nowhere in between.
 *
 * There are no transitions, no animated backgrounds and no shadows on this screen. Every one of
 * them costs frames inside a latency measurement, and a frame lost to decoration is
 * indistinguishable in the data from a frame lost to the player's machine.
 *
 * ## The instructions come before pointer lock
 *
 * Pointer lock needs a user gesture, which gives a natural place to put the full-text task
 * description a screen reader can read (doc 09 §9.0.8). It is not a courtesy: a player who has
 * not understood the task produces a clean measurement of their confusion.
 */

type Phase = "briefing" | "starting" | "running" | "finished" | "failed";

export interface TestSurfaceProps {
  readonly testKey: string;
  readonly countsPer360: number;
  readonly maxImpliedCountsPerSecond: number;
}

export function TestSurface({
  testKey,
  countsPer360,
  maxImpliedCountsPerSecond,
}: TestSurfaceProps) {
  const definition = getTestDefinition(testKey);
  const [phase, setPhase] = useState<Phase>("briefing");
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<{ id: string; plan: SessionPlan } | null>(null);
  const [rounds, setRounds] = useState<readonly RoundAggregate[]>([]);

  // Uploads are fire-and-forget from the engine's point of view, but they must not overlap or
  // be lost, so they queue behind one another.
  const uploads = useRef<Promise<unknown>>(Promise.resolve());
  const sessionId = session?.id ?? null;

  const onRoundComplete = useCallback(
    (aggregate: RoundAggregate) => {
      setRounds((previous) => [...previous, aggregate]);
      if (sessionId === null) return;
      uploads.current = uploads.current.then(async () => {
        const result = await submitRoundAction(sessionId, aggregate);
        if (!result.ok) setError(`Round upload failed: ${result.message}`);
      });
    },
    [sessionId],
  );

  const onFinished = useCallback(() => {
    setPhase("finished");
  }, []);

  const plan = session?.plan;
  const definitions = useMemo(() => (definition === undefined ? [] : [definition]), [definition]);

  const engine = useAimEngine({
    // The hook needs a plan before one exists; a placeholder plan with no rounds finishes
    // immediately and draws nothing, which is the correct behaviour for "not started yet".
    plan: plan ?? emptyPlan(),
    definitions,
    onRoundComplete,
    onFinished,
  });

  // Completing the run is a separate call from the last round upload, and must happen after it:
  // a session marked `completed` before its final round landed would read as finished-and-empty.
  const finishedRef = useRef(false);
  useEffect(() => {
    if (phase !== "finished" || sessionId === null || finishedRef.current) return;
    finishedRef.current = true;
    void uploads.current.then(() => completeRunAction(sessionId, engine.qualityFlags));
  }, [phase, sessionId, engine.qualityFlags]);

  // Locking the page behind the measuring layer stops a scrollbar appearing or disappearing
  // mid-session, which would resize the canvas and pause the run.
  useEffect(() => {
    if (phase !== "running") return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [phase]);

  if (definition === undefined) {
    return (
      <main id="main" className="mx-auto w-full max-w-[720px] px-6 py-16">
        <h1 className="type-display-s">Unknown test</h1>
        <p className="mt-4 text-text-2">
          There is no test called &ldquo;{testKey}&rdquo;.{" "}
          <Link href="/test" className="underline">
            Back to the test list
          </Link>
          .
        </p>
      </main>
    );
  }

  const copy = copyFor(definition);

  async function begin() {
    setPhase("starting");
    setError(null);

    const started = await startRunAction({
      testKey,
      mode: "quick",
      countsPer360,
      aspectRatio: 16 / 9,
      maxImpliedCountsPerSecond,
      environment: {
        devicePixelRatio: window.devicePixelRatio,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      },
    });

    if (!started.ok) {
      setError(started.message);
      setPhase("failed");
      return;
    }

    setSession({ id: started.data.sessionId, plan: started.data.plan });
    setPhase("running");
  }

  const running = phase === "running";

  return (
    <main id="main" className="mx-auto w-full max-w-[860px] px-6 py-12">
      {!running && (
        <header className="mb-8 flex items-baseline justify-between gap-4">
          <div>
            <span className="type-label">Aim test</span>
            <h1 className="type-display-s">{copy.name.toUpperCase()}</h1>
          </div>
          <Link href="/test" className="type-label underline" data-testid="exit-link">
            Exit
          </Link>
        </header>
      )}

      {phase === "briefing" || phase === "starting" || phase === "failed" ? (
        <section className="flex flex-col gap-6" data-testid="briefing">
          <p className="max-w-[60ch] text-text-2">{copy.summary}</p>

          <div className="border border-hairline p-6">
            <h2 className="type-label mb-3">What to do</h2>
            <ol className="flex list-decimal flex-col gap-2 pl-5 text-text-2">
              {copy.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>

          <div className="border border-hairline p-6">
            <h2 className="type-label mb-3">What it measures</h2>
            <p className="max-w-[60ch] text-text-2">{copy.measures}</p>
          </div>

          <p className="text-sm text-text-3">
            Continuous motion can be uncomfortable for some people. You can press Escape at any time
            to pause, and leaving the test does not lose what you have already completed.
          </p>

          {error !== null && (
            <p className="text-critical" role="alert" data-testid="run-error">
              {error}
            </p>
          )}

          <button
            type="button"
            className="self-start border border-hairline px-6 py-3 type-label disabled:opacity-40"
            onClick={() => void begin()}
            disabled={phase === "starting"}
            data-testid="begin-button"
          >
            {phase === "starting" ? "Preparing…" : "Begin"}
          </button>
        </section>
      ) : null}

      {running && (
        <MeasuringLayer
          engine={engine}
          onAbandon={() => {
            if (sessionId !== null) void abandonRunAction(sessionId);
            setPhase("finished");
          }}
        />
      )}

      {phase === "finished" && (
        <section className="flex flex-col gap-6" data-testid="summary">
          <h2 className="type-display-s">DONE</h2>
          <p className="max-w-[60ch] text-text-2">
            Your trials have been recorded. A single test does not produce a sensitivity
            recommendation — that needs a full calibration session, which compares several
            sensitivities against each other.
          </p>

          <ul className="flex flex-col gap-3" data-testid="round-summary">
            {rounds.map((round) => (
              <li key={round.presentationOrder} className="border border-hairline p-4">
                <p className="type-label">
                  {round.isPractice ? "Practice" : "Measured"} · {round.trials.length} trials
                </p>
                <p className="text-sm text-text-2">
                  {round.trials.filter((trial) => trial.validity === "valid").length} valid ·{" "}
                  {round.trials.filter((trial) => trial.validity === "degraded").length} degraded ·{" "}
                  {round.trials.filter((trial) => trial.validity === "invalid").length} invalid
                </p>
              </li>
            ))}
          </ul>

          {error !== null && (
            <p className="text-critical" role="alert" data-testid="run-error">
              {error}
            </p>
          )}

          <Link href="/test" className="self-start border border-hairline px-6 py-3 type-label">
            Back to the tests
          </Link>
        </section>
      )}
    </main>
  );
}

/** A plan with no rounds: valid, finishes immediately, draws nothing. */
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
