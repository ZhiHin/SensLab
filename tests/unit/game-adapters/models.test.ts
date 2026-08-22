import { describe, expect, it } from "vitest";
import { deriveRng } from "@/core/random";
import {
  MIN_ANCHORS,
  assertModelParams,
  countsForSetting,
  settingForCounts,
  tableCountsBounds,
  tableSettingBounds,
  type SensitivityModel,
  type TableAnchor,
  type TableParams,
} from "@/game-adapters";
import { FIXTURE_TABLE_ANCHORS, FIXTURE_YAW_DEG_PER_COUNT } from "@tests/helpers/fixture-adapter";

/**
 * The two model forms (doc 11 §11.2, doc 12 §12.5).
 *
 * All constants here are fictional. The point of these tests is the *shape* of each form —
 * exact invertibility for Form A, monotone non-overshooting interpolation and a refusal to
 * extrapolate for Form B — none of which depends on any real game.
 */

const LINEAR: SensitivityModel = {
  form: "linear_yaw",
  yawDegPerCountAtSettingOne: FIXTURE_YAW_DEG_PER_COUNT,
};

const TABLE: TableParams = {
  form: "table",
  anchors: FIXTURE_TABLE_ANCHORS,
  interpolation: "monotone_cubic_loglog",
  extrapolation: "refuse",
};

const unwrapValue = (result: ReturnType<typeof countsForSetting>): number => {
  expect(result.ok).toBe(true);
  return result.ok ? result.value : NaN;
};

describe("Form A — the linear yaw constant", () => {
  it("inverts exactly across the range", () => {
    const rng = deriveRng("models", "linear");
    for (let i = 0; i < 500; i += 1) {
      const setting = rng.nextRange(0.05, 20);
      const counts = unwrapValue(countsForSetting(LINEAR, setting));
      const back = unwrapValue(settingForCounts(LINEAR, counts));
      expect(Math.abs(back - setting) / setting).toBeLessThan(1e-12);
    }
  });

  it("is exactly reciprocal in the setting", () => {
    // Doubling the setting halves counts/360. If this ever stops holding, the form is not
    // what it claims to be.
    const single = unwrapValue(countsForSetting(LINEAR, 2));
    const double = unwrapValue(countsForSetting(LINEAR, 4));
    expect(single / double).toBeCloseTo(2, 12);
  });

  it("rejects a non-positive constant at construction", () => {
    expect(() => assertModelParams({ form: "linear_yaw", yawDegPerCountAtSettingOne: 0 })).toThrow(
      RangeError,
    );
    expect(() =>
      assertModelParams({ form: "linear_yaw", yawDegPerCountAtSettingOne: Number.NaN }),
    ).toThrow(RangeError);
  });
});

