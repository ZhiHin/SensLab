import type { MetricDerivation, TrialObservation } from "../telemetry/metric-collector";
import { movementOnset, traceFor } from "./trace";

/**
 * The ADS tags (doc 09 §9.13).
 *
 * Both are ordinary metrics restricted to trials that ran under a scoped view. The restriction
 * is what gives them meaning: a round of the ADS test alternates scoped trials with hipfire
 * controls, and a transition cost is only a transition cost on the trials that transitioned.
 * On a control trial both return null — not zero — so the aggregate is over scoped trials only.
 */

function scoped(observation: TrialObservation): boolean {
  return observation.view !== null;
}

/**
 * Movement onset measured from the moment the view zoomed.
 *
 * The measured window opens when the reset target is cleared, which is the instant the view
 * switches, so onset relative to the stimulus *is* the re-orientation cost of the transition.
 */
export const adsTransitionTime: MetricDerivation = {
  key: "adsTransitionTime",
  derive(observation) {
    if (!scoped(observation)) return null;
    const trace = traceFor(observation);
    const onset = movementOnset(trace);
    return onset === null ? null : onset - trace.stimulusAt;
  },
};

export const adsFirstShotAccuracy: MetricDerivation = {
  key: "adsFirstShotAccuracy",
  derive(observation) {
    if (!scoped(observation)) return null;
    if (observation.firstShotHit === null) return null;
    return observation.firstShotHit ? 1 : 0;
  },
};

export const ADS_DERIVATIONS: readonly MetricDerivation[] = [
  adsTransitionTime,
  adsFirstShotAccuracy,
];
