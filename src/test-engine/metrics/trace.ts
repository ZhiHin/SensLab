import { angularDistance, type Angles } from "../../core/geometry/angular";
import type { LiveTarget } from "../targets/target-manager";
import type { TrialObservation } from "../telemetry/metric-collector";

/**
 * The derived geometry every metric reads from (doc 10 §10.1).
 *
 * Each metric in doc 10 is defined against the same handful of quantities — *ε*(*t*), *p*(*t*),
 * *q*(*t*), *d₀* — so they are computed once per trial and shared. Computing them per metric
 * would be both wasteful and, more importantly, a way for two metrics to quietly disagree about
 * the same trial.
 *
 * It is built from the **input** sample stream, not the frame stream. Path length, correction
 * counting and onset detection all depend on the actual movement, and a frame-sampled version
 * of them would change with the player's refresh rate — which is precisely the confound the
 * whole engine is built to avoid (doc 10 §10.3).
 */

export interface TrialTrace {
  /** Sample timestamps within the measured window, milliseconds. */
  readonly t: Float64Array;
  /** Angular error ε(t) from the crosshair to the primary target, degrees. */
  readonly error: Float64Array;
  /** Normalised error ε̂(t) = ε(t)/r. Empty when there is no target. */
  readonly errorNorm: Float64Array;
  /** Progress p(t) along the initial crosshair→target direction, degrees. */
  readonly progress: Float64Array;
  /** Lateral deviation q(t) perpendicular to that direction, degrees. */
  readonly lateral: Float64Array;
  /** Signed rate of progress ṗ(t), degrees per second. */
  readonly progressRate: Float64Array;
  /** Unsigned angular speed of the crosshair, degrees per second. */
  readonly speed: Float64Array;
  /** Cumulative angular path length travelled, degrees. */
  readonly pathLength: Float64Array;

  /** The scored target this trial is about, or null. */
  readonly target: LiveTarget | null;
  /** Target angular radius, degrees. Null when there is no target. */
  readonly radiusDeg: number | null;
  /** Initial angular distance d₀ from the crosshair to the target at t₀. */
  readonly initialDistanceDeg: number | null;

  /** Time of the first sample with ε ≤ r, or null if the crosshair never touched it. */
  readonly firstEntryTime: number | null;
  /** Time of the first button press within the measured window, or null. */
  readonly firstPressTime: number | null;
  /** Every button-press time within the measured window, in order. */
  readonly pressTimes: readonly number[];
  /** Times at which scored targets were destroyed, in order. */
  readonly killTimes: readonly number[];

  readonly stimulusAt: number;
  readonly resolvedAt: number;
  readonly sampleCount: number;
}

/** Speed below which movement is treated as stopped (doc 10 §10.3). */
export const STOP_SPEED_DEG_PER_SEC = 20;
/** Speed that marks the start of a deliberate movement (doc 10 §10.2). */
export const ONSET_SPEED_DEG_PER_SEC = 15;
/** Sustained duration required before an onset is accepted. */
export const ONSET_SUSTAIN_MS = 10;

const cache = new WeakMap<TrialObservation, TrialTrace>();

/**
 * Builds the trace for an observation, once.
 *
 * Memoised on the observation object, which is safe because a derivation is a pure function of
 * that object and the observation is discarded when the trial closes.
 */
export function traceFor(observation: TrialObservation): TrialTrace {
  const existing = cache.get(observation);
  if (existing !== undefined) return existing;
  const built = buildTrace(observation);
  cache.set(observation, built);
  return built;
}