describe("Form B — measured anchors", () => {
  it("passes exactly through every anchor", () => {
    // An interpolant that does not reproduce its own measurements is not interpolating them.
    for (const anchor of FIXTURE_TABLE_ANCHORS) {
      const counts = unwrapValue(countsForSetting(TABLE, anchor.setting));
      expect(counts).toBeCloseTo(anchor.countsPer360, 6);
    }
  });

  it("stays monotone between anchors, without overshooting", () => {
    // This is the property Fritsch–Carlson limiting buys, and the reason an ordinary cubic
    // spline is not good enough: an overshoot would report a rotation the measurements do
    // not support, in a region where there is no measurement to contradict it.
    const bounds = tableSettingBounds(TABLE);
    let previous = Infinity;
    for (let i = 0; i <= 2000; i += 1) {
      const setting = bounds.min + ((bounds.max - bounds.min) * i) / 2000;
      const counts = unwrapValue(countsForSetting(TABLE, setting));
      expect(counts).toBeLessThanOrEqual(previous + 1e-9);
      previous = counts;
    }

    const countsBounds = tableCountsBounds(TABLE);
    for (let i = 0; i <= 500; i += 1) {
      const setting = bounds.min + ((bounds.max - bounds.min) * i) / 500;
      const counts = unwrapValue(countsForSetting(TABLE, setting));
      expect(counts).toBeGreaterThanOrEqual(countsBounds.min);
      expect(counts).toBeLessThanOrEqual(countsBounds.max);
    }
  });

  it("inverts to machine precision", () => {
    const rng = deriveRng("models", "table");
    const bounds = tableSettingBounds(TABLE);
    for (let i = 0; i < 500; i += 1) {
      const setting = rng.nextRange(bounds.min, bounds.max);
      const counts = unwrapValue(countsForSetting(TABLE, setting));
      const back = unwrapValue(settingForCounts(TABLE, counts));
      expect(Math.abs(back - setting) / setting).toBeLessThan(1e-9);
    }
  });

  it("refuses to extrapolate in either direction", () => {
    const settings = tableSettingBounds(TABLE);
    const counts = tableCountsBounds(TABLE);

    for (const outside of [settings.min * 0.9, settings.max * 1.1]) {
      const result = countsForSetting(TABLE, outside);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("OUTSIDE_MEASURED_RANGE");
    }

    for (const outside of [counts.min * 0.9, counts.max * 1.1]) {
      const result = settingForCounts(TABLE, outside);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("OUTSIDE_MEASURED_RANGE");
    }
  });

  it("accepts its own endpoints rather than refusing them as extrapolation", () => {
    // exp(log(x)) is not always x, and an interpolant that refuses the anchor it was built
    // from would be refusing the one point it certainly knows.
    const settings = tableSettingBounds(TABLE);
    const counts = tableCountsBounds(TABLE);
    expect(countsForSetting(TABLE, settings.min).ok).toBe(true);
    expect(countsForSetting(TABLE, settings.max).ok).toBe(true);
    expect(settingForCounts(TABLE, counts.min).ok).toBe(true);
    expect(settingForCounts(TABLE, counts.max).ok).toBe(true);
  });

  it("requires at least five anchors", () => {
    const tooFew: TableAnchor[] = FIXTURE_TABLE_ANCHORS.slice(0, MIN_ANCHORS - 1);
    expect(() => assertModelParams({ ...TABLE, anchors: tooFew })).toThrow(/at least 5/);
  });

  it("rejects anchors that are not strictly increasing in setting", () => {
    const unsorted = [...FIXTURE_TABLE_ANCHORS];
    const swap = unsorted[1] as TableAnchor;
    unsorted[1] = unsorted[2] as TableAnchor;
    unsorted[2] = swap;
    expect(() => assertModelParams({ ...TABLE, anchors: unsorted })).toThrow(
      /strictly increasing in setting/,
    );
  });

  it("rejects a reversal in counts, which would mean the form is wrong", () => {
    const reversed = FIXTURE_TABLE_ANCHORS.map((anchor, index) =>
      index === 3 ? { ...anchor, countsPer360: 99999 } : anchor,
    );
    expect(() => assertModelParams({ ...TABLE, anchors: reversed })).toThrow(
      /strictly monotone in counts/,
    );
  });

  it("rejects a duplicated counts value", () => {
    const duplicated = FIXTURE_TABLE_ANCHORS.map((anchor, index) =>
      index === 2 ? { ...anchor, countsPer360: 19500 } : anchor,
    );
    expect(() => assertModelParams({ ...TABLE, anchors: duplicated })).toThrow(
      /strictly monotone in counts/,
    );
  });

  it("rejects a non-positive anchor", () => {
    const invalid = FIXTURE_TABLE_ANCHORS.map((anchor, index) =>
      index === 0 ? { ...anchor, setting: 0 } : anchor,
    );
    expect(() => assertModelParams({ ...TABLE, anchors: invalid })).toThrow(RangeError);
  });
});

describe("an ascending table is equally valid", () => {
  // Nothing says a game's setting number has to go up as sensitivity goes up. A game whose
  // slider is labelled in cm would ascend, and the interpolator must not assume otherwise.
  const ascending: TableParams = {
    form: "table",
    anchors: [
      { setting: 1, countsPer360: 3600 },
      { setting: 2, countsPer360: 5200 },
      { setting: 3, countsPer360: 7100 },
      { setting: 4, countsPer360: 10400 },
      { setting: 5, countsPer360: 19500 },
    ],
    interpolation: "monotone_cubic_loglog",
    extrapolation: "refuse",
  };

  it("validates, interpolates and inverts", () => {
    expect(() => assertModelParams(ascending)).not.toThrow();
    const counts = unwrapValue(countsForSetting(ascending, 2.5));
    expect(counts).toBeGreaterThan(5200);
    expect(counts).toBeLessThan(7100);
    expect(unwrapValue(settingForCounts(ascending, counts))).toBeCloseTo(2.5, 9);
  });
});
