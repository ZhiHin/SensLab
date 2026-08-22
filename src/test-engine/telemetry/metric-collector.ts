import type { Angles } from "../../core/geometry/angular";
import type { TrialQuality, TrialRecord } from "../contracts";
import type { LiveTarget, TargetManager } from "../targets/target-manager";
import type { EventView, SampleView } from "./ring-buffer";

/**
 * The metric derivation seam (doc 19 §19.2, doc 10).
 *
 * **Phase 2 provides the framework and registers no derivations.** The metrics themselves —
 * acquisition time, flick error, overshoot, path efficiency, tracking accuracy — are Phase 3,
 * because each one is a specification in doc 10 that deserves its own tests against a known
 * movement trace rather than being written alongside the machinery that will run it.
 *
 * What is fixed here is the contract: a derivation is a **pure function of the trial's
 * observations**, run once, after the trial has closed, in the inter-trial interval. Two
 * properties follow from that and both matter:
 *
 *  - Derivation never runs inside the frame loop, so it cannot cost a frame (doc 30 §30.2).
 *  - A derivation cannot influence what was recorded, only summarise it — which is what keeps
 *    validity classification and measurement separable (`SENS-BR-009`).
 */

/** Everything a derivation may look at. Deliberately read-only. */
export interface TrialObservation {
  readonly trialIndex: number;
  readonly isPractice: boolean;
  /**
   * What this trial presented, where the test has more than one kind of trial.
   *
   * Supplied so a derivation never has to infer the task from the trial index — the comfort
   * test's three sub-tasks measure genuinely different things, and a derivation that guessed
   * wrong would produce a confident number for the wrong quantity.
   */
  readonly variant: string | null;
  /** Engine time at which the stimulus was presented. */
  readonly stimulusAt: number;
  /** Engine time at which the trial resolved. */
  readonly resolvedAt: number;
  /** Camera samples driven by input, at full polling rate. */
  readonly inputSamples: SampleView;
  /** Camera samples at rendered frames. */
  readonly frameSamples: SampleView;
  /** Button presses and releases. */
  readonly events: EventView;
  /** Camera orientation when the stimulus appeared. */
  readonly originAngles: Angles;
  readonly targets: readonly LiveTarget[];
  readonly targetManager: TargetManager;
  /** Shots taken, and whether the trial ended in a hit. */
  readonly shots: number;
  readonly hit: boolean | null;
  /** Whether the trial's first button press was a hit. Null when no shot was fired. */
  readonly firstShotHit: boolean | null;
  readonly quality: TrialQuality;
}

/**
 * A single metric derivation.
 *
 * Returning `null` means "not applicable to this trial" — a tracking metric on a flick trial,
 * or a metric whose preconditions were not met. That is different from returning zero, and the
 * distinction is load-bearing: a missing value must not be aggregated as a good one.
 */
export interface MetricDerivation {
  readonly key: string;
  derive(observation: TrialObservation): number | null;
}

export interface MetricCollector {
  register(derivation: MetricDerivation): void;
  /** Registered derivation keys, sorted. */
  keys(): readonly string[];
  /** Runs every registered derivation whose key the test declared. */
  collect(
    observation: TrialObservation,
    declaredKeys: readonly string[],
  ): Readonly<Record<string, number>>;
}

export class DuplicateDerivationError extends Error {
  constructor(key: string) {
    super(`a derivation for metric "${key}" is already registered`);
    this.name = "DuplicateDerivationError";
  }
}

export function createMetricCollector(): MetricCollector {
  const derivations = new Map<string, MetricDerivation>();

  return {
    register(derivation: MetricDerivation): void {
      if (derivations.has(derivation.key)) throw new DuplicateDerivationError(derivation.key);
      derivations.set(derivation.key, derivation);
    },

    keys(): readonly string[] {
      return [...derivations.keys()].sort();
    },

    collect(observation, declaredKeys): Readonly<Record<string, number>> {
      const out: Record<string, number> = {};

      for (const key of declaredKeys) {
        const derivation = derivations.get(key);
        // A declared metric with no registered derivation is silently absent rather than an
        // error: Phase 2 ships zero derivations by design, and a test definition that names a
        // Phase 3 metric must still be runnable today.
        if (derivation === undefined) continue;

        const value = derivation.derive(observation);
        // Non-finite results are dropped rather than stored. A NaN in a metric column would
        // propagate through every aggregate that touched it.
        if (value !== null && Number.isFinite(value)) out[key] = value;
      }

      return out;
    },
  };
}

/** Assembles the persisted trial record from an observation and its derived metrics. */
export function toTrialRecord(
  observation: TrialObservation,
  metrics: Readonly<Record<string, number>>,
  fields: Pick<
    TrialRecord,
    | "validity"
    | "invalidReason"
    | "isReplacement"
    | "startOffsetMs"
    | "stimulusSeed"
    | "variant"
    | "qualityFlags"
    | "targetAngularRadiusDeg"
    | "targetDistanceDeg"
    | "targetDirectionDeg"
  >,
): TrialRecord {
  return {
    trialIndex: observation.trialIndex,
    isPractice: observation.isPractice,
    validity: fields.validity,
    invalidReason: fields.invalidReason,
    isReplacement: fields.isReplacement,
    startOffsetMs: fields.startOffsetMs,
    durationMs: observation.resolvedAt - observation.stimulusAt,
    hit: observation.hit,
    shots: observation.shots,
    targetAngularRadiusDeg: fields.targetAngularRadiusDeg,
    targetDistanceDeg: fields.targetDistanceDeg,
    targetDirectionDeg: fields.targetDirectionDeg,
    stimulusSeed: fields.stimulusSeed,
    variant: fields.variant,
    qualityFlags: fields.qualityFlags,
    quality: observation.quality,
    metrics,
  };
}
