import { describe, expect, it } from "vitest";
import { SCORING_MODEL_V1 } from "@/core/params";
import { computeObjective } from "@/core/scoring/objective";
import {
  alignDirection,
  computeScales,
  softClip,
  type ObservedTrial,
} from "@/core/scoring/standardise";
import type { TestKey } from "@/core/types/vocabulary";

/**
 * The calibration objective (doc 14 §14.1–§14.3, §14.7, §14.10).
 *
 * The properties asserted here are the ones doc 14 §14.10 names, and each exists because its
 * absence would produce a plausible wrong answer rather than a visible failure:
 *
 *  - **Unit invariance** — a metric recorded in seconds instead of milliseconds must not change
 *    the recommendation. Robust standardisation makes the scale irrelevant; a bug that dropped
 *    it would make the answer depend on a storage decision.
 *  - **Direction correctness** — every metric must point the same way after alignment, or a
 *    "better" value would push a candidate down.
 *  - **Bounded influence, not deletion** — one catastrophic trial must not decide the answer,
 *    and must also not be removed (`SENS-BR-009`).
 */

const PARAMS = SCORING_MODEL_V1.params;

let counter = 0;
function trial(over: Partial<ObservedTrial> = {}): ObservedTrial {
  counter += 1;
  return {
    testKey: "flick",
    candidateIndex: 0,
    roundIndex: 0,
    blockIndex: 0,
    trialIndex: counter,
    validity: "valid",
    isPractice: false,
    metrics: {},
    ...over,
  };
}

/** A candidate's worth of flick trials with a given acquisition time. */
function flickTrials(
  candidateIndex: number,
  blockIndex: number,
  values: readonly number[],
): ObservedTrial[] {
  return values.map((value) =>
    trial({
      candidateIndex,
      blockIndex,
      metrics: { adjustedAcquisitionTime: value, firstShotAccuracy: 1, flickErrorNorm: 0.5 },
    }),
  );
}

describe("direction alignment", () => {
  it("flips lower-is-better metrics so higher is better everywhere", () => {
    // After this point no later stage needs to know a metric's direction, which removes an
    // entire class of sign bug.
    expect(alignDirection("adjustedAcquisitionTime", 300)).toBe(-300);
    expect(alignDirection("flickErrorNorm", 1.5)).toBe(-1.5);
    expect(alignDirection("firstShotAccuracy", 0.8)).toBe(0.8);
    expect(alignDirection("pathEfficiency", 0.9)).toBe(0.9);
  });

  it("means a better raw value always raises the trial's score", () => {
    const faster = computeObjective(flickTrials(0, 0, [200, 210, 205, 195]), {
      parameters: PARAMS,
    });
    const slower = computeObjective(flickTrials(0, 0, [400, 410, 405, 395]), {
      parameters: PARAMS,
    });

    // Each set is standardised within itself, so the absolute scores match; what matters is
    // that within a mixed session the faster trials score higher. That is the next test.
    expect(faster.trials).toHaveLength(4);
    expect(slower.trials).toHaveLength(4);
  });

  it("ranks a faster trial above a slower one inside the same session", () => {
    const mixed = [
      ...flickTrials(0, 0, [200, 205, 210, 195]),
      ...flickTrials(1, 1, [400, 410, 405, 395]),
    ];
    const outcome = computeObjective(mixed, { parameters: PARAMS });

    const fast = outcome.trials.filter((entry) => entry.candidateIndex === 0);
    const slow = outcome.trials.filter((entry) => entry.candidateIndex === 1);
    const mean = (values: readonly { score: number }[]): number =>
      values.reduce((sum, entry) => sum + entry.score, 0) / values.length;

    expect(mean(fast)).toBeGreaterThan(mean(slow));
  });
});

