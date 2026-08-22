import type { MotionPattern, TargetSpec, TrialQuality } from "@/test-engine/contracts";
import type { TrialObservation } from "@/test-engine/telemetry/metric-collector";
import { createTargetManager, type LiveTarget } from "@/test-engine/targets/target-manager";
import { createTelemetryBuffers } from "@/test-engine/telemetry/ring-buffer";

/**
 * Builds a trial observation from a hand-written movement trace.
 *
 * This is how doc 10's metric definitions become testable. Each definition is a formula over
 * ε(t), p(t) and the event stream; feeding a trace whose answer is known by hand is the only
 * way to show the implementation computes *that* formula rather than a plausible neighbour —
 * and a plausible neighbour is exactly what a metric bug looks like, because nothing crashes
 * and every number stays in range.
 *
 * The target manager and the telemetry buffers are the **real** ones. Only the player is
 * synthetic.
 */

export interface TracePoint {
  readonly t: number;
  readonly yawDeg: number;
  readonly pitchDeg: number;
}

export interface ObservationOptions {
  /** Where the target sits, as an offset from the trial's origin orientation. */
  readonly target?: { readonly yawDeg: number; readonly pitchDeg: number };
  readonly radiusDeg?: number;
  readonly motion?: MotionPattern;
  /** Extra targets, for switching sequences. Destroyed in the order given by `killAt`. */
  readonly extraTargets?: readonly {
    readonly yawDeg: number;
    readonly pitchDeg: number;
    readonly radiusDeg?: number;
    readonly spawnedAt?: number;
    readonly killAt: number;
  }[];
  /** Crosshair samples, in order. */
  readonly path: readonly TracePoint[];
  readonly presses?: readonly number[];
  readonly releases?: readonly number[];
  readonly stimulusAt?: number;
  readonly resolvedAt?: number;
  /** When the primary target was destroyed, if it was. */
  readonly killAt?: number;
  readonly variant?: string | null;
  readonly hit?: boolean | null;
  readonly firstShotHit?: boolean | null;
  readonly shots?: number;
  readonly quality?: Partial<TrialQuality>;
  readonly origin?: { readonly yawDeg: number; readonly pitchDeg: number };
}

export interface ObservationFixture {
  readonly observation: TrialObservation;
  readonly target: LiveTarget | null;
  readonly targets: readonly LiveTarget[];
}

export function buildObservation(options: ObservationOptions): ObservationFixture {
  const origin = options.origin ?? { yawDeg: 0, pitchDeg: 0 };
  const stimulusAt = options.stimulusAt ?? 1000;
  const path = options.path;
  const resolvedAt = options.resolvedAt ?? path[path.length - 1]?.t ?? stimulusAt;

  const manager = createTargetManager();
  const spawned: LiveTarget[] = [];

  let primary: LiveTarget | null = null;
  if (options.target !== undefined) {
    const spec: TargetSpec = {
      yawDeg: options.target.yawDeg,
      pitchDeg: options.target.pitchDeg,
      angularRadiusDeg: options.radiusDeg ?? 2,
      role: "scored",
    };
    primary = manager.spawn(spec, options.motion ?? { kind: "static" }, stimulusAt, origin);
    spawned.push(primary);
    if (options.killAt !== undefined) manager.destroy(primary, options.killAt);
  }

  for (const extra of options.extraTargets ?? []) {
    const target = manager.spawn(
      {
        yawDeg: extra.yawDeg,
        pitchDeg: extra.pitchDeg,
        angularRadiusDeg: extra.radiusDeg ?? 2,
        role: "scored",
      },
      { kind: "static" },
      extra.spawnedAt ?? stimulusAt,
      origin,
    );
    spawned.push(target);
    manager.destroy(target, extra.killAt);
  }

  const buffers = createTelemetryBuffers({
    inputCapacity: Math.max(256, path.length + 16),
    frameCapacity: 256,
    eventCapacity: Math.max(
      64,
      (options.presses?.length ?? 0) + (options.releases?.length ?? 0) + 8,
    ),
  });

  for (const point of path) buffers.recordInput(point.t, point.yawDeg, point.pitchDeg);

  // Events are recorded in timestamp order, as the browser would deliver them.
  const events = [
    ...(options.presses ?? []).map((t) => ({ t, phase: 0 as const })),
    ...(options.releases ?? []).map((t) => ({ t, phase: 1 as const })),
  ].sort((a, b) => a.t - b.t);
  for (const event of events) buffers.recordEvent(event.t, event.phase, 0);

  const observation: TrialObservation = {
    trialIndex: 0,
    isPractice: false,
    variant: options.variant ?? null,
    stimulusAt,
    resolvedAt,
    inputSamples: buffers.input(),
    frameSamples: buffers.frames(),
    events: buffers.events(),
    originAngles: origin,
    targets: spawned,
    targetManager: manager,
    shots: options.shots ?? options.presses?.length ?? 0,
    hit: options.hit ?? (options.killAt !== undefined ? true : null),
    firstShotHit: options.firstShotHit ?? null,
    quality: {
      cleanFrameFraction: 1,
      hitchCount: 0,
      bufferOverflow: false,
      ...options.quality,
    },
  };

  return { observation, target: primary, targets: spawned };
}

/**
 * A straight-line approach from the origin to a point, sampled at a fixed rate.
 *
 * Constant velocity, so the analytic answers — path length, progress, time to target — are all
 * computable by hand.
 */
export function straightPath(options: {
  readonly from?: { readonly yawDeg: number; readonly pitchDeg: number };
  readonly to: { readonly yawDeg: number; readonly pitchDeg: number };
  readonly startAt: number;
  readonly durationMs: number;
  readonly stepMs?: number;
}): TracePoint[] {
  const from = options.from ?? { yawDeg: 0, pitchDeg: 0 };
  const step = options.stepMs ?? 1;
  const points: TracePoint[] = [];

  for (let elapsed = 0; elapsed <= options.durationMs; elapsed += step) {
    const fraction = options.durationMs === 0 ? 1 : elapsed / options.durationMs;
    points.push({
      t: options.startAt + elapsed,
      yawDeg: from.yawDeg + (options.to.yawDeg - from.yawDeg) * fraction,
      pitchDeg: from.pitchDeg + (options.to.pitchDeg - from.pitchDeg) * fraction,
    });
  }

  return points;
}

/** Holds the crosshair still at `at` for a duration, sampled at a fixed rate. */
export function holdPath(options: {
  readonly at: { readonly yawDeg: number; readonly pitchDeg: number };
  readonly startAt: number;
  readonly durationMs: number;
  readonly stepMs?: number;
  /** Optional per-sample wobble, applied to yaw as ±amplitude alternating. */
  readonly jitterDeg?: number;
}): TracePoint[] {
  const step = options.stepMs ?? 1;
  const points: TracePoint[] = [];
  const jitter = options.jitterDeg ?? 0;

  for (let elapsed = 0, i = 0; elapsed <= options.durationMs; elapsed += step, i += 1) {
    points.push({
      t: options.startAt + elapsed,
      yawDeg: options.at.yawDeg + (i % 2 === 0 ? jitter : -jitter),
      pitchDeg: options.at.pitchDeg,
    });
  }

  return points;
}

/** Concatenates path segments, dropping a duplicated joint sample. */
export function joinPaths(...segments: readonly TracePoint[][]): TracePoint[] {
  const out: TracePoint[] = [];
  for (const segment of segments) {
    for (const point of segment) {
      if (out[out.length - 1]?.t === point.t) continue;
      out.push(point);
    }
  }
  return out;
}
