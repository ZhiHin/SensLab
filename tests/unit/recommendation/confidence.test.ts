import { describe, expect, it } from "vitest";
import {
  CONFIDENCE_COMPONENT_KEYS,
  applyValidationMultiplier,
  computeConfidence,
  largestDetractor,
  type ConfidenceInputs,
} from "@/core/confidence";
import { CONFIDENCE_MODEL_V1 } from "@/core/params";

/**
 * The confidence index (doc 15), against the testing requirements of §15.9 and the worked
 * example of §15.4.
 */

const PARAMS = CONFIDENCE_MODEL_V1.params;
const VERSION = CONFIDENCE_MODEL_V1.version;

/** The clean Standard session of doc 15 §15.4. */
const CLEAN: ConfidenceInputs = {
  verdict: "peak_found",
  // W ≈ 0.159 log2 → C_peak ≈ 0.78
  credibleInterval: { low: 13.0, high: 13.159 },
  // 96% of target → C_sample ≈ 0.98
  effectiveValidTrials: 96,
  targetTrials: 100,
  // rCV 0.12 → C_consistency ≈ 0.71
  trialScoreRcv: 0.12,
  // raw input, 98.5% clean frames, no losses → C_env ≈ 0.985
  environment: {
    rawInputEffective: true,
    cleanFrameFraction: 0.985,
    pointerLockLosses: 0,
    windowResized: false,
  },
  // 0.10 score units → C_drift ≈ 0.83
  drift: { deltaFirstToLast: 0.1, form: "spline" },
  // adjusted R² 0.86 over 9 points
  fit: { rSquaredAdjusted: 0.86, distinctSensitivities: 9 },
  // anchor within noise: t ≈ 1.1 → ≈ 0.95
  anchor: { deltaScore: 0.11, standardError: 0.1 },
};

const compute = (inputs: ConfidenceInputs) => computeConfidence(inputs, PARAMS, VERSION);
const value = (inputs: ConfidenceInputs, key: string): number =>
  compute(inputs).components.find((c) => c.key === key)?.value ?? Number.NaN;

describe("the worked example — doc 15 §15.4", () => {
  it("reproduces the component values", () => {
    expect(value(CLEAN, "peak")).toBeCloseTo(0.78, 1);
    expect(value(CLEAN, "sample")).toBeCloseTo(0.98, 2);
    expect(value(CLEAN, "consistency")).toBeCloseTo(0.71, 1);
    expect(value(CLEAN, "environment")).toBeCloseTo(0.985, 2);
    expect(value(CLEAN, "drift")).toBeCloseTo(0.83, 1);
    expect(value(CLEAN, "fit")).toBeCloseTo(0.86, 2);
    expect(value(CLEAN, "anchor")).toBeCloseTo(0.95, 1);
  });

  it("lands near the documented index", () => {
    // doc 15 works the example to 79 with C_env = 0.97; ours is 0.985, a point higher.
    const outcome = compute(CLEAN);
    expect(outcome.index).toBeGreaterThanOrEqual(78);
    expect(outcome.index).toBeLessThanOrEqual(81);
    expect(outcome.verdictCapped).toBe(false);
  });

  it("drops to the documented neighbourhood without raw input and with dropped frames", () => {
    const degraded = compute({
      ...CLEAN,
      environment: { ...CLEAN.environment, rawInputEffective: false, cleanFrameFraction: 0.94 },
    });
    expect(
      value(
        {
          ...CLEAN,
          environment: { ...CLEAN.environment, rawInputEffective: false, cleanFrameFraction: 0.94 },
        },
        "environment",
      ),
    ).toBeCloseTo(0.8, 2);
    expect(degraded.index).toBeGreaterThanOrEqual(74);
    expect(degraded.index).toBeLessThanOrEqual(77);
  });

  it("caps a flat curve at 40 even when every other component is good", () => {
    const flat = compute({ ...CLEAN, verdict: "indistinguishable" });
    expect(value({ ...CLEAN, verdict: "indistinguishable" }, "peak")).toBe(0.35);
    expect(flat.index).toBe(40);
    expect(flat.verdictCapped).toBe(true);
  });
});

