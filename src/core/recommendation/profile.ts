import type {
  AimProfileKey,
  AimProfileParams,
  SensitivityBand,
} from "../params/aim-profile-rules-v1";
import type { DimensionKey } from "../types/vocabulary";
import type { DimensionOutcome } from "./dimensions";

/**
 * The aim-profile classifier (doc 16 §16.5) and the strengths / improvement areas (§16.6).
 *
 * Deterministic rules over the six dimension *shapes* and the recommended sensitivity band,
 * evaluated in a fixed order, first match wins. No randomness and no personality-quiz mapping
 * (FR-076, `SENS-BR-002` in spirit). The table in doc 16 is the specification; the fixture
 * suite covers every rule including the fallthrough.
 *
 * The generated explanation cites the actual numbers that fired the rule, names the rule in
 * plain language, and describes what the measurement showed — never the player as a person,
 * and never with a weakness as a punchline (`SENS-BR-036`).
 */

export interface ProfileClassification {
  readonly key: AimProfileKey;
  readonly band: SensitivityBand;
  readonly displayName: string;
  /** Which rule fired, 0–8 as numbered in doc 16 §16.5. */
  readonly rule: number;
  /** The dimensions and values the rule was decided on. */
  readonly evidence: readonly {
    readonly dimension: DimensionKey;
    readonly score: number;
    readonly shape: number;
  }[];
}

export function sensitivityBand(cmPer360: number, params: AimProfileParams): SensitivityBand {
  if (cmPer360 < params.bandThresholdsCmPer360.highBelow) return "high";
  if (cmPer360 > params.bandThresholdsCmPer360.lowAbove) return "low";
  return "mid";
}

/** Dimensions by descending shape, ties broken by the canonical ordering. */
function ranked(
  dimensions: readonly DimensionOutcome[],
  order: readonly DimensionKey[],
): readonly DimensionOutcome[] {
  const index = new Map(order.map((key, position) => [key, position]));
  return [...dimensions]
    .filter((dimension) => dimension.sufficient)
    .sort((a, b) =>
      b.shape === a.shape
        ? (index.get(a.dimension) ?? 0) - (index.get(b.dimension) ?? 0)
        : b.shape - a.shape,
    );
}

