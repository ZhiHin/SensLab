import { crossCorrelationLag, resampleUniform } from "../../core/signal";
import { median } from "../../core/statistics";
import type { MotionSegment } from "../contracts";
import { evaluateMotion } from "../targets/motion";
import { segmentWindows } from "../targets/profiles";
import type { MetricDerivation, TrialObservation } from "../telemetry/metric-collector";
import { heldFor } from "./tracking";
import { traceFor, type TrialTrace } from "./trace";

/**
 * Tracking metrics that depend on *what the target was doing* (doc 10 §10.4, post-MVP).
 *
 * The MVP tracking family treats the target's motion as given and measures the error. These
 * three read the motion profile itself — where the reversals were, where the peak was held,
 * when it accelerated — and measure the player against those moments. They only make sense for
 * the `segments` motion kind, and return null for anything else rather than guessing.
 */

/** The crosshair must stay inside the target this long before a reversal counts as recovered. */
export const RECOVERY_HOLD_MS = 50;
/** Resampling grid for the cross-correlation, milliseconds. */
export const LAG_GRID_MS = 4;
/** Longest lag searched. Anything beyond this is not lag; it is not tracking. */
export const MAX_LAG_MS = 400;

function segmentsOf(trace: TrialTrace): readonly MotionSegment[] | null {
  const motion = trace.target?.motion;
  return motion !== undefined && motion.kind === "segments" ? motion.segments : null;
}

/** First time at or after `fromMs` at which ε ≤ r holds for RECOVERY_HOLD_MS, or null. */
function recoveryTimeAfter(trace: TrialTrace, fromMs: number, untilMs: number): number | null {
  const radius = trace.radiusDeg as number;
  let insideSince: number | null = null;
  for (let i = 0; i < trace.sampleCount; i += 1) {
    const t = trace.t[i] as number;
    if (t < fromMs) continue;
    if (t > untilMs) break;
    if ((trace.error[i] as number) <= radius) {
      insideSince ??= t;
      if (t - insideSince >= RECOVERY_HOLD_MS) return insideSince;
    } else {
      insideSince = null;
    }
  }
  return null;
}

export const reversalRecoveryTime: MetricDerivation = {
  key: "reversalRecoveryTime",
  derive(observation: TrialObservation) {
    const context = heldFor(observation);
    if (context === null) return null;
    const { trace } = context;
    const segments = segmentsOf(trace);
    const live = trace.target;
    if (segments === null || live === null) return null;

    // A reversal's moment is the midpoint of its braking segment — the instant the target's
    // velocity passes through zero and the player has to turn around.
    const reversals = segmentWindows(segments, "reverse").map(
      (span) => live.spawnedAt + (span.fromMs + span.toMs) / 2,
    );
    if (reversals.length === 0) return null;

    const times: number[] = [];
    for (const [index, at] of reversals.entries()) {
      if (at < trace.stimulusAt || at > trace.resolvedAt) continue;
      const until = reversals[index + 1] ?? trace.resolvedAt;
      const recovered = recoveryTimeAfter(trace, at, until);
      // Never recovering before the next reversal is the slowest possible recovery, not a
      // missing value — dropping it would flatter exactly the player it describes.
      times.push((recovered ?? until) - at);
    }
    return times.length === 0 ? null : median(times);
  },
};

export const peakSpeedTrackingError: MetricDerivation = {
  key: "peakSpeedTrackingError",
  derive(observation: TrialObservation) {
    const context = heldFor(observation);
    if (context === null) return null;
    const { trace, held } = context;
    const segments = segmentsOf(trace);
    const live = trace.target;
    if (segments === null || live === null) return null;

    const windows = segmentWindows(segments, "sustain").map((span) => ({
      from: live.spawnedAt + span.fromMs,
      to: live.spawnedAt + span.toMs,
    }));
    if (windows.length === 0) return null;

    // As `trackingError`, restricted to the held samples inside a sustained-peak segment.
    let acc = 0;
    let weight = 0;
    for (let k = 0; k < held.indices.length; k += 1) {
      const i = held.indices[k] as number;
      const t = trace.t[i] as number;
      if (!windows.some((span) => t >= span.from && t <= span.to)) continue;
      const normalised = trace.errorNorm[i] as number;
      const duration = held.durations[k] as number;
      acc += normalised * normalised * duration;
      weight += duration;
    }
    return weight > 0 ? Math.sqrt(acc / weight) : null;
  },
};