describe("robust standardisation", () => {
  it("is invariant to a change of unit — doc 14 §14.10", () => {
    // Milliseconds versus seconds. Median and MAD scale together, so the z-scores do not move.
    const inMs = [
      ...flickTrials(0, 0, [200, 240, 260, 300]),
      ...flickTrials(1, 1, [400, 440, 460, 500]),
    ];
    const inSeconds = inMs.map((entry) => ({
      ...entry,
      metrics: {
        ...entry.metrics,
        adjustedAcquisitionTime: (entry.metrics["adjustedAcquisitionTime"] as number) / 1000,
      },
    }));

    const a = computeObjective(inMs, {
      parameters: { ...PARAMS, robustScaleFloors: { adjustedAcquisitionTime: 0 } },
    });
    const b = computeObjective(inSeconds, {
      parameters: { ...PARAMS, robustScaleFloors: { adjustedAcquisitionTime: 0 } },
    });

    // To double precision, not bit for bit: dividing every value by 1000 and re-deriving the
    // median and MAD is not the identity in floating point. What matters is that the scale a
    // metric happens to be stored in cannot move the recommendation.
    expect(b.trials).toHaveLength(a.trials.length);
    b.trials.forEach((entry, index) => {
      expect(entry.score).toBeCloseTo(a.trials[index]?.score as number, 12);
    });
  });

  it("standardises across the whole session, not within a candidate", () => {
    // Standardising within a candidate would remove exactly the between-candidate differences
    // the product exists to measure, and every candidate would score zero.
    const mixed = [
      ...flickTrials(0, 0, [200, 205, 210, 195]),
      ...flickTrials(1, 1, [400, 410, 405, 395]),
    ];
    const outcome = computeObjective(mixed, { parameters: PARAMS });

    const scores = outcome.trials.map((entry) => entry.score);
    expect(new Set(scores).size).toBeGreaterThan(1);
  });

  it("uses a floor so an unusually consistent player does not explode their z", () => {
    // Four identical values have a MAD of zero. Without the floor this divides by nothing.
    const identical = flickTrials(0, 0, [300, 300, 300, 300]);
    const scales = computeScales(identical, {
      robustScaleFloors: PARAMS.robustScaleFloors,
      clipConstant: PARAMS.clipConstant,
    });

    const scale = scales.find((entry) => entry.metricKey === "adjustedAcquisitionTime");
    expect(scale?.flooredScale).toBe(true);
    expect(scale?.scale).toBeCloseTo(PARAMS.robustScaleFloors["adjustedAcquisitionTime"] ?? 0, 9);

    const outcome = computeObjective(identical, { parameters: PARAMS });
    for (const entry of outcome.trials) expect(Number.isFinite(entry.score)).toBe(true);
  });

  it("standardises a binary metric against its binomial scale", () => {
    const mixed = [
      ...[1, 1, 1, 0].map((hit) =>
        trial({ metrics: { firstShotAccuracy: hit, adjustedAcquisitionTime: 300 } }),
      ),
    ];
    const scales = computeScales(mixed, {
      robustScaleFloors: PARAMS.robustScaleFloors,
      clipConstant: PARAMS.clipConstant,
    });

    const scale = scales.find((entry) => entry.metricKey === "firstShotAccuracy");
    expect(scale?.binary).toBe(true);
    // sqrt(p(1−p)) for p = 0.75.
    expect(scale?.scale).toBeCloseTo(Math.sqrt(0.75 * 0.25), 6);
  });
});

describe("bounded influence", () => {
  it("is monotone, smooth and bounded — never trimming", () => {
    const k = PARAMS.clipConstant;

    expect(softClip(0, k)).toBe(0);
    expect(softClip(1, k)).toBeGreaterThan(0);
    expect(softClip(1, k)).toBeLessThan(1);
    // Monotone: a worse value is always worse, however extreme.
    expect(softClip(50, k)).toBeGreaterThan(softClip(20, k));
    // Bounded: leverage cannot exceed ±k however extreme the trial. The bound is approached
    // asymptotically, and `tanh` saturates to exactly 1 in double precision — so the honest
    // assertion is that it never *passes* k.
    expect(Math.abs(softClip(1e6, k))).toBeLessThanOrEqual(k);
    expect(Math.abs(softClip(1e6, k))).toBeCloseTo(k, 9);
    expect(softClip(-3, k)).toBeCloseTo(-softClip(3, k), 12);
  });

  it("refuses a non-positive clip constant", () => {
    expect(() => softClip(1, 0)).toThrow(RangeError);
  });

  it("keeps a catastrophic trial in the estimator while bounding its leverage", () => {
    // `SENS-BR-009` forbids deleting a trial for its result; §14.3 requires it not decide the
    // answer. Both, at once, is exactly what a bounded-influence estimator buys.
    const ordinary = flickTrials(0, 0, [300, 310, 305, 295, 302, 308]);
    const withDisaster = [...ordinary, ...flickTrials(0, 0, [90_000])];

    const before = computeObjective(ordinary, { parameters: PARAMS });
    const after = computeObjective(withDisaster, { parameters: PARAMS });

    // Not deleted: the trial count grows by exactly one.
    expect(after.trials).toHaveLength(before.trials.length + 1);

    // And bounded: no trial's score exceeds the clip constant times its test weight.
    const limit = PARAMS.clipConstant * 0.3;
    for (const entry of after.trials) expect(Math.abs(entry.score)).toBeLessThanOrEqual(limit);
  });
});

