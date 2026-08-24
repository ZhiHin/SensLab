import { describe, expect, it } from "vitest";
import {
  AIM_PROFILE_RULES_V1,
  CONFIDENCE_MODEL_V1,
  CURRENT_VERSIONS,
  REFERENCE_DIST_PROVISIONAL_V2,
  SCORING_MODEL_V2,
} from "@/core/params";
import {
  assembleRecommendation,
  buildResponseCurve,
  fitValueAt,
  type AssembleInputs,
} from "@/core/recommendation";
import type { ObservedTrial } from "@/core/scoring";
import { countsPer360 } from "@/core/types/brand";
import { createCalibrationRoundPlan, estimatedRoundSeconds } from "@/test-engine/plan";
import { SENSITIVITY_INDEPENDENT_TESTS, scoredTestsForMode } from "@/test-engine/tests";
import { CLEAR_PEAK, FLAT } from "../../helpers/synthetic-player";
import { simulate } from "../../helpers/simulate-calibration";

/**
 * Assembling the recommendation object (doc 16 §16.1) from a simulated calibration, and the
 * plan that a calibration round becomes (doc 13 §13.6).
 */

const ENVIRONMENT = {
  rawInputEffective: true,
  cleanFrameFraction: 0.99,
  pointerLockLosses: 0,
  windowResized: false,
};

/** Flick trials at a session-typical level, spread across the simulated candidates. */
function trialsFor(candidateIndices: readonly number[], perCandidate = 12): ObservedTrial[] {
  const trials: ObservedTrial[] = [];
  for (const candidateIndex of candidateIndices) {
    for (let i = 0; i < perCandidate; i += 1) {
      trials.push({
        testKey: "flick",
        candidateIndex,
        roundIndex: 0,
        blockIndex: candidateIndex,
        trialIndex: i,
        validity: i === 11 ? "invalid" : i % 6 === 5 ? "degraded" : "valid",
        isPractice: false,
        scopeKey: "hipfire",
        variant: null,
        metrics: {
          adjustedAcquisitionTime: 480 + (i % 4) * 20 + candidateIndex * 5,
          flickErrorNorm: 0.7 + (i % 3) * 0.05,
          firstShotAccuracy: i % 2,
          pathEfficiency: 0.75,
        },
      });
    }
  }
  return trials;
}

function inputsFor(calibration: AssembleInputs["calibration"]): AssembleInputs {
  return {
    calibration,
    trials: trialsFor(calibration.estimates.map((e) => e.candidateIndex)),
    dpi: 800,
    dpiSource: "known",
    currentCmPer360: 30,
    targetTrials: 200,
    environment: ENVIRONMENT,
    params: {
      scoring: SCORING_MODEL_V2.params,
      reference: REFERENCE_DIST_PROVISIONAL_V2.params,
      confidence: CONFIDENCE_MODEL_V1.params,
      aimProfile: AIM_PROFILE_RULES_V1.params,
    },
    versions: {
      scoring: CURRENT_VERSIONS.scoring,
      calibration: CURRENT_VERSIONS.calibration,
      confidence: CURRENT_VERSIONS.confidence,
      aimProfile: CURRENT_VERSIONS.aim_profile,
    },
  };
}

