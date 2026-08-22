import { describe, expect, it } from "vitest";
import type { TrialRecord } from "@/test-engine/contracts";
import { aggregateRound } from "@/test-engine/metrics/aggregate";

/**
 * Trial → round aggregation (doc 10 §10.7–§10.8).
 *
 * The two properties that matter most are both about honesty rather than arithmetic:
 *
 *  - **Robust estimators replace outlier removal.** A wild flick is a genuine performance event,
 *    not a measurement error, and `SENS-BR-009` forbids discarding it. So the median is used
 *    where a mean would let one bad trial outweigh ten good ones — which is precisely what
 *    removes any temptation to trim.
 *  - **Every value carries its sample counts.** A metric value without them cannot be weighted,
 *    compared or doubted, which makes it worse than no value at all.
 */

let nextIndex = 0;

function trial(over: Partial<TrialRecord> = {}): TrialRecord {
  nextIndex += 1;
  return {
    trialIndex: nextIndex,
    isPractice: false,
    validity: "valid",
    invalidReason: null,
    isReplacement: false,
    startOffsetMs: nextIndex * 1000,
    durationMs: 500,
    hit: true,
    shots: 1,
    targetAngularRadiusDeg: 2,
    targetDistanceDeg: 20,
    targetDirectionDeg: 0,
    stimulusSeed: `seed:${nextIndex}`,
    variant: null,
    qualityFlags: [],
    quality: { cleanFrameFraction: 1, hitchCount: 0, bufferOverflow: false },
    metrics: {},
    ...over,
  };
}

const OPTIONS = { seed: "aggregate-seed", roundIndex: 0, resamples: 200 } as const;

describe("central tendency", () => {
  it("takes the median for times, so one wild trial cannot dominate", () => {
    // Nine tidy trials and one catastrophic one. The mean would be 480; the median is 300.
    const trials = [
      ...[280, 290, 300, 300, 310, 320, 300, 295, 305].map((value) =>
        trial({ metrics: { targetAcquisitionTime: value } }),
      ),
      trial({ metrics: { targetAcquisitionTime: 2100 } }),
    ];

    const summary = aggregateRound(trials, OPTIONS)["targetAcquisitionTime"];
    expect(summary?.value).toBeCloseTo(300, 6);
    // The wild trial is kept and counted; it simply does not get to move the estimate.
    expect(summary?.validTrials).toBe(10);
  });

  it("pools hitAccuracy by shot count, not as a mean of ratios", () => {
    // Two trials: 1 hit from 1 shot, and 1 hit from 4 shots. Total hits over total shots is
    // 2/5 = 0.4. A mean of the per-trial ratios would give 0.625 — a different, wrong number.
    const trials = [
      trial({ shots: 1, metrics: { hitAccuracy: 1 } }),
      trial({ shots: 4, metrics: { hitAccuracy: 0.25 } }),
    ];

    expect(aggregateRound(trials, OPTIONS)["hitAccuracy"]?.value).toBeCloseTo(0.4, 9);
  });

  it("averages rates as proportions", () => {
    const trials = [
      trial({ metrics: { firstShotAccuracy: 1 } }),
      trial({ metrics: { firstShotAccuracy: 0 } }),
      trial({ metrics: { firstShotAccuracy: 1 } }),
      trial({ metrics: { firstShotAccuracy: 1 } }),
    ];

    expect(aggregateRound(trials, OPTIONS)["firstShotAccuracy"]?.value).toBeCloseTo(0.75, 9);
  });
});

describe("sample counts and validity", () => {
  it("counts valid, degraded and invalid separately, and scores only the first two", () => {
    const trials = [
      trial({ metrics: { flickErrorNorm: 1 } }),
      trial({ validity: "degraded", metrics: { flickErrorNorm: 3 } }),
      trial({ validity: "invalid", invalidReason: "focus_lost", metrics: { flickErrorNorm: 99 } }),
    ];

    const summary = aggregateRound(trials, OPTIONS)["flickErrorNorm"];
    expect(summary?.validTrials).toBe(1);
    expect(summary?.degradedTrials).toBe(1);
    expect(summary?.invalidTrials).toBe(1);
    // The invalid trial's value is excluded: it is procedurally unusable, which is a different
    // thing from being a bad result (`SENS-BR-009`).
    expect(summary?.value).toBeCloseTo(2, 6);
  });

  it("excludes practice trials entirely", () => {
    const trials = [
      trial({ isPractice: true, metrics: { flickErrorNorm: 50 } }),
      trial({ metrics: { flickErrorNorm: 1 } }),
      trial({ metrics: { flickErrorNorm: 3 } }),
    ];

    const summary = aggregateRound(trials, OPTIONS)["flickErrorNorm"];
    expect(summary?.value).toBeCloseTo(2, 6);
    expect(summary?.validTrials).toBe(2);
  });

  it("produces nothing at all for a round with no scorable trials", () => {
    const trials = [
      trial({ validity: "invalid", invalidReason: "timeout", metrics: { flickErrorNorm: 4 } }),
    ];
    expect(aggregateRound(trials, OPTIONS)).toEqual({});
  });
});

