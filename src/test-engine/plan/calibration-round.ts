import { matchedStimulusSeed, testOrderForBlock } from "../../core/calibration/counterbalance";
import { deriveRng } from "../../core/random";
import { countsPer360, type CountsPer360 } from "../../core/types/brand";
import type { SessionMode, TestKey } from "../../core/types/vocabulary";
import type {
  CandidateAssignment,
  FreeAimStage,
  PlannedRound,
  SessionPlan,
  TestDefinition,
} from "../contracts";
import { CALIBRATION_FOV_HALF_DEG } from "./single-test";

/**
 * One calibration round as a session plan (doc 13 §13.6, doc 19 §19.8).
 *
 * ## What a round contains
 *
 * ```
 *   round 0 only:   free-aim warm-up → reaction → 360 comfort → practice of each scored test
 *   every round:    block per candidate (counterbalanced) → each scored test in a seeded order
 * ```
 *
 * The sensitivity-independent tests run **once per session**, in round 0, at the baseline:
 * running reaction or comfort per candidate would spend the trial budget on a comparison that
 * cannot differ (doc 09 §9.1, §9.7). Practice is unscored and runs before the first measured
 * block so first-contact learning lands outside the measurement (`SENS-BR-011`).
 *
 * ## Why one plan per round
 *
 * The search is adaptive: the next round's candidates depend on this round's analysis, which
 * happens on the server (doc 13, doc 23 §23.4). So the client receives a plan for exactly one
 * round, runs it, uploads it, and asks for the next. The engine already handles a multi-round
 * plan; giving it one calibration round at a time is what keeps the server the decider.
 *
 * ## Matched stimuli
 *
 * Every candidate's block of a given test uses the same stimulus seed, so candidate *i*'s
 * flick trial *k* faces the same target as candidate *j*'s (a paired design, doc 13 §13.6).
 * The test order within a block is seeded per block and avoids repeating the previous block's
 * opener, so a position effect cannot line up with a test.
 */

export interface CalibrationRoundPlanOptions {
  readonly sessionId: string;
  readonly seed: string;
  readonly mode: SessionMode;
  readonly roundIndex: number;
  /** The round's candidates, already blinded and labelled by the server. */
  readonly candidates: readonly CandidateAssignment[];
  /** Presentation order of the candidates, from the Latin square. Indices into `candidates`. */
  readonly blockOrder: readonly number[];
  readonly scoredTests: readonly TestDefinition[];
  /** Run once, in round 0, at the baseline. */
  readonly baselineTests: readonly TestDefinition[];
  readonly baselineCountsPer360: CountsPer360 | number;
  readonly aspectRatio: number;
  readonly maxImpliedCountsPerSecond: number;
  readonly fovHorizontalHalfDeg?: number;
  readonly freeAim?: FreeAimStage;
  readonly physicalConstraint?: SessionPlan["physicalConstraint"];
  /** Continues the session's presentation numbering across rounds. */
  readonly presentationOffset: number;
  readonly testConfigVersion?: string;
}

export function createCalibrationRoundPlan(options: CalibrationRoundPlanOptions): SessionPlan {
  const {
    roundIndex,
    candidates,
    blockOrder,
    scoredTests,
    baselineTests,
    mode,
    fovHorizontalHalfDeg = CALIBRATION_FOV_HALF_DEG,
  } = options;

  if (candidates.length === 0) throw new RangeError("a calibration round needs candidates");
  if (scoredTests.length === 0) throw new RangeError("a calibration round needs scored tests");
  if ([...blockOrder].sort((a, b) => a - b).join() !== candidates.map((_, i) => i).join()) {
    throw new RangeError("blockOrder must be a permutation of the candidate indices");
  }

  const rounds: PlannedRound[] = [];
  let presentationOrder = options.presentationOffset;
  let blockIndex = 0;

  const push = (round: Omit<PlannedRound, "presentationOrder" | "blockIndex" | "roundIndex">) => {
    rounds.push({ ...round, presentationOrder, blockIndex, roundIndex });
    presentationOrder += 1;
  };

  if (roundIndex === 0) {
    // Sensitivity-independent tests, once, at the baseline.
    for (const definition of baselineTests) {
      push({
        candidateIndex: null,
        testKey: definition.key,
        scopeKey: "hipfire",
        isPractice: false,
        trialCount: definition.trialCount(mode),
        stimulusSeed: `${options.seed}:baseline:${definition.key}`,
      });
    }
    blockIndex += 1;

    // Practice for every scored test, unscored, at the baseline.
    for (const definition of scoredTests) {
      const practice = definition.practiceTrialCount(mode);
      if (practice <= 0) continue;
      push({
        candidateIndex: null,
        testKey: definition.key,
        scopeKey: "hipfire",
        isPractice: true,
        trialCount: practice,
        stimulusSeed: `${options.seed}:practice:${definition.key}`,
      });
    }
    blockIndex += 1;
  }

  const testKeys = scoredTests.map((definition) => definition.key as TestKey);
  const byKey = new Map(scoredTests.map((definition) => [definition.key, definition]));
  let previousOpener: TestKey | null = null;

  for (const position of blockOrder) {
    const candidate = candidates[position];
    if (candidate === undefined) continue;

    const orderRng = deriveRng(`${options.seed}:round${roundIndex}`, "test-order", blockIndex);
    const order = testOrderForBlock(testKeys, orderRng, previousOpener);
    previousOpener = order[0] ?? null;

    for (const testKey of order) {
      const definition = byKey.get(testKey);
      if (definition === undefined) continue;
      push({
        candidateIndex: candidate.candidateIndex,
        testKey,
        scopeKey: "hipfire",
        isPractice: false,
        trialCount: definition.trialCount(mode),
        stimulusSeed: matchedStimulusSeed(options.seed, roundIndex, testKey),
      });
    }
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
    baselineCountsPer360: countsPer360(Number(options.baselineCountsPer360)),
    maxImpliedCountsPerSecond: options.maxImpliedCountsPerSecond,
    ...(options.freeAim === undefined || roundIndex !== 0 ? {} : { freeAim: options.freeAim }),
    ...(options.physicalConstraint === undefined
      ? {}
      : { physicalConstraint: options.physicalConstraint }),
  };
}

/** Rough duration for the round's scored blocks, for the interstitial. */
export function estimatedRoundSeconds(plan: SessionPlan, secondsPerTrial = 3): number {
  return plan.rounds.reduce((sum, round) => sum + round.trialCount * secondsPerTrial, 0);
}
