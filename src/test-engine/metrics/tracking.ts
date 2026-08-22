import { highPassFirstOrder, zeroCrossingRate } from "../../core/signal";
import { rootMeanSquare } from "../../core/statistics";
import type { MetricDerivation, TrialObservation } from "../telemetry/metric-collector";
import { traceFor, type TrialTrace } from "./trace";

/**
 * The tracking family (doc 10 §10.4).
 *
 * ## Held time, not elapsed time
 *
 * Every metric here is measured over the portion of the trial with the fire button **held**.
 * A player who releases mid-trial has stopped performing the task, and averaging their idle
 * time in would make releasing a way to improve a score.
 *
 * ## Time weighting, not sample counting
 *
 * Samples arrive at the mouse's polling rate, which is neither constant nor the same between
 * players. Weighting each sample by the interval it represents means a frame hitch or a
 * polling gap cannot silently reweight the average (doc 10 §10.1).
 *
 * ## Why stability exists alongside accuracy
 *
 * A player at an excessive sensitivity can still post decent time-on-target by correcting
 * constantly. That correction activity is high-frequency, so it is invisible to
 * `trackingAccuracy` and to `trackingError` — it shows up in `trackingStability` and nowhere
 * else. This is the metric that catches "too sensitive" in tracking.
 */

/** High-pass corner separating correction activity from tracking movement (TUNABLE). */
export const STABILITY_CUTOFF_HZ = 3;

interface HeldWindow {
  /** Sample indices during which the fire button was held, in order. */
  readonly indices: readonly number[];
  /** The interval each held sample represents, milliseconds. */
  readonly durations: readonly number[];
  readonly totalMs: number;
}

/**
 * The held intervals of a trial, resolved against the button event stream.
 *
 * A press with no matching release is held to the end of the trial — the trial ending is what
 * released it, and discarding that segment would throw away the tail of every completed
 * tracking trial.
 */
function heldWindow(observation: TrialObservation, trace: TrialTrace): HeldWindow {
  const events = observation.events;
  const intervals: { from: number; to: number }[] = [];
  let openedAt: number | null = null;

  for (let i = 0; i < events.count; i += 1) {
    const time = events.t[i] as number;
    if (events.phase[i] === 0) {
      openedAt ??= time;
    } else if (openedAt !== null) {
      intervals.push({ from: openedAt, to: time });
      openedAt = null;
    }
  }
  if (openedAt !== null) intervals.push({ from: openedAt, to: trace.resolvedAt });

  const isHeld = (time: number): boolean =>
    intervals.some((interval) => time >= interval.from && time <= interval.to);

  const indices: number[] = [];
  const durations: number[] = [];
  let totalMs = 0;

  for (let i = 0; i < trace.sampleCount; i += 1) {
    const time = trace.t[i] as number;
    if (!isHeld(time)) continue;

    // Each sample represents the interval since the previous one; the first held sample
    // represents nothing yet, so it carries zero weight rather than a guessed one.
    const previous = i > 0 ? (trace.t[i - 1] as number) : time;
    const duration = Math.max(0, time - previous);
    indices.push(i);
    durations.push(duration);
    totalMs += duration;
  }

  return { indices, durations, totalMs };
}

function heldFor(observation: TrialObservation): { trace: TrialTrace; held: HeldWindow } | null {
  const trace = traceFor(observation);
  if (trace.target === null || trace.radiusDeg === null) return null;
  const held = heldWindow(observation, trace);
  return held.totalMs <= 0 ? null : { trace, held };
}

export const trackingAccuracy: MetricDerivation = {
  key: "trackingAccuracy",
  derive(observation) {
    const context = heldFor(observation);
    if (context === null) return null;
    const { trace, held } = context;

    let onTargetMs = 0;
    for (let k = 0; k < held.indices.length; k += 1) {
      const i = held.indices[k] as number;
      if ((trace.error[i] as number) <= (trace.radiusDeg as number)) {
        onTargetMs += held.durations[k] as number;
      }
    }
    return onTargetMs / held.totalMs;
  },
};

