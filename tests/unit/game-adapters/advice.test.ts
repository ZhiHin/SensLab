import { describe, expect, it } from "vitest";
import { countsPer360FromCm } from "@/core/sensitivity/canonical";
import { countsForSetting, suggestDpiForScope, type TableParams } from "@/game-adapters";
import { createFixtureAdapter, createTableFixtureAdapter } from "@tests/helpers/fixture-adapter";

/**
 * The DPI suggestion (doc 11 §11.4 step 5).
 *
 * A coarse setting grid is the case where quantisation stops being a rounding footnote. The
 * useful answer is not "your value will be 3.6% off" — it is "at 830 DPI, 24 is exact", which
 * the user can act on. This only exists because the adapter knows the model; a caller outside
 * the layer could not compute it.
 */

const COARSE = createTableFixtureAdapter();
const FINE = createFixtureAdapter();

describe("on a coarse grid", () => {
  // The table fixture steps in whole numbers over 5–100, so a step is several percent.
  const target = countsPer360FromCm(24.7, 800);

  it("names a DPI at which an achievable setting is exact", () => {
    const suggestion = suggestDpiForScope(COARSE, "hipfire", target, 800);
    expect(suggestion).not.toBeNull();
    if (suggestion === null) return;

    expect(Number.isInteger(suggestion.settingValue)).toBe(true);
    expect(suggestion.dpi).not.toBe(800);

    // The claim has to actually hold: at the suggested DPI, that setting hits the target
    // cm/360. Asserting the arithmetic rather than the shape is the point of the test.
    const counts = countsForSetting(
      COARSE.scopes[0]?.model as TableParams,
      suggestion.settingValue,
    );
    expect(counts.ok).toBe(true);
    if (!counts.ok) return;

    const targetCm = (2.54 * target) / 800;
    const achievedCm = (2.54 * counts.value) / suggestion.dpi;
    expect(achievedCm).toBeCloseTo(targetCm, 1);
  });

  it("stays near the current DPI", () => {
    const suggestion = suggestDpiForScope(COARSE, "hipfire", target, 800);
    expect(suggestion).not.toBeNull();
    if (suggestion === null) return;
    expect(Math.abs(suggestion.dpi - 800) / 800).toBeLessThanOrEqual(0.25);
  });

  it("respects a tighter limit on how far the DPI may move", () => {
    expect(
      suggestDpiForScope(COARSE, "hipfire", target, 800, { maxRelativeDpiChange: 0.0001 }),
    ).toBeNull();
  });
});

describe("when there is nothing useful to say", () => {
  it("declines for an unverified scope", () => {
    expect(suggestDpiForScope(FINE, "ads", countsPer360FromCm(30, 800), 800)).toBeNull();
  });

  it("declines for a scope the game does not offer", () => {
    expect(suggestDpiForScope(FINE, "x8", countsPer360FromCm(30, 800), 800)).toBeNull();
  });

  it("declines when the target is outside the measured range", () => {
    // No extrapolation, and therefore no advice about it either.
    expect(suggestDpiForScope(COARSE, "hipfire", 1_000_000, 800)).toBeNull();
  });

  it("declines on a fine grid where the current DPI is already close enough", () => {
    // The fixture steps by 0.01 on a 0.1–10 range, so every target is reachable to well
    // under a tenth of a percent and a DPI change would buy nothing.
    const suggestion = suggestDpiForScope(FINE, "hipfire", countsPer360FromCm(31.2, 800), 800, {
      maxRelativeDpiChange: 0.001,
    });
    expect(suggestion).toBeNull();
  });
});