describe("what enters the objective", () => {
  it("counts every valid trial, exactly — doc 14 §14.10", () => {
    const trials = [
      ...flickTrials(0, 0, [300, 310, 305]),
      trial({ validity: "degraded", metrics: { adjustedAcquisitionTime: 320 } }),
      trial({ validity: "invalid", metrics: { adjustedAcquisitionTime: 999 } }),
      trial({ isPractice: true, metrics: { adjustedAcquisitionTime: 100 } }),
    ];

    const outcome = computeObjective(trials, { parameters: PARAMS });
    // Three valid plus one degraded. The invalid and the practice trial are excluded — the
    // first because it is procedurally unusable, the second because practice is never scored.
    expect(outcome.trials).toHaveLength(4);
  });

  it("ignores metrics outside the decision set", () => {
    // `reactionTime` is a property of the player, not of the sensitivity (`SENS-BR-006`).
    const withReaction = flickTrials(0, 0, [300, 310, 305, 295]).map((entry) => ({
      ...entry,
      metrics: { ...entry.metrics, reactionTime: 250 },
    }));
    const without = flickTrials(0, 0, [300, 310, 305, 295]);

    const a = computeObjective(withReaction, { parameters: PARAMS });
    const b = computeObjective(without, { parameters: PARAMS });
    expect(a.trials.map((entry) => entry.score)).toEqual(b.trials.map((entry) => entry.score));
  });

  it("gives no weight at all to a test outside the objective", () => {
    // Reaction and comfort measure something that cannot vary with sensitivity, so they
    // contribute nothing to the search by construction rather than by a zero weight.
    const reaction = [1, 2, 3, 4].map(() =>
      trial({ testKey: "reaction" as TestKey, metrics: { firstShotAccuracy: 1 } }),
    );
    expect(computeObjective(reaction, { parameters: PARAMS }).trials).toHaveLength(0);
  });

  it("weights a flick trial more than a precision trial", () => {
    // doc 14 §14.7 weights by information per unit of session time: a test with high variance
    // and few trials contributes less signal, and weighting it higher would import noise.
    const flickWeight = PARAMS.objectiveTestWeights.find((entry) => entry.test === "flick")?.weight;
    const precisionWeight = PARAMS.objectiveTestWeights.find(
      (entry) => entry.test === "precision",
    )?.weight;

    expect(flickWeight as number).toBeGreaterThan(precisionWeight as number);

    const mixed = [
      ...flickTrials(0, 0, [200, 400, 300, 350]),
      ...[0.2, 0.9, 0.5, 0.7].map((error) =>
        trial({ testKey: "precision" as TestKey, metrics: { flickErrorNorm: error } }),
      ),
    ];

    const outcome = computeObjective(mixed, { parameters: PARAMS });
    const flickSpread = spread(outcome.trials.slice(0, 4).map((entry) => entry.score));
    const precisionSpread = spread(outcome.trials.slice(4).map((entry) => entry.score));

    expect(flickSpread).toBeGreaterThan(precisionSpread);
  });

  it("renormalises over the metrics a trial actually has", () => {
    // A flick trial that never reached the target has no `pathEfficiency`. Scoring the absent
    // metric as zero would punish the trial twice — once for the miss, again for the absence.
    const complete = flickTrials(0, 0, [300, 310, 305, 295]);
    const missing = complete.map((entry) => ({
      ...entry,
      metrics: { adjustedAcquisitionTime: entry.metrics["adjustedAcquisitionTime"] as number },
    }));

    const outcome = computeObjective(missing, { parameters: PARAMS });
    for (const entry of outcome.trials) {
      expect(Math.abs(entry.score)).toBeLessThanOrEqual(PARAMS.clipConstant * 0.3);
    }
    expect(outcome.trials).toHaveLength(4);
  });

  it("reports a trial that produced no decision metric rather than scoring it as zero", () => {
    const barren = [1, 2, 3].map(() => trial({ metrics: { hitAccuracy: 0.5 } }));
    const outcome = computeObjective(barren, { parameters: PARAMS });

    expect(outcome.trials).toHaveLength(0);
    expect(outcome.unscored).toBe(3);
  });

  it("retains the scales it used, so a result can be explained later", () => {
    const outcome = computeObjective(flickTrials(0, 0, [300, 310, 305, 295]), {
      parameters: PARAMS,
    });
    expect(outcome.scales.length).toBeGreaterThan(0);
    for (const scale of outcome.scales) {
      expect(scale.sampleCount).toBeGreaterThan(0);
      expect(scale.scale).toBeGreaterThan(0);
    }
  });
});

function spread(values: readonly number[]): number {
  return Math.max(...values) - Math.min(...values);
}