function buildTrace(observation: TrialObservation): TrialTrace {
  const samples = observation.inputSamples;
  const count = samples.count;

  const target = primaryTarget(observation);
  const radiusDeg = target?.spec.angularRadiusDeg ?? null;

  const t = new Float64Array(count);
  const error = new Float64Array(count);
  const errorNorm = new Float64Array(count);
  const progress = new Float64Array(count);
  const lateral = new Float64Array(count);
  const progressRate = new Float64Array(count);
  const speed = new Float64Array(count);
  const pathLength = new Float64Array(count);

  // The initial crosshair→target direction, in the tangent plane at the trial's origin. Every
  // along/across decomposition in doc 10 is relative to this axis.
  const origin = observation.originAngles;
  const initialTargetPosition =
    target === null ? null : observation.targetManager.positionAt(target, observation.stimulusAt);

  const axis = initialTargetPosition === null ? null : unitAxis(origin, initialTargetPosition);
  const initialDistanceDeg =
    initialTargetPosition === null ? null : angularDistance(origin, initialTargetPosition);

  let firstEntryTime: number | null = null;
  let cumulativePath = 0;

  for (let i = 0; i < count; i += 1) {
    const time = samples.t[i] as number;
    const yaw = samples.yaw[i] as number;
    const pitch = samples.pitch[i] as number;
    t[i] = time;

    const crosshair: Angles = { yawDeg: yaw, pitchDeg: pitch };

    if (target !== null && radiusDeg !== null) {
      const targetPosition = observation.targetManager.positionAt(target, time);
      const distance = angularDistance(crosshair, targetPosition);
      error[i] = distance;
      errorNorm[i] = distance / radiusDeg;
      if (firstEntryTime === null && distance <= radiusDeg) firstEntryTime = time;
    }

    if (axis !== null) {
      const dYaw = yaw - origin.yawDeg;
      const dPitch = pitch - origin.pitchDeg;
      progress[i] = dYaw * axis.yaw + dPitch * axis.pitch;
      lateral[i] = -dYaw * axis.pitch + dPitch * axis.yaw;
    }

    if (i > 0) {
      const previousTime = t[i - 1] as number;
      const deltaSeconds = (time - previousTime) / 1000;
      const step = angularDistance(
        { yawDeg: samples.yaw[i - 1] as number, pitchDeg: samples.pitch[i - 1] as number },
        crosshair,
      );
      cumulativePath += step;

      if (deltaSeconds > 0) {
        speed[i] = step / deltaSeconds;
        progressRate[i] = ((progress[i] as number) - (progress[i - 1] as number)) / deltaSeconds;
      }
    }
    pathLength[i] = cumulativePath;
  }

  const pressTimes: number[] = [];
  const events = observation.events;
  for (let i = 0; i < events.count; i += 1) {
    if (events.phase[i] === 0) pressTimes.push(events.t[i] as number);
  }

  const killTimes = observation.targets
    .filter((live) => live.spec.role === "scored" && live.destroyedAt !== null)
    .map((live) => live.destroyedAt as number)
    .sort((a, b) => a - b);

  return {
    t,
    error,
    errorNorm,
    progress,
    lateral,
    progressRate,
    speed,
    pathLength,
    target,
    radiusDeg,
    initialDistanceDeg,
    firstEntryTime,
    firstPressTime: pressTimes[0] ?? null,
    pressTimes,
    killTimes,
    stimulusAt: observation.stimulusAt,
    resolvedAt: observation.resolvedAt,
    sampleCount: count,
  };
}

/** The first scored target of the trial — the one the acquisition metrics are about. */
function primaryTarget(observation: TrialObservation): LiveTarget | null {
  for (const live of observation.targets) {
    if (live.spec.role === "scored") return live;
  }
  return null;
}

/**
 * Unit vector along the crosshair→target direction, in the tangent plane at `from`.
 *
 * The tangent plane is exact enough at the distances SensLab uses (≤ 50°) and keeps *p* and *q*
 * directly interpretable as "towards the target" and "across it".
 */
function unitAxis(from: Angles, to: Angles): { yaw: number; pitch: number } | null {
  const dYaw = to.yawDeg - from.yawDeg;
  const dPitch = to.pitchDeg - from.pitchDeg;
  const length = Math.hypot(dYaw, dPitch);
  if (length === 0) return null;
  return { yaw: dYaw / length, pitch: dPitch / length };
}

/**
 * Time of the first sustained movement above the onset threshold, or null.
 *
 * "Sustained" is what separates a genuine movement start from a single noisy sample: the speed
 * must stay above the threshold for at least {@link ONSET_SUSTAIN_MS}, and the reported time is
 * when it first crossed, not when the sustain completed.
 */
export function movementOnset(trace: TrialTrace): number | null {
  let candidateStart: number | null = null;

  for (let i = 1; i < trace.sampleCount; i += 1) {
    const time = trace.t[i] as number;
    if ((trace.speed[i] as number) > ONSET_SPEED_DEG_PER_SEC) {
      if (candidateStart === null) candidateStart = time;
      if (time - candidateStart >= ONSET_SUSTAIN_MS) return candidateStart;
    } else {
      candidateStart = null;
    }
  }

  return null;
}

/** Index of the last sample at or before `time`, or -1 when the trace starts after it. */
export function indexAt(trace: TrialTrace, time: number): number {
  let found = -1;
  for (let i = 0; i < trace.sampleCount; i += 1) {
    if ((trace.t[i] as number) > time) break;
    found = i;
  }
  return found;
}
