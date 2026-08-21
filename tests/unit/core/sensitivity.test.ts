import { describe, expect, it } from "vitest";
import {
  CM_DEGREE_CONSTANT,
  CM_PER_INCH,
  centimetresForRotation,
  cmPer360FromCounts,
  countsPer360FromCm,
  countsPer360FromDegreesPerCount,
  degreesPerCm,
  degreesPerCount,
  eDpi,
  inchesPer360,
  rotationForCentimetres,
} from "@/core/sensitivity/canonical";
import {
  angleForScreenFraction,
  convertCountsPer360ForFovChange,
  criterionToConversionMethod,
  horizontalHalfFovFromVertical,
  matchRatio,
  screenFractionForAngle,
  toDegrees,
  toRadians,
  verticalHalfFovFromHorizontal,
  type MatchCriterion,
} from "@/core/sensitivity/fov";
import {
  DEFAULT_SENSITIVITY_DOMAIN,
  clampCountsToDomain,
  clampToDomain,
  describeSensitivity,
  derivePhysicalConstraint,
  domainInCounts,
  domainInLogSensitivity,
  effectiveDomain,
  fromLogSensitivity,
  isWithinDomain,
  logDeltaForRatio,
  percentChangeForLogDelta,
  ratioForLogDelta,
  toLogSensitivity,
} from "@/core/sensitivity/domain";
import {
  ASSUMED_DEFAULT_DPI,
  assessDpiPlausibility,
  dpiFromMeasured360,
  dpiFromRulerSwipe,
  dpiFromRulerSwipes,
  settingsReliabilityForDpiSource,
} from "@/core/sensitivity/dpi";

describe("canonical conversions (doc 11 §11.1)", () => {
  it("uses the documented constants", () => {
    expect(CM_PER_INCH).toBe(2.54);
    expect(CM_DEGREE_CONSTANT).toBeCloseTo(914.4, 10);
  });

  it("matches the worked example: 30 cm/360 at 800 DPI is 9448.8189 counts", () => {
    const counts = countsPer360FromCm(30, 800);
    expect(counts).toBeCloseTo(9448.818897637795, 9);
  });

  it("feeding exactly counts/360 counts produces exactly 360° — SENS-FR-054", () => {
    const counts = countsPer360FromCm(30, 800);
    const perCount = degreesPerCount(counts);
    expect(counts * perCount).toBeCloseTo(360, 9);
  });

  it("round-trips cm ↔ counts at several DPI values", () => {
    for (const dpiValue of [400, 800, 1600, 3200, 12000]) {
      for (const cm of [8, 19.7, 31.2, 55, 100]) {
        const counts = countsPer360FromCm(cm, dpiValue);
        expect(cmPer360FromCounts(counts, dpiValue)).toBeCloseTo(cm, 9);
      }
    }
  });

  it("keeps degrees-per-count independent of DPI — the reason the engine never needs it", () => {
    // Same physical sensitivity expressed at two DPIs yields different counts but the same
    // angular response per count is *not* expected; what is expected is that the same
    // cm/360 produces the same rotation for the same physical travel.
    const at800 = countsPer360FromCm(30, 800);
    const at1600 = countsPer360FromCm(30, 1600);
    expect(at1600).toBeCloseTo(at800 * 2, 6);
    expect(degreesPerCount(at1600)).toBeCloseTo(degreesPerCount(at800) / 2, 9);
  });

  it("round-trips degrees per count", () => {
    const counts = countsPer360FromCm(31.2, 800);
    expect(countsPer360FromDegreesPerCount(degreesPerCount(counts))).toBeCloseTo(counts, 6);
  });

  it("derives the presentation units", () => {
    expect(degreesPerCm(36)).toBe(10);
    expect(inchesPer360(25.4)).toBeCloseTo(10, 10);
  });

  it("converts between rotation and physical travel", () => {
    expect(centimetresForRotation(30, 180)).toBeCloseTo(15, 10);
    expect(centimetresForRotation(30, -180)).toBeCloseTo(15, 10);
    expect(rotationForCentimetres(30, 15)).toBeCloseTo(180, 10);
  });

  it("computes eDPI for communities that use it", () => {
    expect(eDpi(800, 1.5)).toBe(1200);
  });

  it("rejects non-positive or non-finite inputs rather than propagating them", () => {
    expect(() => countsPer360FromCm(0, 800)).toThrow(RangeError);
    expect(() => countsPer360FromCm(30, 0)).toThrow(RangeError);
    expect(() => cmPer360FromCounts(-1, 800)).toThrow(RangeError);
    expect(() => degreesPerCount(Number.NaN)).toThrow(RangeError);
    expect(() => degreesPerCm(0)).toThrow(RangeError);
    expect(() => inchesPer360(0)).toThrow(RangeError);
    expect(() => eDpi(800, 0)).toThrow(RangeError);
    expect(() => centimetresForRotation(30, Number.NaN)).toThrow(RangeError);
    expect(() => rotationForCentimetres(0, 5)).toThrow(RangeError);
    expect(() => countsPer360FromDegreesPerCount(0)).toThrow(RangeError);
  });
});

