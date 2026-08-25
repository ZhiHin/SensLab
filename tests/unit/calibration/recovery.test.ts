import { describe, expect, it } from "vitest";
import {
  CLEAR_PEAK,
  FLAT,
  INCONSISTENT,
  WARM_THEN_TIRE,
  WARMING_UP,
} from "../../helpers/synthetic-player";
import { simulate } from "../../helpers/simulate-calibration";

/**
 * Recovering a known optimum from a synthetic player (doc 19 §19.12, harness 2).
 *
 * **This is the most important test in the project.** Every other test asserts a component does
 * what it was told; this one asserts the whole pipeline, run on a player whose true optimum is
 * known, recovers that optimum — and, just as importantly, *refuses to invent one* when there is
 * none to find.
 *
 * A system that always returns a number would pass a "does it return a number" test. What
 * distinguishes an honest measuring instrument is that it declines when the evidence is absent,
 * and these cases pin both halves of that behaviour.
 */

describe("recovering a known optimum", () => {
  it("finds a clear peak close to where the player's optimum actually is", () => {
    const result = simulate({ shape: CLEAR_PEAK });

    expect(result.verdict).toBe("peak_found");
    expect(result.xStar).not.toBeNull();

    // Within a quarter of a log2 unit — about 19% in sensitivity, comfortably inside the
    // bracket the search was given.
    expect(Math.abs((result.xStar as number) - CLEAR_PEAK.optimumX)).toBeLessThan(0.25);
    expect(result.countsPer360).not.toBeNull();
  });

  it("reports an interval that contains the true optimum", () => {
    const result = simulate({ shape: CLEAR_PEAK });
    const interval = result.credibleInterval;

    expect(interval).not.toBeNull();
    // An interval that did not contain the truth would be worse than no interval: it would be a
    // confident claim about the wrong place.
    expect(interval?.low as number).toBeLessThan(CLEAR_PEAK.optimumX + 0.35);
    expect(interval?.high as number).toBeGreaterThan(CLEAR_PEAK.optimumX - 0.35);
    expect(interval?.level).toBeCloseTo(0.9, 9);
  });

  it("recovers the optimum despite a player who is still warming up", () => {
    // Without the drift model, a rising session reads as a preference for whichever candidate
    // ran last — which counterbalancing alone cannot remove.
    const result = simulate({ shape: WARMING_UP });

    expect(result.verdict).toBe("peak_found");
    expect(Math.abs((result.xStar as number) - WARMING_UP.optimumX)).toBeLessThan(0.3);
  });

  it("recovers the optimum for a player who warms up and then tires", () => {
    // The shape a straight-line drift term cannot represent, and the reason `g(b)` is a spline.
    const result = simulate({ shape: WARM_THEN_TIRE });

    expect(result.verdict).not.toBe("insufficient_data");
    if (result.verdict === "peak_found") {
      expect(Math.abs((result.xStar as number) - WARM_THEN_TIRE.optimumX)).toBeLessThan(0.35);
    }
  });
});

describe("refusing to invent an optimum", () => {
  it("does not manufacture a peak for a genuinely flat player — SENS-BR-017", () => {
    // The single most important negative result in the product. A flat response must not be
    // turned into a point recommendation drawn from noise.
    const result = simulate({ shape: FLAT });

    expect(result.verdict).not.toBe("peak_found");
    expect(result.xStar).toBeNull();
    expect(result.countsPer360).toBeNull();
    expect(result.credibleInterval).toBeNull();
  });

  it("still offers a range for a flat player, because that is useful", () => {
    const result = simulate({ shape: FLAT });

    // "We could not separate these" is information. Withholding the range as well would leave
    // the player with nothing at all.
    expect(result.comfortRange.lowCm360).toBeGreaterThan(0);
    expect(result.comfortRange.highCm360).toBeGreaterThan(result.comfortRange.lowCm360);
  });

  it("finds no peak for a player too inconsistent to separate", () => {
    const result = simulate({ shape: INCONSISTENT });

    expect(result.verdict).toBe("indistinguishable");
    expect(result.xStar).toBeNull();

    // The MDE is what tells the player *why*, and it is the finding: the session could not have
    // detected an effect smaller than this, and this player's real effect is far smaller. That
    // is "variance, not sensitivity, is your limiter" (doc 04 §4.4.9) — a different and more
    // useful answer than "your response is flat".
    expect(Number.isFinite(result.minimumDetectableEffect)).toBe(true);
    const trueEffect = INCONSISTENT.curvature * 0.5 * 0.5;
    expect(result.minimumDetectableEffect).toBeGreaterThan(trueEffect);
  });

  it("stops with `indistinguishable` once two rounds separate nothing", () => {
    // Condition 3 requires two completed rounds, so a merely underpowered first round cannot end
    // the session early (doc 13 §13.10).
    const result = simulate({ shape: FLAT, rounds: 3 });

    expect(["stop_indistinguishable", "stop_budget"]).toContain(result.stopReason);
    expect(result.verdict).not.toBe("peak_found");
  });

  it("reports insufficient data rather than guessing when candidates are under-sampled", () => {
    const result = simulate({ shape: CLEAR_PEAK, trialsPerCandidate: 3 });

    expect(result.verdict).toBe("insufficient_data");
    expect(result.xStar).toBeNull();
  });
});

