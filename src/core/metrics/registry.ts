import type { MetricAggregation, MetricDirection } from "../types/vocabulary";

/**
 * The metric registry (doc 10).
 *
 * This is the controlled vocabulary behind `trial_metrics` and `round_metrics`: a metric that
 * is not declared here does not exist, cannot be stored, and cannot enter a score. Declaring
 * it as data — rather than as scattered string literals — is what makes the metric set
 * extensible for the post-MVP tests without a migration per metric (ADR-012).
 *
 * Phase 1 provides the registry and its invariants. The derivations that *compute* these
 * values from a trial's movement trace are Phase 3, and the scoring that consumes them is
 * Phase 4.
 */

export interface MetricDefinition {
  readonly key: string;
  readonly displayName: string;
  /** SI-ish unit label. "1" denotes a dimensionless ratio or normalised value. */
  readonly unit: string;
  readonly direction: MetricDirection;
  readonly aggregation: MetricAggregation;
  /**
   * Whether this metric participates in the calibration objective (doc 10 §10.9).
   *
   * Deliberately a small subset. Metrics are excluded for concrete reasons: reaction time
   * because it is a property of the player rather than of the sensitivity (`SENS-BR-006`),
   * hit accuracy because it is confounded by trigger discipline, and the comfort metrics
   * because they are a constraint rather than a score.
   */
  readonly isDecisionMetric: boolean;
  readonly description: string;
  /** Version of this definition. A changed definition is a new version, never an edit. */
  readonly version: number;
}

const define = (definition: MetricDefinition): MetricDefinition => Object.freeze(definition);

