import { highPassFirstOrder } from "../../core/signal";
import { rootMeanSquare } from "../../core/statistics";
import { evaluateDisturbance } from "../targets/disturbance";
import type { MetricDerivation, TrialObservation } from "../telemetry/metric-collector";
import { STABILITY_CUTOFF_HZ } from "./tracking";
import { traceFor, type TrialTrace } from "./trace";

/**
 * The recoil family (doc 10 §10.5, post-MVP).
 *
 * ## Reconstructing held time
 *
 * The disturbance develops as a function of cumulative held time, which the engine tracked
 * live. The derivations reconstruct the same quantity from the event stream — every press and
 * release is recorded — so the applied offset at any sample is recoverable exactly, and the
 * player's own movement is the recorded crosshair minus that offset.
 *
 * ## The recoil span
 *
 * Measured from the first press until the burst has developed fully (held time reaches
 * `burstMs`), or the trial ends. What follows is the recovery span, where the only question
 * is how quickly the player re-centres once the push stops.
 */

export const RECOIL_RECOVERY_HOLD_MS = 50;

interface RecoilContext {
  readonly trace: TrialTrace;
  /** Held time at each sample, milliseconds. */
  readonly heldAt: Float64Array;
  /** Sample indices inside the recoil span. */
  readonly span: readonly number[];
  /** Engine time at which the burst completed, or null if it never did. */
  readonly burstEndedAt: number | null;
  readonly pattern: NonNullable<TrialObservation["disturbance"]>;
}

function heldTimeSeries(observation: TrialObservation, trace: TrialTrace): Float64Array {
  const events = observation.events;
  const presses: number[] = [];
  const releases: number[] = [];
  for (let i = 0; i < events.count; i += 1) {
    (events.phase[i] === 0 ? presses : releases).push(events.t[i] as number);
  }

  const heldAt = new Float64Array(trace.sampleCount);
  let accumulated = 0;
  let openedAt: number | null = null;
  let p = 0;
  let r = 0;

  for (let i = 0; i < trace.sampleCount; i += 1) {
    const t = trace.t[i] as number;
    // Advance the event cursors up to this sample, closing and opening holds in order.
    while (true) {
      const nextPress = presses[p];
      const nextRelease = releases[r];
      const candidate = Math.min(nextPress ?? Infinity, nextRelease ?? Infinity);
      if (candidate > t) break;
      if (nextPress !== undefined && nextPress === candidate) {
        openedAt ??= nextPress;
        p += 1;
      } else if (nextRelease !== undefined) {
        if (openedAt !== null) {
          accumulated += nextRelease - openedAt;
          openedAt = null;
        }
        r += 1;
      }
    }
    heldAt[i] = accumulated + (openedAt === null ? 0 : t - openedAt);
  }
  return heldAt;
}

function recoilContext(observation: TrialObservation): RecoilContext | null {
  const pattern = observation.disturbance;
  if (pattern === null) return null;
  const trace = traceFor(observation);
  if (trace.target === null || trace.radiusDeg === null || trace.sampleCount < 4) return null;

  const heldAt = heldTimeSeries(observation, trace);
  const span: number[] = [];
  let burstEndedAt: number | null = null;

  for (let i = 0; i < trace.sampleCount; i += 1) {
    const held = heldAt[i] as number;
    if (held <= 0) continue;
    if (held <= pattern.burstMs) span.push(i);
    else if (burstEndedAt === null) burstEndedAt = trace.t[i] as number;
  }
  if (span.length < 3) return null;

  return { trace, heldAt, span, burstEndedAt, pattern };
}

/** Time-weighted RMS of one error component over the recoil span. */
function rmsComponent(
  context: RecoilContext,
  observation: TrialObservation,
  axis: "yaw" | "pitch",
): number {
  const { trace, span } = context;
  const live = trace.target as NonNullable<TrialTrace["target"]>;
  const samples = observation.inputSamples;
  let acc = 0;
  let weight = 0;

  for (let k = 1; k < span.length; k += 1) {
    const i = span[k] as number;
    const previous = span[k - 1] as number;
    const duration = Math.max(0, (trace.t[i] as number) - (trace.t[previous] as number));
    const target = observation.targetManager.positionAt(live, trace.t[i] as number);
    const component =
      axis === "yaw"
        ? (samples.yaw[i] as number) - target.yawDeg
        : (samples.pitch[i] as number) - target.pitchDeg;
    acc += component * component * duration;
    weight += duration;
  }
  return weight > 0 ? Math.sqrt(acc / weight) : 0;
}

export const recoilDeviationVertical: MetricDerivation = {
  key: "recoilDeviationVertical",
  derive(observation) {
    const context = recoilContext(observation);
    return context === null ? null : rmsComponent(context, observation, "pitch");
  },
};

