"use client";

import { useEffect, useMemo, useState } from "react";
import type { RoundAggregate } from "@/test-engine/contracts";
import { useAimEngine } from "@/test-engine/mount";
import { createHarnessPlan, harnessDefinition } from "./harness-definition";

/**
 * The browser harness for the aim engine (doc 19 §19.12, harness 3).
 *
 * Development only — the route group's layout 404s this in production.
 *
 * What it is for is everything the headless harness cannot reach: real pointer lock, a real
 * canvas, a real `requestAnimationFrame`, and a real hand. It makes no numerical assertions;
 * the deterministic harness owns those. What it proves is that the engine is *playable*.
 *
 * Note what the surface deliberately does not show while a round is running: no score, no
 * accuracy, no candidate label. Those are absent here for the same reason they are absent from
 * the HUD (`SENS-BR-007`) — the round summaries below appear only after a round has closed,
 * and they name the candidate index because this page is for engineers, not players.
 */

const ASPECT_RATIO = 16 / 9;

/**
 * A fixed seed, deliberately.
 *
 * A time-based seed would differ between the server render and the client render and fail
 * hydration — which does not merely log a warning: React regenerates the tree, the canvas
 * element is replaced, and the engine attached to it is torn down mid-session. A constant also
 * makes two runs of the harness directly comparable, which is what a harness is for.
 */
const HARNESS_SEED = "lab-harness-v1";

export function EngineHarness() {
  const [rounds, setRounds] = useState<readonly RoundAggregate[]>([]);

  // Memoised so the engine is created once: a new plan object on every render would tear down
  // and rebuild the engine mid-session.
  const plan = useMemo(() => createHarnessPlan(HARNESS_SEED, ASPECT_RATIO), []);
  const definitions = useMemo(() => [harnessDefinition], []);

  // Destructured rather than kept as one object: passing a property of it to `ref=` marks the
  // whole handle as ref-like, and every later read of it as a ref access during render.
  const {
    attachCanvas,
    state,
    stage,
    pauseReason,
    qualityFlags,
    start,
    resume,
    restartRound,
    abort,
    completeFreeAim,
  } = useAimEngine({
    plan,
    definitions,
    onRoundComplete: (aggregate) => setRounds((previous) => [...previous, aggregate]),
  });

  const isRunning = state === "running";
  const isFreeAim = stage.kind === "free_aim";

  /**
   * The warm-up gate is a key, not a button.
   *
   * While pointer lock is held there is no cursor, so no DOM control is reachable — which is
   * also why pause is Escape and why restart and abort live on the pause overlay. A "Continue"
   * button rendered next to a locked canvas would be a control the player cannot press.
   */
  useEffect(() => {
    if (!isFreeAim) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Enter") completeFreeAim();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isFreeAim, completeFreeAim]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="type-label">Phase 2 · Engine harness</span>
          <h1 className="type-display-s">AIM ENGINE</h1>
        </div>
        <dl className="flex flex-wrap gap-6 text-sm">
          <div className="flex flex-col">
            <dt className="type-label">State</dt>
            <dd data-testid="engine-state">{state}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="type-label">Stage</dt>
            <dd data-testid="engine-stage">{stage.kind}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="type-label">Seed</dt>
            <dd className="font-mono text-text-2">{HARNESS_SEED}</dd>
          </div>
        </dl>
      </header>

      <div className="relative overflow-hidden rounded border border-hairline bg-void">
        <canvas
          ref={attachCanvas}
          data-testid="engine-canvas"
          className="block w-full"
          style={{ aspectRatio: String(ASPECT_RATIO) }}
        />

        {/* The pause overlay is DOM, not canvas — it only exists while nothing is measured. */}
        {state !== "running" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-void/85 text-center">
            <p className="type-label" data-testid="overlay-state">
              {overlayLabel(state, pauseReason)}
            </p>
            {state === "paused" ? (
              <button
                type="button"
                className="border border-hairline px-6 py-2 type-label"
                onClick={() => void resume()}
                data-testid="resume-button"
              >
                Resume
              </button>
            ) : state === "ready" || state === "idle" ? (
              <button
                type="button"
                className="border border-hairline px-6 py-2 type-label"
                onClick={() => void start()}
                data-testid="start-button"
              >
                Start
              </button>
            ) : null}
            {state === "paused" && (
              <div className="flex flex-wrap justify-center gap-3">
                <button
                  type="button"
                  className="border border-hairline px-4 py-2 type-label"
                  onClick={() => restartRound()}
                  data-testid="restart-button"
                >
                  Restart round
                </button>
                <button
                  type="button"
                  className="border border-hairline px-4 py-2 type-label"
                  onClick={() => abort()}
                  data-testid="abort-button"
                >
                  Abort
                </button>
              </div>
            )}

            <p className="max-w-[46ch] text-sm text-text-3">
              Pointer lock needs a click. Press Escape at any time to pause.
            </p>
          </div>
        )}
      </div>

      <p className="text-sm text-text-3" data-testid="controls-hint">
        {isFreeAim
          ? "Warm-up: acquire targets, then press Enter to begin the first round."
          : isRunning
            ? "Press Escape to pause. Restart and abort live on the pause overlay."
            : "Idle."}
      </p>

      {qualityFlags.length > 0 && (
        <p className="text-sm text-critical" data-testid="quality-flags">
          Session quality flags: {qualityFlags.join(", ")}
        </p>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="type-label">Rounds completed ({rounds.length})</h2>
        {rounds.length === 0 ? (
          <p className="text-sm text-text-3">
            Nothing yet. Round aggregates appear here as each round closes — one callback per round,
            never one per trial.
          </p>
        ) : (
          <ul className="flex flex-col gap-3" data-testid="round-list">
            {rounds.map((round) => (
              <li key={round.presentationOrder} className="border border-hairline p-4 text-sm">
                <p className="type-label">
                  Round {round.roundIndex + 1} · candidate {round.candidateIndex ?? "baseline"}
                </p>
                <p className="text-text-2">
                  {round.trials.length} trials ·{" "}
                  {round.trials.filter((trial) => trial.validity === "valid").length} valid ·{" "}
                  {round.trials.filter((trial) => trial.validity === "degraded").length} degraded ·{" "}
                  {round.trials.filter((trial) => trial.validity === "invalid").length} invalid
                </p>
                <p className="text-text-3">
                  late frames {(round.qualitySummary.lateFrameRatio * 100).toFixed(1)}% · hitches{" "}
                  {round.qualitySummary.hitchCount} · lock losses{" "}
                  {round.qualitySummary.lockLossCount}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function overlayLabel(state: string, pauseReason: string | null): string {
  switch (state) {
    case "paused":
      return `Paused — ${pauseReason ?? "user"}`;
    case "finished":
      return "Session complete";
    case "aborted":
      return "Session aborted";
    default:
      return "Ready";
  }
}
