import { angularDistance } from "../core/geometry/angular";
import { aggregateRound } from "./metrics/aggregate";
import { deriveRng } from "../core/random";
import type { InvalidReason } from "../core/types/vocabulary";
import type {
  PlannedRound,
  RoundAggregate,
  TestDefinition,
  TrialIdentity,
  TrialRecord,
} from "./contracts";
import {
  createMetricCollector,
  toTrialRecord,
  type MetricCollector,
  type TrialObservation,
} from "./telemetry/metric-collector";
import {
  createTrialRunner,
  type TrialDependencies,
  type TrialOutcome,
  type TrialRunner,
} from "./trial-manager";

/**
 * Runs the trial sequence for one round, including replacement (doc 19 §19.2).
 *
 * Split out of `trial-manager.ts`, which doc 19's module list nominally owns, purely for file
 * size — the trial state machine is already at the reviewable limit and the round loop is a
 * separate concern with separate tests. Recorded as a deviation in the Phase 2 report.
 *
 * ## Replacement, and why it is bounded
 *
 * A trial invalidated for a *procedural* reason — a lost pointer lock, a hidden tab, a frame
 * hitch — is replaced so the round still reaches its sample target (FR-060). It is never
 * discarded: the invalid trial is kept, counted and surfaced (`SENS-BR-009`).
 *
 * The replacement allowance is capped. Without a cap, a machine that hitches every second
 * would extend a round indefinitely, and the player would be asked to keep aiming until the
 * environment happened to behave — which is both cruel and pointless, since the resulting data
 * would be flagged anyway. On exhaustion the round ends short and says so.
 */

export const REPLACEMENT_ALLOWANCE = 0.25;

export interface RoundRunnerOptions {
  readonly round: PlannedRound;
  readonly definition: TestDefinition;
  readonly deps: TrialDependencies;
  readonly sessionSeed: string;
  readonly scopeKey: PlannedRound["scopeKey"];
  readonly mode: TrialIdentity["mode"];
  readonly collector?: MetricCollector;
  /** Engine time at which the round began. Trial offsets are relative to it. */
  readonly startedAt: number;
  readonly startedAtWallClock: string;
}

export interface RoundProgress {
  readonly completedTrials: number;
  readonly targetTrials: number;
  readonly validTrials: number;
  readonly invalidTrials: number;
  readonly replacementsUsed: number;
  readonly replacementsRemaining: number;
}

export interface RoundRunner {
  /** Advances the round. Returns the finished aggregate once complete, else null. */
  tick(now: number): RoundAggregate | null;
  onMove(t: number, dx: number, dy: number): void;
  onButton(t: number, phase: "down" | "up", button: number): void;
  /** Ends the round early, invalidating the open trial. */
  abort(now: number, reason: InvalidReason): RoundAggregate;
  /**
   * Closes the open trial as invalid and leaves the round open (doc 19 §19.3).
   *
   * This is what a pause does. The round survives it, so a player who alt-tabs three trials
   * into a round returns to that round rather than losing it.
   */
  invalidateOpenTrial(now: number, reason: InvalidReason): void;
  progress(): RoundProgress;
  readonly finished: boolean;
  /** The trial currently open, for the renderer. */
  readonly activeTrial: TrialRunner | null;
}

