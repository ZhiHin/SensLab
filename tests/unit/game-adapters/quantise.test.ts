import { describe, expect, it } from "vitest";
import { countsPer360FromCm } from "@/core/sensitivity/canonical";
import {
  DEFAULT_QUANTISATION_WARNING_PCT,
  assertSettingRange,
  countsForSetting,
  isOnStep,
  quantisationErrorPct,
  quantiseSetting,
  quantiseToStep,
  suggestDpiForGrid,
  type SensitivityModel,
  type SettingRangeSpec,
} from "@/game-adapters";
import { createFixtureAdapter, FIXTURE_YAW_DEG_PER_COUNT } from "@tests/helpers/fixture-adapter";

/**
 * Quantisation (doc 11 §11.4).
 *
 * The behaviour under test is a claim about honesty rather than about arithmetic: the number
 * a player is shown must be the one the quantised setting actually produces, not the ideal
 * one that no achievable setting reaches.
 */

const TWO_DECIMALS: SettingRangeSpec = { min: 0.1, max: 10, step: 0.01, decimals: 2 };
const COARSE: SettingRangeSpec = { min: 1, max: 100, step: 5, decimals: 0 };

describe("rounding onto the game grid", () => {
  it("lands on a representable value at the declared precision", () => {
    // Math.round(1.15 / 0.01) * 0.01 is 1.1500000000000001, which a game parser may or may
    // not accept and a user certainly should not have to type.
    expect(quantiseToStep(1.15, TWO_DECIMALS)).toBe(1.15);
    expect(quantiseToStep(1.153, TWO_DECIMALS)).toBe(1.15);
    expect(quantiseToStep(1.156, TWO_DECIMALS)).toBe(1.16);
    expect(quantiseToStep(37, COARSE)).toBe(35);
    expect(quantiseToStep(38, COARSE)).toBe(40);
  });

  it("recognises a value that already sits on the grid", () => {
    expect(isOnStep(1.15, TWO_DECIMALS)).toBe(true);
    expect(isOnStep(1.155, TWO_DECIMALS)).toBe(false);
    expect(isOnStep(35, COARSE)).toBe(true);
    expect(isOnStep(37, COARSE)).toBe(false);
  });

  it("clamps to the range and reports that it did", () => {
    expect(quantiseSetting(0.05, TWO_DECIMALS)).toEqual({
      idealValue: 0.05,
      value: 0.1,
      clamped: true,
    });
    expect(quantiseSetting(20, TWO_DECIMALS)).toEqual({
      idealValue: 20,
      value: 10,
      clamped: true,
    });
    expect(quantiseSetting(2.5, TWO_DECIMALS).clamped).toBe(false);
  });

  it("never emits a value outside the range, even when rounding would push it there", () => {
    // A max of 98 on a step of 5 rounds to 100, which the game would reject.
    const awkward: SettingRangeSpec = { min: 1, max: 98, step: 5, decimals: 0 };
    expect(quantiseSetting(98, awkward).value).toBeLessThanOrEqual(98);
    expect(quantiseSetting(97.6, awkward).value).toBeLessThanOrEqual(98);
  });

  it("rejects an incoherent range at construction", () => {
    expect(() => assertSettingRange({ min: 5, max: 1, step: 1, decimals: 0 })).toThrow(RangeError);
    expect(() => assertSettingRange({ min: 1, max: 5, step: 0, decimals: 0 })).toThrow(RangeError);
    expect(() => assertSettingRange({ min: 1, max: 5, step: 1, decimals: -1 })).toThrow(RangeError);
  });
});

describe("the reported error", () => {
  it("is signed, so a value that lands fast reads differently from one that lands slow", () => {
    expect(quantisationErrorPct(101, 100)).toBeCloseTo(1, 12);
    expect(quantisationErrorPct(99, 100)).toBeCloseTo(-1, 12);
    expect(quantisationErrorPct(100, 100)).toBe(0);
  });

  it("refuses a non-positive request rather than dividing by zero", () => {
    expect(() => quantisationErrorPct(100, 0)).toThrow(RangeError);
  });
});

