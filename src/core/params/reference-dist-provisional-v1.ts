import type { ReferenceStatistic } from "../scoring/contracts";
import type { ParameterSet } from "./types";

/**
 * `reference_dist_provisional_v1` — the cross-player reference used for display scores only.
 *
 * ## Read this before using any number in this file
 *
 * SensLab has no population data. Every mean and standard deviation below is an **engineering
 * estimate**, not a measurement, and every one is expected to be replaced (doc 14 §14.4).
 * They exist so the product can render a 0–100 dimension score on day one, and they are
 * marked `provisional: true` so that:
 *
 *  - the UI labels those scores provisional wherever they appear (`SENS-UX-017`), and
 *  - **no percentile is shown at all** — a percentile against an invented distribution is a
 *    lie with a number attached.
 *
 * What is *not* affected by any of this: the recommendation, the ranges, the response curve,
 * the validation verdict and the aim-profile shape. All of those come from within-session
 * comparisons and are fully valid regardless of what is in this file (ADR-018). That
 * separation is why SensLab can launch honestly without population data.
 *
 * Replacing this set is a clean, versioned event: fit `reference_dist_v2` from consented
 * sessions, release it as a new version, and historical results keep rendering under the
 * version that produced them.
 */

export interface ReferenceDistributionParams {
  readonly statistics: readonly ReferenceStatistic[];
  /** True while any statistic in the set is provisional. Drives the UI labelling. */
  readonly provisional: boolean;
  /** Percentiles are suppressed entirely while the set is provisional. */
  readonly percentilesEnabled: boolean;
}

const provisional = (
  metricKey: string,
  mean: number,
  standardDeviation: number,
): ReferenceStatistic => Object.freeze({ metricKey, mean, standardDeviation, provisional: true });

export const REFERENCE_DIST_PROVISIONAL_V1: ParameterSet<ReferenceDistributionParams> =
  Object.freeze({
    kind: "reference_distribution",
    version: "reference_dist_provisional_v1",
    releasedAt: "2026-08-20",
    notes:
      "PROVISIONAL. Engineering estimates, not measurements. Display scores only, never " +
      "percentiles. Replace with a set fitted from consented sessions before claiming any " +
      "cross-player comparison.",
    params: Object.freeze({
      provisional: true,
      percentilesEnabled: false,
      statistics: Object.freeze([
        provisional("adjustedAcquisitionTime", 520, 140),
        provisional("targetAcquisitionTime", 700, 170),
        provisional("timeToTarget", 480, 130),
        provisional("firstShotAccuracy", 0.62, 0.14),
        provisional("flickErrorNorm", 0.75, 0.3),
        provisional("microAdjustmentError", 0.85, 0.32),
        provisional("overshootRate", 0.28, 0.13),
        provisional("undershootRate", 0.22, 0.12),
        provisional("correctionCount", 1.4, 0.7),
        provisional("pathEfficiency", 0.72, 0.12),
        provisional("settleTime", 210, 90),
        provisional("jitterRMS", 0.18, 0.09),
        provisional("trackingAccuracy", 0.55, 0.16),
        provisional("trackingError", 1.1, 0.4),
        provisional("trackingStability", 0.55, 0.15),
        provisional("switchingTime", 780, 200),
        provisional("switchingTravelTime", 520, 150),
        provisional("consistency", 0.72, 0.12),
      ]),
    }),
  });