describe("FOV geometry (doc 11 §11.5)", () => {
  it("converts degrees and radians", () => {
    expect(toRadians(180)).toBeCloseTo(Math.PI, 12);
    expect(toDegrees(Math.PI)).toBeCloseTo(180, 12);
  });

  it("relates horizontal and vertical half-FOV through the aspect ratio", () => {
    const h = 51.5;
    const v = verticalHalfFovFromHorizontal(h, 16 / 9);
    expect(Math.tan(toRadians(h)) / Math.tan(toRadians(v))).toBeCloseTo(16 / 9, 9);
    expect(horizontalHalfFovFromVertical(v, 16 / 9)).toBeCloseTo(h, 9);
  });

  it("projects an angle to a screen fraction and back", () => {
    const half = 51.5;
    const fraction = screenFractionForAngle(20, half);
    expect(fraction).toBeGreaterThan(0);
    expect(fraction).toBeLessThan(1);
    expect(angleForScreenFraction(fraction, half)).toBeCloseTo(20, 9);
  });

  it("places the FOV edge at exactly one half-width", () => {
    expect(screenFractionForAngle(51.5, 51.5)).toBeCloseTo(1, 9);
  });

  it("rejects half-FOV values outside (0, 90)", () => {
    expect(() => screenFractionForAngle(10, 0)).toThrow(RangeError);
    expect(() => screenFractionForAngle(10, 90)).toThrow(RangeError);
    expect(() => verticalHalfFovFromHorizontal(45, 0)).toThrow(RangeError);
    expect(() => horizontalHalfFovFromVertical(45, -1)).toThrow(RangeError);
  });
});

describe("FOV matching criteria (doc 11 §11.6)", () => {
  const wide = 51.5;
  const zoomed = 20;

  it("360-distance matching leaves the canonical value untouched", () => {
    expect(matchRatio({ kind: "distance_360" }, wide, zoomed)).toBe(1);
  });

  it("focal-length matching is the tangent ratio", () => {
    const expected = Math.tan(toRadians(wide)) / Math.tan(toRadians(zoomed));
    expect(matchRatio({ kind: "focal_length" }, wide, zoomed)).toBeCloseTo(expected, 12);
  });

  it("monitor-distance matching at k = 1 reduces to the half-FOV ratio", () => {
    expect(matchRatio({ kind: "monitor_distance", coefficient: 1 }, wide, zoomed)).toBeCloseTo(
      wide / zoomed,
      9,
    );
  });

  it("monitor-distance matching approaches focal-length matching as k → 0", () => {
    const focal = matchRatio({ kind: "focal_length" }, wide, zoomed);
    const tiny = matchRatio({ kind: "monitor_distance", coefficient: 1e-6 }, wide, zoomed);
    expect(tiny).toBeCloseTo(focal, 6);
  });

  it("orders the criteria as the derivation predicts", () => {
    // Zoomed in, every criterion slows physical aim; focal length slows it most,
    // monitor-edge least within the family, and 360-distance not at all.
    const focal = matchRatio({ kind: "focal_length" }, wide, zoomed);
    const half = matchRatio({ kind: "monitor_distance", coefficient: 0.5 }, wide, zoomed);
    const edge = matchRatio({ kind: "monitor_distance", coefficient: 1 }, wide, zoomed);
    expect(focal).toBeGreaterThan(half);
    expect(half).toBeGreaterThan(edge);
    expect(edge).toBeGreaterThan(1);
  });

  it("is symmetric: converting there and back is the identity", () => {
    const criterion: MatchCriterion = { kind: "monitor_distance", coefficient: 0.5 };
    const counts = countsPer360FromCm(30, 800);
    const scoped = convertCountsPer360ForFovChange(counts, wide, zoomed, criterion);
    const back = convertCountsPer360ForFovChange(scoped, zoomed, wide, criterion);
    expect(back).toBeCloseTo(counts, 6);
  });

  it("maps criteria to the persisted conversion-method vocabulary", () => {
    expect(criterionToConversionMethod({ kind: "distance_360" })).toBe("distance_360");
    expect(criterionToConversionMethod({ kind: "focal_length" })).toBe("focal_length");
    expect(criterionToConversionMethod({ kind: "monitor_distance", coefficient: 0.5 })).toBe(
      "monitor_distance",
    );
  });

  it("rejects a coefficient outside (0, 1] and points at the focal-length criterion", () => {
    expect(() => matchRatio({ kind: "monitor_distance", coefficient: 0 }, wide, zoomed)).toThrow(
      /focal_length/,
    );
    expect(() => matchRatio({ kind: "monitor_distance", coefficient: 1.5 }, wide, zoomed)).toThrow(
      RangeError,
    );
  });

  it("rejects a non-positive canonical value", () => {
    expect(() =>
      convertCountsPer360ForFovChange(0, wide, zoomed, { kind: "distance_360" }),
    ).toThrow(RangeError);
  });
});

