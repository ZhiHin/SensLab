"use client";

import { copyFor } from "@/features/test-run/copy";
import type { useAimEngine } from "@/test-engine/mount";

/**
 * The fixed full-viewport layer a measured session runs in (doc 19 §19.11, doc 25 §25.6).
 *
 * Fixed to the viewport as a correctness decision rather than a stylistic one: the engine pauses
 * on a canvas resize, because a resize changes the angular-to-pixel mapping mid-session. A
 * canvas in the document flow is resized by anything that reflows the page — a header
 * unmounting, a scrollbar appearing — so a session would pause itself the moment it started.
 *
 * There are no transitions, no animated backgrounds and no shadows here. Every one of them
 * costs frames inside a latency measurement, and a frame lost to decoration is
 * indistinguishable in the data from a frame lost to the player's machine.
 *
 * Nothing on this layer names a candidate, a score or a sensitivity (`SENS-BR-007`).
 *
 * ## The canvas and a screen reader (`SENS-UX-032`, doc 28 §28.8)
 *
 * A canvas is opaque to assistive technology, so it carries an accessible name and a live
 * description of what is happening — which test, which phase, whether the session is paused.
 * The description is deliberately **procedural**: it says "measuring" and never "you hit" or
 * "23 ms", because a running commentary of performance would be feedback the sighted player
 * does not get, and that would make the two measurements different (`SENS-BR-007`).
 */

type Engine = ReturnType<typeof useAimEngine>;

export interface MeasuringLayerProps {
  readonly engine: Engine;
  readonly onAbandon: () => void;
  /** Optional procedural progress line — never a score. */
  readonly progressLabel?: string | null;
}

export function MeasuringLayer({ engine, onAbandon, progressLabel = null }: MeasuringLayerProps) {
  const {
    attachCanvas,
    state,
    stage,
    trialPhase,
    pauseReason,
    start,
    resume,
    restartRound,
    abort,
  } = engine;

  const round = stage.kind === "round" ? stage.round : null;
  const testName = round === null ? null : copyFor({ key: round.testKey }).name;
  const canvasLabel =
    testName === null
      ? "Aim measurement area"
      : `Aim measurement area — ${testName}${round?.isPractice === true ? " practice" : ""}`;

  // One sentence, procedural only. Paused states are announced because a player who cannot see
  // the overlay needs to know why nothing is responding.
  const statusText =
    state === "paused"
      ? `Paused. ${pauseReason ?? "Press resume to continue."}`
      : state !== "running"
        ? "Ready to begin. Activate the button to start and capture the cursor."
        : round === null
          ? "Preparing."
          : trialPhase === "active"
            ? `Measuring ${testName}.`
            : `Get ready. ${testName} next.`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-void">
      <canvas
        ref={attachCanvas}
        data-testid="test-canvas"
        // A canvas has no implicit role and no content a screen reader can reach. `img` with a
        // name is the honest description of what it is: one rendered surface, described by the
        // live region below rather than traversable.
        role="img"
        aria-label={canvasLabel}
        aria-describedby="measuring-status"
        className="block max-h-full w-full max-w-[min(100vw,177.78vh)]"
        style={{ aspectRatio: "16 / 9" }}
      />

      {progressLabel !== null && state === "running" && (
        <p
          className="type-label pointer-events-none absolute top-4 left-4 text-text-3"
          data-testid="progress-label"
        >
          {progressLabel}
        </p>
      )}

      {state !== "running" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-void/90 text-center">
          <p className="type-label" data-testid="overlay-state">
            {state === "paused" ? `Paused — ${pauseReason ?? "user"}` : "Ready"}
          </p>

          {state === "paused" ? (
            <div className="flex flex-wrap justify-center gap-3">
              <button
                type="button"
                className="border border-hairline px-5 py-2 type-label"
                onClick={() => void resume()}
                data-testid="resume-button"
              >
                Resume
              </button>
              <button
                type="button"
                className="border border-hairline px-5 py-2 type-label"
                onClick={() => restartRound()}
                data-testid="restart-button"
              >
                Restart round
              </button>
              <button
                type="button"
                className="border border-hairline px-5 py-2 type-label"
                onClick={() => {
                  abort();
                  onAbandon();
                }}
                data-testid="abandon-button"
              >
                Stop
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="border border-hairline px-6 py-3 type-label"
              onClick={() => void start()}
              data-testid="lock-button"
            >
              Click to begin
            </button>
          )}

          <p className="max-w-[46ch] text-sm text-text-3">
            Your cursor is captured while the test runs. Press Escape to pause.
          </p>
        </div>
      )}

      <p id="measuring-status" className="sr-only" aria-live="polite" data-testid="trial-phase">
        {statusText}
      </p>
    </div>
  );
}
