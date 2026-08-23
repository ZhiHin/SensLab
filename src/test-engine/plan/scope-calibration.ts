import { latinSquare } from "../../core/calibration/counterbalance";
import { deriveRng } from "../../core/random";
import { countsPer360, type CountsPer360 } from "../../core/types/brand";
import type { ScopeKey, SessionMode } from "../../core/types/vocabulary";
import type { CandidateAssignment, PlannedRound, SessionPlan, TestDefinition } from "../contracts";
import { CALIBRATION_FOV_HALF_DEG } from "./single-test";

/**
 * Scope Calibration (doc 09 §9.14, doc 13 §13.12).
 *
 * Finds the best per-scope sensitivity by running the **same** calibration engine over a
 * different parameter: the hipfire cm/360 is held at its already-recommended value and the
 * candidates are *scoped* sensitivities. Nothing in the search, the drift model or the
 * response surface knows the difference — a candidate is a counts/360 value either way, and
 * the objective is computed on the scope's own track (doc 14 via `computeObjective`'s
 * `scopeKey`).
 *
 * ## What this plan contains
 *
 * Rounds of the ADS test, one per candidate, under `searchParameter: "scope"`. The ADS
 * definition reads that flag and puts the round's sensitivity on the *scoped* segment with
 * the hipfire segment held at the baseline (doc 09 §9.13).
 *
 * ## What this plan does not decide
 *
 * Which scopes exist. doc 09 §9.14's exposure rule — only scopes the selected game actually
 * has — lives in the service layer against the game's adapter, because the engine must not
 * learn that a game exists. As of Phase 6 no game has a verified scope roster, so the service
 * offers nothing; the plan is built and tested against the scope keys directly.
 */

export interface ScopeCalibrationPlanOptions {
  readonly sessionId: string;
  readonly seed: string;
  readonly mode: SessionMode;
  readonly definition: TestDefinition;
  readonly scopeKey: Exclude<ScopeKey, "hipfire">;
  /** The recommended hipfire sensitivity, held fixed throughout. */
  readonly hipfireCountsPer360: CountsPer360 | number;
  /** The scoped sensitivities under test, already blinded and labelled by the caller. */
  readonly candidates: readonly CandidateAssignment[];
  readonly roundIndex: number;
  readonly aspectRatio: number;
  readonly maxImpliedCountsPerSecond: number;
  readonly fovHorizontalHalfDeg?: number;
  readonly includePractice?: boolean;
  readonly testConfigVersion?: string;
  /** Continues a session's presentation numbering, so a later round's rounds stay unique. */
  readonly presentationOffset?: number;
}

export function createScopeCalibrationPlan(options: ScopeCalibrationPlanOptions): SessionPlan {
  const {
    definition,
    mode,
    scopeKey,
    candidates,
    roundIndex,
    includePractice = true,
    fovHorizontalHalfDeg = CALIBRATION_FOV_HALF_DEG,
    presentationOffset = 0,
  } = options;

  if (definition.key !== "ads") {
    throw new RangeError(`scope calibration runs the ADS test, not "${definition.key}"`);
  }
  if (candidates.length === 0) throw new RangeError("scope calibration needs candidates");

  const rounds: PlannedRound[] = [];
  let presentationOrder = presentationOffset;
  let blockIndex = 0;

  if (includePractice && roundIndex === 0) {
    const practiceTrials = definition.practiceTrialCount(mode);
    if (practiceTrials > 0) {
      rounds.push({
        presentationOrder,
        blockIndex,
        roundIndex,
        candidateIndex: null,
        testKey: definition.key,
        scopeKey,
        isPractice: true,
        trialCount: practiceTrials,
        stimulusSeed: `${options.seed}:${scopeKey}:practice`,
      });
      presentationOrder += 1;
      blockIndex += 1;
    }
  }

  // Counterbalanced candidate order, as the hipfire search has (doc 13 §13.6). One row of a
  // seeded Latin square is a permutation; successive rounds take successive rows.
  const square = latinSquare(
    candidates.length,
    deriveRng(`${options.seed}:${scopeKey}`, "scope-block-order"),
  );
  const order = square[roundIndex % candidates.length] ?? candidates.map((_, index) => index);

  for (const position of order) {
    const candidate = candidates[position];
    if (candidate === undefined) continue;
    rounds.push({
      presentationOrder,
      blockIndex,
      roundIndex,
      candidateIndex: candidate.candidateIndex,
      testKey: definition.key,
      scopeKey,
      isPractice: false,
      trialCount: definition.trialCount(mode),
      // Matched stimuli: the seed excludes the candidate, so candidate i's trial k faces the
      // same target as candidate j's (doc 13 §13.6).
      stimulusSeed: `${options.seed}:${scopeKey}:round${roundIndex}`,
    });
    presentationOrder += 1;
    blockIndex += 1;
  }

  return {
    sessionId: options.sessionId,
    mode,
    seed: options.seed,
    fovHorizontalHalfDeg,
    aspectRatio: options.aspectRatio,
    candidates,
    rounds,
    testConfigVersion: options.testConfigVersion ?? "1.0.0",
    baselineCountsPer360: countsPer360(Number(options.hipfireCountsPer360)),
    maxImpliedCountsPerSecond: options.maxImpliedCountsPerSecond,
    searchParameter: "scope",
  };
}