describe("assembling a peak_found recommendation", () => {
  const calibration = simulate({ shape: CLEAR_PEAK });
  const recommendation = assembleRecommendation(inputsFor(calibration));

  it("carries the canonical value in every unit, derived from counts", () => {
    expect(recommendation.verdict).toBe("peak_found");
    const { recommendedCountsPer360, recommendedCmPer360, degreesPerCm } = recommendation.canonical;
    expect(recommendedCountsPer360).not.toBeNull();
    expect(recommendedCmPer360).toBeCloseTo((2.54 * (recommendedCountsPer360 ?? 0)) / 800, 9);
    expect(degreesPerCm).toBeCloseTo(360 / (recommendedCmPer360 ?? 1), 9);
  });

  it("nests the ranges and contains the recommendation — doc 16 §16.3 invariants", () => {
    const { highPerformance, comfort } = recommendation.ranges;
    expect(highPerformance).not.toBeNull();
    if (highPerformance === null) return;
    const cm = recommendation.canonical.recommendedCmPer360 ?? 0;
    expect(comfort.lowCm360).toBeLessThanOrEqual(highPerformance.lowCm360 + 1e-9);
    expect(comfort.highCm360).toBeGreaterThanOrEqual(highPerformance.highCm360 - 1e-9);
    expect(cm).toBeGreaterThanOrEqual(highPerformance.lowCm360);
    expect(cm).toBeLessThanOrEqual(highPerformance.highCm360);
    expect(highPerformance.level).toBeCloseTo(0.9, 9);
  });

  it("produces a confidence index with seven components, under the ceiling", () => {
    const confidence = recommendation.quality.confidence;
    expect(confidence).not.toBeNull();
    expect(confidence?.components).toHaveLength(7);
    expect(confidence?.index).toBeGreaterThan(0);
    expect(confidence?.index).toBeLessThanOrEqual(92);
    expect(confidence?.version).toBe(CURRENT_VERSIONS.confidence);
  });

  it("keeps DPI provenance out of the index and in the settings reliability", () => {
    const assumed = assembleRecommendation({ ...inputsFor(calibration), dpiSource: "assumed" });
    expect(assumed.quality.confidence?.index).toBe(recommendation.quality.confidence?.index);
    expect(assumed.quality.settingsReliability).toBe("assumed_dpi");
    expect(recommendation.quality.settingsReliability).toBe("normal");
  });

  it("clips both ranges at the pad-width ceiling and keeps them nested — doc 16 §16.3", () => {
    const hp = recommendation.ranges.highPerformance;
    expect(hp).not.toBeNull();
    if (hp === null) return;
    // A ceiling inside the credible interval: the high-performance range is cut to it, and
    // the comfort range still contains what is left.
    const ceiling = (hp.lowCm360 + hp.highCm360) / 2;
    const clipped = assembleRecommendation(
      inputsFor({
        ...calibration,
        constraint: { maxCmPer360: ceiling, source: "pad_width", conflict: false },
      }),
    );
    expect(clipped.ranges.highPerformance?.highCm360).toBeCloseTo(ceiling, 9);
    expect(clipped.ranges.highPerformance?.lowCm360).toBeCloseTo(hp.lowCm360, 9);
    expect(clipped.ranges.comfort.lowCm360).toBeLessThanOrEqual(
      clipped.ranges.highPerformance?.lowCm360 ?? 0,
    );
    expect(clipped.ranges.constraint?.source).toBe("pad_width");

    // A ceiling below the whole interval cannot be honoured by clipping, and inventing a
    // reversed range would be worse than reporting what was measured.
    const below = assembleRecommendation(
      inputsFor({
        ...calibration,
        constraint: { maxCmPer360: hp.lowCm360 / 2, source: "measured", conflict: true },
      }),
    );
    expect(below.ranges.highPerformance?.highCm360).toBeCloseTo(hp.highCm360, 9);
  });

  it("builds a response curve that redraws without the fit", () => {
    const curve = recommendation.evidence.responseCurve;
    expect(curve.candidates.length).toBe(calibration.estimates.length);
    expect(curve.fit).not.toBeNull();
    expect(curve.band.length).toBeGreaterThan(10);
    expect(curve.xStar?.cm360).toBeCloseTo(recommendation.canonical.recommendedCmPer360 ?? 0, 9);
    expect(curve.currentSens?.cm360).toBe(30);
    expect(curve.candidates.some((c) => c.isAnchor)).toBe(true);
    // The fit evaluates to a maximum near the peak.
    const atPeak = fitValueAt(curve, curve.xStar?.cm360 ?? 30) ?? -Infinity;
    const away = fitValueAt(curve, (curve.xStar?.cm360 ?? 30) * 1.3) ?? Infinity;
    expect(atPeak).toBeGreaterThan(away);
  });

  it("explains the profile and lists strengths from the measured dimensions", () => {
    expect(recommendation.profile.explanation.sentences.length).toBeGreaterThan(0);
    expect(recommendation.profile.dimensions).toHaveLength(6);
    expect(recommendation.profile.classification.rule).toBeGreaterThanOrEqual(0);
    expect(recommendation.provenance.seed).toBe(calibration.seed.toString());
    expect(recommendation.evidence.sample.validTrials).toBeGreaterThan(0);
    expect(recommendation.evidence.sample.degradedTrials).toBeGreaterThan(0);
    expect(recommendation.evidence.sample.invalidTrials).toBe(calibration.estimates.length);
  });

  it("is deterministic", () => {
    expect(assembleRecommendation(inputsFor(calibration))).toEqual(recommendation);
  });
});

