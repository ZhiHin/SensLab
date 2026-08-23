import { matchRatio, type MatchCriterion } from "../../core/sensitivity/fov";
import type { ScopeKey } from "../../core/types/vocabulary";
import type {
  MotionPattern,
  TargetSpec,
  TestDefinition,
  TestRng,
  TrialContext,
  TrialView,
} from "../contracts";
import {
  classifyDirection,
  rangeForDirectionClass,
  type DirectionClass,
} from "../targets/placement";

/**
 * The ADS Test (doc 09 §9.13).
 *
 * Aiming in a scoped state: the camera's FOV narrows and the sensitivity changes, exactly as
 * it would when a player aims down sights. Trials **alternate** between a hipfire control and
 * a scoped trial so the transition cost is a within-round comparison rather than a guess.
 *
 * ## SensLab's scopes, not any game's
 *
 * The scope definitions below are SensLab's **own simulation**: a tangent-space magnification
 * and a matching criterion from doc 11 §11.6. They are not a claim about how any game zooms or
 * scales its ADS sensitivity — that is a verification item per game (EV-006..009, EV-014) and
 * no such item is closed. The test runs on the simulated scope regardless (doc 09 §9.13:
 * "the test itself can run on SensLab's own simulated scope definitions"); converting the
 * result into a game's own number is the adapter's job and is gated like everything else.
 *
 * ## Two search parameters, one definition (doc 13 §13.12)
 *
 * In an ordinary session the round's sensitivity is the *hipfire* candidate and the scoped one
 * is derived from it. In Scope Calibration the round's sensitivity is the *scoped* candidate
 * and the hipfire is held at the baseline. The view hook reads `context.searchParameter` and
 * produces the right pair either way, which is what lets the calibration engine search over
 * a scope multiplier without learning anything new.
 */

export interface SimulatedScope {
  readonly magnification: number;
  readonly criterion: MatchCriterion;
}

/**
 * `ASSUMPTION` (`TUNABLE`) — SensLab's simulated scope ladder.
 *
 * Magnifications are the nominal ones a scope key names; `ads` is a low-zoom aim-down-sights
 * state. The criteria follow doc 11 §11.6.3's defaults: half-screen monitor distance up to 4×,
 * focal length from 6×.
 */
export const SIMULATED_SCOPES: Readonly<Record<Exclude<ScopeKey, "hipfire">, SimulatedScope>> = {
  ads: { magnification: 1.5, criterion: { kind: "monitor_distance", coefficient: 0.5 } },
  x1: { magnification: 1.25, criterion: { kind: "monitor_distance", coefficient: 0.5 } },
  x2: { magnification: 2, criterion: { kind: "monitor_distance", coefficient: 0.5 } },
  x3: { magnification: 3, criterion: { kind: "monitor_distance", coefficient: 0.5 } },
  x4: { magnification: 4, criterion: { kind: "monitor_distance", coefficient: 0.5 } },
  x6: { magnification: 6, criterion: { kind: "focal_length" } },
  x8: { magnification: 8, criterion: { kind: "focal_length" } },
};

/** Half-FOV after a tangent-space magnification. */
export function scopedHalfFovDeg(hipfireHalfFovDeg: number, magnification: number): number {
  return (Math.atan(Math.tan((hipfireHalfFovDeg * Math.PI) / 180) / magnification) * 180) / Math.PI;
}

/**
 * The scoped counts/360 derived from a hipfire one under the simulated scope's criterion.
 *
 * The ratio is the doc 11 §11.6.1 identity; all zoomed-in criteria make the scoped state
 * slower in physical terms, so the scoped counts/360 is always the larger number.
 */
export function derivedScopedCounts(
  hipfireCounts: number,
  hipfireHalfFovDeg: number,
  scope: SimulatedScope,
): number {
  const scopedHalf = scopedHalfFovDeg(hipfireHalfFovDeg, scope.magnification);
  return hipfireCounts * matchRatio(scope.criterion, hipfireHalfFovDeg, scopedHalf);
}

/** Even trials are hipfire controls; odd trials are scoped. */
export function adsVariantFor(
  trialIndex: number,
  searchParameter: "hipfire" | "scope",
): "hipfire" | "ads" {
  // Scope Calibration spends its budget on the scope under test; the control would be a
  // measurement of the fixed hipfire, which it already has.
  if (searchParameter === "scope") return "ads";
  return trialIndex % 2 === 0 ? "hipfire" : "ads";
}