export const accelerationLagMs: MetricDerivation = {
  key: "accelerationLagMs",
  derive(observation: TrialObservation) {
    const context = heldFor(observation);
    if (context === null) return null;
    const { trace } = context;
    const segments = segmentsOf(trace);
    const live = trace.target;
    if (segments === null || live === null) return null;
    if (trace.sampleCount < 8) return null;

    const lags: number[] = [];
    for (const span of segmentWindows(segments, "accelerate")) {
      const from = live.spawnedAt + span.fromMs;
      // Extend past the acceleration so a lagging response has somewhere to show up.
      const to = Math.min(trace.resolvedAt, live.spawnedAt + span.toMs + MAX_LAG_MS);
      if (to - from < LAG_GRID_MS * 8) continue;

      // The target's velocity is analytic, so it is evaluated exactly on the grid. The
      // crosshair is known only at samples — and a mouse at rest sends none — so its *position*
      // is resampled onto the same grid and differentiated there. Building both signals at the
      // sparse sample times and interpolating would smear the response earlier and bias the
      // lag low, which is exactly what the first version of this did.
      const gridCount = Math.floor((to - from) / LAG_GRID_MS) + 1;
      const reference = new Float64Array(gridCount);
      for (let g = 0; g < gridCount; g += 1) {
        const t = from + g * LAG_GRID_MS;
        reference[g] = evaluateMotion(
          live.motion,
          live.origin,
          t - live.spawnedAt,
        ).velocityDegPerSec.yaw;
      }

      const position = resampleUniform(
        trace.t,
        observation.inputSamples.yaw,
        from,
        to,
        LAG_GRID_MS,
      );
      const response = new Float64Array(gridCount);
      for (let g = 1; g < gridCount; g += 1) {
        response[g] =
          (((position[g] as number) - (position[g - 1] as number)) / LAG_GRID_MS) * 1000;
      }

      const lag = crossCorrelationLag(reference, response, Math.floor(MAX_LAG_MS / LAG_GRID_MS));
      if (lag !== null) lags.push(lag * LAG_GRID_MS);
    }

    return lags.length === 0 ? null : median(lags);
  },
};

/**
 * Whether the slide demanded more physical travel than the player can comfortably make
 * (doc 09 §9.10). 1 or 0; null when the comfort test has not run, because "unknown" is not
 * "no".
 */
export const pathTruncated: MetricDerivation = {
  key: "pathTruncated",
  derive(observation: TrialObservation) {
    if (observation.maxSingleSwipeCounts === null) return null;
    const trace = traceFor(observation);
    const segments = segmentsOf(trace);
    if (segments === null) return null;

    // The longest single continuous sweep the profile contains, in degrees, then in counts at
    // the sensitivity the trial ran at. A slide out and back is two sweeps, not one.
    let longestSweepDeg = 0;
    let currentSweepDeg = 0;
    for (const segment of segments) {
      if (segment.label === "hold") {
        longestSweepDeg = Math.max(longestSweepDeg, currentSweepDeg);
        currentSweepDeg = 0;
        continue;
      }
      const t = segment.durationMs / 1000;
      currentSweepDeg += Math.abs(
        segment.startVelocityDegPerSec * t + 0.5 * segment.accelerationDegPerSec2 * t * t,
      );
    }
    longestSweepDeg = Math.max(longestSweepDeg, currentSweepDeg);

    const requiredCounts = longestSweepDeg / observation.degreesPerCount;
    return requiredCounts > observation.maxSingleSwipeCounts ? 1 : 0;
  },
};

export const MOTION_TRACKING_DERIVATIONS: readonly MetricDerivation[] = [
  reversalRecoveryTime,
  peakSpeedTrackingError,
  accelerationLagMs,
  pathTruncated,
];
