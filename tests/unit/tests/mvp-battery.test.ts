import { describe, expect, it } from "vitest";
import { getMetricDefinition, METRIC_KEYS } from "@/core/metrics";
import type { TestDefinition } from "@/test-engine/contracts";
import {
  comfort360Test,
  flickTest,
  microTest,
  MVP_TESTS,
  precisionTest,
  reactionTest,
  SCORED_TESTS,
  SENSITIVITY_INDEPENDENT_TESTS,
  switchingTest,
  trackingTest,
} from "@/test-engine/tests";
import { BATTERY_FRAME_MS as FRAME_MS, runBattery } from "../../helpers/battery-runner";

/**
 * The MVP battery, each test running end to end (doc 09 §9.1–§9.7).
 *
 * **This is Phase 3's exit criterion.** Every test must work independently — producing valid
 * trials and populated metrics on its own — before calibration is allowed to compare
 * sensitivities with it. A test that cannot do that alone will not do it inside a candidate
 * comparison either, and debugging it there, with counterbalancing and blinding in the way, is
 * far harder.
 *
 * The player is synthetic and deliberately competent: it aims at what the renderer drew, holds
 * when the test asks for a hold, and sweeps when the test asks for a sweep. The point is not to
 * simulate a realistic human — that is the Phase 4 synthetic-player work — but to show the
 * lifecycle, the stimulus and the metric pipeline all connect.
 */

// The synthetic player lives in tests/helpers/battery-runner.ts since Phase 6, shared with
// the advanced battery.
const runTest = (definition: TestDefinition, options: { seed?: string } = {}) =>
  runBattery(definition, options);

describe("every MVP test runs independently", () => {
  for (const definition of MVP_TESTS) {
    it(`completes a ${definition.key} round with valid trials`, () => {
      const { measured } = runTest(definition);

      expect(measured.testKey).toBe(definition.key);
      expect(measured.trials.length).toBeGreaterThan(0);

      const usable = measured.trials.filter((trial) => trial.validity !== "invalid");
      expect(
        usable.length,
        `invalid reasons: ${measured.trials
          .map((trial) => trial.invalidReason)
          .filter(Boolean)
          .join(", ")}`,
      ).toBeGreaterThanOrEqual(definition.minValidTrials("quick"));
    });

    it(`produces the metrics ${definition.key} declares`, () => {
      const { measured } = runTest(definition);
      const produced = new Set(measured.trials.flatMap((trial) => Object.keys(trial.metrics)));

      // Not every declared metric applies to every trial — `settleTime` needs the crosshair to
      // have reached the target, for instance — so the assertion is that the test produced
      // *something*, and that everything it produced was declared.
      expect(produced.size).toBeGreaterThan(0);
      for (const key of produced) {
        expect(definition.metricKeys, `${definition.key} produced undeclared "${key}"`).toContain(
          key,
        );
      }
    });

    it(`aggregates ${definition.key} to round metrics with sample counts`, () => {
      const { measured } = runTest(definition);
      const entries = Object.entries(measured.roundMetrics);
      expect(entries.length).toBeGreaterThan(0);

      for (const [key, summary] of entries) {
        // doc 10 §10.10 — a metric value without its sample count is not storable.
        expect(Number.isFinite(summary.value), `${key} produced a non-finite value`).toBe(true);
        expect(summary.validTrials + summary.degradedTrials).toBeGreaterThan(0);
        expect(METRIC_KEYS).toContain(key);
      }
    });

    it(`reproduces ${definition.key} exactly from the same seed — SENS-BR-031`, () => {
      const first = runTest(definition, { seed: "repeat-me" });
      const second = runTest(definition, { seed: "repeat-me" });

      expect(second.measured.trials.map((trial) => trial.stimulusSeed)).toEqual(
        first.measured.trials.map((trial) => trial.stimulusSeed),
      );
      expect(second.measured.trials.map((trial) => trial.targetDistanceDeg)).toEqual(
        first.measured.trials.map((trial) => trial.targetDistanceDeg),
      );
      expect(second.measured.trials.map((trial) => trial.variant)).toEqual(
        first.measured.trials.map((trial) => trial.variant),
      );
    });
  }
});