export function simulatedScopeFor(scopeKey: ScopeKey): SimulatedScope {
  if (scopeKey === "hipfire") {
    throw new RangeError("the ADS test needs a scoped scopeKey; a round at hipfire has no scope");
  }
  return SIMULATED_SCOPES[scopeKey];
}

/** Flick-class distances, scaled down because the scoped view is narrower. */
const DISTANCE_DEG = { min: 4, max: 18 } as const;
const TARGET_RADIUS_DEG = { min: 0.9, max: 1.6 } as const;
const RESET_RADIUS_DEG = 3;

function directionClassFor(trialIndex: number): DirectionClass {
  const cycle: DirectionClass[] = ["horizontal", "diagonal", "horizontal", "vertical"];
  return cycle[trialIndex % cycle.length] as DirectionClass;
}

export const adsTest: TestDefinition = {
  key: "ads",
  version: 1,
  category: "scored",
  instructionsKey: "test.ads.instructions",
  displayNameKey: "test.ads.name",

  // Alternation halves the scoped sample, so the counts are doubled against doc 09's
  // "10 per candidate per round per scope" to keep ten scoped trials.
  trialCount: (mode) => (mode === "quick" ? 12 : mode === "advanced" ? 24 : 20),
  minValidTrials: (mode) => (mode === "quick" ? 12 : mode === "advanced" ? 24 : 20),
  practiceTrialCount: () => 6,

  timeoutMs: 5000,
  interTrialIntervalMs: { min: 250, max: 600 },
  endCondition: "first_hit",
  shootingModel: "click",
  minMovementCounts: 40,

  spawn(rng: TestRng, context: TrialContext): readonly TargetSpec[] {
    const distanceDeg = rng.nextRange(DISTANCE_DEG.min, DISTANCE_DEG.max);
    const range = rangeForDirectionClass(rng, directionClassFor(context.trialIndex));
    const directionDeg = rng.nextRange(range.from, range.to);
    const radians = (directionDeg * Math.PI) / 180;

    return [
      { yawDeg: 0, pitchDeg: 0, angularRadiusDeg: RESET_RADIUS_DEG, role: "reset" },
      {
        yawDeg: distanceDeg * Math.cos(radians),
        pitchDeg: distanceDeg * Math.sin(radians),
        angularRadiusDeg: rng.nextRange(TARGET_RADIUS_DEG.min, TARGET_RADIUS_DEG.max),
        role: "scored",
      },
    ];
  },

  motionFor(): MotionPattern {
    return { kind: "static" };
  },

  viewFor(_rng: TestRng, context: TrialContext): TrialView | null {
    if (adsVariantFor(context.trialIndex, context.searchParameter) === "hipfire") return null;
    const scope = simulatedScopeFor(context.scopeKey);

    if (context.searchParameter === "scope") {
      // The round's sensitivity *is* the scoped candidate; hipfire is held at the baseline.
      return {
        magnification: scope.magnification,
        positioningCountsPer360: context.baselineCountsPer360,
        measuredCountsPer360: context.roundCountsPer360,
      };
    }

    return {
      magnification: scope.magnification,
      positioningCountsPer360: context.roundCountsPer360,
      measuredCountsPer360: derivedScopedCounts(
        context.roundCountsPer360,
        context.fovHorizontalHalfDeg,
        scope,
      ),
    };
  },

  variantFor(_rng, context) {
    return adsVariantFor(context.trialIndex, context.searchParameter);
  },

  additionalInvalidReasons: ["premature_movement"],
  metricKeys: [
    "targetAcquisitionTime",
    "adjustedAcquisitionTime",
    "movementOnsetTime",
    "timeToTarget",
    "firstShotAccuracy",
    "flickError",
    "flickErrorNorm",
    "microAdjustmentError",
    "overshootRate",
    "correctionCount",
    "pathEfficiency",
    "adsTransitionTime",
    "adsFirstShotAccuracy",
    "qualityScore",
  ],
  primaryMetricKey: "adjustedAcquisitionTime",
};

export { classifyDirection };