export function createRoundRunner(options: RoundRunnerOptions): RoundRunner {
  const { round, definition, deps, sessionSeed, startedAt } = options;
  const collector = options.collector ?? createMetricCollector();

  const targetTrials = round.trialCount;
  const maxReplacements = Math.floor(targetTrials * REPLACEMENT_ALLOWANCE);

  const records: TrialRecord[] = [];
  let trialIndex = 0;
  let replacementsUsed = 0;
  let nextIsReplacement = false;
  let current: TrialRunner | null = null;
  let currentSeedKey = "";
  let currentIsReplacement = false;
  let finished = false;
  let aggregate: RoundAggregate | null = null;

  const stimulusSeedFor = (index: number): string => `${round.stimulusSeed}:${index}`;

  const beginTrial = (now: number): void => {
    // Two independent streams: the stimulus must be reproducible and matched across candidates
    // (doc 13 §13.6), while the inter-trial jitter must not be. Deriving them separately means
    // changing one cannot shift the other (doc 19 §19.8).
    const stimulusRng = deriveRng(sessionSeed, "target-placement", round.roundIndex, trialIndex);
    const timingRng = deriveRng(
      `${sessionSeed}:${round.presentationOrder}`,
      "timing-jitter",
      round.roundIndex,
      trialIndex,
    );

    const interval = timingRng.nextRange(
      definition.interTrialIntervalMs.min,
      definition.interTrialIntervalMs.max,
    );

    const context: TrialIdentity = {
      trialIndex,
      isPractice: round.isPractice,
      scopeKey: options.scopeKey,
      mode: options.mode,
    };

    currentSeedKey = stimulusSeedFor(trialIndex);
    currentIsReplacement = nextIsReplacement;
    nextIsReplacement = false;

    deps.targets.reset();
    current = createTrialRunner({
      definition,
      context,
      rng: stimulusRng,
      deps,
      startedAt: now,
      interTrialIntervalMs: interval,
    });
  };

  const recordOutcome = (outcome: TrialOutcome): void => {
    const primary = outcome.primaryTarget;

    // Built once and shared: the derivations and the record must describe the same trial, and
    // two separately-constructed observations are two chances for them to drift apart.
    const observation: TrialObservation = {
      trialIndex,
      isPractice: round.isPractice,
      variant: outcome.variant,
      stimulusAt: outcome.stimulusAt,
      resolvedAt: outcome.resolvedAt,
      inputSamples: deps.buffers.input(),
      frameSamples: deps.buffers.frames(),
      events: deps.buffers.events(),
      originAngles: outcome.originAngles,
      targets: outcome.targets,
      targetManager: deps.targets,
      shots: outcome.shots,
      hit: outcome.hit,
      firstShotHit: outcome.firstShotHit,
      quality: {
        cleanFrameFraction: outcome.frameStats.cleanFrameFraction,
        hitchCount: outcome.frameStats.hitches,
        bufferOverflow: deps.buffers.overflowed,
      },
    };

    const metrics = collector.collect(observation, definition.metricKeys);

    records.push(
      toTrialRecord(observation, metrics, {
        validity: outcome.validity,
        invalidReason: outcome.invalidReason,
        isReplacement: currentIsReplacement,
        startOffsetMs: outcome.stimulusAt - startedAt,
        stimulusSeed: currentSeedKey,
        variant: outcome.variant,
        qualityFlags: outcome.qualityFlags,
        targetAngularRadiusDeg: primary?.spec.angularRadiusDeg ?? null,
        // The spec is an offset from the trial's origin orientation, so the declared distance
        // is the great-circle angle between the two — not a planar hypotenuse of the offset,
        // which drifts from the truth as pitch grows.
        targetDistanceDeg:
          primary === null ? null : angularDistance(outcome.originAngles, primary.origin),
        targetDirectionDeg:
          primary === null ? null : directionOf(primary.spec.yawDeg, primary.spec.pitchDeg),
      }),
    );

    // Only procedural invalidity earns a replacement, and only while the allowance lasts.
    if (outcome.validity === "invalid" && replacementsUsed < maxReplacements) {
      replacementsUsed += 1;
      nextIsReplacement = true;
    } else {
      trialIndex += 1;
    }
  };

  const buildAggregate = (now: number): RoundAggregate => {
    const lateFrameRatio = 1 - deps.frames.sessionStats().cleanFrameFraction;

    return {
      presentationOrder: round.presentationOrder,
      blockIndex: round.blockIndex,
      roundIndex: round.roundIndex,
      candidateIndex: round.candidateIndex,
      testKey: round.testKey,
      scopeKey: round.scopeKey,
      isPractice: round.isPractice,
      startedAt: options.startedAtWallClock,
      completedAt: new Date(
        Date.parse(options.startedAtWallClock) + (now - startedAt),
      ).toISOString(),
      trials: records,
      roundMetrics: aggregateRound(records, {
        seed: sessionSeed,
        roundIndex: round.roundIndex,
        ...(definition.primaryMetricKey === undefined
          ? {}
          : { primaryMetricKey: definition.primaryMetricKey }),
      }),
      qualitySummary: {
        lateFrameRatio,
        hitchCount: deps.frames.sessionStats().hitches,
        lockLossCount: deps.quality.lockLossCount,
      },
    };
  };

  return {
    get finished() {
      return finished;
    },
    get activeTrial() {
      return current;
    },

    progress(): RoundProgress {
      const valid = records.filter((record) => record.validity !== "invalid").length;
      return {
        completedTrials: records.length,
        targetTrials,
        validTrials: valid,
        invalidTrials: records.length - valid,
        replacementsUsed,
        replacementsRemaining: maxReplacements - replacementsUsed,
      };
    },

    tick(now: number): RoundAggregate | null {
      if (finished) return aggregate;

      if (current === null) {
        if (trialIndex >= targetTrials) {
          finished = true;
          aggregate = buildAggregate(now);
          return aggregate;
        }
        beginTrial(now);
      }

      const outcome = current?.tick(now) ?? null;
      if (outcome !== null) {
        recordOutcome(outcome);
        current = null;
      }

      if (trialIndex >= targetTrials && current === null) {
        finished = true;
        aggregate = buildAggregate(now);
        return aggregate;
      }

      return null;
    },

    onMove(t, dx, dy): void {
      current?.onMove(t, dx, dy);
    },

    onButton(t, phase, button): void {
      current?.onButton(t, phase, button);
    },

    invalidateOpenTrial(now, reason): void {
      if (current === null || finished) return;

      if (current.phase === "armed") {
        // The stimulus never appeared, so nothing was measured. Recording a row here would add
        // a trial that describes nothing and spend replacement allowance that a genuine fault
        // is going to need.
        current = null;
        return;
      }

      if (current.phase !== "resolved") {
        recordOutcome(current.abort(now, reason));
        current = null;
      }
    },

    abort(now, reason): RoundAggregate {
      if (aggregate !== null) return aggregate;
      if (current !== null && current.phase !== "resolved") {
        recordOutcome(current.abort(now, reason));
        current = null;
      }
      finished = true;
      aggregate = buildAggregate(now);
      return aggregate;
    },
  };
}

/** Direction of a declared offset, in degrees clockwise from screen-right. */
function directionOf(yawOffsetDeg: number, pitchOffsetDeg: number): number {
  const degrees = (Math.atan2(pitchOffsetDeg, yawOffsetDeg) * 180) / Math.PI;
  return ((degrees % 360) + 360) % 360;
}
