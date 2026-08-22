import { countReversals, highPassFirstOrder } from "../../core/signal";
import { rootMeanSquare } from "../../core/statistics";
import type { MetricDerivation, TrialObservation } from "../telemetry/metric-collector";
import { indexAt, STOP_SPEED_DEG_PER_SEC, traceFor, type TrialTrace } from "./trace";

/**
 * The placement and error family (doc 10 §10.3).
 *
 * ## The two-sided signature
 *
 * `overshootRate` and `undershootRate` are the reason the response curve has a peak at all.
 * A sensitivity that is too high produces systematic overshoot; one that is too low produces
 * systematic undershoot; the optimum is where their sum is smallest. Neither on its own would
 * identify an optimum — a monotone metric can only ever say "more" or "less".
 *
 * ## Why the ballistic phase is found rather than assumed
 *
 * Almost every metric here is defined "before the correction phase", so the flick stop has to
 * be located in the trace. Doc 10 defines it as the earlier of the first press and the first
 * speed minimum below 20°/s after 60% of the distance has been covered. Guessing it — a fixed
 * time slice, say — would fold corrections into the ballistic measurement and make a stable
 * player look imprecise.
 */

/** Fraction of d₀ that must be covered before a speed minimum counts as the flick stop. */
const BALLISTIC_PROGRESS_FRACTION = 0.6;
/** Hysteresis threshold for a counted correction (doc 10 §10.3). */
const CORRECTION_THRESHOLD_DEG_PER_SEC = 20;
/** Minimum gap between counted corrections. */
const CORRECTION_REFRACTORY_MS = 25;
/** A stop this long below the stop speed, short of the target, is an undershoot. */
const UNDERSHOOT_DWELL_MS = 40;
/** High-pass corner separating tremor from deliberate movement (doc 10 §10.3, TUNABLE). */
export const JITTER_CUTOFF_HZ = 6;

const indicator = (success: boolean): number => (success ? 1 : 0);

/**
 * Index of the flick stop: the end of the ballistic phase.
 *
 * Returns null when the trial has no identifiable ballistic phase — no target, no movement, or
 * a player who never got 60% of the way there.
 */
function flickStopIndex(trace: TrialTrace): number | null {
  if (trace.sampleCount === 0 || trace.initialDistanceDeg === null) return null;

  const pressIndex = trace.firstPressTime === null ? -1 : indexAt(trace, trace.firstPressTime);
  const threshold = trace.initialDistanceDeg * BALLISTIC_PROGRESS_FRACTION;

  let minimumIndex: number | null = null;
  for (let i = 1; i < trace.sampleCount; i += 1) {
    if ((trace.progress[i] as number) < threshold) continue;
    if ((trace.speed[i] as number) < STOP_SPEED_DEG_PER_SEC) {
      minimumIndex = i;
      break;
    }
  }

  if (pressIndex < 0) return minimumIndex;
  if (minimumIndex === null) return pressIndex;
  return Math.min(pressIndex, minimumIndex);
}

/** Error at the flick stop, in degrees. */
function flickErrorDeg(observation: TrialObservation): number | null {
  const trace = traceFor(observation);
  const stop = flickStopIndex(trace);
  if (stop === null || trace.target === null) return null;
  return trace.error[stop] as number;
}

export const flickError: MetricDerivation = {
  key: "flickError",
  derive: flickErrorDeg,
};

export const flickErrorNorm: MetricDerivation = {
  key: "flickErrorNorm",
  derive(observation) {
    const raw = flickErrorDeg(observation);
    const radius = traceFor(observation).radiusDeg;
    // Normalised by target radius because raw degrees are not comparable between a 2° flick
    // target and a 0.5° precision target — and every cross-test aggregate uses this form.
    return raw === null || radius === null || radius <= 0 ? null : raw / radius;
  },
};

export const microAdjustmentError: MetricDerivation = {
  key: "microAdjustmentError",
  // The same quantity as flickErrorNorm, kept under its own key because it carries different
  // dimension weights (doc 10 §10.3).
  derive: (observation) => flickErrorNorm.derive(observation),
};

export const overshootRate: MetricDerivation = {
  key: "overshootRate",
  derive(observation) {
    const overshoot = overshootMagnitudeDeg(observation);
    return overshoot === null ? null : indicator(overshoot > 0);
  },
};

export const overshootMagnitudeNorm: MetricDerivation = {
  key: "overshootMagnitudeNorm",
  derive(observation) {
    const overshoot = overshootMagnitudeDeg(observation);
    const radius = traceFor(observation).radiusDeg;
    if (overshoot === null || radius === null || radius <= 0) return null;
    // Zero on non-overshooting trials rather than absent: the magnitude of a non-overshoot is
    // genuinely zero, and dropping it would bias the average towards the wild trials.
    return Math.max(0, overshoot) / radius;
  },
};

/**
 * How far past the target's far edge the crosshair went during the engagement, in degrees.
 *
 * ## The window, and why doc 10's original wording could not be used
 *
 * doc 10 originally bounded this at *first entry*. That is vacuous for the case the metric
 * exists to detect: a crosshair travelling towards a target reaches d₀ − r before it reaches
 * d₀ + r, so a straight-line overshoot — the canonical signature of excessive sensitivity —
 * could never satisfy it. The correction, and its reasoning, are recorded in doc 10 §10.3.
 *
 * The window therefore runs from t₀ to the moment the target was destroyed, falling back to
 * the end of the trial when it never was. Bounding at the kill is what keeps the metric
 * meaningful in a multi-kill test such as Switching, where movement towards the *next* target
 * would otherwise be counted as an overshoot of the previous one.
 */