describe("log-sensitivity space (doc 13 §13.2)", () => {
  it("round-trips through log space", () => {
    const counts = countsPer360FromCm(31.2, 800);
    expect(fromLogSensitivity(toLogSensitivity(counts))).toBeCloseTo(counts, 6);
  });

  it("turns multiplicative ratios into additive offsets", () => {
    expect(logDeltaForRatio(2)).toBeCloseTo(1, 12);
    expect(logDeltaForRatio(1.5)).toBeCloseTo(0.5849625007, 9);
    expect(ratioForLogDelta(1)).toBeCloseTo(2, 12);
    expect(percentChangeForLogDelta(0.1)).toBeCloseTo(7.177346254, 6);
  });

  it("makes a fixed step a fixed percentage anywhere on the scale", () => {
    const low = fromLogSensitivity(toLogSensitivity(countsPer360FromCm(10, 800)) + 0.1);
    const high = fromLogSensitivity(toLogSensitivity(countsPer360FromCm(80, 800)) + 0.1);
    expect(low / countsPer360FromCm(10, 800)).toBeCloseTo(high / countsPer360FromCm(80, 800), 9);
  });

  it("rejects non-positive or non-finite inputs", () => {
    expect(() => toLogSensitivity(0)).toThrow(RangeError);
    expect(() => fromLogSensitivity(Number.NaN)).toThrow(RangeError);
    expect(() => logDeltaForRatio(0)).toThrow(RangeError);
    expect(() => ratioForLogDelta(Number.NaN)).toThrow(RangeError);
  });
});

describe("admissible domain (doc 11 §11.10)", () => {
  it("expresses the domain in counts and log space for a given DPI", () => {
    const counts = domainInCounts(800);
    expect(counts.min).toBeCloseTo(countsPer360FromCm(8, 800), 6);
    expect(counts.max).toBeCloseTo(countsPer360FromCm(100, 800), 6);

    const logs = domainInLogSensitivity(800);
    expect(logs.min).toBeLessThan(logs.max);
  });

  it("recognises and clamps values", () => {
    expect(isWithinDomain(30)).toBe(true);
    expect(isWithinDomain(4)).toBe(false);
    expect(isWithinDomain(140)).toBe(false);
    expect(clampToDomain(4)).toBe(DEFAULT_SENSITIVITY_DOMAIN.minCmPer360);
    expect(clampToDomain(140)).toBe(DEFAULT_SENSITIVITY_DOMAIN.maxCmPer360);
    expect(clampToDomain(30)).toBe(30);
  });

  it("clamps canonical values through the DPI", () => {
    const tooFast = countsPer360FromCm(2, 800);
    expect(clampCountsToDomain(tooFast, 800)).toBeCloseTo(countsPer360FromCm(8, 800), 6);
  });

  it("describes a sensitivity in every unit a surface might need", () => {
    const view = describeSensitivity(countsPer360FromCm(31.2, 800), 800);
    expect(view.cmPer360).toBeCloseTo(31.2, 9);
    expect(view.inchesPer360).toBeCloseTo(31.2 / 2.54, 9);
    expect(view.degreesPerCm).toBeCloseTo(360 / 31.2, 9);
    expect(view.logSensitivity).toBeCloseTo(Math.log2(view.countsPer360), 9);
  });
});

