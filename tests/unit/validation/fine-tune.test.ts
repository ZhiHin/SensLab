import { describe, expect, it } from "vitest";
import { CALIBRATION_MODEL_V2 } from "@/core/params";
import type { CalibrationResult } from "@/core/calibration";
import {
  FINE_TUNE_LABELS,
  duelDecision,
  fineTuneCandidates,
  originalHeldUp,
  screeningRanking,
  validationOffer,
  type ValidationOutcome,
} from "@/core/validation";
import type { ResponseCurve } from "@/core/recommendation";

/**
 * Fine-tuning (doc 17 §17.7) and the offer rule (doc 17 §17.2).
 */

const OFFSETS = CALIBRATION_MODEL_V2.params.fineTune.offsets;

describe("the fine-tune candidates — doc 17 §17.7", () => {
  it("places five candidates around x*, symmetric in log space, revealed by position", () => {
    const specs = fineTuneCandidates(13, OFFSETS, { low: 10, high: 16 });
    expect(specs).toHaveLength(5);
    specs.forEach((spec, index) => expect(spec.x - 13).toBeCloseTo(OFFSETS[index] ?? 0, 12));
    expect(specs.map((spec) => spec.revealLabel)).toEqual([...FINE_TUNE_LABELS]);
    // Symmetric: the two on each side are mirror images, so neither direction is favoured.
    expect(specs[0]?.offset).toBeCloseTo(-(specs[4]?.offset ?? 0), 12);
    expect(specs[1]?.offset).toBeCloseTo(-(specs[3]?.offset ?? 0), 12);
    expect(specs[2]?.offset).toBe(0);
    // δ₂ explores inside the uncertainty: about 10% in sensitivity, not a re-calibration.
    expect(2 ** Math.abs(specs[4]?.offset ?? 0) - 1).toBeLessThan(0.15);
  });

  it("names a candidate the label table does not cover", () => {
    // A future parameter set could ship a different offset table; the reveal still says what
    // each candidate was rather than dropping the row.
    const specs = fineTuneCandidates(13, [-0.2, -0.1, 0, 0.1, 0.2, 0.3], { low: 10, high: 16 });
    expect(specs).toHaveLength(6);
    expect(specs[5]?.revealLabel).toBe("Offset 0.3");
  });

  it("clips to the admissible range and never measures the same sensitivity twice", () => {
    // A ceiling just above x* collapses the two upper candidates onto the bound.
    const specs = fineTuneCandidates(13, OFFSETS, { low: 12, high: 13.03 });
    expect(specs.length).toBeLessThan(5);
    expect(new Set(specs.map((spec) => spec.x)).size).toBe(specs.length);
    expect(Math.max(...specs.map((spec) => spec.x))).toBeLessThanOrEqual(13.03);
    // The label still names what the candidate was meant to be, not its clipped position.
    expect(specs.map((spec) => spec.revealLabel)).toContain("Lower");
  });
});

describe("screening — doc 17 §17.7 phase 1", () => {
  const estimate = (candidateIndex: number, x: number, mean: number) => ({
    candidateIndex,
    x,
    mean,
    standardError: 0.05,
    trials: 10,
  });

  it("ranks by the fitted quadratic when the screening blocks describe a curve", () => {
    // A concave set peaking at the middle candidate. The fit pools all five blocks, so the
    // ranking follows the shape rather than whichever single block ran luckiest.
    const ranked = screeningRanking([
      estimate(0, 12.86, -0.09),
      estimate(1, 12.94, -0.02),
      estimate(2, 13.0, 0.06),
      estimate(3, 13.06, -0.01),
      estimate(4, 13.14, -0.12),
    ]);
    expect(ranked[0]).toBe(2);
    expect(ranked).toHaveLength(5);
    expect(new Set(ranked).size).toBe(5);
  });

  it("falls back to the observed means when there is no concave fit", () => {
    const ranked = screeningRanking([
      estimate(0, 12.86, 0.4),
      estimate(1, 12.94, 0.1),
      estimate(2, 13.0, -0.2),
    ]);
    expect(ranked[0]).toBe(0);
  });
});

