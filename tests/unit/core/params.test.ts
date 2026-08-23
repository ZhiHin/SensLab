import { describe, expect, it } from "vitest";
import {
  AIM_PROFILE_RULES_V1,
  ALL_PARAMETER_SETS,
  CALIBRATION_MODEL_V1,
  CONFIDENCE_MODEL_V1,
  CURRENT_VERSIONS,
  HISTORICAL_PARAMETER_SETS,
  REFERENCE_DIST_PROVISIONAL_V1,
  REFERENCE_DIST_PROVISIONAL_V2,
  RELEASED_PARAMETER_SETS,
  SCORING_MODEL_V1,
  SCORING_MODEL_V2,
  findParameterSet,
} from "@/core/params";
import {
  DECISION_METRIC_KEYS,
  METRIC_DEFINITIONS,
  alignDirection,
  getMetricDefinition,
  isKnownMetric,
} from "@/core/metrics/registry";
import {
  ADVANCED_TEST_KEYS,
  DIMENSION_KEYS,
  MVP_TEST_KEYS,
  TEST_KEYS,
} from "@/core/types/vocabulary";
import { ADVANCED_TESTS } from "@/test-engine/tests";

/**
 * Parameter-set invariants.
 *
 * These assert that the versioned parameter sets are internally consistent and consistent
 * with the metric registry. A weight that references a metric which does not exist, or a
 * dimension whose weights do not sum to 1, produces a silently wrong score rather than an
 * error — which is precisely the failure mode this product cannot tolerate.
 */