describe("physical constraint (doc 13 §13.4)", () => {
  it("returns no bound when nothing is known", () => {
    const constraint = derivePhysicalConstraint({});
    expect(constraint.maxCmPer360).toBeNull();
    expect(constraint.source).toBe("none");
  });

  it("derives a bound from a declared pad width", () => {
    const constraint = derivePhysicalConstraint({ padWidthCm: 45 });
    expect(constraint.source).toBe("pad_width");
    expect(constraint.maxCmPer360).toBeCloseTo(45 / 0.55, 9);
  });

  it("derives the documented example: a 22 cm comfortable swipe bounds at 40 cm/360", () => {
    const constraint = derivePhysicalConstraint({ comfortableSwipeCm: 22 });
    expect(constraint.source).toBe("measured");
    expect(constraint.maxCmPer360).toBeCloseTo(40, 6);
  });

  it("takes the binding limit when both are known and consistent", () => {
    const constraint = derivePhysicalConstraint({ padWidthCm: 45, comfortableSwipeCm: 22 });
    expect(constraint.maxCmPer360).toBeCloseTo(22 / 0.55, 9);
    expect(constraint.conflict).toBe(false);
  });

  it("prefers the measurement and records a conflict when the swipe exceeds the pad", () => {
    const constraint = derivePhysicalConstraint({ padWidthCm: 20, comfortableSwipeCm: 35 });
    expect(constraint.conflict).toBe(true);
    expect(constraint.source).toBe("measured");
    expect(constraint.maxCmPer360).toBeCloseTo(35 / 0.55, 9);
  });

  it("honours tuned rho and kappa", () => {
    const constraint = derivePhysicalConstraint({ comfortableSwipeCm: 20, rho: 1, kappa: 0.5 });
    expect(constraint.maxCmPer360).toBeCloseTo(10, 9);
  });

  it("rejects invalid tuning parameters", () => {
    expect(() => derivePhysicalConstraint({ padWidthCm: 40, rho: 0 })).toThrow(RangeError);
    expect(() => derivePhysicalConstraint({ padWidthCm: 40, rho: 1.5 })).toThrow(RangeError);
    expect(() => derivePhysicalConstraint({ padWidthCm: 40, kappa: 0 })).toThrow(RangeError);
  });

  it("ignores non-positive measurements", () => {
    expect(derivePhysicalConstraint({ padWidthCm: 0, comfortableSwipeCm: 0 }).source).toBe("none");
  });

  it("narrows the effective domain and never inverts it", () => {
    const constrained = effectiveDomain(DEFAULT_SENSITIVITY_DOMAIN, {
      maxCmPer360: 40,
      source: "measured",
      conflict: false,
    });
    expect(constrained.maxCmPer360).toBe(40);
    expect(constrained.minCmPer360).toBe(DEFAULT_SENSITIVITY_DOMAIN.minCmPer360);

    const severe = effectiveDomain(DEFAULT_SENSITIVITY_DOMAIN, {
      maxCmPer360: 5,
      source: "measured",
      conflict: false,
    });
    expect(severe.minCmPer360).toBeLessThanOrEqual(severe.maxCmPer360);

    const unconstrained = effectiveDomain(DEFAULT_SENSITIVITY_DOMAIN, {
      maxCmPer360: null,
      source: "none",
      conflict: false,
    });
    expect(unconstrained).toEqual(DEFAULT_SENSITIVITY_DOMAIN);
  });
});

