import type { MetricDerivation } from "../telemetry/metric-collector";
import { movementOnset, traceFor } from "./trace";

/**
 * The click and acquisition family (doc 10 §10.2).
 *
 * ## Why decomposition matters more than the headline number
 *
 * `targetAcquisitionTime` is the end-to-end cost of an engagement, and it is the number a player
 * intuitively cares about. It is *not* the number the calibration engine should optimise,
 * because it contains a large sensitivity-independent term: the player's own reaction floor.
 *
 * ```
 *   acquisition = onset + ballistic + correction + trigger
 * ```
 *
 * Only the middle two respond to sensitivity. `adjustedAcquisitionTime` removes the onset term,
 * which is why it — and not raw acquisition — is the decision metric (doc 10 §10.9). A player
 * whose acquisition is slow because their *onset* is slow is telling us nothing about
 * sensitivity; a player whose *correction* time differs between candidates is telling us a
 * great deal.
 */

/** A rate metric's per-trial value: 1 for a success, 0 for a failure (doc 10 §10.7). */
const indicator = (success: boolean): number => (success ? 1 : 0);

export const reactionTime: MetricDerivation = {
  key: "reactionTime",
  derive(observation) {
    // t₀ is the presentation frame's timestamp, which is what `stimulusAt` is: the trial
    // presents its target inside the frame callback that will paint it.
    const press = traceFor(observation).firstPressTime;
    return press === null ? null : press - observation.stimulusAt;
  },
};

export const movementOnsetTime: MetricDerivation = {
  key: "movementOnsetTime",
  derive(observation) {
    const onset = movementOnset(traceFor(observation));
    return onset === null ? null : onset - observation.stimulusAt;
  },
};

export const timeToTarget: MetricDerivation = {
  key: "timeToTarget",
  derive(observation) {
    // Deliberately independent of shooting: this is movement performance with trigger
    // discipline stripped out.
    const entry = traceFor(observation).firstEntryTime;
    return entry === null ? null : entry - observation.stimulusAt;
  },
};

export const targetAcquisitionTime: MetricDerivation = {
  key: "targetAcquisitionTime",
  derive(observation) {
    // Only a trial that ended in a hit has an acquisition time. A miss has no moment of
    // acquisition, and substituting the timeout would report the clock rather than the player.
    if (observation.hit !== true) return null;
    const trace = traceFor(observation);
    const killAt = trace.killTimes[trace.killTimes.length - 1];
    return (killAt ?? observation.resolvedAt) - observation.stimulusAt;
  },
};

export const adjustedAcquisitionTime: MetricDerivation = {
  key: "adjustedAcquisitionTime",
  derive(observation) {
    if (observation.hit !== true) return null;
    const trace = traceFor(observation);
    const onset = movementOnset(trace);
    if (onset === null) return null;

    const killAt = trace.killTimes[trace.killTimes.length - 1] ?? observation.resolvedAt;
    const adjusted = killAt - onset;
    // A negative value would mean the hit preceded the movement that produced it. That is not
    // a fast trial, it is a broken measurement, and reporting it as 0 would flatter it.
    return adjusted >= 0 ? adjusted : null;
  },
};

export const firstShotAccuracy: MetricDerivation = {
  key: "firstShotAccuracy",
  derive(observation) {
    // Null rather than 0 when no shot was fired: "did not shoot" is not "shot and missed", and
    // a proportion that counted it as a miss would punish a timeout twice.
    return observation.firstShotHit === null ? null : indicator(observation.firstShotHit);
  },
};

export const hitAccuracy: MetricDerivation = {
  key: "hitAccuracy",
  derive(observation) {
    if (observation.shots === 0) return null;
    // Per trial this is hits/shots for that trial; the round aggregate pools it by shot count
    // so the round value is total hits / total shots, as doc 10 §10.5 defines it.
    const hits = traceFor(observation).killTimes.length;
    return hits / observation.shots;
  },
};

export const prematureClickRate: MetricDerivation = {
  key: "prematureClickRate",
  derive(observation) {
    // The trial is already invalid when this is true (doc 09 §9.1); the metric exists so the
    // rate is visible in the session report rather than only in the invalid count.
    const press = traceFor(observation).firstPressTime;
    if (press === null) return 0;
    return indicator(press - observation.stimulusAt < HUMAN_REACTION_FLOOR_MS);
  },
};

/** Below this, a "reaction" is anticipation rather than response (doc 09 §9.1). */
export const HUMAN_REACTION_FLOOR_MS = 80;

export const qualityScore: MetricDerivation = {
  key: "qualityScore",
  derive: (observation) => observation.quality.cleanFrameFraction,
};

export const ACQUISITION_DERIVATIONS: readonly MetricDerivation[] = [
  reactionTime,
  movementOnsetTime,
  timeToTarget,
  targetAcquisitionTime,
  adjustedAcquisitionTime,
  firstShotAccuracy,
  hitAccuracy,
  prematureClickRate,
  qualityScore,
];
