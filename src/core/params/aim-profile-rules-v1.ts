import type { DimensionKey } from "../types/vocabulary";
import type { ParameterSet } from "./types";

/**
 * `aim_profile_rules_v1` — the deterministic aim-profile classifier (doc 16 §16.5).
 *
 * Rules over measured dimension shape, evaluated in order, first match wins. No randomness,
 * no personality-quiz mapping. The classifier operates on *shape* — each dimension relative
 * to the player's own mean, in their own spread units — so the profile describes what kind of
 * aimer someone is, not how good they are. A beginner and an expert with the same relative
 * strengths get the same profile, which is correct.
 */

export type AimProfileKey =
  | "provisional"
  | "balanced"
  | "tracking-focused"
  | "precision-focused"
  | "fast-flick"
  | "low-sensitivity-control"
  | "high-mobility"
  | "hybrid";

export type SensitivityBand = "high" | "mid" | "low";

export interface AimProfileParams {
  /**
   * Band thresholds in cm/360. Conventional community bands used as descriptive labels only —
   * they carry no claim about what is good.
   */
  readonly bandThresholdsCmPer360: { readonly highBelow: number; readonly lowAbove: number };

  /** Floor on the player's own dimension spread, preventing divide-by-noise on flat profiles. */
  readonly shapeSpreadFloor: number;

  /** |shape| below which no dimension is considered to stand out at all. */
  readonly flatShapeThreshold: number;

  /** Margin by which a leading dimension must exceed the runner-up to claim a focus profile. */
  readonly leadMargin: number;

  /** |shape| at or beyond which a dimension counts as a strength or an improvement area. */
  readonly notableShapeThreshold: number;

  /** Minimum dimensions with sufficient samples before a profile may be assigned at all. */
  readonly minimumScoredDimensions: number;

  readonly maxStrengths: number;
  readonly maxImprovementAreas: number;

  /** Display name per (profile, band). Retunable without touching the classifier. */
  readonly displayNames: Readonly<Record<string, string>>;

  /** Canonical dimension ordering used when breaking presentation ties. */
  readonly dimensionOrder: readonly DimensionKey[];
}

export const AIM_PROFILE_RULES_V1: ParameterSet<AimProfileParams> = Object.freeze({
  kind: "aim_profile",
  version: "aim_profile_rules_v1",
  releasedAt: "2026-08-20",
  notes:
    "Initial release. Band thresholds are conventional community bands, used as labels only. " +
    "The classifier itself is a pure function with a fixture table covering every rule.",
  params: Object.freeze({
    bandThresholdsCmPer360: Object.freeze({ highBelow: 20, lowAbove: 40 }),
    shapeSpreadFloor: 3,
    flatShapeThreshold: 0.6,
    leadMargin: 0.5,
    notableShapeThreshold: 0.5,
    minimumScoredDimensions: 4,
    maxStrengths: 3,
    maxImprovementAreas: 2,
    displayNames: Object.freeze({
      "provisional:high": "Provisional",
      "provisional:mid": "Provisional",
      "provisional:low": "Provisional",
      "balanced:high": "Balanced (High Sens)",
      "balanced:mid": "Balanced",
      "balanced:low": "Balanced (Low Sens)",
      "tracking-focused:high": "Tracking Focused",
      "tracking-focused:mid": "Tracking Focused",
      "tracking-focused:low": "Tracking Focused",
      "precision-focused:high": "Precision Focused",
      "precision-focused:mid": "Balanced Precision",
      "precision-focused:low": "Precision Focused",
      "fast-flick:high": "Fast Flick",
      "fast-flick:mid": "Fast Flick",
      "fast-flick:low": "Fast Flick",
      "low-sensitivity-control:high": "Control",
      "low-sensitivity-control:mid": "Control",
      "low-sensitivity-control:low": "Low-Sensitivity Control",
      "high-mobility:high": "High Mobility",
      "high-mobility:mid": "High Mobility",
      "high-mobility:low": "High Mobility",
      "hybrid:high": "Hybrid",
      "hybrid:mid": "Hybrid",
      "hybrid:low": "Hybrid",
    }),
    dimensionOrder: Object.freeze([
      "flick",
      "precision",
      "tracking",
      "speed",
      "control",
      "consistency",
    ] as const),
  }),
});