const DEFINITIONS: readonly MetricDefinition[] = Object.freeze([
  /* ------------------------------------------------ acquisition family (doc 10 §10.2) */
  define({
    key: "reactionTime",
    displayName: "Reaction time",
    unit: "ms",
    direction: "lower_better",
    aggregation: "median",
    isDecisionMetric: false,
    description:
      "Time from the presentation frame to the first button press. Establishes the player's " +
      "simple visual-motor floor. Never an input to the sensitivity recommendation.",
    version: 1,
  }),
  define({
    key: "movementOnsetTime",
    displayName: "Movement onset",
    unit: "ms",
    direction: "lower_better",
    aggregation: "median",
    isDecisionMetric: false,
    description:
      "Time from stimulus to the first sustained movement above threshold. Used to decompose " +
      "acquisition time into its reaction and movement components.",
    version: 1,
  }),
  define({
    key: "timeToTarget",
    displayName: "Time to target",
    unit: "ms",
    direction: "lower_better",
    aggregation: "median",
    isDecisionMetric: false,
    description:
      "Time until the crosshair first touches the target, irrespective of shooting. Pure " +
      "movement performance, uncontaminated by trigger discipline.",
    version: 1,
  }),
  define({
    key: "targetAcquisitionTime",
    displayName: "Target acquisition",
    unit: "ms",
    direction: "lower_better",
    aggregation: "median",
    isDecisionMetric: false,
    description: "Time from stimulus to a successful hit, including any correction and re-aim.",
    version: 1,
  }),
  define({
    key: "adjustedAcquisitionTime",
    displayName: "Acquisition (onset-adjusted)",
    unit: "ms",
    direction: "lower_better",
    aggregation: "median",
    isDecisionMetric: true,
    description:
      "Target acquisition time with the movement-onset component removed. Strips out the " +
      "sensitivity-independent reaction term, which is why this — not raw acquisition — is " +
      "the primary speed input to the search.",
    version: 1,
  }),
  define({
    key: "firstShotAccuracy",
    displayName: "First-shot accuracy",
    unit: "1",
    direction: "higher_better",
    aggregation: "proportion",
    isDecisionMetric: true,
    description:
      "Proportion of trials whose first button press was a hit. The cleanest single measure " +
      "of aim placement.",
    version: 1,
  }),
  define({
    key: "hitAccuracy",
    displayName: "Hit accuracy",
    unit: "1",
    direction: "higher_better",
    aggregation: "proportion",
    isDecisionMetric: false,
    description:
      "Hits divided by total shots. Excluded from the decision set because it is confounded " +
      "by how freely the player pulls the trigger.",
    version: 1,
  }),
  define({
    key: "prematureClickRate",
    displayName: "Premature clicks",
    unit: "1",
    direction: "lower_better",
    aggregation: "proportion",
    isDecisionMetric: false,
    description: "Proportion of reaction trials answered before the stimulus could be perceived.",
    version: 1,
  }),

  /* ------------------------------------------------ placement / error (doc 10 §10.3) */
  define({
    key: "flickError",
    displayName: "Flick error",
    unit: "deg",
    direction: "lower_better",
    aggregation: "median",
    isDecisionMetric: false,
    description: "Angular distance from the target centre at the end of the ballistic phase.",
    version: 1,
  }),
  define({
    key: "flickErrorNorm",
    displayName: "Flick error (normalised)",
    unit: "1",
    direction: "lower_better",
    aggregation: "median",
    isDecisionMetric: true,
    description:
      "Flick error divided by the target's angular radius. Target-size independent, so it is " +
      "the only form comparable across tests.",
    version: 1,
  }),
  define({
    key: "microAdjustmentError",
    displayName: "Micro-adjustment error",
    unit: "1",
    direction: "lower_better",
    aggregation: "median",
    isDecisionMetric: true,
    description: "Normalised flick error restricted to small-angle micro-adjustment trials.",
    version: 1,
  }),
  define({
    key: "overshootRate",
    displayName: "Overshoot rate",
    unit: "1",
    direction: "lower_better",
    aggregation: "proportion",
    isDecisionMetric: true,
    description:
      "Proportion of trials in which the crosshair passed beyond the target before entering " +
      "it. The canonical signature of a sensitivity that is too high.",
    version: 1,
  }),
  define({
    key: "overshootMagnitudeNorm",
    displayName: "Overshoot magnitude",
    unit: "1",
    direction: "lower_better",
    aggregation: "median",
    isDecisionMetric: false,
    description:
      "How far past the target an overshoot travelled, normalised by target radius. " +
      "Distinguishes slightly past from wildly past, which the rate alone conflates.",
    version: 1,
  }),
  define({
    key: "undershootRate",
    displayName: "Undershoot rate",
    unit: "1",
    direction: "lower_better",
    aggregation: "proportion",
    isDecisionMetric: true,
    description:
      "Proportion of trials whose ballistic movement stopped short and required a second " +
      "movement. The mirror of overshoot, and the signature of a sensitivity that is too low.",
    version: 1,
  }),
  define({
    key: "correctionCount",
    displayName: "Corrections",
    unit: "count",
    direction: "lower_better",
    aggregation: "median",
    isDecisionMetric: true,
    description:
      "Direction reversals after the ballistic phase, counted with hysteresis and a " +
      "refractory period so that sensor noise does not register as aiming.",
    version: 1,
  }),
  define({
    key: "pathEfficiency",
    displayName: "Path efficiency",
    unit: "1",
    direction: "higher_better",
    aggregation: "median",
    isDecisionMetric: true,
    description:
      "Straight-line angular distance divided by the path actually travelled. The most " +
      "compact summary of movement quality, and highly sensitivity-responsive.",
    version: 1,
  }),
  define({
    key: "settleTime",
    displayName: "Settle time",
    unit: "ms",
    direction: "lower_better",
    aggregation: "median",
    isDecisionMetric: false,
    description:
      "Time between first entering the target and firing. Rises sharply when sensitivity is " +
      "too high for fine control.",
    version: 1,
  }),
  define({
    key: "jitterRMS",
    displayName: "Jitter",
    unit: "deg",
    direction: "lower_better",
    aggregation: "rms",
    isDecisionMetric: false,
    description:
      "RMS of the high-pass filtered crosshair position while settling. Separates tremor and " +
      "micro-correction from deliberate slow movement.",
    version: 1,
  }),

  /* ------------------------------------------------ tracking (doc 10 §10.4) */
  define({
    key: "trackingAccuracy",
    displayName: "Time on target",
    unit: "1",
    direction: "higher_better",
    aggregation: "time_weighted_mean",
    isDecisionMetric: true,
    description: "Time-weighted fraction of the trial spent with the crosshair inside the target.",
    version: 1,
  }),
  define({
    key: "trackingError",
    displayName: "Tracking error",
    unit: "1",
    direction: "lower_better",
    aggregation: "rms",
    isDecisionMetric: true,
    description:
      "Time-weighted RMS of the normalised angular error. Unlike time-on-target it does not " +
      "saturate, and it distinguishes just-off from far-off.",
    version: 1,
  }),
  define({
    key: "trackingStability",
    displayName: "Tracking stability",
    unit: "1",
    direction: "higher_better",
    aggregation: "mean",
    isDecisionMetric: true,
    description:
      "Inverse of the high-frequency component of tracking error. Catches a player who is " +
      "holding time-on-target only by correcting constantly — which no other metric sees.",
    version: 1,
  }),
  define({
    key: "correctionFrequency",
    displayName: "Correction frequency",
    unit: "Hz",
    direction: "neutral",
    aggregation: "mean",
    isDecisionMetric: false,
    description:
      "Zero-crossing rate of the along-motion error derivative. Only meaningful jointly with " +
      "tracking error, so it is never scored alone.",
    version: 1,
  }),
  define({
    key: "trackingBias",
    displayName: "Lead / lag",
    unit: "1",
    direction: "neutral",
    aggregation: "time_weighted_mean",
    isDecisionMetric: false,
    description:
      "Signed mean along-motion error. Positive is leading the target, negative is lagging. " +
      "A style descriptor, recorded rather than penalised.",
    version: 1,
  }),

  /* ------------------------------------------------ switching (doc 10 §10.5) */
  define({
    key: "switchingTime",
    displayName: "Switch time",
    unit: "ms",
    direction: "lower_better",
    aggregation: "median",
    isDecisionMetric: false,
    description: "Time between consecutive hits in a target-switching sequence.",
    version: 1,
  }),
  define({
    key: "switchingTravelTime",
    displayName: "Switch travel",
    unit: "ms",
    direction: "lower_better",
    aggregation: "median",
    isDecisionMetric: true,
    description:
      "Time from a hit to first entering the next target. Isolates movement by excluding the " +
      "settle and trigger phases.",
    version: 1,
  }),

  /* ------------------------------------------------ comfort constraint (doc 09 §9.7) */
  define({
    key: "maxSingleSwipeDeg",
    displayName: "Max single swipe",
    unit: "deg",
    direction: "higher_better",
    aggregation: "median",
    isDecisionMetric: false,
    description: "Largest rotation achieved in one continuous motion with no lift detected.",
    version: 1,
  }),
  define({
    key: "comfortableSwipeCm",
    displayName: "Comfortable swipe",
    unit: "cm",
    direction: "higher_better",
    aggregation: "median",
    isDecisionMetric: false,
    description:
      "Physical distance corresponding to the comfortable single swipe. Produces a hard " +
      "constraint on the search range rather than a score.",
    version: 1,
  }),
  define({
    key: "liftCount180",
    displayName: "Lifts to turn 180°",
    unit: "count",
    direction: "lower_better",
    aggregation: "median",
    isDecisionMetric: false,
    description: "Lifts or re-grips required to face directly behind.",
    version: 1,
  }),
  define({
    key: "time180",
    displayName: "Time to turn 180°",
    unit: "ms",
    direction: "lower_better",
    aggregation: "median",
    isDecisionMetric: false,
    description: "Time taken to turn to face directly behind.",
    version: 1,
  }),
  define({
    key: "returnErrorDeg",
    displayName: "Return error",
    unit: "deg",
    direction: "lower_better",
    aggregation: "median",
    isDecisionMetric: false,
    description: "Angular error when returning to a marked heading.",
    version: 1,
  }),

  /* ------------------------------------------------ post-MVP tests (doc 09 §9.8–§9.13) */
  define({
    key: "liftDetected",
    displayName: "Lift detected",
    unit: "1",
    direction: "lower_better",
    aggregation: "proportion",
    isDecisionMetric: false,
    description:
      "Whether the movement stream shows a lift or re-grip before the target was reached. A " +
      "measured fact about the physical reach a sensitivity demands, not a performance score; " +
      "feeds the physical-constraint model rather than the objective.",
    version: 1,
  }),
  define({
    key: "reversalRecoveryTime",
    displayName: "Reversal recovery",
    unit: "ms",
    direction: "lower_better",
    aggregation: "median",
    isDecisionMetric: true,
    description:
      "After each direction reversal, the time until the crosshair is back inside the target " +
      "for at least 50 ms. Median across the reversals in a trial.",
    version: 1,
  }),
  define({
    key: "peakSpeedTrackingError",
    displayName: "Peak-speed tracking error",
    unit: "1",
    direction: "lower_better",
    aggregation: "median",
    isDecisionMetric: true,
    description:
      "Tracking error restricted to the segments where the target holds its peak speed — the " +
      "part of a slide a sensitivity either supports or does not.",
    version: 1,
  }),
  define({
    key: "accelerationLagMs",
    displayName: "Acceleration lag",
    unit: "ms",
    direction: "lower_better",
    aggregation: "median",
    isDecisionMetric: false,
    description:
      "Cross-correlation lag between target angular velocity and crosshair angular velocity " +
      "during the acceleration phases of a slide.",
    version: 1,
  }),
  define({
    key: "pathTruncated",
    displayName: "Path truncated",
    unit: "1",
    direction: "neutral",
    aggregation: "proportion",
    isDecisionMetric: false,
    description:
      "Whether the physical travel a slide demanded exceeded the player's measured comfortable " +
      "swipe. Such trials are excluded from tracking scoring and retained as evidence for the " +
      "constraint model (doc 09 §9.10).",
    version: 1,
  }),
  define({
    key: "recoilDeviationVertical",
    displayName: "Vertical recoil deviation",
    unit: "deg",
    direction: "lower_better",
    aggregation: "median",
    isDecisionMetric: true,
    description: "RMS of the vertical component of the aiming error during the recoil window.",
    version: 1,
  }),
  define({
    key: "recoilDeviationHorizontal",
    displayName: "Horizontal recoil deviation",
    unit: "deg",
    direction: "lower_better",
    aggregation: "median",
    isDecisionMetric: false,
    description: "RMS of the horizontal component of the aiming error during the recoil window.",
    version: 1,
  }),
  define({
    key: "recoilCompensationGain",
    displayName: "Recoil compensation gain",
    unit: "1",
    direction: "neutral",
    aggregation: "median",
    isDecisionMetric: false,
    description:
      "OLS slope of the player's counter-movement against the applied recoil displacement. " +
      "1.0 is perfect compensation; below is under-, above is over-compensation. Signed, because " +
      "the direction of the failure is diagnostic.",
    version: 1,
  }),
  define({
    key: "recoilRecoveryTime",
    displayName: "Recoil recovery",
    unit: "ms",
    direction: "lower_better",
    aggregation: "median",
    isDecisionMetric: false,
    description:
      "After the recoil burst ends, the time until the crosshair is back inside the target for " +
      "at least 50 ms.",
    version: 1,
  }),
  define({
    key: "stabilityUnderRecoil",
    displayName: "Stability under recoil",
    unit: "1",
    direction: "higher_better",
    aggregation: "median",
    isDecisionMetric: true,
    description:
      "Inverse of the high-frequency content of the aiming error during the recoil window. " +
      "Low when compensation is a series of jerks rather than a steady pull.",
    version: 1,
  }),
  define({
    key: "adsTransitionTime",
    displayName: "ADS transition",
    unit: "ms",
    direction: "lower_better",
    aggregation: "median",
    isDecisionMetric: false,
    description:
      "Movement onset measured from the moment the view zooms: the re-orientation cost of the " +
      "transition into the scoped state. Present only on scoped trials.",
    version: 1,
  }),
  define({
    key: "adsFirstShotAccuracy",
    displayName: "ADS first-shot accuracy",
    unit: "1",
    direction: "higher_better",
    aggregation: "proportion",
    isDecisionMetric: false,
    description: "First-shot accuracy on scoped trials, tagged so the scope track can read it.",
    version: 1,
  }),

  /* ------------------------------------------------ derived / session (doc 10 §10.6) */
  define({
    key: "consistency",
    displayName: "Consistency",
    unit: "1",
    direction: "higher_better",
    aggregation: "mean",
    isDecisionMetric: true,
    description:
      "Bounded 0–1 repeatability score derived from the robust coefficient of variation. A " +
      "first-class output: for many players the honest finding is that variance, not " +
      "sensitivity, is the limiter.",
    version: 1,
  }),
  define({
    key: "fatigueDrift",
    displayName: "Fatigue drift",
    unit: "score/100 trials",
    direction: "neutral",
    aggregation: "mean",
    isDecisionMetric: false,
    description:
      "Signed slope of the composite trial score across the session once candidate effects " +
      "are removed. Large magnitude in either direction contaminates candidate comparison.",
    version: 1,
  }),
  define({
    key: "qualityScore",
    displayName: "Frame quality",
    unit: "1",
    direction: "higher_better",
    aggregation: "mean",
    isDecisionMetric: false,
    description: "Fraction of frames within the frame budget during a trial.",
    version: 1,
  }),
]);

const BY_KEY: ReadonlyMap<string, MetricDefinition> = new Map(
  DEFINITIONS.map((definition) => [definition.key, definition]),
);

export const METRIC_DEFINITIONS: readonly MetricDefinition[] = DEFINITIONS;

export const METRIC_KEYS: readonly string[] = DEFINITIONS.map((definition) => definition.key);

export function getMetricDefinition(key: string): MetricDefinition | undefined {
  return BY_KEY.get(key);
}

export function isKnownMetric(key: string): boolean {
  return BY_KEY.has(key);
}

/** The subset that participates in the calibration objective (doc 10 §10.9). */
export const DECISION_METRIC_KEYS: readonly string[] = DEFINITIONS.filter(
  (definition) => definition.isDecisionMetric,
).map((definition) => definition.key);

/**
 * Aligns a raw value so that larger is always better.
 *
 * Applied once, at the head of the scoring pipeline, so that no later stage needs to know a
 * metric's direction — which removes an entire class of sign bug (doc 14 §14.2).
 */
export function alignDirection(key: string, value: number): number {
  const definition = BY_KEY.get(key);
  if (definition === undefined) throw new RangeError(`unknown metric "${key}"`);
  return definition.direction === "lower_better" ? -value : value;
}