describe("uncertainty", () => {
  it("gives rates a Wilson interval that stays inside [0, 1]", () => {
    // Four out of four. The normal approximation would put the upper bound above 1, which is
    // not a possible value for a proportion.
    const trials = Array.from({ length: 4 }, () => trial({ metrics: { firstShotAccuracy: 1 } }));
    const summary = aggregateRound(trials, OPTIONS)["firstShotAccuracy"];

    expect(summary?.intervalLow as number).toBeGreaterThan(0);
    expect(summary?.intervalHigh as number).toBeLessThanOrEqual(1);
    expect(summary?.intervalLow as number).toBeLessThan(1);
  });

  it("gives everything else a bootstrap interval that brackets the estimate", () => {
    const trials = [280, 300, 320, 340, 360, 300, 310].map((value) =>
      trial({ metrics: { targetAcquisitionTime: value } }),
    );
    const summary = aggregateRound(trials, OPTIONS)["targetAcquisitionTime"];

    expect(summary?.intervalLow as number).toBeLessThanOrEqual(summary?.value as number);
    expect(summary?.intervalHigh as number).toBeGreaterThanOrEqual(summary?.value as number);
    expect(summary?.robustStandardDeviation as number).toBeGreaterThan(0);
  });

  it("reports no interval below three trials, rather than inventing one", () => {
    // A bootstrap can only resample the values it has. With two of them it has nothing to say
    // about spread, and a printed interval would imply evidence that does not exist.
    const trials = [300, 320].map((value) => trial({ metrics: { targetAcquisitionTime: value } }));
    const summary = aggregateRound(trials, OPTIONS)["targetAcquisitionTime"];

    expect(summary?.value).toBeCloseTo(310, 6);
    expect(summary?.intervalLow).toBeNull();
    expect(summary?.intervalHigh).toBeNull();
  });

  it("is reproducible from the seed — SENS-BR-031", () => {
    const trials = [280, 300, 320, 340, 360, 300, 310].map((value) =>
      trial({ metrics: { targetAcquisitionTime: value } }),
    );

    const first = aggregateRound(trials, OPTIONS)["targetAcquisitionTime"];
    const second = aggregateRound(trials, OPTIONS)["targetAcquisitionTime"];
    expect(second).toEqual(first);

    // The point estimate is seed-independent by construction — a median does not resample —
    // while the interval around it comes from the seeded stream. Both are asserted, because a
    // seed that leaked into the estimate would make the same session report different numbers
    // on every run.
    const other = aggregateRound(trials, { ...OPTIONS, seed: "different" })[
      "targetAcquisitionTime"
    ];
    expect(other?.value).toBeCloseTo(first?.value as number, 9);
    expect(other?.intervalLow as number).toBeLessThanOrEqual(other?.value as number);
    expect(other?.intervalHigh as number).toBeGreaterThanOrEqual(other?.value as number);
  });
});

describe("consistency", () => {
  it("is computed from the test's primary metric", () => {
    const steady = [300, 302, 298, 301, 299].map((value) =>
      trial({ metrics: { adjustedAcquisitionTime: value } }),
    );
    const erratic = [180, 420, 250, 500, 300].map((value) =>
      trial({ metrics: { adjustedAcquisitionTime: value } }),
    );

    const options = { ...OPTIONS, primaryMetricKey: "adjustedAcquisitionTime" };
    const steadyScore = aggregateRound(steady, options)["consistency"]?.value as number;
    const erraticScore = aggregateRound(erratic, options)["consistency"]?.value as number;

    expect(steadyScore).toBeGreaterThan(erraticScore);
    expect(steadyScore).toBeLessThanOrEqual(1);
    expect(erraticScore).toBeGreaterThan(0);
  });

  it("is absent when the test declares no primary metric", () => {
    // The comfort test's three sub-tasks measure different quantities; a single consistency
    // figure across them would describe none of them.
    const trials = [300, 320, 340].map((value) => trial({ metrics: { time180: value } }));
    expect(aggregateRound(trials, OPTIONS)["consistency"]).toBeUndefined();
  });

  it("carries the round's sample counts like every other aggregate", () => {
    const trials = [300, 302, 298].map((value) =>
      trial({ metrics: { adjustedAcquisitionTime: value } }),
    );
    const summary = aggregateRound(trials, {
      ...OPTIONS,
      primaryMetricKey: "adjustedAcquisitionTime",
    })["consistency"];

    expect(summary?.validTrials).toBe(3);
    expect(summary?.invalidTrials).toBe(0);
  });
});
