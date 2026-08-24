import { describe, expect, it } from "vitest";
import {
  comparability,
  dimensionChanges,
  rangesOverlap,
  recommendationChange,
  type ComparabilityInput,
  type DimensionSample,
} from "@/core/comparison";
import { CALIBRATION_MODEL_V2, SCORING_MODEL_V2 } from "@/core/params";
import { DIMENSION_KEYS } from "@/core/types/vocabulary";

/**
 * Session comparison (doc 17 §17.9, `SENS-BR-019`).
 *
 * The property that matters most here is the negative one: overlapping ranges must never
 * produce a "meaningful change" verdict. A product that told players they had improved when
 * the measurement could not support it would be lying in the most rewarding direction, so
 * that case gets the most attention.
 */

const OPTIONS = {
  perSigma: SCORING_MODEL_V2.params.displayScaling.perSigma,
  level: CALIBRATION_MODEL_V2.params.statistics.credibleIntervalLevel,
};

const BASE: ComparabilityInput = {
  hardwareProfileId: "profile-a",
  dpi: 800,
  environmentClass: "pass",
  mode: "standard",
  scoringVersion: "scoring_model_v2",
  calibrationVersion: "calibration_model_v2",
  confidenceVersion: "confidence_model_v1",
};

describe("comparability — doc 17 §17.9", () => {
  it("is comparable only when every field matches", () => {
    expect(comparability(BASE, BASE)).toEqual({ comparable: true, differences: [] });
  });

  it("names specifically what differed, in the documented order", () => {
    const other: ComparabilityInput = {
      hardwareProfileId: "profile-b",
      dpi: 1600,
      environmentClass: "degraded",
      mode: "quick",
      scoringVersion: "scoring_model_v1",
      calibrationVersion: "calibration_model_v1",
      confidenceVersion: "confidence_model_v2",
    };
    expect(comparability(BASE, other)).toEqual({
      comparable: false,
      differences: [
        "hardware_profile",
        "dpi",
        "environment_class",
        "mode",
        "scoring_version",
        "calibration_version",
        "confidence_version",
      ],
    });
  });

  it("treats an unknown hardware profile as a difference rather than a match", () => {
    // Two ad-hoc sessions are not known to be the same setup, and "both unknown" is exactly
    // the case where a false match would be most tempting.
    const adHoc = { ...BASE, hardwareProfileId: null };
    expect(comparability(adHoc, adHoc).differences).toEqual(["hardware_profile"]);
    expect(comparability(BASE, adHoc).differences).toEqual(["hardware_profile"]);
  });

  it("flags one difference at a time", () => {
    expect(comparability(BASE, { ...BASE, dpi: 400 }).differences).toEqual(["dpi"]);
    expect(comparability(BASE, { ...BASE, mode: "advanced" }).differences).toEqual(["mode"]);
  });
});

describe("the change verdict — the conservative rule", () => {
  const range = (low: number, high: number) => ({ low, high });

  it("calls a change meaningful only when the ranges do not overlap", () => {
    const change = recommendationChange(
      { cm360: 34.1, range: range(33, 35.5) },
      { cm360: 28.0, range: range(27, 29.5) },
    );
    expect(change.verdict).toBe("meaningful");
    expect(change.direction).toBe("faster");
    expect(change.percent).toBeCloseTo(((28 - 34.1) / 34.1) * 100, 9);
  });

  it("calls overlapping ranges within-noise however far apart the points are", () => {
    // doc 17's own example: 34.1 → 31.2 with overlapping ranges is not a demonstrated change.
    const change = recommendationChange(
      { cm360: 34.1, range: range(30, 38) },
      { cm360: 31.2, range: range(28, 36) },
    );
    expect(change.verdict).toBe("within_noise");
    expect(change.fromCm360).toBe(34.1);
    expect(change.toCm360).toBe(31.2);
  });

  it("treats touching ranges as overlapping", () => {
    // The stricter reading of the boundary: equality is not separation.
    expect(rangesOverlap(range(30, 32), range(32, 34))).toBe(true);
    expect(
      recommendationChange({ cm360: 31, range: range(30, 32) }, { cm360: 33, range: range(32, 34) })
        .verdict,
    ).toBe("within_noise");
    expect(rangesOverlap(range(30, 32), range(32.0001, 34))).toBe(false);
  });

  it("cannot call a change when a range is missing", () => {
    const noRange = recommendationChange(
      { cm360: 30, range: null },
      { cm360: 24, range: range(20, 26) },
    );
    expect(noRange.verdict).toBe("within_noise");

    const noPoint = recommendationChange(
      { cm360: null, range: null },
      { cm360: 24, range: range(20, 26) },
    );
    expect(noPoint.verdict).toBe("not_available");
    expect(noPoint.percent).toBeNull();
    expect(noPoint.direction).toBeNull();
  });

  it("reports the direction in cm/360 terms, where larger is slower", () => {
    expect(
      recommendationChange({ cm360: 30, range: range(29, 31) }, { cm360: 40, range: range(39, 41) })
        .direction,
    ).toBe("slower");
    expect(
      recommendationChange({ cm360: 30, range: range(29, 31) }, { cm360: 30, range: range(29, 31) })
        .direction,
    ).toBe("unchanged");
  });
});

