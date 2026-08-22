import { describe, expect, it } from "vitest";
import { matchRatio, verticalHalfFovFromHorizontal } from "@/core/sensitivity/fov";
import { countsPer360FromCm } from "@/core/sensitivity/canonical";
import {
  DEFAULT_HIGH_ZOOM_CRITERION,
  DEFAULT_LOW_ZOOM_CRITERION,
  HIGH_ZOOM_MAGNIFICATION_THRESHOLD,
  defaultCriterionForMagnification,
  halfFovForMagnification,
  scopedTargetCounts,
} from "@/game-adapters";
import { createFixtureAdapter } from "@tests/helpers/fixture-adapter";

/**
 * Scoped and ADS conversion (doc 11 §11.6).
 *
 * The maths is first-principles and lives in `core/sensitivity/fov`; what is exercised here
 * is the part that depends on the *game* — the `ads_model` declaration, the optics
 * description, and the criterion defaults.
 */

const HIPFIRE_HALF_FOV = 51.5;
const HIPFIRE_COUNTS = countsPer360FromCm(31.2, 800);

describe("the ads_model declaration decides whether the criterion applies at all", () => {
  it("emits nothing when the ADS model is unknown", () => {
    // doc 11 §11.6.4: an unverified ADS model produces no value. Not a disclaimed value, not
    // a value with a warning — none.
    const outcome = scopedTargetCounts({
      hipfireCounts: HIPFIRE_COUNTS,
      adsModel: "unknown",
      optics: { kind: "tangent_magnification", magnification: 4 },
      hipfireHalfFovDegrees: HIPFIRE_HALF_FOV,
      criterion: DEFAULT_LOW_ZOOM_CRITERION,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.kind).toBe("ads_model_unknown");
  });

  it("leaves the target untouched when the game does its own FOV scaling", () => {
    // Applying the monitor-distance family on top of a game that already compensates is the
    // failure doc 11 singles out: hipfire stays perfectly correct and every scoped value is
    // wrong by exactly the factor the game applied.
    const outcome = scopedTargetCounts({
      hipfireCounts: HIPFIRE_COUNTS,
      adsModel: "internally_fov_scaled",
      optics: { kind: "tangent_magnification", magnification: 4 },
      hipfireHalfFovDegrees: HIPFIRE_HALF_FOV,
      criterion: DEFAULT_LOW_ZOOM_CRITERION,
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.countsPer360).toBe(HIPFIRE_COUNTS);
      expect(outcome.value.conversionMethod).toBe("direct");
      expect(outcome.value.criterion).toBeNull();
    }
  });

  it("applies the criterion for a raw multiplier", () => {
    const outcome = scopedTargetCounts({
      hipfireCounts: HIPFIRE_COUNTS,
      adsModel: "raw_multiplier",
      optics: { kind: "tangent_magnification", magnification: 4 },
      hipfireHalfFovDegrees: HIPFIRE_HALF_FOV,
      criterion: DEFAULT_LOW_ZOOM_CRITERION,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    // Zooming in makes the scoped state slower in physical terms, always.
    expect(outcome.value.countsPer360).toBeGreaterThan(HIPFIRE_COUNTS);
    expect(outcome.value.conversionMethod).toBe("monitor_distance");
    expect(outcome.value.conversionCoefficient).toBe(0.5);

    const scopeHalfFov = halfFovForMagnification(HIPFIRE_HALF_FOV, 4);
    const expected =
      HIPFIRE_COUNTS * matchRatio(DEFAULT_LOW_ZOOM_CRITERION, HIPFIRE_HALF_FOV, scopeHalfFov);
    expect(outcome.value.countsPer360).toBeCloseTo(expected, 9);
    expect(outcome.value.scopeHalfFovDegrees).toBeCloseTo(scopeHalfFov, 9);
  });
});

describe("what the conversion refuses to guess", () => {
  it("will not match FOV without the player's hipfire FOV", () => {
    const outcome = scopedTargetCounts({
      hipfireCounts: HIPFIRE_COUNTS,
      adsModel: "raw_multiplier",
      optics: { kind: "tangent_magnification", magnification: 4 },
      criterion: DEFAULT_LOW_ZOOM_CRITERION,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.kind).toBe("missing_fov_context");
  });

  it("will not match FOV for a scope whose optics were never established", () => {
    const outcome = scopedTargetCounts({
      hipfireCounts: HIPFIRE_COUNTS,
      adsModel: "raw_multiplier",
      optics: null,
      hipfireHalfFovDegrees: HIPFIRE_HALF_FOV,
      criterion: DEFAULT_LOW_ZOOM_CRITERION,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.kind).toBe("missing_fov_context");
  });

  it("needs neither for the 360-distance criterion, which is FOV-independent by definition", () => {
    const outcome = scopedTargetCounts({
      hipfireCounts: HIPFIRE_COUNTS,
      adsModel: "raw_multiplier",
      optics: null,
      criterion: { kind: "distance_360" },
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.countsPer360).toBe(HIPFIRE_COUNTS);
      expect(outcome.value.conversionMethod).toBe("distance_360");
    }
  });
});

describe("optics", () => {
  it("prefers a measured half-FOV over a magnification when one exists", () => {
    const measured = scopedTargetCounts({
      hipfireCounts: HIPFIRE_COUNTS,
      adsModel: "raw_multiplier",
      optics: { kind: "measured_half_fov", halfFovDegrees: 20 },
      hipfireHalfFovDegrees: HIPFIRE_HALF_FOV,
      criterion: DEFAULT_LOW_ZOOM_CRITERION,
    });
    expect(measured.ok).toBe(true);
    if (measured.ok) expect(measured.value.scopeHalfFovDegrees).toBe(20);
  });

  it("derives a half-FOV from magnification in tangent space", () => {
    // tan(h_scope) = tan(h_hipfire) / magnification, which is what linear magnification means
    // for a perspective projection.
    const half = halfFovForMagnification(60, 2);
    expect(Math.tan((half * Math.PI) / 180)).toBeCloseTo(Math.tan((60 * Math.PI) / 180) / 2, 12);
    expect(half).toBeLessThan(60);
  });

  it("rejects a non-positive magnification", () => {
    expect(() => halfFovForMagnification(60, 0)).toThrow(RangeError);
  });
});

describe("criterion defaults (doc 11 §11.6.3)", () => {
  it("uses centre matching at high magnification and half-screen matching below it", () => {
    expect(defaultCriterionForMagnification(1)).toEqual(DEFAULT_LOW_ZOOM_CRITERION);
    expect(defaultCriterionForMagnification(4)).toEqual(DEFAULT_LOW_ZOOM_CRITERION);
    expect(defaultCriterionForMagnification(HIGH_ZOOM_MAGNIFICATION_THRESHOLD)).toEqual(
      DEFAULT_HIGH_ZOOM_CRITERION,
    );
    expect(defaultCriterionForMagnification(8)).toEqual(DEFAULT_HIGH_ZOOM_CRITERION);
  });

  it("falls back to the ADS default when magnification is unknown", () => {
    expect(defaultCriterionForMagnification(undefined)).toEqual(DEFAULT_LOW_ZOOM_CRITERION);
  });

  it("orders the criteria as the geometry requires", () => {
    // Within the monitor-distance family, edge matching is fastest and centre matching is
    // slowest; 360-distance leaves the value alone. If this ordering ever inverts, a sign
    // has gone wrong somewhere in the derivation.
    const scope = halfFovForMagnification(HIPFIRE_HALF_FOV, 4);
    const focal = matchRatio({ kind: "focal_length" }, HIPFIRE_HALF_FOV, scope);
    const half = matchRatio(
      { kind: "monitor_distance", coefficient: 0.5 },
      HIPFIRE_HALF_FOV,
      scope,
    );
    const edge = matchRatio({ kind: "monitor_distance", coefficient: 1 }, HIPFIRE_HALF_FOV, scope);
    const identity = matchRatio({ kind: "distance_360" }, HIPFIRE_HALF_FOV, scope);

    expect(focal).toBeGreaterThan(half);
    expect(half).toBeGreaterThan(edge);
    expect(edge).toBeGreaterThan(identity);
    expect(identity).toBe(1);
  });

  it("agrees with the vertical construction when the aspect ratio is applied consistently", () => {
    // Matching on the vertical axis is the same construction on v instead of h. The two
    // agree at the focal-length limit, because tan h / tan h' = tan v / tan v' when both
    // states share an aspect ratio.
    const aspect = 16 / 9;
    const scope = halfFovForMagnification(HIPFIRE_HALF_FOV, 4);
    const horizontal = matchRatio({ kind: "focal_length" }, HIPFIRE_HALF_FOV, scope);
    const vertical = matchRatio(
      { kind: "focal_length" },
      verticalHalfFovFromHorizontal(HIPFIRE_HALF_FOV, aspect),
      verticalHalfFovFromHorizontal(scope, aspect),
    );
    expect(vertical).toBeCloseTo(horizontal, 12);
  });
});

describe("the adapter applies all of this behind the gate", () => {
  it("refuses a scoped conversion while the scope is unverified", () => {
    const adapter = createFixtureAdapter();
    const outcome = adapter.fromCanonical(HIPFIRE_COUNTS, {
      dpi: 800,
      scopeKey: "ads",
      hipfireHalfFovDegrees: HIPFIRE_HALF_FOV,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("EXTERNAL_VERIFICATION_REQUIRED");
  });

  it("derives the scoped setting from the hipfire target once the scope is verified", () => {
    const adapter = createFixtureAdapter({ verifiedAdsScope: true });
    const hipfire = adapter.fromCanonical(HIPFIRE_COUNTS, { dpi: 800, scopeKey: "hipfire" });
    const ads = adapter.fromCanonical(HIPFIRE_COUNTS, {
      dpi: 800,
      scopeKey: "ads",
      hipfireHalfFovDegrees: HIPFIRE_HALF_FOV,
    });

    expect(hipfire.ok).toBe(true);
    expect(ads.ok).toBe(true);
    if (!hipfire.ok || !ads.ok) return;

    // Slower in physical terms means a smaller in-game number on this fixture model.
    expect(ads.value.achievedCountsPer360).toBeGreaterThan(hipfire.value.achievedCountsPer360);
    expect(ads.value.settings[0]?.key).toBe("ads_sensitivity");
    expect(ads.value.conversionMethod).toBe("monitor_distance");
    expect(ads.value.conversionCoefficient).toBe(0.5);
  });

  it("honours a user override of the criterion (FR-085)", () => {
    const adapter = createFixtureAdapter({ verifiedAdsScope: true });
    const context = { dpi: 800, scopeKey: "ads" as const, hipfireHalfFovDegrees: HIPFIRE_HALF_FOV };

    const byDefault = adapter.fromCanonical(HIPFIRE_COUNTS, context);
    const overridden = adapter.fromCanonical(HIPFIRE_COUNTS, {
      ...context,
      criterion: { kind: "focal_length" },
    });

    expect(byDefault.ok && overridden.ok).toBe(true);
    if (!byDefault.ok || !overridden.ok) return;
    expect(overridden.value.conversionMethod).toBe("focal_length");
    expect(overridden.value.achievedCountsPer360).not.toBe(byDefault.value.achievedCountsPer360);
  });

  it("ignores a requested criterion when the game scales internally", () => {
    // The criterion is simply not consulted; the target stays in the game's own terms rather
    // than being converted twice.
    const adapter = createFixtureAdapter({
      verifiedAdsScope: true,
      adsModel: "internally_fov_scaled",
    });
    const outcome = adapter.fromCanonical(HIPFIRE_COUNTS, {
      dpi: 800,
      scopeKey: "ads",
      hipfireHalfFovDegrees: HIPFIRE_HALF_FOV,
      criterion: { kind: "focal_length" },
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.conversionMethod).toBe("direct");
      // Equal to the hipfire target up to the scope's own quantisation, and nothing more.
      const relative =
        Math.abs(outcome.value.achievedCountsPer360 - HIPFIRE_COUNTS) / HIPFIRE_COUNTS;
      expect(relative).toBeLessThan(0.005);
    }
  });

  it("reports missing FOV context rather than silently choosing one", () => {
    const adapter = createFixtureAdapter({ verifiedAdsScope: true });
    const outcome = adapter.fromCanonical(HIPFIRE_COUNTS, { dpi: 800, scopeKey: "ads" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("MISSING_CONTEXT");
  });
});
