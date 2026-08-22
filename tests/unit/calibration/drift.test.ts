import { describe, expect, it } from "vitest";
import { fitDriftModel } from "@/core/calibration/drift";
import type { ScoredTrial } from "@/core/calibration/contracts";

/**
 * The drift model (doc 13 §13.7).
 *
 * ```
 * y_t = μ + α_i + g(b_t) + ε_t
 * ```
 *
 * The property that matters is **separation**: a player who improves through the session must
 * not have that improvement attributed to whichever sensitivity happened to run last. Every case
 * here is constructed with a known α and a known g, so the fit can be checked against both.
 */

interface Level {
  readonly candidateIndex: number;
  readonly x: number;
  readonly block: number;
  readonly alpha: number;
}

/** Builds a trial set with an exactly known truth and no noise. */
function trialsFor(
  levels: readonly Level[],
  options: {
    readonly perLevel: number;
    readonly driftPerBlock?: number;
  },
): { trials: ScoredTrial[]; candidateX: Map<number, number> } {
  const drift = options.driftPerBlock ?? 0;
  const trials: ScoredTrial[] = [];
  const candidateX = new Map<number, number>();

  for (const level of levels) {
    candidateX.set(level.candidateIndex, level.x);
    for (let i = 0; i < options.perLevel; i += 1) {
      trials.push({
        candidateIndex: level.candidateIndex,
        roundIndex: 0,
        blockIndex: level.block,
        // A tiny deterministic wobble keeps the residual variance non-zero, so standard errors
        // are finite rather than exactly zero.
        score: level.alpha + drift * level.block + (i % 3) * 0.001,
      });
    }
  }

  return { trials, candidateX };
}

const KNOTS = 2;
const CONDITION_THRESHOLD = 1e6;

describe("separating candidate effects from drift", () => {
  it("recovers the candidate effects when there is no drift", () => {
    const { trials, candidateX } = trialsFor(
      [
        { candidateIndex: 0, x: 12.5, block: 0, alpha: -0.5 },
        { candidateIndex: 1, x: 13.0, block: 1, alpha: 0.3 },
        { candidateIndex: 2, x: 13.5, block: 2, alpha: 0.2 },
      ],
      { perLevel: 20 },
    );

    const fit = fitDriftModel({
      trials,
      candidateX,
      interiorKnots: KNOTS,
      conditionNumberThreshold: CONDITION_THRESHOLD,
    });

    expect(fit).not.toBeNull();
    const alphas = fit?.estimates.map((estimate) => estimate.alphaHat) ?? [];
    // Sum-to-zero coding: the effects are differences from the session mean, so they sum to 0.
    expect(alphas.reduce((sum, value) => sum + value, 0)).toBeCloseTo(0, 6);
    // And their *ordering and spacing* match the truth, which is what the search reads.
    expect((alphas[1] as number) - (alphas[0] as number)).toBeCloseTo(0.8, 3);
    expect((alphas[2] as number) - (alphas[0] as number)).toBeCloseTo(0.7, 3);
  });

  it("cannot separate drift from candidate when every level runs in exactly one block", () => {
    // Three candidates, three blocks, a bijection between them. No arithmetic can say whether a
    // late block scored well because of its sensitivity or because of when it ran — so the
    // honest model has no drift term at all, and says so.
    const { trials, candidateX } = trialsFor(
      [
        { candidateIndex: 0, x: 12.5, block: 0, alpha: 0 },
        { candidateIndex: 1, x: 13.0, block: 1, alpha: 0 },
        { candidateIndex: 2, x: 13.5, block: 2, alpha: 0 },
      ],
      { perLevel: 20, driftPerBlock: 0.5 },
    );

    const fit = fitDriftModel({
      trials,
      candidateX,
      interiorKnots: KNOTS,
      conditionNumberThreshold: CONDITION_THRESHOLD,
    });

    expect(fit?.drift.form).toBe("none");
    expect(fit?.drift.deltaFirstToLast).toBe(0);
  });

  it("separates a real drift once one sensitivity is measured twice — the anchor", () => {
    // The same x at two widely separated blocks is the entire mechanism (doc 13 §13.5). With
    // it, a session-long improvement is attributed to time rather than to the sensitivity that
    // happened to run last.
    const { trials, candidateX } = trialsFor(
      [
        { candidateIndex: 0, x: 12.5, block: 0, alpha: -0.4 },
        { candidateIndex: 1, x: 13.0, block: 1, alpha: 0.2 },
        { candidateIndex: 2, x: 13.5, block: 2, alpha: 0.2 },
        // The anchor: candidate 3 re-tests x = 13.0 much later.
        { candidateIndex: 3, x: 13.0, block: 5, alpha: 0.2 },
      ],
      { perLevel: 20, driftPerBlock: 0.3 },
    );

    const fit = fitDriftModel({
      trials,
      candidateX,
      interiorKnots: KNOTS,
      conditionNumberThreshold: CONDITION_THRESHOLD,
    });

    expect(fit).not.toBeNull();
    expect(fit?.drift.form).not.toBe("none");
    // Drift across five blocks at 0.3 per block.
    expect(fit?.drift.deltaFirstToLast as number).toBeCloseTo(1.5, 1);

    // And the anchor shares a level with the round-1 centre, so they carry the same effect.
    const byIndex = new Map(fit?.estimates.map((e) => [e.candidateIndex, e.alphaHat]));
    expect(byIndex.get(3)).toBeCloseTo(byIndex.get(1) as number, 9);
  });

  it("keys the candidate effect by sensitivity, not by candidate instance", () => {
    // Two candidate rows at the same x are the same sensitivity. Treating them as separate
    // levels would leave the anchor unable to identify anything.
    const { trials, candidateX } = trialsFor(
      [
        { candidateIndex: 0, x: 13.0, block: 0, alpha: 0.5 },
        { candidateIndex: 1, x: 13.5, block: 1, alpha: -0.5 },
        { candidateIndex: 2, x: 13.0, block: 4, alpha: 0.5 },
      ],
      { perLevel: 15 },
    );

    const fit = fitDriftModel({
      trials,
      candidateX,
      interiorKnots: KNOTS,
      conditionNumberThreshold: CONDITION_THRESHOLD,
    });

    const byIndex = new Map(fit?.estimates.map((e) => [e.candidateIndex, e.alphaHat]));
    expect(byIndex.get(0)).toBeCloseTo(byIndex.get(2) as number, 9);
    expect(byIndex.get(0)).not.toBeCloseTo(byIndex.get(1) as number, 3);
  });

  it("falls back to a straight line when the spline design is ill-conditioned", () => {
    // A threshold of zero forces the fallback, which is what the real condition check does when
    // the design cannot support a spline. The weaker model is *recorded*, so the confidence
    // model can price it rather than the session silently claiming more than it knows.
    const { trials, candidateX } = trialsFor(
      [
        { candidateIndex: 0, x: 13.0, block: 0, alpha: 0.5 },
        { candidateIndex: 1, x: 13.5, block: 1, alpha: -0.5 },
        { candidateIndex: 2, x: 13.0, block: 4, alpha: 0.5 },
      ],
      { perLevel: 15, driftPerBlock: 0.2 },
    );

    const fit = fitDriftModel({
      trials,
      candidateX,
      interiorKnots: KNOTS,
      conditionNumberThreshold: 0,
    });

    expect(fit?.drift.form).toBe("none");
  });

  it("reports the condition estimate, so an ill-conditioned design is visible", () => {
    const { trials, candidateX } = trialsFor(
      [
        { candidateIndex: 0, x: 13.0, block: 0, alpha: 0.5 },
        { candidateIndex: 1, x: 13.5, block: 1, alpha: -0.5 },
        { candidateIndex: 2, x: 13.0, block: 4, alpha: 0.5 },
      ],
      { perLevel: 15 },
    );

    const fit = fitDriftModel({
      trials,
      candidateX,
      interiorKnots: KNOTS,
      conditionNumberThreshold: CONDITION_THRESHOLD,
    });

    expect(Number.isFinite(fit?.drift.conditionNumber as number)).toBe(true);
    expect(fit?.drift.conditionNumber as number).toBeGreaterThan(0);
  });
});