describe("assembling without a peak", () => {
  it("gives a comfort range, no point, and a capped index for a flat player", () => {
    const calibration = simulate({ shape: FLAT });
    const recommendation = assembleRecommendation(inputsFor(calibration));
    expect(recommendation.verdict).toBe("indistinguishable");
    expect(recommendation.canonical.recommendedCmPer360).toBeNull();
    expect(recommendation.ranges.highPerformance).toBeNull();
    expect(recommendation.ranges.comfort.highCm360).toBeGreaterThan(
      recommendation.ranges.comfort.lowCm360,
    );
    expect(recommendation.quality.confidence?.index).toBeLessThanOrEqual(40);
    expect(recommendation.evidence.responseCurve.xStar).toBeNull();
  });

  it("produces no confidence at all for insufficient data", () => {
    const calibration = simulate({ shape: CLEAR_PEAK, trialsPerCandidate: 3 });
    expect(calibration.verdict).toBe("insufficient_data");
    const recommendation = assembleRecommendation(inputsFor(calibration));
    expect(recommendation.quality.confidence).toBeNull();
    expect(recommendation.canonical.recommendedCmPer360).toBeNull();
  });
});

describe("a calibration round as a session plan", () => {
  const candidates = [0, 1, 2].map((i) => ({
    candidateIndex: i,
    countsPer360: countsPer360(8000 + i * 1500),
    blindLabel: "ABC"[i] ?? "?",
  }));
  const build = (roundIndex: number, mode: "quick" | "standard" = "standard") =>
    createCalibrationRoundPlan({
      sessionId: "00000000-0000-7000-8000-00000000plan",
      seed: "plan-seed",
      mode,
      roundIndex,
      candidates,
      blockOrder: [2, 0, 1],
      scoredTests: scoredTestsForMode(mode),
      baselineTests: SENSITIVITY_INDEPENDENT_TESTS,
      baselineCountsPer360: 9448.82,
      aspectRatio: 16 / 9,
      maxImpliedCountsPerSecond: 4_000_000,
      presentationOffset: 0,
    });

  it("runs baseline and practice only in round 0, then a block per candidate", () => {
    const first = build(0);
    const later = build(1);
    expect(
      first.rounds.filter((r) => r.candidateIndex === null && !r.isPractice).map((r) => r.testKey),
    ).toEqual(["reaction", "comfort360"]);
    expect(first.rounds.filter((r) => r.isPractice)).toHaveLength(5);
    expect(later.rounds.every((r) => r.candidateIndex !== null)).toBe(true);
    expect(later.rounds).toHaveLength(15);
    // Blocks follow the given order.
    const order = later.rounds.filter((_, i) => i % 5 === 0).map((r) => r.candidateIndex);
    expect(order).toEqual([2, 0, 1]);
  });

  it("matches stimuli across candidates and varies test order between blocks", () => {
    const plan = build(1);
    const flickSeeds = new Set(
      plan.rounds.filter((r) => r.testKey === "flick").map((r) => r.stimulusSeed),
    );
    expect(flickSeeds.size).toBe(1);
    const openers = [0, 5, 10].map((i) => plan.rounds[i]?.testKey);
    expect(openers[0]).not.toBe(openers[1]);
    expect(openers[1]).not.toBe(openers[2]);
    expect(estimatedRoundSeconds(plan)).toBeGreaterThan(0);
  });

  it("numbers presentation continuously across rounds and is reproducible", () => {
    const a = build(1);
    const b = build(1);
    expect(b).toEqual(a);
    expect(a.rounds.map((r) => r.presentationOrder)).toEqual(a.rounds.map((_, i) => i));
    expect(new Set(a.rounds.map((r) => r.blockIndex)).size).toBe(3);
  });

  it("carries the free-aim stage into round 0 only, and the physical constraint into every round", () => {
    const freeAim = {
      minAcquisitions: 10,
      targetAngularRadiusDeg: 1.5,
      minDistanceDeg: 10,
      maxDistanceDeg: 40,
      countsPer360: countsPer360(9500),
    };
    const physicalConstraint = { maxSingleSwipeCounts: 12_000 };
    const withExtras = (roundIndex: number) =>
      createCalibrationRoundPlan({
        sessionId: "00000000-0000-7000-8000-00000000plan",
        seed: "plan-seed",
        mode: "quick",
        roundIndex,
        candidates,
        blockOrder: [1, 2, 0],
        scoredTests: scoredTestsForMode("quick"),
        baselineTests: SENSITIVITY_INDEPENDENT_TESTS,
        baselineCountsPer360: 9448.82,
        aspectRatio: 16 / 9,
        maxImpliedCountsPerSecond: 4_000_000,
        presentationOffset: 7,
        freeAim,
        physicalConstraint,
        testConfigVersion: "1.1.0",
      });
    const first = withExtras(0);
    const later = withExtras(1);
    expect(first.freeAim).toEqual(freeAim);
    expect(later.freeAim).toBeUndefined();
    expect(first.physicalConstraint).toEqual(physicalConstraint);
    expect(later.physicalConstraint).toEqual(physicalConstraint);
    expect(first.testConfigVersion).toBe("1.1.0");
    expect(later.rounds[0]?.presentationOrder).toBe(7);
  });

  it("refuses a malformed order or an empty roster", () => {
    expect(() =>
      createCalibrationRoundPlan({
        sessionId: "s",
        seed: "x",
        mode: "quick",
        roundIndex: 0,
        candidates,
        blockOrder: [0, 0, 1],
        scoredTests: scoredTestsForMode("quick"),
        baselineTests: [],
        baselineCountsPer360: 9000,
        aspectRatio: 1,
        maxImpliedCountsPerSecond: 1,
        presentationOffset: 0,
      }),
    ).toThrow(/permutation/);
    expect(() =>
      createCalibrationRoundPlan({
        sessionId: "s",
        seed: "x",
        mode: "quick",
        roundIndex: 0,
        candidates: [],
        blockOrder: [],
        scoredTests: scoredTestsForMode("quick"),
        baselineTests: [],
        baselineCountsPer360: 9000,
        aspectRatio: 1,
        maxImpliedCountsPerSecond: 1,
        presentationOffset: 0,
      }),
    ).toThrow(/needs candidates/);
  });
});

describe("the response curve contract", () => {
  it("carries the constraint as a forbidden region and no current sensitivity when unknown", () => {
    const calibration = simulate({ shape: CLEAR_PEAK });
    const constrained = {
      ...calibration,
      constraint: { maxCmPer360: 40, source: "pad_width" as const, conflict: false },
    };
    const curve = buildResponseCurve(constrained, 800, null);
    expect(curve.constraint?.maxCm360).toBe(40);
    expect(curve.currentSens).toBeNull();
    expect(curve.dpi).toBe(800);
  });
});