export function classifyAimProfile(
  dimensions: readonly DimensionOutcome[],
  cmPer360: number | null,
  params: AimProfileParams,
): ProfileClassification {
  const band = cmPer360 === null ? "mid" : sensitivityBand(cmPer360, params);
  const display = (key: AimProfileKey): string => params.displayNames[`${key}:${band}`] ?? key;
  const evidenceOf = (keys: readonly DimensionKey[]) =>
    keys
      .map((key) => dimensions.find((d) => d.dimension === key))
      .filter((d): d is DimensionOutcome => d !== undefined)
      .map((d) => ({ dimension: d.dimension, score: d.score, shape: d.shape }));

  const scored = dimensions.filter((dimension) => dimension.sufficient);

  // Rule 0 — too little data for a profile at all.
  if (scored.length < params.minimumScoredDimensions) {
    return {
      key: "provisional",
      band,
      displayName: display("provisional"),
      rule: 0,
      evidence: evidenceOf(scored.map((d) => d.dimension)),
    };
  }

  const byRank = ranked(dimensions, params.dimensionOrder);
  const top = byRank[0] as DimensionOutcome;
  const second = byRank[1] as DimensionOutcome;
  const lowest = byRank[byRank.length - 1] as DimensionOutcome;
  const topTwo = new Set([top.dimension, second.dimension]);
  const shapeOf = (key: DimensionKey): number =>
    dimensions.find((d) => d.dimension === key)?.shape ?? 0;

  // Rule 1 — nothing stands out.
  const maxAbs = Math.max(...scored.map((d) => Math.abs(d.shape)));
  if (maxAbs < params.flatShapeThreshold) {
    return {
      key: "balanced",
      band,
      displayName: display("balanced"),
      rule: 1,
      evidence: evidenceOf([top.dimension, lowest.dimension]),
    };
  }

  // Rule 2 — tracking clearly leads.
  if (top.dimension === "tracking" && top.shape - second.shape >= params.leadMargin) {
    return {
      key: "tracking-focused",
      band,
      displayName: display("tracking-focused"),
      rule: 2,
      evidence: evidenceOf(["tracking", second.dimension]),
    };
  }

  // Rule 3 — precision and control on top, speed at the bottom.
  if (topTwo.has("precision") && topTwo.has("control") && lowest.dimension === "speed") {
    return {
      key: "precision-focused",
      band,
      displayName: display("precision-focused"),
      rule: 3,
      evidence: evidenceOf(["precision", "control", "speed"]),
    };
  }

  // Rule 4 — flick and speed on top, precision at the bottom.
  if (topTwo.has("flick") && topTwo.has("speed") && lowest.dimension === "precision") {
    return {
      key: "fast-flick",
      band,
      displayName: display("fast-flick"),
      rule: 4,
      evidence: evidenceOf(["flick", "speed", "precision"]),
    };
  }

  // Rule 5 — control leads at a low sensitivity.
  if (top.dimension === "control" && band === "low") {
    return {
      key: "low-sensitivity-control",
      band,
      displayName: display("low-sensitivity-control"),
      rule: 5,
      evidence: evidenceOf(["control"]),
    };
  }

  // Rule 6 — speed leads at a high sensitivity.
  if (top.dimension === "speed" && band === "high") {
    return {
      key: "high-mobility",
      band,
      displayName: display("high-mobility"),
      rule: 6,
      evidence: evidenceOf(["speed"]),
    };
  }

  // Rule 7 — two non-adjacent strengths with no weakness.
  const strong = params.dimensionOrder.filter((key) => shapeOf(key) >= params.flatShapeThreshold);
  const weak = params.dimensionOrder.some((key) => shapeOf(key) <= -params.flatShapeThreshold);
  if (strong.length >= 2 && !weak) {
    const positions = strong.map((key) => params.dimensionOrder.indexOf(key));
    const nonAdjacent = positions.some((a) => positions.some((b) => Math.abs(a - b) > 1));
    if (nonAdjacent) {
      return {
        key: "hybrid",
        band,
        displayName: display("hybrid"),
        rule: 7,
        evidence: evidenceOf(strong),
      };
    }
  }

  // Rule 8 — fallback.
  return {
    key: "balanced",
    band,
    displayName: display("balanced"),
    rule: 8,
    evidence: evidenceOf([top.dimension, lowest.dimension]),
  };
}

/* ------------------------------------------------------------------ strengths & areas */

export interface NotableDimension {
  readonly dimension: DimensionKey;
  readonly score: number;
  readonly shape: number;
}

export interface StrengthsAndAreas {
  readonly strengths: readonly NotableDimension[];
  readonly improvementAreas: readonly NotableDimension[];
  /** True when neither list is populated — a flat profile, reported as such. */
  readonly flat: boolean;
}

export function strengthsAndAreas(
  dimensions: readonly DimensionOutcome[],
  params: AimProfileParams,
): StrengthsAndAreas {
  const scored = dimensions.filter((dimension) => dimension.sufficient);
  const pick = (d: DimensionOutcome): NotableDimension => ({
    dimension: d.dimension,
    score: d.score,
    shape: d.shape,
  });

  const strengths = scored
    .filter((d) => d.shape >= params.notableShapeThreshold)
    .sort((a, b) => b.shape - a.shape)
    .slice(0, params.maxStrengths)
    .map(pick);

  const improvementAreas = scored
    .filter((d) => d.shape <= -params.notableShapeThreshold)
    .sort((a, b) => a.shape - b.shape)
    .slice(0, params.maxImprovementAreas)
    .map(pick);

  return {
    strengths,
    improvementAreas,
    flat: strengths.length === 0 && improvementAreas.length === 0,
  };
}