function overshootMagnitudeDeg(observation: TrialObservation): number | null {
  const trace = traceFor(observation);
  if (trace.initialDistanceDeg === null || trace.radiusDeg === null) return null;

  const limit = trace.killTimes[0] ?? trace.resolvedAt;
  let maximumProgress = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < trace.sampleCount; i += 1) {
    if ((trace.t[i] as number) > limit) break;
    const progress = trace.progress[i] as number;
    if (progress > maximumProgress) maximumProgress = progress;
  }

  if (maximumProgress === Number.NEGATIVE_INFINITY) return null;
  return maximumProgress - (trace.initialDistanceDeg + trace.radiusDeg);
}

export const undershootRate: MetricDerivation = {
  key: "undershootRate",
  derive(observation) {
    const trace = traceFor(observation);
    if (trace.initialDistanceDeg === null || trace.radiusDeg === null) return null;

    const shortOf = trace.initialDistanceDeg - trace.radiusDeg;
    const limit = trace.firstEntryTime ?? Infinity;

    let stoppedSince: number | null = null;
    for (let i = 1; i < trace.sampleCount; i += 1) {
      const time = trace.t[i] as number;
      if (time > limit) break;

      const movingSlowly = (trace.speed[i] as number) < STOP_SPEED_DEG_PER_SEC;
      const shortOfTarget = (trace.progress[i] as number) < shortOf;

      if (movingSlowly && shortOfTarget) {
        stoppedSince ??= time;
        // The ballistic movement stopped short and a second movement was required — the
        // canonical signature of a sensitivity that is too low.
        if (time - stoppedSince >= UNDERSHOOT_DWELL_MS) return 1;
      } else {
        stoppedSince = null;
      }
    }

    return 0;
  },
};

export const correctionCount: MetricDerivation = {
  key: "correctionCount",
  derive(observation) {
    const trace = traceFor(observation);
    const stop = flickStopIndex(trace);
    if (stop === null) return null;

    // Counted only after the ballistic phase: reversals during the flick itself are the flick,
    // not corrections to it.
    return countReversals(
      trace.progressRate.subarray(stop),
      trace.t.subarray(stop),
      CORRECTION_THRESHOLD_DEG_PER_SEC,
      CORRECTION_REFRACTORY_MS,
    );
  },
};

export const pathEfficiency: MetricDerivation = {
  key: "pathEfficiency",
  derive(observation) {
    const trace = traceFor(observation);
    if (trace.initialDistanceDeg === null || trace.firstEntryTime === null) return null;

    const entry = indexAt(trace, trace.firstEntryTime);
    if (entry < 0) return null;
    const travelled = trace.pathLength[entry] as number;
    if (travelled <= 0) return null;

    // Clamped because a target that drifted towards the crosshair can make the straight-line
    // distance exceed the path travelled, and an "efficiency" above 1 is not meaningful.
    return Math.min(1, trace.initialDistanceDeg / travelled);
  },
};

export const settleTime: MetricDerivation = {
  key: "settleTime",
  derive(observation) {
    const trace = traceFor(observation);
    if (trace.firstEntryTime === null) return null;

    // The shot that resolved the trial, not the first one: settling ends when the player
    // committed, and an early miss is part of the settling.
    const shot = trace.pressTimes.find((time) => time >= (trace.firstEntryTime as number));
    return shot === undefined ? null : shot - trace.firstEntryTime;
  },
};

export const jitterRMS: MetricDerivation = {
  key: "jitterRMS",
  derive(observation) {
    const trace = traceFor(observation);
    if (trace.firstEntryTime === null) return null;

    const start = indexAt(trace, trace.firstEntryTime);
    const shot = trace.pressTimes.find((time) => time >= (trace.firstEntryTime as number));
    const end = shot === undefined ? trace.sampleCount - 1 : indexAt(trace, shot);
    if (start < 0 || end <= start) return null;

    // High-passed before the RMS, which is the whole point: without it a slow deliberate
    // approach and a shaky hover produce the same variance and the metric says nothing.
    const times = trace.t.subarray(start, end + 1);
    const progressHp = highPassFirstOrder(
      trace.progress.subarray(start, end + 1),
      times,
      JITTER_CUTOFF_HZ,
    );
    const lateralHp = highPassFirstOrder(
      trace.lateral.subarray(start, end + 1),
      times,
      JITTER_CUTOFF_HZ,
    );

    // The two axes are filtered independently and combined in quadrature (doc 10 §10.3).
    return Math.hypot(rootMeanSquare(progressHp), rootMeanSquare(lateralHp));
  },
};

export const PLACEMENT_DERIVATIONS: readonly MetricDerivation[] = [
  flickError,
  flickErrorNorm,
  microAdjustmentError,
  overshootRate,
  overshootMagnitudeNorm,
  undershootRate,
  correctionCount,
  pathEfficiency,
  settleTime,
  jitterRMS,
];
