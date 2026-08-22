import { countsPer360 } from "@/core/types/brand";
import type {
  MotionPattern,
  SessionPlan,
  TargetSpec,
  TestDefinition,
  TestRng,
  TrialContext,
} from "@/test-engine/contracts";
import { placeTarget } from "@/test-engine/targets/placement";

/**
 * The development harness's synthetic test (doc 19 §19.9, FR-058).
 *
 * **This is not one of the seven aim tests.** Those are Phase 3, each with its own
 * specification in doc 09 and its own metrics in doc 10, and inventing approximations of them
 * here would be worse than having none — a plausible-looking flick test with made-up distances
 * would quietly become the thing everyone tested against.
 *
 * What this definition is for is the structural claim doc 19 §19.9 makes: **a test is data plus
 * pure hooks.** It exercises the whole engine — spawning, timing, validity, telemetry,
 * rendering — through nothing but a declaration, on a route that never reaches production. If
 * the engine ever needs a special case to run it, that claim has stopped being true.
 */

const HARNESS_TRIALS = 8;

export const harnessDefinition: TestDefinition = {
  key: "flick",
  version: 1,
  category: "scored",
  instructionsKey: "lab.harness.instructions",
  displayNameKey: "lab.harness.name",

  trialCount: () => HARNESS_TRIALS,
  minValidTrials: () => 4,
  practiceTrialCount: () => 0,

  timeoutMs: 2500,
  interTrialIntervalMs: { min: 350, max: 750 },
  endCondition: "first_hit",
  shootingModel: "click",

  spawn(rng: TestRng, _context: TrialContext): readonly TargetSpec[] {
    // A reset target at the origin, then one scored target placed from the seeded stream. The
    // reset target is what makes every trial start from the same orientation.
    const placement = placeTarget(
      rng,
      { yawDeg: 0, pitchDeg: 0 },
      {
        minDistanceDeg: 12,
        maxDistanceDeg: 30,
        minSeparationDeg: 8,
      },
    );

    return [
      { yawDeg: 0, pitchDeg: 0, angularRadiusDeg: 3, role: "reset" },
      {
        yawDeg: placement.position.yawDeg,
        pitchDeg: placement.position.pitchDeg,
        angularRadiusDeg: 2,
        role: "scored",
      },
    ];
  },

  motionFor(): MotionPattern {
    return { kind: "static" };
  },

  additionalInvalidReasons: [],
  // No metric keys: Phase 2 registers no derivations, and naming keys that do not exist yet
  // would suggest numbers are being produced when none are.
  metricKeys: [],
};

/**
 * A two-round plan for the harness.
 *
 * The two candidates are deliberately far apart so the difference is obvious to a human
 * driving the page, and both are labelled A and B — the engine never learns which is which,
 * and neither does the HUD (`SENS-BR-007`).
 */
export function createHarnessPlan(seed: string, aspectRatio: number): SessionPlan {
  return {
    sessionId: "00000000-0000-7000-8000-00000000dev0",
    mode: "quick",
    seed,
    fovHorizontalHalfDeg: 51.5,
    aspectRatio,
    candidates: [
      { candidateIndex: 0, countsPer360: countsPer360(7086.61), blindLabel: "A" },
      { candidateIndex: 1, countsPer360: countsPer360(11811.02), blindLabel: "B" },
    ],
    rounds: [
      {
        presentationOrder: 0,
        blockIndex: 0,
        roundIndex: 0,
        candidateIndex: 0,
        testKey: "flick",
        scopeKey: "hipfire",
        isPractice: false,
        trialCount: HARNESS_TRIALS,
        stimulusSeed: `${seed}:round-0`,
      },
      {
        presentationOrder: 1,
        blockIndex: 0,
        roundIndex: 1,
        candidateIndex: 1,
        testKey: "flick",
        scopeKey: "hipfire",
        isPractice: false,
        trialCount: HARNESS_TRIALS,
        // Matched stimuli across candidates within a block (doc 13 §13.6): the same seed, so
        // the two candidates are compared on identical targets.
        stimulusSeed: `${seed}:round-0`,
      },
    ],
    testConfigVersion: "0.0.0-harness",
    baselineCountsPer360: countsPer360(9448.82),
    // 8 m/s of hand movement at 3200 DPI. The real planner derives this from the session's DPI;
    // the harness has no DPI, so it uses the permissive default.
    maxImpliedCountsPerSecond: 4_000_000,
    freeAim: {
      minAcquisitions: 3,
      targetAngularRadiusDeg: 3,
      minDistanceDeg: 10,
      maxDistanceDeg: 25,
      countsPer360: countsPer360(9448.82),
    },
  };
}