describe("the battery's shape — doc 09", () => {
  it("has five scored tests and two that are not", () => {
    expect(SCORED_TESTS.map((test) => test.key).sort()).toEqual([
      "flick",
      "micro",
      "precision",
      "switching",
      "tracking",
    ]);
    expect(SENSITIVITY_INDEPENDENT_TESTS.map((test) => test.key).sort()).toEqual([
      "comfort360",
      "reaction",
    ]);
  });

  it("keeps reaction out of the decision set — SENS-BR-006", () => {
    // Reaction is a property of the player, not of the sensitivity. Letting it into the
    // comparison would add variance without signal and make a tired round look like a bad
    // sensitivity.
    expect(reactionTest.category).toBe("baseline");
    for (const key of reactionTest.metricKeys) {
      expect(
        getMetricDefinition(key)?.isDecisionMetric,
        `${key} must not drive the sensitivity decision`,
      ).toBe(false);
    }
  });

  it("keeps the comfort metrics out of the decision set too", () => {
    // They are a constraint on the search range, not a score within it.
    expect(comfort360Test.category).toBe("constraint");
    for (const key of comfort360Test.metricKeys) {
      expect(getMetricDefinition(key)?.isDecisionMetric).toBe(false);
    }
  });

  it("gives every scored test at least one decision metric", () => {
    for (const definition of SCORED_TESTS) {
      const decisive = definition.metricKeys.filter(
        (key) => getMetricDefinition(key)?.isDecisionMetric === true,
      );
      expect(
        decisive.length,
        `${definition.key} contributes nothing to the decision`,
      ).toBeGreaterThan(0);
    }
  });

  it("declares only metrics that exist in the registry", () => {
    for (const definition of MVP_TESTS) {
      for (const key of definition.metricKeys) {
        expect(METRIC_KEYS, `${definition.key} declares unknown metric "${key}"`).toContain(key);
      }
      if (definition.primaryMetricKey !== undefined) {
        expect(definition.metricKeys).toContain(definition.primaryMetricKey);
      }
    }
  });

  it("uses only procedural invalid reasons", () => {
    // `SENS-BR-009`: no test may declare a reason that describes how well the player performed.
    const performanceWords = ["miss", "accuracy", "score", "slow", "bad", "poor", "fail"];
    for (const definition of MVP_TESTS) {
      for (const reason of definition.additionalInvalidReasons) {
        for (const word of performanceWords) expect(reason.includes(word)).toBe(false);
      }
    }
  });
});

describe("the tests that shape the response curve", () => {
  it("gives flick the distance mix doc 09 declares", () => {
    const { measured } = runTest(flickTest);
    const variants = measured.trials.map((trial) => trial.variant);

    expect(new Set(variants).size).toBeGreaterThan(1);
    for (const variant of variants) expect(["small", "medium", "large"]).toContain(variant);
  });

  it("keeps micro's targets inside the small-angle band it exists to measure", () => {
    const { measured } = runTest(microTest);
    for (const trial of measured.trials) {
      // doc 09 §9.3 — 0.8° to 4.0°, which is where excessive sensitivity shows up first.
      expect(trial.targetDistanceDeg as number).toBeGreaterThanOrEqual(0.7);
      expect(trial.targetDistanceDeg as number).toBeLessThanOrEqual(4.1);
      expect(trial.targetAngularRadiusDeg as number).toBeLessThanOrEqual(0.7);
    }
  });

  it("resolves a precision trial on one shot", () => {
    const { measured } = runTest(precisionTest);
    for (const trial of measured.trials) {
      expect(trial.shots).toBeLessThanOrEqual(1);
    }
  });

  it("runs a tracking trial for its full duration and records held-time metrics", () => {
    const { measured } = runTest(trackingTest);
    for (const trial of measured.trials.filter((entry) => entry.validity !== "invalid")) {
      // A duration trial ends on its clock, so every valid trial lasts the declared 5 s.
      expect(trial.durationMs).toBeGreaterThanOrEqual(trackingTest.timeoutMs - FRAME_MS * 2);
      expect(trial.metrics["trackingAccuracy"]).toBeGreaterThan(0.5);
    }
  });

  it("gives a switching sequence its kills and its switching measurements", () => {
    const { measured } = runTest(switchingTest);
    const valid = measured.trials.filter((trial) => trial.validity !== "invalid");

    expect(valid.length).toBeGreaterThan(0);
    for (const trial of valid) {
      expect(trial.metrics["switchingTime"]).toBeGreaterThan(0);
      expect(trial.metrics["switchingTravelTime"]).toBeGreaterThan(0);
    }
  });

  it("gives comfort a value for each of its three sub-tasks", () => {
    const { measured } = runTest(comfort360Test);
    const variants = new Set(measured.trials.map((trial) => trial.variant));
    expect(variants).toEqual(new Set(["swipe", "half_turn", "return"]));

    const produced = new Set(measured.trials.flatMap((trial) => Object.keys(trial.metrics)));
    expect(produced).toContain("maxSingleSwipeDeg");
    expect(produced).toContain("time180");
    expect(produced).toContain("returnErrorDeg");
  });

  it("measures reaction without letting the camera move", () => {
    const { measured } = runTest(reactionTest);
    const valid = measured.trials.filter((trial) => trial.validity !== "invalid");

    expect(valid.length).toBeGreaterThan(0);
    for (const trial of valid) {
      expect(trial.metrics["reactionTime"]).toBeGreaterThan(0);
    }
    // No aiming happened, so there is no distance to report — the target is at the crosshair.
    expect(measured.trials[0]?.targetDistanceDeg).toBeCloseTo(0, 6);
  });
});
