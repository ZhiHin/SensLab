import type { ReferenceStatistic } from "../scoring/contracts";
import type { ParameterSet } from "./types";
import {
  REFERENCE_DIST_PROVISIONAL_V1,
  type ReferenceDistributionParams,
} from "./reference-dist-provisional-v1";

/**
 * `reference_dist_provisional_v2` — v1 plus the post-MVP decision metrics.
 *
 * Everything said at the top of v1 applies with equal force: these are **engineering
 * estimates, not measurements**, they drive display scores only, and no percentile is shown
 * against them. The new entries are needed so that a dimension drawing on a post-MVP metric
 * is not unscorable for display, and they are exactly as provisional as the rest.
 */

const provisional = (
  metricKey: string,
  mean: number,
  standardDeviation: number,
): ReferenceStatistic => Object.freeze({ metricKey, mean, standardDeviation, provisional: true });

export const REFERENCE_DIST_PROVISIONAL_V2: ParameterSet<ReferenceDistributionParams> =
  Object.freeze({
    kind: "reference_distribution",
    version: "reference_dist_provisional_v2",
    releasedAt: "2026-08-23",
    notes:
      "PROVISIONAL. v1 plus estimates for the Phase 6 decision metrics. Engineering estimates, " +
      "not measurements. Display scores only, never percentiles.",
    params: Object.freeze({
      provisional: true,
      percentilesEnabled: false,
      statistics: Object.freeze([
        ...REFERENCE_DIST_PROVISIONAL_V1.params.statistics,
        provisional("reversalRecoveryTime", 320, 130),
        provisional("peakSpeedTrackingError", 1.4, 0.5),
        provisional("recoilDeviationVertical", 1.8, 0.7),
        provisional("stabilityUnderRecoil", 0.5, 0.15),
      ]),
    }),
  });
