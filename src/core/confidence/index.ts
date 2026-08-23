import type { ConfidenceParams } from "../params/confidence-model-v1";
import type { CalibrationVerdict, DriftForm } from "../types/vocabulary";

/**
 * The confidence index (doc 15).
 *
 * ## What it is, precisely
 *
 * A bounded, monotone, deterministic function of seven named quality inputs, each reported
 * individually. It says *how much the measurement conditions and the data support the
 * recommendation*. It is **not** a p-value, not a posterior probability, and not a percentage
 * of anything — and the UI never calls it one (`SENS-BR-027`).
 *
 * Two quantities are reported separately and never conflated: the **high-performance range**
 * (a genuine statistical interval from the bootstrap, "where is the peak?") and this index
 * ("how much should you trust this session at all?"). Keeping them apart is what lets the range
 * stay honest.
 *
 * ## Why a geometric mean
 *
 * Composition is a weighted *geometric* mean, so a single very poor component visibly drags
 * the whole index down — a bad environment invalidates comparisons no matter how clean the
 * statistics look, and an arithmetic mean would let good components mask it.
 *
 * ## The ceiling
 *
 * `confidence_model_v1` caps the index at 92 (`SENS-BR-028`). Until the index has been
 * validated against same-hardware re-tests (doc 15 §15.7), claiming 95%+ would assert a
 * precision SensLab has not demonstrated. The ceiling is a version property.
 */

export type ConfidenceComponentKey =
  "peak" | "sample" | "consistency" | "environment" | "drift" | "fit" | "anchor";

export const CONFIDENCE_COMPONENT_KEYS: readonly ConfidenceComponentKey[] = [
  "peak",
  "sample",
  "consistency",
  "environment",
  "drift",
  "fit",
  "anchor",
];

export interface ConfidenceInputs {
  readonly verdict: Exclude<CalibrationVerdict, "insufficient_data">;
  /** 90% credible interval on x*, in log2 units. Null when no interval could be formed. */
  readonly credibleInterval: { readonly low: number; readonly high: number } | null;
  /** Valid trials count 1, degraded count 0.5 — already weighted by the caller. */
  readonly effectiveValidTrials: number;
  readonly targetTrials: number;
  /** Session-level robust coefficient of variation of the trial composite score. */
  readonly trialScoreRcv: number | null;
  readonly environment: {
    readonly rawInputEffective: boolean;
    readonly cleanFrameFraction: number;
    readonly pointerLockLosses: number;
    readonly windowResized: boolean;
  };
  readonly drift: {
    readonly deltaFirstToLast: number;
    readonly form: DriftForm;
  };
  readonly fit: {
    readonly rSquaredAdjusted: number | null;
    readonly distinctSensitivities: number;
  } | null;
  /** The anchor re-test, or null when it was not run (Quick mode). */
  readonly anchor: { readonly deltaScore: number; readonly standardError: number } | null;
}

export interface ConfidenceComponent {
  readonly key: ConfidenceComponentKey;
  /** In [0, 1]; null when the input could not be measured at all. */
  readonly value: number;
  readonly weight: number;
  /** True when the value came from a neutral default rather than a measurement. */
  readonly neutral: boolean;
  /** True when a cap was applied to this component. */
  readonly capped: boolean;
  /** The measured quantity the value was derived from, for the breakdown UI. */
  readonly measured: Readonly<Record<string, number | string | boolean | null>>;
}

export interface ConfidenceOutcome {
  /** 0–100, after the ceiling and the verdict cap. */
  readonly index: number;
  /** The geometric mean before the ceiling, in [0, 1]. */
  readonly raw: number;
  readonly components: readonly ConfidenceComponent[];
  /** True when the verdict cap lowered the index. */
  readonly verdictCapped: boolean;
  readonly ceiling: number;
  readonly version: string;
}

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/* ------------------------------------------------------------------ components */