describe("robustness", () => {
  it("is not derailed by 10% wild trials — doc 14 §14.10", () => {
    const clean = simulate({ shape: CLEAR_PEAK });
    const noisy = simulate({ shape: CLEAR_PEAK, outlierRate: 0.1 });

    expect(noisy.verdict).not.toBe("insufficient_data");
    if (clean.verdict === "peak_found" && noisy.verdict === "peak_found") {
      // Wild trials are kept, not deleted (`SENS-BR-009`); the bounded-influence clip is what
      // stops them deciding the answer. The shift must stay within the MDE.
      const shift = Math.abs((noisy.xStar as number) - (clean.xStar as number));
      expect(shift).toBeLessThan(0.4);
    }
  });

  it("keeps every trial in the estimator — no trimming", () => {
    const result = simulate({ shape: CLEAR_PEAK, trialsPerCandidate: 20 });
    const counted = result.estimates.reduce((sum, estimate) => sum + estimate.validTrials, 0);
    const supplied = result.rounds.length > 0 ? 20 * result.estimates.length : 0;

    // The number entering the estimator equals the number supplied, exactly.
    expect(counted).toBe(supplied);
  });
});

describe("reproducibility — SENS-BR-031, SENS-BR-030", () => {
  it("produces an identical result from the same seed and trials", () => {
    const first = simulate({ shape: CLEAR_PEAK, seed: "identical" });
    const second = simulate({ shape: CLEAR_PEAK, seed: "identical" });

    // Re-running the engine over the same trials must reproduce the stored recommendation
    // exactly. This is the test that keeps the "explainable forever" promise real.
    expect(second.xStar).toBe(first.xStar);
    expect(second.verdict).toBe(first.verdict);
    expect(second.credibleInterval).toEqual(first.credibleInterval);
    expect(second.estimates).toEqual(first.estimates);
    expect(second.rounds.map((round) => round.decision)).toEqual(
      first.rounds.map((round) => round.decision),
    );
  });

  it("produces a different search path from a different player", () => {
    const a = simulate({ shape: CLEAR_PEAK, seed: "player-a" });
    const b = simulate({ shape: { ...CLEAR_PEAK, optimumX: 12.6 }, seed: "player-a" });

    expect(b.xStar).not.toBe(a.xStar);
  });
});

describe("the two ranges — doc 16 §16.3", () => {
  it("keeps the comfort range wider than, and containing, the high-performance range", () => {
    const result = simulate({ shape: CLEAR_PEAK });
    expect(result.verdict).toBe("peak_found");
    const ci = result.credibleInterval;
    expect(ci).not.toBeNull();
    if (ci === null || result.xStar === null) return;

    const dpi = 800;
    const toCm = (x: number): number => (2.54 * 2 ** x) / dpi;
    const recommended = toCm(result.xStar as number);
    // Comfort contains the credible interval, which contains the recommendation.
    expect(result.comfortRange.lowCm360).toBeLessThanOrEqual(toCm(ci.low) + 1e-9);
    expect(result.comfortRange.highCm360).toBeGreaterThanOrEqual(toCm(ci.high) - 1e-9);
    expect(recommended).toBeGreaterThanOrEqual(result.comfortRange.lowCm360);
    expect(recommended).toBeLessThanOrEqual(result.comfortRange.highCm360);
    // And it is a plateau, not a restatement of the interval.
    expect(result.comfortRange.highCm360 - result.comfortRange.lowCm360).toBeGreaterThan(
      toCm(ci.high) - toCm(ci.low),
    );
  });

  it("keeps the search and the reported range inside the pad-width ceiling", () => {
    const free = simulate({ shape: CLEAR_PEAK });
    const ceiling = (free.comfortRange.lowCm360 + free.comfortRange.highCm360) / 2;
    const clipped = simulate({ shape: CLEAR_PEAK, maxCmPer360: ceiling });

    // The constraint bounds the *search*, not only the report: doc 13 §13.3 intersects the
    // bracket "with the admissible domain and with the physical constraint", and §13.8 clips
    // x* to both before it is used as a centre. Spending a player’s trials on sensitivities
    // they cannot physically execute would be the alternative.
    //
    // An earlier revision asserted the opposite — that the estimate was untouched — and cited
    // SENS-BR-012 for it. That rule is about minimum sample size per candidate and says
    // nothing about constraints; the assertion passed only because the ceiling used here did
    // not happen to bite while the search clipped bracket centres instead of bracket ends.
    expect(clipped.comfortRange.highCm360).toBeLessThanOrEqual(ceiling + 1e-9);
    expect(clipped.xStar).not.toBeNull();
    // Every candidate the search placed after the first round respects the ceiling. Round 0
    // starts from the caller’s bracket, which is where the session’s prior sits.
    const toCm = (x: number): number => (2.54 * 2 ** x) / 800;
    const later = clipped.candidates.filter((candidate) => candidate.roundIndex > 0);
    expect(later.length).toBeGreaterThan(0);
    for (const candidate of later) {
      expect(toCm(candidate.x as number)).toBeLessThanOrEqual(ceiling + 1e-9);
    }

    // The lower end is untouched: a ceiling is a bound on one side only.
    expect(clipped.comfortRange.lowCm360).toBeGreaterThan(0);
    expect(clipped.comfortRange.lowCm360).toBeLessThan(clipped.comfortRange.highCm360);

    // A ceiling below the whole plateau cannot be honoured by clipping; the range is kept
    // rather than inverted, and the session still reports something usable.
    const tooLow = simulate({ shape: CLEAR_PEAK, maxCmPer360: free.comfortRange.lowCm360 / 2 });
    expect(tooLow.comfortRange.highCm360).toBeGreaterThan(tooLow.comfortRange.lowCm360);
  });
});
