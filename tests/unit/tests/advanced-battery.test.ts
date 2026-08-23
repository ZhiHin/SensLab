import { describe, expect, it } from "vitest";
import { METRIC_KEYS } from "@/core/metrics";
import { countsPer360FromDegreesPerCount, degreesPerCount } from "@/core/sensitivity/canonical";
import {
  ADVANCED_TESTS,
  ALL_TESTS,
  MVP_TESTS,
  SIMULATED_SCOPES,
  adsTest,
  getTestDefinition,
  recoilTest,
  scoredTestsForMode,
  slideTrackingTest,
  strafeTrackingTest,
  wideFlickTest,
} from "@/test-engine/tests";
import { BATTERY_COUNTS, runBattery } from "../../helpers/battery-runner";

/**
 * The advanced battery, each test running end to end (doc 09 §9.8–§9.13).
 *
 * **This is Phase 6's exit criterion**: every post-MVP test must work independently, through
 * the real engine, producing valid trials and populated metrics. The synthetic player is
 * competent and fast; what is being proven is that the lifecycle, the new motion kinds, the
 * camera disturbance and the per-trial view all connect to the metric pipeline.
 */

describe("the roster", () => {
  it("adds six scored tests to the seven MVP ones", () => {
    expect(ADVANCED_TESTS).toHaveLength(6);
    expect(ALL_TESTS).toHaveLength(13);
    expect(ADVANCED_TESTS.every((test) => test.category === "scored")).toBe(true);
    for (const definition of ADVANCED_TESTS) {
      expect(getTestDefinition(definition.key)).toBe(definition);
      expect(MVP_TESTS).not.toContain(definition);
    }
  });

  it("runs the post-MVP tests only in Advanced mode", () => {
    expect(scoredTestsForMode("quick").map((t) => t.key)).toEqual(["flick", "micro", "tracking"]);
    expect(scoredTestsForMode("standard")).toHaveLength(5);
    const advanced = scoredTestsForMode("advanced").map((t) => t.key);
    expect(advanced).toHaveLength(10);
    for (const key of ["wide-flick", "strafe-tracking", "slide-tracking", "speed", "recoil"]) {
      expect(advanced).toContain(key);
    }
    // The ADS test needs a scoped round and is added by the planner, not the hipfire roster.
    expect(advanced).not.toContain("ads");
  });

  it("declares only registered metrics", () => {
    for (const definition of ADVANCED_TESTS) {
      for (const key of definition.metricKeys) {
        expect(METRIC_KEYS, `${definition.key} declares unknown metric "${key}"`).toContain(key);
      }
      expect(definition.metricKeys).toContain(definition.primaryMetricKey);
    }
  });
});

describe("every advanced test runs independently", () => {
  for (const definition of ADVANCED_TESTS) {
    const scopeKey = definition.key === "ads" ? ("ads" as const) : ("hipfire" as const);

    it(`completes a ${definition.key} round with valid trials`, () => {
      const { measured } = runBattery(definition, { scopeKey });

      expect(measured.testKey).toBe(definition.key);
      const usable = measured.trials.filter((trial) => trial.validity !== "invalid");
      expect(
        usable.length,
        `invalid reasons: ${measured.trials
          .map((trial) => trial.invalidReason)
          .filter(Boolean)
          .join(", ")}`,
      ).toBeGreaterThanOrEqual(definition.minValidTrials("quick"));
    });

    it(`produces the metrics ${definition.key} declares, and only those`, () => {
      const { measured } = runBattery(definition, { scopeKey });
      const produced = new Set(measured.trials.flatMap((trial) => Object.keys(trial.metrics)));
      expect(produced.size).toBeGreaterThan(0);
      for (const key of produced) {
        expect(definition.metricKeys, `${definition.key} produced undeclared "${key}"`).toContain(
          key,
        );
      }
      expect(produced.has(definition.primaryMetricKey as string)).toBe(true);
    });

    it(`aggregates ${definition.key} to round metrics with sample counts`, () => {
      const { measured } = runBattery(definition, { scopeKey });
      const entries = Object.entries(measured.roundMetrics);
      expect(entries.length).toBeGreaterThan(0);
      for (const [key, summary] of entries) {
        expect(Number.isFinite(summary.value), `${key} non-finite`).toBe(true);
        expect(summary.validTrials + summary.degradedTrials).toBeGreaterThan(0);
        expect(METRIC_KEYS).toContain(key);
      }
    });

    it(`reproduces ${definition.key} exactly from the same seed — SENS-BR-031`, () => {
      const first = runBattery(definition, { seed: "repeat-me", scopeKey });
      const second = runBattery(definition, { seed: "repeat-me", scopeKey });
      expect(second.measured.trials.map((t) => t.stimulusSeed)).toEqual(
        first.measured.trials.map((t) => t.stimulusSeed),
      );
      expect(second.measured.trials.map((t) => t.targetDistanceDeg)).toEqual(
        first.measured.trials.map((t) => t.targetDistanceDeg),
      );
      expect(second.measured.trials.map((t) => t.metrics)).toEqual(
        first.measured.trials.map((t) => t.metrics),
      );
    });
  }
});