function peakComponent(inputs: ConfidenceInputs, params: ConfidenceParams): ConfidenceComponent {
  const weight = params.weights.peak;
  if (inputs.credibleInterval === null) {
    // No interval at all is the weakest possible localisation, not a missing value.
    return {
      key: "peak",
      value: 0.05,
      weight,
      neutral: false,
      capped: false,
      measured: { intervalWidthLog2: null },
    };
  }
  const width = Math.abs(inputs.credibleInterval.high - inputs.credibleInterval.low);
  const ratio = width / params.references.peakIntervalWidth;
  let value = 1 / (1 + ratio * ratio);
  let capped = false;
  if (inputs.verdict === "indistinguishable" && value > params.indistinguishablePeakCap) {
    // A narrow interval around a flat curve is precision about nothing.
    value = params.indistinguishablePeakCap;
    capped = true;
  }
  return {
    key: "peak",
    value,
    weight,
    neutral: false,
    capped,
    measured: { intervalWidthLog2: width },
  };
}

function sampleComponent(inputs: ConfidenceInputs, params: ConfidenceParams): ConfidenceComponent {
  const target = Math.max(1, inputs.targetTrials);
  const ratio = Math.min(1, Math.max(0, inputs.effectiveValidTrials) / target);
  // Square root: going from 50% to 100% of target matters more than the last 10% would.
  return {
    key: "sample",
    value: Math.sqrt(ratio),
    weight: params.weights.sample,
    neutral: false,
    capped: false,
    measured: { effectiveValidTrials: inputs.effectiveValidTrials, targetTrials: target },
  };
}

function consistencyComponent(
  inputs: ConfidenceInputs,
  params: ConfidenceParams,
): ConfidenceComponent {
  if (inputs.trialScoreRcv === null || !Number.isFinite(inputs.trialScoreRcv)) {
    return {
      key: "consistency",
      value: 0.5,
      weight: params.weights.consistency,
      neutral: true,
      capped: false,
      measured: { robustCv: null },
    };
  }
  const rcv = Math.max(0, inputs.trialScoreRcv);
  return {
    key: "consistency",
    value: 1 / (1 + rcv / params.references.consistencyRcv),
    weight: params.weights.consistency,
    neutral: false,
    capped: false,
    measured: { robustCv: rcv },
  };
}

function environmentComponent(
  inputs: ConfidenceInputs,
  params: ConfidenceParams,
): ConfidenceComponent {
  const env = inputs.environment;
  const pRaw = env.rawInputEffective ? 1 : params.environment.noRawInput;
  const pFrames = clamp(env.cleanFrameFraction, params.environment.cleanFrameFloor, 1);
  const pLock = Math.max(
    params.environment.pointerLockFloor,
    1 - params.environment.perPointerLockLoss * Math.max(0, env.pointerLockLosses),
  );
  const pWindow = env.windowResized ? params.environment.windowResized : 1;
  return {
    key: "environment",
    value: pRaw * pFrames * pLock * pWindow,
    weight: params.weights.environment,
    neutral: false,
    capped: false,
    measured: {
      rawInputEffective: env.rawInputEffective,
      cleanFrameFraction: env.cleanFrameFraction,
      pointerLockLosses: env.pointerLockLosses,
      windowResized: env.windowResized,
    },
  };
}

function driftComponent(inputs: ConfidenceInputs, params: ConfidenceParams): ConfidenceComponent {
  const delta = Math.abs(inputs.drift.deltaFirstToLast);
  let value = 1 / (1 + delta / params.references.driftDelta);
  // A linear fallback means the spline could not be supported; the weaker model is priced.
  if (inputs.drift.form === "linear_fallback") value *= params.driftFallbackPenalty;
  return {
    key: "drift",
    value,
    weight: params.weights.drift,
    neutral: false,
    capped: false,
    measured: { deltaFirstToLast: inputs.drift.deltaFirstToLast, form: inputs.drift.form },
  };
}

function fitComponent(inputs: ConfidenceInputs, params: ConfidenceParams): ConfidenceComponent {
  const fit = inputs.fit;
  if (
    fit === null ||
    fit.rSquaredAdjusted === null ||
    fit.distinctSensitivities < params.fitMinimumDistinctPoints
  ) {
    // A saturated fit has a meaningless R²; a neutral value refuses to reward it for that.
    return {
      key: "fit",
      value: params.neutral.fitSaturated,
      weight: params.weights.fit,
      neutral: true,
      capped: false,
      measured: {
        rSquaredAdjusted: fit?.rSquaredAdjusted ?? null,
        distinctSensitivities: fit?.distinctSensitivities ?? 0,
      },
    };
  }
  return {
    key: "fit",
    value: clamp(fit.rSquaredAdjusted, 0.3, 1),
    weight: params.weights.fit,
    neutral: false,
    capped: false,
    measured: {
      rSquaredAdjusted: fit.rSquaredAdjusted,
      distinctSensitivities: fit.distinctSensitivities,
    },
  };
}