describe("the duel's early stop — doc 17 §17.7 phase 2", () => {
  const analysed = (
    verdict: "improved" | "worse" | "no_measurable_difference",
  ): ValidationOutcome =>
    ({
      kind: "analysed",
      verdict,
      composite: {
        delta: 0,
        ciLow: verdict === "improved" ? 0.1 : -1,
        ciHigh: verdict === "worse" ? -0.1 : 1,
        level: 0.9,
      },
      metrics: [],
      pairs: 2,
      blocks: 4,
      trials: { baseline: 24, candidate: 24 },
    }) as ValidationOutcome;

  it("stops as soon as the paired interval excludes zero, naming the winner", () => {
    expect(duelDecision(analysed("improved"), 1, 2)).toEqual({
      stop: true,
      winner: "B",
      reason: "interval_excludes_zero",
    });
    expect(duelDecision(analysed("worse"), 1, 2)).toEqual({
      stop: true,
      winner: "A",
      reason: "interval_excludes_zero",
    });
  });

  it("continues to a fixed budget when it cannot separate them, then stops with no winner", () => {
    expect(duelDecision(analysed("no_measurable_difference"), 1, 2)).toEqual({
      stop: false,
      winner: null,
      reason: "continue",
    });
    expect(duelDecision(analysed("no_measurable_difference"), 2, 2)).toEqual({
      stop: true,
      winner: null,
      reason: "budget_reached",
    });
    // The budget is what bounds the number of looks, and it is declared in the parameter set.
    expect(CALIBRATION_MODEL_V2.params.fineTune.duelQuartetBudget).toBeGreaterThan(0);
  });

  it("continues while the duel has not been analysed at all", () => {
    const outcome: ValidationOutcome = { kind: "insufficient", pairs: 0, required: 1 };
    expect(duelDecision(outcome, 0, 2).stop).toBe(false);
  });
});

describe("whether the original held up — doc 17 §17.7 output", () => {
  const result = (
    verdict: CalibrationResult["verdict"],
    interval: { low: number; high: number } | null,
  ): CalibrationResult =>
    ({
      verdict,
      credibleInterval: interval === null ? null : { ...interval, level: 0.9 },
    }) as CalibrationResult;

  it("holds up unless the refinement excludes the original", () => {
    // Inside the new interval: nothing changed, which doc 17 expects to be common.
    expect(originalHeldUp(result("peak_found", { low: 12.9, high: 13.1 }), 13)).toBe(true);
    // Outside it: the refinement is a genuinely different answer.
    expect(originalHeldUp(result("peak_found", { low: 13.2, high: 13.4 }), 13)).toBe(false);
    // No peak at all is not evidence against the original.
    expect(originalHeldUp(result("indistinguishable", null), 13)).toBe(true);
    expect(originalHeldUp(result("insufficient_data", null), 13)).toBe(true);
  });
});

describe("whether validation is offered — doc 17 §17.2", () => {
  const curve = (mde: number): ResponseCurve =>
    ({
      candidates: [],
      fit: { b0: -100, b1: 15, b2: -0.57, concave: true, r2Adj: 0.8 },
      band: [],
      xStar: null,
      comfortBand: { lo: 20, hi: 40 },
      constraint: null,
      currentSens: null,
      minimumDetectableEffect: mde,
      peakBeyondMeasured: null,
      dpi: 800,
    }) as unknown as ResponseCurve;

  const base = {
    verdict: "peak_found" as const,
    recommendedCm360: 26,
    currentCm360: 38,
    startingPointCm360: 30,
    highPerformance: { low: 24, high: 29 },
    curve: curve(0.05),
    alreadyValidated: false,
  };

  it("is offered when the player's sensitivity sits outside what the session could separate", () => {
    const offer = validationOffer(base);
    expect(offer.offered).toBe(true);
    expect(offer.reason).toBe("offered");
    expect(offer.baselineCm360).toBe(38);
    expect(offer.candidateCm360).toBe(26);
    expect(offer.predictedGap).not.toBeNull();
  });

  it("is not offered when the recommendation is effectively where the player already was", () => {
    const offer = validationOffer({ ...base, currentCm360: 27 });
    expect(offer.offered).toBe(false);
    expect(offer.reason).toBe("within_mde");
    // The numbers are still reported, so the page can say why rather than hiding the control.
    expect(offer.baselineCm360).toBe(27);
    expect(offer.candidateCm360).toBe(26);
  });

  it("falls back to the interval when there is no fitted curve to read a gap from", () => {
    const offer = validationOffer({ ...base, curve: null });
    expect(offer.offered).toBe(true);
    expect(offer.predictedGap).toBeNull();
    // And the interval still closes the offer when the player is already inside it.
    const inside = validationOffer({ ...base, curve: null, currentCm360: 27 });
    expect(inside.offered).toBe(false);
    expect(inside.reason).toBe("within_mde");
  });

  it("frames a cold start against the starting point", () => {
    const offer = validationOffer({ ...base, currentCm360: null });
    expect(offer.offered).toBe(true);
    expect(offer.reason).toBe("offered_vs_starting_point");
    expect(offer.baselineCm360).toBe(30);
  });

  it("has nothing to validate without a point estimate", () => {
    for (const verdict of ["indistinguishable", "insufficient_data"] as const) {
      const offer = validationOffer({ ...base, verdict, recommendedCm360: null });
      expect(offer.offered).toBe(false);
      expect(offer.reason).toBe("no_point_estimate");
    }
    // A cold start with no round-1 centre either.
    expect(validationOffer({ ...base, currentCm360: null, startingPointCm360: null }).reason).toBe(
      "no_point_estimate",
    );
  });

  it("is offered once", () => {
    expect(validationOffer({ ...base, alreadyValidated: true }).reason).toBe("already_validated");
  });
});