describe("metric registry", () => {
  it("has unique keys", () => {
    const keys = METRIC_DEFINITIONS.map((definition) => definition.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("resolves definitions by key and reports unknown ones", () => {
    expect(getMetricDefinition("firstShotAccuracy")?.direction).toBe("higher_better");
    expect(getMetricDefinition("nonsense")).toBeUndefined();
    expect(isKnownMetric("trackingError")).toBe(true);
    expect(isKnownMetric("nonsense")).toBe(false);
  });

  it("gives every metric a non-empty description and unit", () => {
    for (const definition of METRIC_DEFINITIONS) {
      expect(definition.description.length, definition.key).toBeGreaterThan(20);
      expect(definition.unit.length, definition.key).toBeGreaterThan(0);
    }
  });

  it("aligns direction so that larger is always better — doc 14 §14.2", () => {
    // Acquisition time is lower-better, so alignment flips its sign.
    expect(alignDirection("adjustedAcquisitionTime", 500)).toBe(-500);
    // First-shot accuracy is higher-better and passes through unchanged.
    expect(alignDirection("firstShotAccuracy", 0.7)).toBe(0.7);
    expect(() => alignDirection("nonsense", 1)).toThrow(RangeError);
  });

  it("excludes reaction time from the decision set — SENS-BR-006", () => {
    expect(DECISION_METRIC_KEYS).not.toContain("reactionTime");
    expect(getMetricDefinition("reactionTime")?.isDecisionMetric).toBe(false);
  });

  it("excludes hit accuracy from the decision set, being confounded by trigger discipline", () => {
    expect(DECISION_METRIC_KEYS).not.toContain("hitAccuracy");
  });

  it("excludes the comfort metrics: they are a constraint, not a score", () => {
    for (const key of ["comfortableSwipeCm", "maxSingleSwipeDeg", "liftCount180"]) {
      expect(DECISION_METRIC_KEYS, key).not.toContain(key);
    }
  });

  it("keeps the decision set small and deliberate", () => {
    // Phase 6 raised the cap from 16 to 18 for four post-MVP metrics — one per new test that
    // carries a distinct signal (reversal recovery, peak-speed error, vertical recoil
    // deviation, stability under recoil). Anything else a new test produces is context.
    expect(DECISION_METRIC_KEYS.length).toBeGreaterThanOrEqual(10);
    expect(DECISION_METRIC_KEYS.length).toBeLessThanOrEqual(18);
  });

  it("leaves the ADS tags and the horizontal recoil component out of the decision set", () => {
    for (const key of ["adsFirstShotAccuracy", "adsTransitionTime", "recoilDeviationHorizontal"]) {
      expect(DECISION_METRIC_KEYS, key).not.toContain(key);
    }
  });
});

describe("scoring_model_v1", () => {
  const params = SCORING_MODEL_V1.params;

  it("defines all six dimensions exactly once", () => {
    const defined = params.dimensions.map((dimension) => dimension.dimension);
    expect(new Set(defined).size).toBe(defined.length);
    expect([...defined].sort()).toEqual([...DIMENSION_KEYS].sort());
  });

  it("has weights summing to 1 within every dimension", () => {
    for (const dimension of params.dimensions) {
      const total = dimension.weights.reduce((sum, weight) => sum + weight.weight, 0);
      expect(total, dimension.dimension).toBeCloseTo(1, 9);
    }
  });

  it("references only metrics that exist in the registry", () => {
    for (const dimension of params.dimensions) {
      for (const weight of dimension.weights) {
        expect(isKnownMetric(weight.metricKey), `${dimension.dimension}/${weight.metricKey}`).toBe(
          true,
        );
      }
    }
  });

  it("references only tests that exist", () => {
    for (const dimension of params.dimensions) {
      for (const weight of dimension.weights) {
        for (const test of weight.fromTests) {
          expect(TEST_KEYS, `${dimension.dimension}/${weight.metricKey}`).toContain(test);
        }
      }
    }
  });

  /**
   * doc 09 §9.15 — no dimension may depend on a single test, so that one noisy round cannot
   * dominate it.
   *
   * **Tracking is a documented exception at MVP.** The MVP battery contains exactly one
   * continuous-tracking test; the second and third sources (Strafe Tracking, Slide Tracking)
   * arrive in Phase 6. Phase 0's prose overstated this — doc 09 §9.15 has been corrected, and
   * the conflict is recorded in the Phase 1 completion report.
   *
   * The exception is bounded rather than waved through: the assertion below fails if any
   * *other* dimension ever becomes single-sourced, and it also fails if Tracking gains a
   * second source without this comment being revisited.
   */
  const SINGLE_SOURCE_EXCEPTIONS = new Set(["tracking"]);

  it("feeds every dimension except Tracking from at least two tests — doc 09 §9.15", () => {
    const singleSourced: string[] = [];
    for (const dimension of params.dimensions) {
      const tests = new Set(dimension.weights.flatMap((weight) => [...weight.fromTests]));
      if (tests.size < 2) singleSourced.push(dimension.dimension);
    }
    expect([...singleSourced].sort()).toEqual([...SINGLE_SOURCE_EXCEPTIONS].sort());
  });

  it("mitigates the Tracking exception with a continuous-sample test", () => {
    // A tracking trial is ~5 s of continuously sampled error, not one discrete observation,
    // so a single test is far less fragile here than the same situation would be for Flick.
    const tracking = params.dimensions.find((d) => d.dimension === "tracking");
    expect(tracking?.weights.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps Speed free of accuracy and Precision free of time — doc 14 §14.5", () => {
    // If both dimensions contained both, they would correlate by construction and the Aim DNA
    // shape would carry no information.
    const speed = params.dimensions.find((d) => d.dimension === "speed");
    const precision = params.dimensions.find((d) => d.dimension === "precision");

    const speedMetrics = speed?.weights.map((w) => w.metricKey) ?? [];
    expect(speedMetrics).not.toContain("firstShotAccuracy");
    expect(speedMetrics).not.toContain("flickErrorNorm");
    expect(speedMetrics).not.toContain("overshootRate");

    const precisionMetrics = precision?.weights.map((w) => w.metricKey) ?? [];
    expect(precisionMetrics).not.toContain("adjustedAcquisitionTime");
    expect(precisionMetrics).not.toContain("switchingTime");
    expect(precisionMetrics).not.toContain("timeToTarget");
  });

  it("never scores reaction time in any dimension — SENS-BR-006", () => {
    for (const dimension of params.dimensions) {
      for (const weight of dimension.weights) {
        expect(weight.metricKey, dimension.dimension).not.toBe("reactionTime");
        expect(weight.fromTests, dimension.dimension).not.toContain("reaction");
      }
    }
  });

  it("has objective test weights summing to 1 over the five scored tests", () => {
    const total = params.objectiveTestWeights.reduce((sum, entry) => sum + entry.weight, 0);
    expect(total).toBeCloseTo(1, 9);
    expect(params.objectiveTestWeights).toHaveLength(5);
    for (const entry of params.objectiveTestWeights) {
      expect(TEST_KEYS).toContain(entry.test);
      expect(entry.test).not.toBe("reaction");
      expect(entry.test).not.toBe("comfort360");
    }
  });

  it("declares decision metrics that all exist and are marked as such in the registry", () => {
    for (const key of params.decisionMetricKeys) {
      expect(isKnownMetric(key), key).toBe(true);
      expect(getMetricDefinition(key)?.isDecisionMetric, key).toBe(true);
    }
  });

  it("has a balanced default weight profile summing to 1", () => {
    const total = Object.values(params.defaultWeightProfile).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 9);
    expect(Object.keys(params.defaultWeightProfile).sort()).toEqual([...DIMENSION_KEYS].sort());
  });

  it("keeps per-game weight profiles disabled at MVP — FR-011", () => {
    // Game selection must change nothing upstream of the adapter.
    expect(params.gameWeightProfilesEnabled).toBe(false);
  });

  it("uses a bounded-influence clip rather than trimming", () => {
    expect(params.clipConstant).toBeGreaterThan(0);
    expect(params.displayScaling.min).toBeGreaterThanOrEqual(0);
    expect(params.displayScaling.max).toBeLessThanOrEqual(100);
  });
});

describe("calibration_model_v1", () => {
  const params = CALIBRATION_MODEL_V1.params;

  it("uses the documented admissible domain", () => {
    expect(params.domainCmPer360).toEqual({ min: 8, max: 100 });
  });

  it("starts cold at a centre inside the domain", () => {
    expect(params.coldStartCentreCmPer360).toBeGreaterThan(params.domainCmPer360.min);
    expect(params.coldStartCentreCmPer360).toBeLessThan(params.domainCmPer360.max);
  });

  it("widens the bracket as knowledge decreases", () => {
    const { priorRecommendation, knownCurrentSensitivity, coldStart } = params.initialHalfWidth;
    expect(priorRecommendation).toBeLessThan(knownCurrentSensitivity);
    expect(knownCurrentSensitivity).toBeLessThan(coldStart);
  });

  it("narrows toward, but never below, the half-width floor", () => {
    expect(params.narrowing.gamma).toBeGreaterThan(0);
    expect(params.narrowing.gamma).toBeLessThan(1);
    expect(params.narrowing.conservativeGamma).toBeGreaterThan(params.narrowing.gamma);
    expect(params.narrowing.minHalfWidth).toBeGreaterThan(0);
  });

  it("gives Advanced more candidates and rounds than Quick", () => {
    expect(params.roundBudget.advanced).toBeGreaterThan(params.roundBudget.quick);
    expect(params.candidatesPerRound.advanced).toBeGreaterThanOrEqual(
      params.candidatesPerRound.quick,
    );
    expect(params.candidatesPerRound.standard).toBeGreaterThanOrEqual(3);
  });

  it("runs the anchor re-test in Standard and Advanced but not Quick", () => {
    expect(params.anchorEnabled.quick).toBe(false);
    expect(params.anchorEnabled.standard).toBe(true);
    expect(params.anchorEnabled.advanced).toBe(true);
  });

  it("uses a 90% decision level, not 95% — doc 13 §13.9", () => {
    expect(params.statistics.significanceLevel).toBe(0.9);
    expect(params.statistics.bootstrapResamples).toBeGreaterThanOrEqual(1000);
  });

  it("sets sample minimums for every MVP test, rising with mode", () => {
    // The post-MVP floors are declared by their definitions, not by this released set: a
    // released parameter set is never edited to add them (SENS-BR-029).
    for (const key of MVP_TEST_KEYS) {
      const minimum = params.minimumValidTrials[key];
      expect(minimum, key).toBeDefined();
      if (minimum === undefined) continue;
      expect(minimum.advanced, key).toBeGreaterThanOrEqual(minimum.standard);
      expect(minimum.standard, key).toBeGreaterThanOrEqual(minimum.quick);
      expect(minimum.quick, key).toBeGreaterThan(0);
    }
  });

  it("uses a symmetric fine-tune offset ladder centred on the recommendation", () => {
    expect(params.fineTuneOffsets).toHaveLength(5);
    expect(params.fineTuneOffsets[2]).toBe(0);
    expect(params.fineTuneOffsets[0]).toBeCloseTo(-(params.fineTuneOffsets[4] ?? 0), 9);
    expect(params.fineTuneOffsets[1]).toBeCloseTo(-(params.fineTuneOffsets[3] ?? 0), 9);
  });

  it("constrains the low-sensitivity end with rho in (0, 1]", () => {
    expect(params.constraint.rho).toBeGreaterThan(0);
    expect(params.constraint.rho).toBeLessThanOrEqual(1);
  });
});

describe("confidence_model_v1", () => {
  const params = CONFIDENCE_MODEL_V1.params;

  it("caps confidence below certainty — SENS-BR-028", () => {
    expect(params.ceiling).toBeLessThan(1);
    expect(params.verdictCaps.peakFound).toBeLessThanOrEqual(Math.round(params.ceiling * 100));
  });

  it("caps an indistinguishable result far below a found peak — SENS-BR-017", () => {
    expect(params.verdictCaps.indistinguishable).toBeLessThan(params.verdictCaps.peakFound);
    expect(params.indistinguishablePeakCap).toBeLessThan(0.5);
  });

  it("weights peak identification highest", () => {
    const { peak, ...rest } = params.weights;
    for (const [name, weight] of Object.entries(rest)) {
      expect(peak, name).toBeGreaterThanOrEqual(weight);
    }
  });

  it("penalises a missing raw-input path and a resized window", () => {
    expect(params.environment.noRawInput).toBeLessThan(1);
    expect(params.environment.windowResized).toBeLessThan(1);
    expect(params.environment.cleanFrameFloor).toBeGreaterThan(0);
    expect(params.environment.cleanFrameFloor).toBeLessThan(1);
  });

  it("rewards a corroborated recommendation and punishes a refuted one — doc 15 §15.8", () => {
    expect(params.validationMultipliers.improved).toBeGreaterThan(1);
    expect(params.validationMultipliers.noMeasurableDifference).toBeLessThan(1);
    expect(params.validationMultipliers.worse).toBeLessThan(
      params.validationMultipliers.noMeasurableDifference,
    );
  });
});

describe("aim_profile_rules_v1", () => {
  const params = AIM_PROFILE_RULES_V1.params;

  it("orders the sensitivity bands sensibly", () => {
    expect(params.bandThresholdsCmPer360.highBelow).toBeLessThan(
      params.bandThresholdsCmPer360.lowAbove,
    );
  });

  it("names every profile in every band", () => {
    const profiles = new Set(
      Object.keys(params.displayNames).map((composite) => composite.split(":")[0]),
    );
    for (const profile of profiles) {
      for (const band of ["high", "mid", "low"]) {
        expect(params.displayNames[`${profile}:${band}`], `${profile}:${band}`).toBeDefined();
      }
    }
  });

  it("covers all six dimensions in its canonical ordering", () => {
    expect([...params.dimensionOrder].sort()).toEqual([...DIMENSION_KEYS].sort());
  });

  it("limits improvement areas to at most two — SENS-UX-018", () => {
    // A list of five weaknesses is discouraging and not actionable.
    expect(params.maxImprovementAreas).toBeLessThanOrEqual(2);
    expect(params.maxStrengths).toBeGreaterThanOrEqual(params.maxImprovementAreas);
  });
});

describe("reference_dist_provisional_v1", () => {
  const params = REFERENCE_DIST_PROVISIONAL_V1.params;

  it("is marked provisional and suppresses percentiles — doc 14 §14.4", () => {
    expect(params.provisional).toBe(true);
    expect(params.percentilesEnabled).toBe(false);
  });

  it("marks every individual statistic provisional", () => {
    for (const statistic of params.statistics) {
      expect(statistic.provisional, statistic.metricKey).toBe(true);
    }
  });

  it("references only known metrics and uses positive spreads", () => {
    for (const statistic of params.statistics) {
      expect(isKnownMetric(statistic.metricKey), statistic.metricKey).toBe(true);
      expect(statistic.standardDeviation, statistic.metricKey).toBeGreaterThan(0);
    }
  });

  it("covers every v1 decision metric, so no v1 dimension is unscorable", () => {
    const covered = new Set(params.statistics.map((statistic) => statistic.metricKey));
    for (const key of SCORING_MODEL_V1.params.decisionMetricKeys) {
      expect(covered.has(key), key).toBe(true);
    }
  });
});

describe("reference_dist_provisional_v2", () => {
  const params = REFERENCE_DIST_PROVISIONAL_V2.params;

  it("is still provisional, with percentiles suppressed", () => {
    expect(params.provisional).toBe(true);
    expect(params.percentilesEnabled).toBe(false);
    expect(params.statistics.every((statistic) => statistic.provisional)).toBe(true);
  });

  it("covers every decision metric, so no dimension is unscorable", () => {
    const covered = new Set(params.statistics.map((statistic) => statistic.metricKey));
    for (const key of DECISION_METRIC_KEYS) {
      expect(covered.has(key), key).toBe(true);
    }
  });

  it("extends v1 without altering it", () => {
    const v1 = REFERENCE_DIST_PROVISIONAL_V1.params.statistics;
    expect(params.statistics.slice(0, v1.length)).toEqual(v1);
    expect(params.statistics.length).toBeGreaterThan(v1.length);
  });
});

/**
 * scoring_model_v2 — the post-MVP tests enter the weights (Phase 6).
 *
 * Every invariant asserted on v1 holds here too, with one change that is the whole point of
 * the version: the Tracking single-source exception is gone.
 */
describe("scoring_model_v2", () => {
  const params = SCORING_MODEL_V2.params;

  it("is the scoring version currently in force", () => {
    expect(CURRENT_VERSIONS.scoring).toBe(SCORING_MODEL_V2.version);
    expect(ALL_PARAMETER_SETS).toContain(SCORING_MODEL_V2);
    expect(HISTORICAL_PARAMETER_SETS).toContain(SCORING_MODEL_V1);
  });

  it("defines all six dimensions with weights summing to 1", () => {
    const defined = params.dimensions.map((dimension) => dimension.dimension);
    expect([...defined].sort()).toEqual([...DIMENSION_KEYS].sort());
    for (const dimension of params.dimensions) {
      const total = dimension.weights.reduce((sum, weight) => sum + weight.weight, 0);
      expect(total, dimension.dimension).toBeCloseTo(1, 9);
    }
  });

  it("references only metrics and tests that exist", () => {
    for (const dimension of params.dimensions) {
      for (const weight of dimension.weights) {
        expect(isKnownMetric(weight.metricKey), weight.metricKey).toBe(true);
        for (const test of weight.fromTests) expect(TEST_KEYS).toContain(test);
      }
    }
  });

  it("feeds every dimension from at least two tests — the Tracking exception is closed", () => {
    // doc 09 §9.15 said Tracking was single-sourced "until Strafe Tracking and Slide Tracking
    // arrive in Phase 6". They have.
    for (const dimension of params.dimensions) {
      const tests = new Set(dimension.weights.flatMap((weight) => [...weight.fromTests]));
      expect(tests.size, dimension.dimension).toBeGreaterThanOrEqual(2);
    }
    const tracking = params.dimensions.find((d) => d.dimension === "tracking");
    const trackingTests = new Set(tracking?.weights.flatMap((w) => [...w.fromTests]));
    expect(trackingTests.has("strafe-tracking")).toBe(true);
    expect(trackingTests.has("slide-tracking")).toBe(true);
  });

  it("uses every post-MVP test somewhere", () => {
    const used = new Set(
      params.dimensions.flatMap((d) => d.weights.flatMap((w) => [...w.fromTests])),
    );
    for (const key of ADVANCED_TEST_KEYS) expect(used.has(key), key).toBe(true);
  });

  it("keeps Speed free of accuracy and Precision free of time — doc 14 §14.5", () => {
    const speed = params.dimensions.find((d) => d.dimension === "speed");
    const precision = params.dimensions.find((d) => d.dimension === "precision");
    const speedMetrics = speed?.weights.map((w) => w.metricKey) ?? [];
    for (const key of ["firstShotAccuracy", "flickErrorNorm", "overshootRate"]) {
      expect(speedMetrics).not.toContain(key);
    }
    const precisionMetrics = precision?.weights.map((w) => w.metricKey) ?? [];
    for (const key of ["adjustedAcquisitionTime", "switchingTime", "timeToTarget"]) {
      expect(precisionMetrics).not.toContain(key);
    }
  });

  it("weights Recoil for Control above everything else — doc 09 §9.12", () => {
    const byDimension = new Map(
      params.dimensions.map((d) => [
        d.dimension,
        d.weights.filter((w) => w.fromTests.includes("recoil")).reduce((s, w) => s + w.weight, 0),
      ]),
    );
    const control = byDimension.get("control") ?? 0;
    for (const [dimension, weight] of byDimension) {
      if (dimension !== "control") expect(weight, dimension).toBeLessThan(control);
    }
  });

  it("never scores reaction time in any dimension — SENS-BR-006", () => {
    for (const dimension of params.dimensions) {
      for (const weight of dimension.weights) {
        expect(weight.metricKey).not.toBe("reactionTime");
        expect(weight.fromTests).not.toContain("reaction");
      }
    }
  });

  it("has objective weights summing to 1 over eleven tests, MVP five in the majority", () => {
    const total = params.objectiveTestWeights.reduce((sum, entry) => sum + entry.weight, 0);
    expect(total).toBeCloseTo(1, 9);
    expect(params.objectiveTestWeights).toHaveLength(11);
    const mvp = params.objectiveTestWeights
      .filter((entry) => (MVP_TEST_KEYS as readonly string[]).includes(entry.test))
      .reduce((sum, entry) => sum + entry.weight, 0);
    expect(mvp).toBeGreaterThan(0.5);
    for (const entry of params.objectiveTestWeights) {
      expect(entry.test).not.toBe("reaction");
      expect(entry.test).not.toBe("comfort360");
    }
  });

  it("declares decision metrics that all exist and are marked as such in the registry", () => {
    for (const key of params.decisionMetricKeys) {
      expect(getMetricDefinition(key)?.isDecisionMetric, key).toBe(true);
    }
    expect([...params.decisionMetricKeys].sort()).toEqual([...DECISION_METRIC_KEYS].sort());
  });

  it("inherits v1's floors, clip, scaling and disabled game profiles", () => {
    expect(params.clipConstant).toBe(SCORING_MODEL_V1.params.clipConstant);
    expect(params.displayScaling).toEqual(SCORING_MODEL_V1.params.displayScaling);
    expect(params.gameWeightProfilesEnabled).toBe(false);
    for (const [key, floor] of Object.entries(SCORING_MODEL_V1.params.robustScaleFloors)) {
      expect(params.robustScaleFloors[key], key).toBe(floor);
    }
  });

  it("points at the v2 reference distribution", () => {
    expect(params.referenceDistributionVersion).toBe(REFERENCE_DIST_PROVISIONAL_V2.version);
  });
});

describe("post-MVP test sample floors", () => {
  it("are declared by every advanced definition, rising with mode", () => {
    for (const definition of ADVANCED_TESTS) {
      const quick = definition.minValidTrials("quick");
      const standard = definition.minValidTrials("standard");
      const advanced = definition.minValidTrials("advanced");
      expect(quick, definition.key).toBeGreaterThan(0);
      expect(standard, definition.key).toBeGreaterThanOrEqual(quick);
      expect(advanced, definition.key).toBeGreaterThanOrEqual(standard);
    }
  });
});

describe("the parameter-set registry", () => {
  it("contains one released set per algorithm kind", () => {
    const kinds = ALL_PARAMETER_SETS.map((set) => set.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(kinds.sort()).toEqual(
      ["aim_profile", "calibration", "confidence", "reference_distribution", "scoring"].sort(),
    );
  });

  it("agrees with the current-version map", () => {
    for (const set of ALL_PARAMETER_SETS) {
      expect(CURRENT_VERSIONS[set.kind]).toBe(set.version);
    }
  });

  it("keeps superseded sets compiled and resolvable — SENS-BR-020", () => {
    // A result generated under scoring_model_v1 must keep rendering under scoring_model_v1.
    expect(findParameterSet("scoring_model_v1")).toBe(SCORING_MODEL_V1);
    expect(findParameterSet("scoring_model_v2")).toBe(SCORING_MODEL_V2);
    expect(findParameterSet("nope")).toBeUndefined();
    expect(RELEASED_PARAMETER_SETS.length).toBe(
      ALL_PARAMETER_SETS.length + HISTORICAL_PARAMETER_SETS.length,
    );
    for (const set of HISTORICAL_PARAMETER_SETS) {
      expect(ALL_PARAMETER_SETS).not.toContain(set);
      expect(Object.isFrozen(set.params), set.version).toBe(true);
    }
  });

  it("gives every set a release date and a non-empty note", () => {
    for (const set of ALL_PARAMETER_SETS) {
      expect(Number.isNaN(Date.parse(set.releasedAt)), set.version).toBe(false);
      expect(set.notes.length, set.version).toBeGreaterThan(20);
    }
  });

  it("freezes released sets so they cannot be mutated in place — SENS-BR-029", () => {
    for (const set of ALL_PARAMETER_SETS) {
      expect(Object.isFrozen(set), set.version).toBe(true);
      expect(Object.isFrozen(set.params), set.version).toBe(true);
    }
  });
});