describe("the properties doc 15 §15.9 requires", () => {
  it("is deterministic", () => {
    expect(compute(CLEAN)).toEqual(compute(CLEAN));
  });

  it("is monotone in every component", () => {
    const base = compute(CLEAN).index;
    const better: ConfidenceInputs[] = [
      { ...CLEAN, credibleInterval: { low: 13.0, high: 13.05 } },
      { ...CLEAN, effectiveValidTrials: 100 },
      { ...CLEAN, trialScoreRcv: 0.05 },
      { ...CLEAN, environment: { ...CLEAN.environment, cleanFrameFraction: 1 } },
      { ...CLEAN, drift: { deltaFirstToLast: 0, form: "spline" } },
      { ...CLEAN, fit: { rSquaredAdjusted: 0.99, distinctSensitivities: 9 } },
      { ...CLEAN, anchor: { deltaScore: 0, standardError: 0.1 } },
    ];
    for (const inputs of better) expect(compute(inputs).index).toBeGreaterThanOrEqual(base);

    const worse: ConfidenceInputs[] = [
      { ...CLEAN, credibleInterval: { low: 12.5, high: 13.5 } },
      { ...CLEAN, effectiveValidTrials: 40 },
      { ...CLEAN, trialScoreRcv: 0.6 },
      { ...CLEAN, environment: { ...CLEAN.environment, pointerLockLosses: 4 } },
      { ...CLEAN, drift: { deltaFirstToLast: 1.5, form: "linear_fallback" } },
      { ...CLEAN, fit: { rSquaredAdjusted: 0.3, distinctSensitivities: 9 } },
      { ...CLEAN, anchor: { deltaScore: 1, standardError: 0.1 } },
    ];
    for (const inputs of worse) expect(compute(inputs).index).toBeLessThanOrEqual(base);
  });

  it("never exceeds the ceiling", () => {
    const perfect = compute({
      ...CLEAN,
      credibleInterval: { low: 13, high: 13 },
      effectiveValidTrials: 1000,
      trialScoreRcv: 0,
      environment: {
        rawInputEffective: true,
        cleanFrameFraction: 1,
        pointerLockLosses: 0,
        windowResized: false,
      },
      drift: { deltaFirstToLast: 0, form: "spline" },
      fit: { rSquaredAdjusted: 1, distinctSensitivities: 9 },
      anchor: { deltaScore: 0, standardError: 1 },
    });
    expect(perfect.raw).toBeCloseTo(1, 6);
    expect(perfect.index).toBe(92);
    expect(perfect.index).toBeLessThanOrEqual(100 * PARAMS.ceiling);
  });

  it("has no floor: a bad session reads single digits", () => {
    const awful = compute({
      ...CLEAN,
      credibleInterval: { low: 11, high: 15 },
      effectiveValidTrials: 5,
      trialScoreRcv: 3,
      environment: {
        rawInputEffective: false,
        cleanFrameFraction: 0.5,
        pointerLockLosses: 10,
        windowResized: true,
      },
      drift: { deltaFirstToLast: 4, form: "linear_fallback" },
      fit: { rSquaredAdjusted: 0.1, distinctSensitivities: 9 },
      anchor: { deltaScore: 3, standardError: 0.1 },
    });
    expect(awful.index).toBeLessThan(10);
  });

  it("drives towards zero when one component collapses — the geometric-mean property", () => {
    const collapsed = compute({ ...CLEAN, effectiveValidTrials: 0 });
    expect(collapsed.index).toBeLessThan(10);
    expect(largestDetractor(compute({ ...CLEAN, effectiveValidTrials: 0 }))?.key).toBe("sample");
  });

  it("reports every component, naming the ones that were not measured", () => {
    const outcome = compute({ ...CLEAN, anchor: null, trialScoreRcv: null, fit: null });
    expect(outcome.components.map((c) => c.key)).toEqual(CONFIDENCE_COMPONENT_KEYS);
    for (const component of outcome.components) {
      expect(component.value).toBeGreaterThan(0);
      expect(component.value).toBeLessThanOrEqual(1);
    }
    const byKey = new Map(outcome.components.map((c) => [c.key, c]));
    expect(byKey.get("anchor")?.neutral).toBe(true);
    expect(byKey.get("anchor")?.value).toBe(PARAMS.neutral.anchorNotRun);
    expect(byKey.get("fit")?.neutral).toBe(true);
    expect(byKey.get("consistency")?.neutral).toBe(true);
  });

  it("treats a saturated fit neutrally rather than rewarding it", () => {
    const saturated = value(
      { ...CLEAN, fit: { rSquaredAdjusted: 1, distinctSensitivities: 3 } },
      "fit",
    );
    expect(saturated).toBe(PARAMS.neutral.fitSaturated);
  });

  it("prices a linear-fallback drift model", () => {
    const spline = value(CLEAN, "drift");
    const fallback = value(
      { ...CLEAN, drift: { ...CLEAN.drift, form: "linear_fallback" } },
      "drift",
    );
    expect(fallback).toBeCloseTo(spline * PARAMS.driftFallbackPenalty, 9);
  });

  it("floors the pointer-lock penalty and clamps the frame fraction", () => {
    const many = value(
      { ...CLEAN, environment: { ...CLEAN.environment, pointerLockLosses: 100 } },
      "environment",
    );
    expect(many).toBeCloseTo(0.985 * PARAMS.environment.pointerLockFloor, 6);
    const terrible = value(
      { ...CLEAN, environment: { ...CLEAN.environment, cleanFrameFraction: 0.1 } },
      "environment",
    );
    expect(terrible).toBeCloseTo(PARAMS.environment.cleanFrameFloor, 6);
  });
});

describe("after validation — doc 15 §15.8", () => {
  it("applies the multipliers and re-clamps to the ceiling and the verdict cap", () => {
    expect(applyValidationMultiplier(79, "improved", "peak_found", PARAMS)).toBe(85);
    expect(applyValidationMultiplier(79, "no_measurable_difference", "peak_found", PARAMS)).toBe(
      77,
    );
    expect(applyValidationMultiplier(79, "worse", "peak_found", PARAMS)).toBe(55);
    expect(applyValidationMultiplier(90, "improved", "peak_found", PARAMS)).toBe(92);
    expect(applyValidationMultiplier(40, "improved", "indistinguishable", PARAMS)).toBe(40);
  });
});