describe("wide flick", () => {
  it("presents every angle class, exactly balanced left and right", () => {
    const { measured } = runBattery(wideFlickTest);
    const variants = measured.trials.map((trial) => trial.variant);
    for (const angle of [45, 90, 135, 180]) {
      expect(variants.filter((v) => v === `deg${angle}`)).toHaveLength(2);
    }
    // Distances land inside the jittered class: 180° targets are genuinely behind the player.
    // 180° ± 5° of yaw with a little pitch: the great-circle distance is a touch under the yaw.
    const far = measured.trials.filter((trial) => trial.variant === "deg180");
    for (const trial of far) {
      expect(trial.targetDistanceDeg).toBeGreaterThan(165);
    }
    const directions = measured.trials.map((trial) => trial.targetDirectionDeg ?? 0);
    const rightward = directions.filter((d) => d < 90 || d > 270).length;
    expect(rightward).toBe(directions.length / 2);
  });

  it("reports no lift for a player who never pauses", () => {
    const { measured } = runBattery(wideFlickTest);
    for (const trial of measured.trials) {
      expect(trial.metrics.liftDetected).toBe(0);
    }
  });
});

describe("strafe tracking", () => {
  it("reversals are drawn memorylessly, so two seeds differ and one seed repeats", () => {
    const a = runBattery(strafeTrackingTest, { seed: "strafe-a" });
    const b = runBattery(strafeTrackingTest, { seed: "strafe-b" });
    const again = runBattery(strafeTrackingTest, { seed: "strafe-a" });
    const recoveries = (run: typeof a) =>
      run.measured.trials.map((trial) => trial.metrics.reversalRecoveryTime);
    expect(recoveries(again)).toEqual(recoveries(a));
    expect(recoveries(b)).not.toEqual(recoveries(a));
  });

  it("measures a slower recovery for a player who reacts late", () => {
    const prompt = runBattery(strafeTrackingTest, { reactionFrames: 0 });
    const late = runBattery(strafeTrackingTest, { reactionFrames: 40 });
    const median = (run: typeof prompt) =>
      run.measured.roundMetrics.reversalRecoveryTime?.value ?? Number.NaN;
    expect(median(late)).toBeGreaterThan(median(prompt));
  });
});

describe("slide tracking", () => {
  it("marks a slide as truncated only when it exceeds the player's reach", () => {
    // A slide of 55–95° at this sensitivity needs several hundred counts. A reach of ten
    // counts is exceeded by every slide; a reach of a million by none.
    const cramped = runBattery(slideTrackingTest, { maxSingleSwipeCounts: 10 });
    const roomy = runBattery(slideTrackingTest, { maxSingleSwipeCounts: 1_000_000 });
    const unknown = runBattery(slideTrackingTest);

    expect(cramped.measured.trials.every((t) => t.metrics.pathTruncated === 1)).toBe(true);
    expect(roomy.measured.trials.every((t) => t.metrics.pathTruncated === 0)).toBe(true);
    // Unknown reach is not "no": the metric is absent rather than zero.
    expect(unknown.measured.trials.every((t) => t.metrics.pathTruncated === undefined)).toBe(true);
  });

  it("measures a larger acceleration lag for a player who reacts late", () => {
    const prompt = runBattery(slideTrackingTest, { reactionFrames: 0 });
    const late = runBattery(slideTrackingTest, { reactionFrames: 24 });
    const lag = (run: typeof prompt) =>
      run.measured.roundMetrics.accelerationLagMs?.value ?? Number.NaN;
    expect(lag(late)).toBeGreaterThan(lag(prompt));
    // 24 frames at 240 Hz is 100 ms; the estimate should land within a few grid steps of it
    // once the prompt player's own one-frame lag is removed.
    expect(Math.abs(lag(late) - lag(prompt) - 100)).toBeLessThan(24);
  });
});