describe("DPI handling (doc 11 §11.9)", () => {
  it("offers 800 as an explicit assumption, never a silent default", () => {
    expect(ASSUMED_DEFAULT_DPI).toBe(800);
  });

  it("computes DPI from a ruler swipe", () => {
    // 800 counts over one inch is 800 DPI by definition.
    expect(dpiFromRulerSwipe(800, 2.54)).toBeCloseTo(800, 9);
    // A credit card is 8.56 cm; 2696 counts over it implies ~800 DPI.
    expect(dpiFromRulerSwipe(2696, 8.56)).toBeCloseTo(800, 0);
  });

  it("takes the median of repeated swipes", () => {
    const value = dpiFromRulerSwipes([
      { counts: 780, distanceCm: 2.54 },
      { counts: 800, distanceCm: 2.54 },
      { counts: 1600, distanceCm: 2.54 },
    ]);
    expect(value).toBeCloseTo(800, 6);
  });

  it("averages the two middle swipes for an even count", () => {
    const value = dpiFromRulerSwipes([
      { counts: 700, distanceCm: 2.54 },
      { counts: 800, distanceCm: 2.54 },
      { counts: 900, distanceCm: 2.54 },
      { counts: 1000, distanceCm: 2.54 },
    ]);
    expect(value).toBeCloseTo(850, 6);
  });

  it("solves for DPI from a measured in-game 360 distance", () => {
    const counts = countsPer360FromCm(30, 800);
    expect(dpiFromMeasured360(counts, 30)).toBeCloseTo(800, 6);
  });

  it("rejects impossible measurements", () => {
    expect(() => dpiFromRulerSwipe(0, 10)).toThrow(RangeError);
    expect(() => dpiFromRulerSwipe(100, 0)).toThrow(RangeError);
    expect(() => dpiFromRulerSwipes([])).toThrow(RangeError);
    expect(() => dpiFromMeasured360(0, 30)).toThrow(RangeError);
    expect(() => dpiFromMeasured360(1000, 0)).toThrow(RangeError);
  });

  it("reports settings reliability separately from measurement confidence", () => {
    expect(settingsReliabilityForDpiSource("known")).toBe("normal");
    expect(settingsReliabilityForDpiSource("estimated")).toBe("estimated_dpi");
    expect(settingsReliabilityForDpiSource("assumed")).toBe("assumed_dpi");
  });
});

describe("DPI plausibility (doc 11 §11.9.3)", () => {
  it("reports no evidence when nothing can be cross-checked", () => {
    expect(assessDpiPlausibility({}).kind).toBe("no_evidence");
    expect(assessDpiPlausibility({ impliedCmPer360: 0 }).kind).toBe("no_evidence");
    expect(assessDpiPlausibility({ impliedCmPer360: Number.NaN }).kind).toBe("no_evidence");
  });

  it("accepts a sensible implied sensitivity", () => {
    expect(assessDpiPlausibility({ impliedCmPer360: 30 }).kind).toBe("consistent");
  });

  it("flags an implied sensitivity outside the human-usable band", () => {
    const tooFast = assessDpiPlausibility({ impliedCmPer360: 2 });
    expect(tooFast.kind).toBe("implausible_sensitivity");
    const tooSlow = assessDpiPlausibility({ impliedCmPer360: 250 });
    expect(tooSlow.kind).toBe("implausible_sensitivity");
  });

  it("flags a sensitivity that cannot fit on the declared pad", () => {
    const verdict = assessDpiPlausibility({ impliedCmPer360: 90, padWidthCm: 30 });
    expect(verdict.kind).toBe("exceeds_pad");
  });

  it("flags a mismatch against the player's own measured reach", () => {
    const verdict = assessDpiPlausibility({ impliedCmPer360: 90, measuredComfortableSwipeCm: 15 });
    expect(verdict.kind).toBe("conflicts_with_measured_swipe");
    if (verdict.kind === "conflicts_with_measured_swipe") {
      expect(verdict.ratio).toBeCloseTo(6, 6);
    }

    const opposite = assessDpiPlausibility({
      impliedCmPer360: 9,
      measuredComfortableSwipeCm: 60,
    });
    expect(opposite.kind).toBe("conflicts_with_measured_swipe");
  });

  it("accepts a swipe that is merely different, not contradictory", () => {
    expect(
      assessDpiPlausibility({ impliedCmPer360: 30, measuredComfortableSwipeCm: 20 }).kind,
    ).toBe("consistent");
  });
});
