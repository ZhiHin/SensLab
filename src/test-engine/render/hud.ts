import type { SessionStage } from "../session-controller";

/**
 * The HUD model (doc 19 §19.11, `SENS-BR-007`).
 *
 * ## What is deliberately absent
 *
 * There is no score. No accuracy. No streak. No candidate identity. No timer. Not because the
 * HUD has not got round to it, but because showing any of them would change what is being
 * measured: a visible score turns a measurement into a performance, and a visible candidate
 * lets the player's expectations decide which sensitivity "felt better".
 *
 * The model is a plain data structure rather than draw calls so that this rule is *testable* —
 * a test can assert the model's shape has no score field, which is a far stronger guarantee
 * than grepping a canvas for text that might be drawn.
 *
 * The HUD is drawn **on the canvas**, not in the DOM, so updating it cannot trigger a React
 * render or a layout during a measured window (`SENS-NFR-004`).
 */

export interface HudModel {
  /** 1-based round number, or null outside a round. */
  readonly roundNumber: number | null;
  readonly totalRounds: number;
  /** Trials completed in the current round. */
  readonly trialsDone: number;
  readonly trialsTarget: number;
  /** The test's display-name message key. Never a score. */
  readonly testLabelKey: string | null;
  /** Instructional line: the pause hint, the countdown, or the free-aim prompt. */
  readonly hintKey: string;
  /** Countdown seconds remaining, when resuming. */
  readonly countdownSeconds: number | null;
  /** Free-aim acquisitions so far, and the minimum before continuing. */
  readonly freeAim: { readonly acquisitions: number; readonly required: number } | null;
}

export const PAUSE_HINT_KEY = "hud.pauseHint";

export function buildHudModel(
  stage: SessionStage,
  totals: { readonly completedRounds: number; readonly totalRounds: number },
  freeAimRequired: number,
): HudModel {
  const base = {
    totalRounds: totals.totalRounds,
    testLabelKey: null,
    countdownSeconds: null,
    freeAim: null,
  } as const;

  switch (stage.kind) {
    case "round":
      return {
        ...base,
        roundNumber: stage.round.roundIndex + 1,
        trialsDone: stage.progress.completedTrials,
        trialsTarget: stage.progress.targetTrials,
        testLabelKey: `test.${stage.round.testKey}.name`,
        hintKey: PAUSE_HINT_KEY,
      };

    case "free_aim":
      return {
        ...base,
        roundNumber: null,
        trialsDone: 0,
        trialsTarget: 0,
        hintKey: "hud.freeAimHint",
        freeAim: { acquisitions: stage.acquisitions, required: freeAimRequired },
      };

    case "countdown":
      return {
        ...base,
        roundNumber: null,
        trialsDone: 0,
        trialsTarget: 0,
        hintKey: "hud.resuming",
        countdownSeconds: Math.max(1, Math.ceil(stage.remainingMs / 1000)),
      };

    case "interstitial":
      return {
        ...base,
        roundNumber: null,
        trialsDone: 0,
        trialsTarget: 0,
        hintKey: "hud.interstitial",
      };

    case "paused":
      return { ...base, roundNumber: null, trialsDone: 0, trialsTarget: 0, hintKey: "hud.paused" };

    case "idle":
    case "finished":
    case "aborted":
      return { ...base, roundNumber: null, trialsDone: 0, trialsTarget: 0, hintKey: "" };
  }
}