describe("the achieved value the adapter reports", () => {
  const adapter = createFixtureAdapter();
  const model: SensitivityModel = {
    form: "linear_yaw",
    yawDegPerCountAtSettingOne: FIXTURE_YAW_DEG_PER_COUNT,
  };

  it("comes from the quantised setting, not the ideal one", () => {
    const requested = countsPer360FromCm(31.234, 800);
    const outcome = adapter.fromCanonical(requested, { dpi: 800, scopeKey: "hipfire" });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const emitted = outcome.value.settings[0];
    expect(emitted?.idealValue).not.toBe(emitted?.value);

    const fromQuantised = countsForSetting(model, emitted?.value ?? 0);
    expect(fromQuantised.ok).toBe(true);
    if (fromQuantised.ok) {
      expect(outcome.value.achievedCountsPer360).toBeCloseTo(fromQuantised.value, 9);
    }

    // And the ideal would have given a *different* answer, which is the whole point.
    const fromIdeal = countsForSetting(model, emitted?.idealValue ?? 0);
    expect(fromIdeal.ok).toBe(true);
    if (fromIdeal.ok) {
      expect(Math.abs(fromIdeal.value - outcome.value.achievedCountsPer360)).toBeGreaterThan(0);
      expect(fromIdeal.value).toBeCloseTo(requested, 6);
    }
  });

  it("stays well inside the warning threshold on a fine grid", () => {
    for (const cm of [12, 18.7, 25, 33.3, 47, 64.8, 90]) {
      const outcome = adapter.fromCanonical(countsPer360FromCm(cm, 800), {
        dpi: 800,
        scopeKey: "hipfire",
      });
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(Math.abs(outcome.value.quantisationErrorPct)).toBeLessThan(
          DEFAULT_QUANTISATION_WARNING_PCT,
        );
      }
    }
  });
});

describe("suggesting a DPI that lands on the grid", () => {
  // doc 11 §11.4 step 5. The algebra: a setting s produces C(s) counts/360, so the DPI at
  // which s is exactly right for a target cm/360 is 2.54 × C(s) / cm.
  const candidates = [
    { settingValue: 1.4, counts: 12857.142857142857 },
    { settingValue: 1.45, counts: 12413.79310344828 },
    { settingValue: 1.5, counts: 12000 },
  ];

  it("picks the candidate nearest the current DPI", () => {
    const suggestion = suggestDpiForGrid({
      targetCmPer360: 38,
      currentDpi: 800,
      candidates,
    });
    expect(suggestion).not.toBeNull();
    expect(suggestion?.dpi).toBeGreaterThan(600);
    expect(suggestion?.dpi).toBeLessThan(1000);
    expect(candidates.some((c) => c.settingValue === suggestion?.settingValue)).toBe(true);
  });

  it("declines a suggestion that asks for a wildly different DPI", () => {
    // A "suggestion" to halve the DPI is a different recommendation wearing a hint's clothes.
    expect(
      suggestDpiForGrid({
        targetCmPer360: 38,
        currentDpi: 8000,
        candidates,
        maxRelativeDpiChange: 0.25,
      }),
    ).toBeNull();
  });

  it("declines when the current DPI is already exact", () => {
    const exact = suggestDpiForGrid({
      targetCmPer360: 38.1,
      currentDpi: 800,
      candidates: [{ settingValue: 1.5, counts: 12000 }],
    });
    expect(exact).toBeNull();
  });

  it("declines on nonsense input rather than inventing a DPI", () => {
    expect(suggestDpiForGrid({ targetCmPer360: 0, currentDpi: 800, candidates })).toBeNull();
    expect(suggestDpiForGrid({ targetCmPer360: 38, currentDpi: 0, candidates })).toBeNull();
    expect(suggestDpiForGrid({ targetCmPer360: 38, currentDpi: 800, candidates: [] })).toBeNull();
  });
});