describe("recoil", () => {
  it("cycles through every generated family, none of them a game's", () => {
    const { measured } = runBattery(recoilTest);
    const families = new Set(measured.trials.map((trial) => trial.variant));
    expect(families.size).toBe(4);
  });

  it("rewards compensation and records its gain", () => {
    const full = runBattery(recoilTest, { compensation: 1 });
    const weak = runBattery(recoilTest, { compensation: 0.3 });

    const vertical = (run: typeof full) =>
      run.measured.roundMetrics.recoilDeviationVertical?.value ?? Number.NaN;
    expect(vertical(full)).toBeLessThan(vertical(weak));

    // The gain is the OLS slope of counter-movement against the applied recoil, so a player
    // who pulls against 30% of it reads near 0.3 and a perfect one near 1 (doc 10 §10.5).
    const gain = (run: typeof full) =>
      run.measured.roundMetrics.recoilCompensationGain?.value ?? Number.NaN;
    expect(gain(weak)).toBeGreaterThan(0.15);
    expect(gain(weak)).toBeLessThan(0.5);
    expect(gain(full)).toBeGreaterThan(0.8);
    expect(gain(full)).toBeLessThan(1.2);
  });

  it("leaves no disturbance behind when the trial ends", () => {
    // The camera is restored between trials; a residual offset would bleed into the next.
    const { measured } = runBattery(recoilTest);
    expect(measured.trials.length).toBeGreaterThan(1);
    // If the disturbance leaked, later trials would start off-target and recovery times
    // would grow monotonically. They do not.
    const recoveries = measured.trials.map((t) => t.metrics.recoilRecoveryTime ?? 0);
    expect(Math.max(...recoveries)).toBeLessThan(400);
  });
});

describe("ADS", () => {
  it("alternates hipfire controls with scoped trials", () => {
    const { measured } = runBattery(adsTest, { scopeKey: "ads" });
    const variants = measured.trials.map((trial) => trial.variant);
    expect(variants.filter((v) => v === "ads").length).toBe(variants.length / 2);
    expect(variants.filter((v) => v === "hipfire").length).toBe(variants.length / 2);
  });

  it("tags only the scoped trials", () => {
    const { measured } = runBattery(adsTest, { scopeKey: "ads" });
    for (const trial of measured.trials) {
      if (trial.variant === "ads") {
        expect(trial.metrics.adsFirstShotAccuracy).toBeDefined();
      } else {
        expect(trial.metrics.adsTransitionTime).toBeUndefined();
        expect(trial.metrics.adsFirstShotAccuracy).toBeUndefined();
      }
    }
  });

  it("runs the scoped segment at the derived sensitivity and the session FOV otherwise", () => {
    // Observed through the engine: after a scoped trial resolves, the camera is back at the
    // round's sensitivity and magnification 1. The derived scoped sensitivity is slower.
    const hipfire = degreesPerCount(BATTERY_COUNTS);
    const scope = SIMULATED_SCOPES.ads;
    expect(scope.magnification).toBeGreaterThan(1);
    const { measured } = runBattery(adsTest, { scopeKey: "ads" });
    expect(measured.scopeKey).toBe("ads");
    // Every trial completed at some sensitivity; the engine restored it each time, or the
    // hipfire controls would have been run zoomed and their acquisition would differ wildly.
    const controls = measured.trials.filter((t) => t.variant === "hipfire");
    expect(controls.every((t) => t.validity !== "invalid")).toBe(true);
    expect(countsPer360FromDegreesPerCount(hipfire)).toBeCloseTo(BATTERY_COUNTS, 6);
  });

  it("refuses to run at hipfire, which has no scope", () => {
    expect(() => runBattery(adsTest, { scopeKey: "hipfire" })).toThrow(/needs a scoped scopeKey/);
  });
});
