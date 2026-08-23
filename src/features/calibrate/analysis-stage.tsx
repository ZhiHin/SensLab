"use client";

import { useEffect, useState } from "react";

/**
 * SCR-030 — "Analyzing your aim" (doc 25 §25.7, `SENS-UX-021`).
 *
 * The analysis itself already happened on the server in the last upload; what this stage does
 * is tell the player, honestly and legibly, what was done with their trials. The stages are
 * the real pipeline, the trial count is the real count, and each line holds for a minimum so
 * the sequence can be read. Under `prefers-reduced-motion` the list renders at once.
 */

const STAGES = [
  (n: number) => `normalising ${n.toLocaleString()} trials`,
  () => "separating warm-up and fatigue",
  () => "comparing sensitivities",
  () => "fitting your response curve",
  () => "checking confidence",
] as const;

/** Minimum hold per stage. Five stages at this hold is the 1.2 s minimum doc 25 asks for, plus. */
export const STAGE_HOLD_MS = 320;

export function AnalysisStage({ trials, onDone }: { trials: number; onDone: () => void }) {
  // Under reduced motion every stage is shown at once; the initial state reads the preference
  // rather than an effect setting it, which would be a render-in-effect.
  const [done, setDone] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? STAGES.length
      : 0,
  );

  useEffect(() => {
    if (done >= STAGES.length) {
      const handle = window.setTimeout(
        onDone,
        Math.max(STAGE_HOLD_MS, 1200 - STAGE_HOLD_MS * STAGES.length),
      );
      return () => window.clearTimeout(handle);
    }
    const handle = window.setTimeout(() => setDone((value) => value + 1), STAGE_HOLD_MS);
    return () => window.clearTimeout(handle);
  }, [done, onDone]);

  return (
    <main
      id="main"
      className="mx-auto flex min-h-[70vh] w-full max-w-[720px] flex-col justify-center px-6 py-16"
    >
      <span className="type-label">Calibration complete</span>
      <h1 className="type-display-s mb-8">ANALYZING YOUR AIM</h1>
      <ol className="flex flex-col gap-3" aria-live="polite" data-testid="analysis-stages">
        {STAGES.map((label, index) => (
          <li
            key={label(trials)}
            className={`flex items-baseline justify-between gap-4 ${
              index < done ? "text-text-1" : index === done ? "text-text-2" : "text-text-3"
            }`}
          >
            <span className="type-data-s">{label(trials)}</span>
            <span className="type-label">{index < done ? "done" : index === done ? "…" : ""}</span>
          </li>
        ))}
      </ol>
    </main>
  );
}
