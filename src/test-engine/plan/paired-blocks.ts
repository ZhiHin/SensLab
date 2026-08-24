import { testOrderForBlock } from "../../core/calibration/counterbalance";
import { deriveRng } from "../../core/random";
import { countsPer360, type CountsPer360 } from "../../core/types/brand";
import type { SessionMode, TestKey } from "../../core/types/vocabulary";
import { pairIndexOf, type ValidationArm } from "../../core/validation/sequence";
import type { CandidateAssignment, PlannedRound, SessionPlan, TestDefinition } from "../contracts";
import { CALIBRATION_FOV_HALF_DEG } from "./single-test";

/**
 * Paired-block plans: the validation test and the fine-tune duel (doc 17 §17.2, §17.7), and
 * the fine-tune screening pass.
 *
 * ## Blocks, pairs, and where practice goes
 *
 * ```
 *   block index:   0          2    3    4    5    6    7    8    9
 *                  practice   A    B    B    A    B    A    A    B      (ABBA BAAB)
 *                             └ pair 1 ┘ └ pair 2 ┘ └ pair 3 ┘ └ pair 4 ┘
 * ```
 *
 * The analysis pairs **adjacent** blocks (`pairIndexOf`), so scored blocks start at an even
 * index with practice alone at block 0. That keeps the pairing a pure function of the block
 * index — nothing has to be stored to say which block partners which.
 *
 * ## Matched stimuli within a pair
 *
 * The two blocks of a pair share a stimulus seed per test: the A block's flick trial *k*
 * faces the same target as the B block's flick trial *k*. Pairs differ from each other, so
 * nothing is memorised across the run (doc 13 §13.6, doc 17 §17.2).
 *
 * ## What the plan never carries
 *
 * No label the player could read as a sensitivity. Candidates carry the blind label the
 * server assigned and the counts the engine needs to scale input; the HUD shows neither
 * (`SENS-BR-007`).
 */

export interface PairedBlocksPlanOptions {
  readonly sessionId: string;
  readonly seed: string;
  readonly mode: SessionMode;
  /** Arm A then arm B. Both are blinded by the server before they arrive here. */
  readonly arms: { readonly A: CandidateAssignment; readonly B: CandidateAssignment };
  /** The counterbalanced block sequence. */
  readonly sequence: readonly ValidationArm[];
  readonly tests: readonly TestDefinition[];
  readonly trialsPerBlock: Readonly<Record<string, number>>;
  /** Sensitivity for the practice block; arm A's by convention. */
  readonly baselineCountsPer360: CountsPer360 | number;
  readonly aspectRatio: number;
  readonly maxImpliedCountsPerSecond: number;
  /** Unscored warm-up before the first scored block. */
  readonly practice: boolean;
  /** First scored block index. Even, so pairs stay adjacent; ≥ 2 when practice runs. */
  readonly firstBlockIndex: number;
  readonly presentationOffset: number;
  readonly fovHorizontalHalfDeg?: number;
  readonly testConfigVersion?: string;
}

export function createPairedBlocksPlan(options: PairedBlocksPlanOptions): SessionPlan {
  const { arms, sequence, tests, mode, fovHorizontalHalfDeg = CALIBRATION_FOV_HALF_DEG } = options;
  if (sequence.length === 0) throw new RangeError("a paired-blocks plan needs a sequence");
  if (tests.length === 0) throw new RangeError("a paired-blocks plan needs tests");
  if (options.firstBlockIndex % 2 !== 0 || options.firstBlockIndex < 0) {
    throw new RangeError("firstBlockIndex must be a non-negative even number");
  }
  if (options.practice && options.firstBlockIndex < 2) {
    throw new RangeError("practice needs block 0 free: firstBlockIndex must be at least 2");
  }

  const rounds: PlannedRound[] = [];
  let presentationOrder = options.presentationOffset;
  const push = (round: Omit<PlannedRound, "presentationOrder" | "roundIndex">) => {
    rounds.push({ ...round, presentationOrder, roundIndex: 0 });
    presentationOrder += 1;
  };

  if (options.practice) {
    for (const definition of tests) {
      const practice = definition.practiceTrialCount(mode);
      if (practice <= 0) continue;
      push({
        candidateIndex: null,
        testKey: definition.key,
        scopeKey: "hipfire",
        isPractice: true,
        trialCount: practice,
        stimulusSeed: `${options.seed}:practice:${definition.key}`,
        blockIndex: 0,
      });
    }
  }

  const testKeys = tests.map((definition) => definition.key as TestKey);
  const byKey = new Map(tests.map((definition) => [definition.key, definition]));
  let previousOpener: TestKey | null = null;

  sequence.forEach((arm, position) => {
    const blockIndex = options.firstBlockIndex + position;
    const candidate = arm === "A" ? arms.A : arms.B;
    const orderRng = deriveRng(options.seed, "paired-test-order", blockIndex);
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
        trialCount: options.trialsPerBlock[testKey] ?? definition.trialCount(mode),
        stimulusSeed: `${options.seed}:pair${pairIndexOf(blockIndex)}:${testKey}`,
        blockIndex,
      });
    }
  });

  return {
    sessionId: options.sessionId,
    mode,
    seed: options.seed,
    fovHorizontalHalfDeg,
    aspectRatio: options.aspectRatio,
    candidates: [arms.A, arms.B],
    rounds,
    testConfigVersion: options.testConfigVersion ?? "1.0.0",
    baselineCountsPer360: countsPer360(Number(options.baselineCountsPer360)),
    maxImpliedCountsPerSecond: options.maxImpliedCountsPerSecond,
  };
}