export const trackingError: MetricDerivation = {
  key: "trackingError",
  derive(observation) {
    const context = heldFor(observation);
    if (context === null) return null;
    const { trace, held } = context;

    // Time-weighted RMS of the normalised error. Unlike accuracy it does not saturate when the
    // player is consistently on target, which is why both are kept.
    let acc = 0;
    for (let k = 0; k < held.indices.length; k += 1) {
      const i = held.indices[k] as number;
      const normalised = trace.errorNorm[i] as number;
      acc += normalised * normalised * (held.durations[k] as number);
    }
    return Math.sqrt(acc / held.totalMs);
  },
};

export const trackingStability: MetricDerivation = {
  key: "trackingStability",
  derive(observation) {
    const context = heldFor(observation);
    if (context === null) return null;
    const { trace, held } = context;
    if (held.indices.length < 2) return null;

    const times = new Float64Array(held.indices.length);
    const values = new Float64Array(held.indices.length);
    for (let k = 0; k < held.indices.length; k += 1) {
      const i = held.indices[k] as number;
      times[k] = trace.t[i] as number;
      values[k] = trace.errorNorm[i] as number;
    }

    const highFrequency = highPassFirstOrder(values, times, STABILITY_CUTOFF_HZ);
    // Expressed as an inverse so that, like every other "higher is better" metric, more is
    // better — and so it is bounded in (0, 1] rather than unbounded above.
    return 1 / (1 + rootMeanSquare(highFrequency));
  },
};

export const correctionFrequency: MetricDerivation = {
  key: "correctionFrequency",
  derive(observation) {
    const context = heldFor(observation);
    if (context === null) return null;
    const { trace, held } = context;
    if (held.indices.length < 3) return null;

    // Zero-crossing rate of the derivative of the signed along-motion error. Never scored
    // alone: high frequency with low error is a fine tracking style, high frequency with high
    // error is instability, and the two are only distinguishable jointly.
    const times = new Float64Array(held.indices.length - 1);
    const derivative = new Float64Array(held.indices.length - 1);

    for (let k = 1; k < held.indices.length; k += 1) {
      const i = held.indices[k] as number;
      const previous = held.indices[k - 1] as number;
      const deltaSeconds = ((trace.t[i] as number) - (trace.t[previous] as number)) / 1000;
      times[k - 1] = trace.t[i] as number;
      derivative[k - 1] =
        deltaSeconds > 0
          ? ((trace.progress[i] as number) - (trace.progress[previous] as number)) / deltaSeconds
          : 0;
    }

    return zeroCrossingRate(derivative, times);
  },
};

export const trackingBias: MetricDerivation = {
  key: "trackingBias",
  derive(observation) {
    const context = heldFor(observation);
    if (context === null) return null;
    const { trace, held } = context;
    const radius = trace.radiusDeg as number;

    // Signed along-motion component: positive means the crosshair is ahead of the target.
    // Leading is a legitimate style, so this records it rather than penalising it.
    const live = trace.target;
    if (live === null) return null;
    const samples = observation.inputSamples;
    let acc = 0;
    let weight = 0;

    for (let k = 1; k < held.indices.length; k += 1) {
      const i = held.indices[k] as number;
      const previous = held.indices[k - 1] as number;

      const now = observation.targetManager.positionAt(live, trace.t[i] as number);
      const before = observation.targetManager.positionAt(live, trace.t[previous] as number);

      // The target's own direction of travel over this interval. A stationary target has no
      // "ahead", so those samples contribute nothing rather than an arbitrary sign.
      const motionYaw = now.yawDeg - before.yawDeg;
      const motionPitch = now.pitchDeg - before.pitchDeg;
      const motionLength = Math.hypot(motionYaw, motionPitch);
      if (motionLength === 0) continue;

      const offsetYaw = (samples.yaw[i] as number) - now.yawDeg;
      const offsetPitch = (samples.pitch[i] as number) - now.pitchDeg;

      const along = (offsetYaw * motionYaw + offsetPitch * motionPitch) / motionLength;
      const duration = held.durations[k] as number;
      acc += (along / radius) * duration;
      weight += duration;
    }

    return weight > 0 ? acc / weight : null;
  },
};

export const TRACKING_DERIVATIONS: readonly MetricDerivation[] = [
  trackingAccuracy,
  trackingError,
  trackingStability,
  correctionFrequency,
  trackingBias,
];