export const recoilDeviationHorizontal: MetricDerivation = {
  key: "recoilDeviationHorizontal",
  derive(observation) {
    const context = recoilContext(observation);
    return context === null ? null : rmsComponent(context, observation, "yaw");
  },
};

/**
 * OLS slope of the player's counter-movement against the applied recoil.
 *
 * Fitted on the vertical axis, where the bulk of the disturbance is. The counter-movement is
 * the player's own pitch change — the recorded crosshair with the disturbance removed — and
 * perfect compensation moves it by exactly minus the applied offset, giving a slope of 1.
 */
export const recoilCompensationGain: MetricDerivation = {
  key: "recoilCompensationGain",
  derive(observation) {
    const context = recoilContext(observation);
    if (context === null) return null;
    const { span, heldAt, pattern } = context;
    const samples = observation.inputSamples;

    const first = span[0] as number;
    const baselinePitch =
      (samples.pitch[first] as number) -
      evaluateDisturbance(pattern, heldAt[first] as number).pitchDeg;

    let sumX = 0;
    let sumY = 0;
    let sumXX = 0;
    let sumXY = 0;
    let n = 0;
    for (const i of span) {
      const applied = evaluateDisturbance(pattern, heldAt[i] as number).pitchDeg;
      const own = (samples.pitch[i] as number) - applied - baselinePitch;
      // The player pulls *against* the rise, so the counter-movement is the negative of their
      // own displacement; a perfect pull tracks the applied offset one-for-one.
      const x = applied;
      const y = -own;
      sumX += x;
      sumY += y;
      sumXX += x * x;
      sumXY += x * y;
      n += 1;
    }
    const denominator = n * sumXX - sumX * sumX;
    if (denominator <= 1e-9) return null;
    return (n * sumXY - sumX * sumY) / denominator;
  },
};

export const recoilRecoveryTime: MetricDerivation = {
  key: "recoilRecoveryTime",
  derive(observation) {
    const context = recoilContext(observation);
    if (context === null || context.burstEndedAt === null) return null;
    const { trace, burstEndedAt } = context;
    const radius = trace.radiusDeg as number;
    const live = trace.target as NonNullable<TrialTrace["target"]>;
    const samples = observation.inputSamples;

    // A mouse at rest sends nothing, so the crosshair between samples is wherever the last
    // sample left it. The recovery span is therefore walked as a sequence of (time, error)
    // points that includes the burst end and the trial end, each evaluated with the last known
    // crosshair — otherwise a player who settled perfectly and stopped moving would read as
    // never having settled at all.
    const points: { t: number; error: number }[] = [];
    let lastIndex = -1;
    for (let i = 0; i < trace.sampleCount; i += 1) {
      if ((trace.t[i] as number) < burstEndedAt) lastIndex = i;
      else break;
    }
    const errorWith = (index: number, t: number): number => {
      const target = observation.targetManager.positionAt(live, t);
      return Math.hypot(
        (samples.yaw[index] as number) - target.yawDeg,
        (samples.pitch[index] as number) - target.pitchDeg,
      );
    };
    if (lastIndex >= 0) points.push({ t: burstEndedAt, error: errorWith(lastIndex, burstEndedAt) });
    for (let i = Math.max(0, lastIndex + 1); i < trace.sampleCount; i += 1) {
      points.push({ t: trace.t[i] as number, error: trace.error[i] as number });
    }
    const finalIndex = trace.sampleCount - 1;
    if (finalIndex >= 0) {
      points.push({ t: trace.resolvedAt, error: errorWith(finalIndex, trace.resolvedAt) });
    }

    let insideSince: number | null = null;
    for (const point of points) {
      if (point.error <= radius) {
        insideSince ??= point.t;
        if (point.t - insideSince >= RECOIL_RECOVERY_HOLD_MS) return insideSince - burstEndedAt;
      } else {
        insideSince = null;
      }
    }
    // Never settled: the whole recovery span elapsed. That is the slowest possible value,
    // not a missing one.
    return trace.resolvedAt - burstEndedAt;
  },
};

export const stabilityUnderRecoil: MetricDerivation = {
  key: "stabilityUnderRecoil",
  derive(observation) {
    const context = recoilContext(observation);
    if (context === null) return null;
    const { trace, span } = context;
    if (span.length < 3) return null;

    const times = new Float64Array(span.length);
    const values = new Float64Array(span.length);
    for (let k = 0; k < span.length; k += 1) {
      const i = span[k] as number;
      times[k] = trace.t[i] as number;
      values[k] = trace.errorNorm[i] as number;
    }
    const highFrequency = highPassFirstOrder(values, times, STABILITY_CUTOFF_HZ);
    return 1 / (1 + rootMeanSquare(highFrequency));
  },
};

export const RECOIL_DERIVATIONS: readonly MetricDerivation[] = [
  recoilDeviationVertical,
  recoilDeviationHorizontal,
  recoilCompensationGain,
  recoilRecoveryTime,
  stabilityUnderRecoil,
];