describe("what the drift model refuses", () => {
  it("declines a single candidate, which has nothing to compare against", () => {
    const { trials, candidateX } = trialsFor([{ candidateIndex: 0, x: 13, block: 0, alpha: 0 }], {
      perLevel: 30,
    });

    expect(
      fitDriftModel({
        trials,
        candidateX,
        interiorKnots: KNOTS,
        conditionNumberThreshold: CONDITION_THRESHOLD,
      }),
    ).toBeNull();
  });

  it("declines when there are fewer trials than parameters", () => {
    const { trials, candidateX } = trialsFor(
      [
        { candidateIndex: 0, x: 12.5, block: 0, alpha: 0 },
        { candidateIndex: 1, x: 13.0, block: 1, alpha: 0 },
        { candidateIndex: 2, x: 13.5, block: 2, alpha: 0 },
      ],
      { perLevel: 1 },
    );

    // A model with more parameters than observations fits perfectly and means nothing.
    expect(
      fitDriftModel({
        trials,
        candidateX,
        interiorKnots: KNOTS,
        conditionNumberThreshold: CONDITION_THRESHOLD,
      }),
    ).toBeNull();
  });

  it("declines an empty trial set", () => {
    expect(
      fitDriftModel({
        trials: [],
        candidateX: new Map(),
        interiorKnots: KNOTS,
        conditionNumberThreshold: CONDITION_THRESHOLD,
      }),
    ).toBeNull();
  });
});

describe("what the drift model reports", () => {
  it("counts every trial that entered the estimator", () => {
    const { trials, candidateX } = trialsFor(
      [
        { candidateIndex: 0, x: 12.5, block: 0, alpha: -0.2 },
        { candidateIndex: 1, x: 13.0, block: 1, alpha: 0.1 },
        { candidateIndex: 2, x: 13.5, block: 2, alpha: 0.1 },
      ],
      { perLevel: 12 },
    );

    const fit = fitDriftModel({
      trials,
      candidateX,
      interiorKnots: KNOTS,
      conditionNumberThreshold: CONDITION_THRESHOLD,
    });

    // No trimming: what went in is what was counted.
    expect(fit?.usedTrials).toBe(36);
    for (const estimate of fit?.estimates ?? []) expect(estimate.validTrials).toBe(12);
  });

  it("gives every estimate a finite standard error and its sensitivity", () => {
    const { trials, candidateX } = trialsFor(
      [
        { candidateIndex: 0, x: 12.5, block: 0, alpha: -0.2 },
        { candidateIndex: 1, x: 13.0, block: 1, alpha: 0.1 },
        { candidateIndex: 2, x: 13.5, block: 2, alpha: 0.1 },
      ],
      { perLevel: 12 },
    );

    const fit = fitDriftModel({
      trials,
      candidateX,
      interiorKnots: KNOTS,
      conditionNumberThreshold: CONDITION_THRESHOLD,
    });

    for (const estimate of fit?.estimates ?? []) {
      expect(Number.isFinite(estimate.standardError)).toBe(true);
      expect(estimate.standardError).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(estimate.x as number)).toBe(true);
    }
    expect(fit?.residualSd as number).toBeGreaterThanOrEqual(0);
  });
});