/* ------------------------------------------------------------------ screening */

export interface ScreeningPlanOptions {
  readonly sessionId: string;
  readonly seed: string;
  readonly mode: SessionMode;
  /** Every fine-tune candidate, blinded. */
  readonly candidates: readonly CandidateAssignment[];
  /** Presentation order of the candidates — a seeded permutation from the server. */
  readonly order: readonly number[];
  readonly tests: readonly TestDefinition[];
  readonly trialsPerBlock: Readonly<Record<string, number>>;
  readonly baselineCountsPer360: CountsPer360 | number;
  readonly aspectRatio: number;
  readonly maxImpliedCountsPerSecond: number;
  readonly presentationOffset: number;
  readonly fovHorizontalHalfDeg?: number;
  readonly testConfigVersion?: string;
}

/**
 * One short block per candidate, in a seeded order, after a practice block. Stimuli are
 * matched across candidates as in a calibration round.
 */
export function createScreeningPlan(options: ScreeningPlanOptions): SessionPlan {
  const {
    candidates,
    order,
    tests,
    mode,
    fovHorizontalHalfDeg = CALIBRATION_FOV_HALF_DEG,
  } = options;
  if (candidates.length === 0) throw new RangeError("a screening plan needs candidates");
  if ([...order].sort((a, b) => a - b).join() !== candidates.map((_, i) => i).join()) {
    throw new RangeError("order must be a permutation of the candidate positions");
  }

  const rounds: PlannedRound[] = [];
  let presentationOrder = options.presentationOffset;
  const push = (round: Omit<PlannedRound, "presentationOrder" | "roundIndex">) => {
    rounds.push({ ...round, presentationOrder, roundIndex: 0 });
    presentationOrder += 1;
  };

  for (const definition of tests) {
    const practice = definition.practiceTrialCount(mode);
    if (practice <= 0) continue;
    push({
      candidateIndex: null,
      testKey: definition.key,
      scopeKey: "hipfire",
      isPractice: true,
      trialCount: practice,
      stimulusSeed: `${options.seed}:practice:${definition.key}`,
      blockIndex: 0,
    });
  }

  const testKeys = tests.map((definition) => definition.key as TestKey);
  const byKey = new Map(tests.map((definition) => [definition.key, definition]));
  let previousOpener: TestKey | null = null;

  order.forEach((position, slot) => {
    const candidate = candidates[position];
    if (candidate === undefined) return;
    const blockIndex = slot + 1;
    const orderRng = deriveRng(options.seed, "screening-test-order", blockIndex);
    const testOrder = testOrderForBlock(testKeys, orderRng, previousOpener);
    previousOpener = testOrder[0] ?? null;
    for (const testKey of testOrder) {
      const definition = byKey.get(testKey);
      if (definition === undefined) continue;
      push({
        candidateIndex: candidate.candidateIndex,
        testKey,
        scopeKey: "hipfire",
        isPractice: false,
        trialCount: options.trialsPerBlock[testKey] ?? definition.trialCount(mode),
        stimulusSeed: `${options.seed}:screening:${testKey}`,
        blockIndex,
      });
    }
  });

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
  };
}
