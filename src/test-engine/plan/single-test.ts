import type { CountsPer360 } from "../../core/types/brand";
import type { ScopeKey, SessionMode, TestKey } from "../../core/types/vocabulary";
import type { FreeAimStage, PlannedRound, SessionPlan, TestDefinition } from "../contracts";

/**
 * A plan that runs one test on its own (doc 05 FR-058).
 *
 * **This is not the calibration planner.** There are no candidates, no counterbalancing and no
 * adaptive narrowing here — that is Phase 4, and building a half-version of it now would mean
 * two planners to keep in agreement.
 *
 * What this is for is the property Phase 3 has to establish before calibration can be built at
 * all: **every test works independently**. A test that cannot produce clean, reproducible
 * metrics on its own will not produce them inside a candidate comparison either, and debugging
 * it there — with counterbalancing and blinding in the way — is far harder.
 *
 * ## Why `candidateIndex` is null
 *
 * A candidate exists to be *compared*. Running one test at one sensitivity compares nothing, so
 * there is no candidate: the round runs at the plan's baseline, which is the sensitivity the
 * caller asked for. Recording a candidate here would put a comparison in the data that never
 * happened.
 */

/** doc 09 §9.0.1 — held constant across every round, and recorded on the session. */
export const CALIBRATION_FOV_HALF_DEG = 51.5;

export interface SingleTestPlanOptions {
  readonly sessionId: string;
  readonly seed: string;
  readonly mode: SessionMode;
  readonly definition: TestDefinition;
  /** The sensitivity to run at. Becomes the plan's baseline, since there is no candidate. */
  readonly countsPer360: CountsPer360;
  readonly aspectRatio: number;
  /** Physical plausibility bound, computed by the caller from the session DPI (doc 23 §23.10). */
  readonly maxImpliedCountsPerSecond: number;
  readonly scopeKey?: ScopeKey;
  readonly fovHorizontalHalfDeg?: number;
  /** Include the unscored practice round. On by default (`SENS-BR-011`). */
  readonly includePractice?: boolean;
  /** The free-aim warm-up, where the caller wants one before the first measured trial. */
  readonly freeAim?: FreeAimStage;
  readonly testConfigVersion?: string;
}

export function createSingleTestPlan(options: SingleTestPlanOptions): SessionPlan {
  const {
    definition,
    mode,
    scopeKey = "hipfire",
    includePractice = true,
    fovHorizontalHalfDeg = CALIBRATION_FOV_HALF_DEG,
  } = options;

  const rounds: PlannedRound[] = [];
  const practiceTrials = definition.practiceTrialCount(mode);

  if (includePractice && practiceTrials > 0) {
    rounds.push({
      presentationOrder: 0,
      blockIndex: 0,
      roundIndex: 0,
      candidateIndex: null,
      testKey: definition.key as TestKey,
      scopeKey,
      isPractice: true,
      trialCount: practiceTrials,
      // A separate stream from the measured round: practice must never consume the draws the
      // measured round depends on, or the stimulus sequence would shift when practice is
      // skipped (doc 19 §19.8).
      stimulusSeed: `${options.seed}:${definition.key}:practice`,
    });
  }

  rounds.push({
    presentationOrder: rounds.length,
    blockIndex: 0,
    roundIndex: rounds.length,
    candidateIndex: null,
    testKey: definition.key as TestKey,
    scopeKey,
    isPractice: false,
    trialCount: definition.trialCount(mode),
    stimulusSeed: `${options.seed}:${definition.key}:measured`,
  });

  return {
    sessionId: options.sessionId,
    mode,
    seed: options.seed,
    fovHorizontalHalfDeg,
    aspectRatio: options.aspectRatio,
    candidates: [],
    rounds,
    testConfigVersion: options.testConfigVersion ?? "1.0.0",
    baselineCountsPer360: options.countsPer360,
    maxImpliedCountsPerSecond: options.maxImpliedCountsPerSecond,
    ...(options.freeAim === undefined ? {} : { freeAim: options.freeAim }),
  };
}