function anchorComponent(inputs: ConfidenceInputs, params: ConfidenceParams): ConfidenceComponent {
  if (inputs.anchor === null) {
    // Neutral-negative: the repeatability check genuinely was not performed.
    return {
      key: "anchor",
      value: params.neutral.anchorNotRun,
      weight: params.weights.anchor,
      neutral: true,
      capped: false,
      measured: { tStatistic: null },
    };
  }
  const se = inputs.anchor.standardError;
  const t = se > 0 ? Math.abs(inputs.anchor.deltaScore) / se : Number.POSITIVE_INFINITY;
  const value = Number.isFinite(t) ? 1 / (1 + Math.max(0, t - 1) / 2) : 0.05;
  return {
    key: "anchor",
    value,
    weight: params.weights.anchor,
    neutral: false,
    capped: false,
    measured: { tStatistic: Number.isFinite(t) ? t : null },
  };
}

/* ------------------------------------------------------------------ composition */

export function computeConfidence(
  inputs: ConfidenceInputs,
  params: ConfidenceParams,
  version: string,
): ConfidenceOutcome {
  const components = [
    peakComponent(inputs, params),
    sampleComponent(inputs, params),
    consistencyComponent(inputs, params),
    environmentComponent(inputs, params),
    driftComponent(inputs, params),
    fitComponent(inputs, params),
    anchorComponent(inputs, params),
  ];

  // Weighted geometric mean. A zero component is floored just above zero so the logarithm is
  // finite; the result is then (correctly) a single-digit index rather than NaN.
  let weighted = 0;
  let totalWeight = 0;
  for (const component of components) {
    const value = Math.max(1e-6, Math.min(1, component.value));
    weighted += component.weight * Math.log(value);
    totalWeight += component.weight;
  }
  const raw = Math.exp(weighted / totalWeight);

  const uncapped = Math.round(100 * params.ceiling * raw);
  const cap =
    inputs.verdict === "indistinguishable"
      ? params.verdictCaps.indistinguishable
      : params.verdictCaps.peakFound;
  const index = Math.min(uncapped, cap);

  return {
    index: clamp(index, 0, 100),
    raw,
    components,
    verdictCapped: uncapped > cap,
    ceiling: params.ceiling,
    version,
  };
}

/**
 * The component most responsible for a reduced index.
 *
 * Measured by weighted log-loss, which is how the geometric mean actually allocates blame.
 * Used by the breakdown UI to attach the one concrete action doc 15 §15.6 asks for.
 */
export function largestDetractor(outcome: ConfidenceOutcome): ConfidenceComponent | null {
  let worst: ConfidenceComponent | null = null;
  let worstLoss = 0;
  for (const component of outcome.components) {
    const loss = -component.weight * Math.log(Math.max(1e-6, component.value));
    if (loss > worstLoss) {
      worstLoss = loss;
      worst = component;
    }
  }
  return worst;
}

/** Applies the post-validation multiplier (doc 15 §15.8) and re-clamps to the ceiling and cap. */
export function applyValidationMultiplier(
  index: number,
  verdict: "improved" | "no_measurable_difference" | "worse",
  calibrationVerdict: Exclude<CalibrationVerdict, "insufficient_data">,
  params: ConfidenceParams,
): number {
  const multiplier =
    verdict === "improved"
      ? params.validationMultipliers.improved
      : verdict === "worse"
        ? params.validationMultipliers.worse
        : params.validationMultipliers.noMeasurableDifference;
  const cap =
    calibrationVerdict === "indistinguishable"
      ? params.verdictCaps.indistinguishable
      : params.verdictCaps.peakFound;
  return clamp(Math.round(index * multiplier), 0, Math.min(cap, Math.round(100 * params.ceiling)));
}
