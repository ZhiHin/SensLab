import { describe, expect, it } from "vitest";
import { countsPer360 } from "@/core/types/brand";
import { roundAggregateSchema, startRunSchema } from "@/features/test-run/schema";
import { createEngine } from "@/test-engine/engine";
import { createStandardCollector } from "@/test-engine/metrics";
import { createSingleTestPlan } from "@/test-engine/plan/single-test";
import { flickTest } from "@/test-engine/tests";
import type { RoundAggregate } from "@/test-engine/contracts";
import { createHarness } from "../../helpers/engine-harness";

/**
 * Validation of what the browser submits (doc 23 §23.6).
 *
 * The first test here is the important one: it feeds a **real, engine-produced round** through
 * the validator. Hand-written fixtures would have passed a schema that rejected every genuine
 * upload — which is exactly what happened, because Zod's `record` with an enum key is
 * exhaustive and demanded every metric in the registry on every round.
 *
 * The rest assert the rejections that matter. The server cannot verify that a reported
 * acquisition time is what a hand actually did — measurement happens in the browser, and
 * pretending otherwise would be worse than admitting it. What it can do is refuse the
 * structurally impossible, which is what turns "a client could send anything" into "a client
 * could send a plausible lie".
 */

const FRAME_MS = 1000 / 240;

/** Runs a real flick round and returns its aggregate, JSON round-tripped as an upload would be. */
function realRound(): RoundAggregate {
  const { clock, input, renderer } = createHarness(1000);
  const aggregates: RoundAggregate[] = [];

  const engine = createEngine({
    plan: createSingleTestPlan({
      sessionId: "00000000-0000-7000-8000-00000000test",
      seed: "schema-seed",
      mode: "quick",
      definition: flickTest,
      countsPer360: countsPer360(9448.82),
      aspectRatio: 16 / 9,
      maxImpliedCountsPerSecond: 4_000_000,
      includePractice: false,
    }),
    definitions: [flickTest],
    clock,
    input,
    renderer,
    collector: createStandardCollector(),
    frameBudgetMs: FRAME_MS,
    callbacks: { onRoundComplete: (aggregate) => aggregates.push(aggregate) },
  });

  engine.init();
  engine.startUnlocked();

  for (let frame = 0; frame < 40_000 && engine.state === "running"; frame += 1) {
    clock.tick(FRAME_MS);
    const drawn = renderer.lastFrame;
    const target = drawn?.targets.living()[0];
    if (drawn === undefined || drawn === null || target === undefined) continue;

    const now = clock.now();
    const position = drawn.targets.positionAt(target, now);
    const camera = engine.camera;
    input.move(
      now,
      (position.yawDeg - camera.yawDeg) / camera.degreesPerCount,
      -(position.pitchDeg - camera.pitchDeg) / camera.degreesPerCount,
    );
    input.click(now + 0.5);
  }

  const round = aggregates[0];
  if (round === undefined) throw new Error("no round produced");
  // Serialised and parsed, because that is what actually crosses the wire.
  return JSON.parse(JSON.stringify(round)) as RoundAggregate;
}

describe("round upload validation", () => {
  it("accepts a round the engine actually produced", () => {
    const parsed = roundAggregateSchema.safeParse(realRound());
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [], null, 2)).toBe(true);
  });

  it("accepts a sparse metric map, because trial metrics are sparse by design", () => {
    // A tracking metric is meaningless on a flick trial. A schema demanding every registered
    // metric would reject every real upload.
    const round = realRound();
    const trial = round.trials[0];
    expect(trial).toBeDefined();
    expect(Object.keys(trial?.metrics ?? {}).length).toBeLessThan(33);
    expect(roundAggregateSchema.safeParse(round).success).toBe(true);
  });

  it("rejects a metric key that is not in the registry", () => {
    const round = realRound();
    const tampered = {
      ...round,
      trials: round.trials.map((trial) => ({
        ...trial,
        metrics: { ...trial.metrics, madeUpMetric: 1 },
      })),
    };
    expect(roundAggregateSchema.safeParse(tampered).success).toBe(false);
  });

  it("rejects a trial whose validity contradicts its reason code", () => {
    const round = realRound();
    const tampered = {
      ...round,
      trials: round.trials.map((trial) => ({ ...trial, invalidReason: "timeout" })),
    };
    // The database check constraint would reject this too; catching it here turns a 500 into a
    // clear rejection.
    expect(roundAggregateSchema.safeParse(tampered).success).toBe(false);
  });

  it("rejects impossible numbers", () => {
    const round = realRound();

    const negativeDuration = {
      ...round,
      trials: round.trials.map((trial) => ({ ...trial, durationMs: -5 })),
    };
    expect(roundAggregateSchema.safeParse(negativeDuration).success).toBe(false);

    const impossibleFraction = {
      ...round,
      qualitySummary: { ...round.qualitySummary, lateFrameRatio: 1.4 },
    };
    expect(roundAggregateSchema.safeParse(impossibleFraction).success).toBe(false);
  });

  it("rejects an unknown test key", () => {
    const round = realRound();
    expect(roundAggregateSchema.safeParse({ ...round, testKey: "not-a-test" }).success).toBe(false);
  });
});

describe("run start validation", () => {
  it("accepts a well-formed request", () => {
    expect(
      startRunSchema.safeParse({
        testKey: "flick",
        mode: "quick",
        countsPer360: 9448.82,
        aspectRatio: 16 / 9,
        maxImpliedCountsPerSecond: 4_000_000,
        environment: {},
      }).success,
    ).toBe(true);
  });

  it("rejects a non-finite or non-positive sensitivity", () => {
    for (const countsPer360Value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        startRunSchema.safeParse({
          testKey: "flick",
          mode: "quick",
          countsPer360: countsPer360Value,
          aspectRatio: 16 / 9,
          maxImpliedCountsPerSecond: 4_000_000,
        }).success,
      ).toBe(false);
    }
  });

  it("rejects a test that does not exist", () => {
    expect(
      startRunSchema.safeParse({
        testKey: "aimbot",
        mode: "quick",
        countsPer360: 9448.82,
        aspectRatio: 16 / 9,
        maxImpliedCountsPerSecond: 4_000_000,
      }).success,
    ).toBe(false);
  });
});