describe("dimension deltas", () => {
  const sample = (score: number | null, n: number): DimensionSample[] =>
    DIMENSION_KEYS.map((dimension) => ({ dimension, score, n, provisional: true }));

  it("needs a delta larger than both sessions' sampling error", () => {
    // 100 trials each: SE ≈ 1.25 points a side, so the tolerance is ≈ 2.9 at the 90% level.
    const changes = dimensionChanges(sample(50, 100), sample(56, 100), OPTIONS);
    expect(changes).toHaveLength(DIMENSION_KEYS.length);
    for (const change of changes) {
      expect(change.delta).toBe(6);
      expect(change.tolerance).toBeGreaterThan(0);
      expect(change.meaningful).toBe(true);
    }
  });

  it("calls the same delta within-noise when the samples are small", () => {
    // 4 trials each: the same six points is well inside what four trials can resolve.
    const changes = dimensionChanges(sample(50, 4), sample(56, 4), OPTIONS);
    for (const change of changes) {
      expect(change.meaningful).toBe(false);
      expect(change.tolerance ?? 0).toBeGreaterThan(6);
    }
  });

  it("is symmetric in direction and monotone in sample size", () => {
    const up = dimensionChanges(sample(40, 60), sample(50, 60), OPTIONS)[0];
    const down = dimensionChanges(sample(50, 60), sample(40, 60), OPTIONS)[0];
    expect(up?.delta).toBe(10);
    expect(down?.delta).toBe(-10);
    expect(up?.meaningful).toBe(down?.meaningful);

    const small = dimensionChanges(sample(50, 10), sample(56, 10), OPTIONS)[0];
    const large = dimensionChanges(sample(50, 200), sample(56, 200), OPTIONS)[0];
    expect(large?.tolerance ?? 0).toBeLessThan(small?.tolerance ?? 0);
  });

  it("declines to compare a dimension either session did not score", () => {
    const missingSide = dimensionChanges(sample(50, 40), sample(null, 0), OPTIONS)[0];
    expect(missingSide?.delta).toBeNull();
    expect(missingSide?.meaningful).toBe(false);

    const absent = dimensionChanges(sample(50, 40), [], OPTIONS)[0];
    expect(absent?.to).toBeNull();
    expect(absent?.meaningful).toBe(false);

    // A dimension scored from zero trials cannot carry a tolerance, so it is never meaningful.
    const zeroTrials = dimensionChanges(sample(50, 0), sample(90, 0), OPTIONS)[0];
    expect(zeroTrials?.meaningful).toBe(false);
    expect(zeroTrials?.tolerance).toBeNull();
  });

  it("carries the provisional flag through from either side", () => {
    const a = sample(50, 40).map((entry) => ({ ...entry, provisional: false }));
    const b = sample(56, 40);
    expect(dimensionChanges(a, a, OPTIONS)[0]?.provisional).toBe(false);
    expect(dimensionChanges(a, b, OPTIONS)[0]?.provisional).toBe(true);
  });
});
