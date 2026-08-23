import { createMetricCollector, type MetricCollector } from "../telemetry/metric-collector";
import { ACQUISITION_DERIVATIONS } from "./acquisition";
import { ADS_DERIVATIONS } from "./ads";
import { COMFORT_DERIVATIONS } from "./comfort";
import { LIFT_DERIVATIONS } from "./lift";
import { MOTION_TRACKING_DERIVATIONS } from "./motion-tracking";
import { PLACEMENT_DERIVATIONS } from "./placement";
import { RECOIL_DERIVATIONS } from "./recoil";
import { SWITCHING_DERIVATIONS } from "./switching";
import { TRACKING_DERIVATIONS } from "./tracking";

/**
 * The standard metric collector (doc 10).
 *
 * Every derivation SensLab computes, registered in one place. A test declares which keys it
 * wants; the collector runs only those, so a tracking metric is never computed on a flick trial
 * and never appears in its record.
 */

export * from "./acquisition";
export * from "./ads";
export * from "./aggregate";
export * from "./comfort";
export * from "./lift";
export * from "./motion-tracking";
export * from "./placement";
export * from "./recoil";
export * from "./switching";
export * from "./trace";
export * from "./tracking";

export const ALL_DERIVATIONS = [
  ...ACQUISITION_DERIVATIONS,
  ...PLACEMENT_DERIVATIONS,
  ...TRACKING_DERIVATIONS,
  ...SWITCHING_DERIVATIONS,
  ...COMFORT_DERIVATIONS,
  ...MOTION_TRACKING_DERIVATIONS,
  ...RECOIL_DERIVATIONS,
  ...LIFT_DERIVATIONS,
  ...ADS_DERIVATIONS,
];

export function createStandardCollector(): MetricCollector {
  const collector = createMetricCollector();
  for (const derivation of ALL_DERIVATIONS) collector.register(derivation);
  return collector;
}
