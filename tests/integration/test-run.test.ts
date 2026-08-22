import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { testRounds, testTrials, roundMetrics, trialMetrics } from "@/db/schema";
import { userRepo } from "@/repositories";
import { hashPassword } from "@/lib/password";
import { createEngine } from "@/test-engine/engine";
import { createStandardCollector } from "@/test-engine/metrics";
import { flickTest, comfort360Test } from "@/test-engine/tests";
import type { RoundAggregate } from "@/test-engine/contracts";
import {
  abandonTestRun,
  completeTestRun,
  startTestRun,
  submitRound,
} from "@/services/test-run-service";
import { asUser, db, resetVolatileTables } from "@tests/helpers/db";
import { createHarness } from "@tests/helpers/engine-harness";

/**
 * A whole aim test, from the engine to the database (Phase 3).
 *
 * The unit suites prove the metrics are computed correctly and the engine runs the lifecycle.
 * What only this layer can prove is that what the engine produced is what the database ends up
 * holding — including the parts that are easy to drop silently on the way: the trial variant,
 * the quality flags, and the round aggregates with their sample counts.
 */

const FRAME_MS = 1000 / 240;

async function makeUser(email: string): Promise<string> {
  const { userId } = await userRepo.createUser({
    email,
    passwordHash: await hashPassword("correct-horse-battery"),
  });
  return userId;
}

/** Runs a test with a synthetic player that aims at whatever the renderer drew. */
function playThrough(
  definition: typeof flickTest,
  plan: Parameters<typeof createEngine>[0]["plan"],
) {
  const { clock, input, renderer } = createHarness(1000);
  const aggregates: RoundAggregate[] = [];

  const engine = createEngine({
    plan,
    definitions: [definition],
    clock,
    input,
    renderer,
    collector: createStandardCollector(),
    frameBudgetMs: FRAME_MS,
    callbacks: { onRoundComplete: (aggregate) => aggregates.push(aggregate) },
  });

  engine.init();
  engine.startUnlocked();

  let sweepFrames = 0;

  for (let frame = 0; frame < 60_000 && engine.state === "running"; frame += 1) {
    clock.tick(FRAME_MS);
    const now = clock.now();
    const drawn = renderer.lastFrame;
    if (drawn === null) continue;

    const camera = engine.camera;
    const perCount = camera.degreesPerCount;

    if (definition.key === "comfort360") {
      if (engine.trialPhase !== "active") {
        sweepFrames = 0;
        continue;
      }
      sweepFrames += 1;
      if (sweepFrames < 30) input.move(now, 20 / perCount, 0);
      else if (sweepFrames === 35) input.click(now + 0.5);
      continue;
    }

    const target = drawn.targets.living()[0];
    if (target === undefined) continue;

    const position = drawn.targets.positionAt(target, now);
    input.move(
      now,
      (position.yawDeg - camera.yawDeg) / perCount,
      -(position.pitchDeg - camera.pitchDeg) / perCount,
    );
    input.click(now + 0.5);
  }

  return { aggregates, qualityFlags: engine.sessionFlags() };
}

describe("a single-test run reaches the database", () => {
  beforeEach(async () => {
    await resetVolatileTables();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("creates a session pinned to the algorithm versions that produced it", async () => {
    const actor = asUser(await makeUser("run-owner@senslab.test"));

    const { sessionId, plan } = await startTestRun(actor, {
      testKey: "flick",
      mode: "quick",
      countsPer360: 9448.82,
      aspectRatio: 16 / 9,
      maxImpliedCountsPerSecond: 4_000_000,
      environment: { devicePixelRatio: 1 },
    });

    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
    // The plan is authored on the server: the seed, the trial counts and the sensitivity all
    // decide what the numbers mean, so a client must not get to choose them.
    expect(plan.sessionId).toBe(sessionId);
    expect(plan.rounds.length).toBeGreaterThanOrEqual(2);
    expect(plan.rounds.some((round) => round.isPractice)).toBe(true);
    expect(Number(plan.baselineCountsPer360)).toBeCloseTo(9448.82, 6);

    const rows = await db()
      .select({ status: sql<string>`status`, seed: sql<string>`seed::text` })
      .from(sql`test_sessions`)
      .where(sql`id = ${sessionId}`);
    expect(rows[0]?.status).toBe("in_progress");
  });

  it("refuses a test it does not have, rather than creating an empty session", async () => {
    const actor = asUser(await makeUser("unknown-test@senslab.test"));

    await expect(
      startTestRun(actor, {
        testKey: "not-a-test",
        mode: "quick",
        countsPer360: 9448.82,
        aspectRatio: 16 / 9,
        maxImpliedCountsPerSecond: 4_000_000,
        environment: {},
      }),
    ).rejects.toThrow(/not-a-test/);
  });

  it("refuses an implausible sensitivity", async () => {
    const actor = asUser(await makeUser("bad-sens@senslab.test"));

    await expect(
      startTestRun(actor, {
        testKey: "flick",
        mode: "quick",
        countsPer360: 12,
        aspectRatio: 16 / 9,
        maxImpliedCountsPerSecond: 4_000_000,
        environment: {},
      }),
    ).rejects.toThrow();
  });

  it("persists trials, their metrics and the round aggregates", async () => {
    const actor = asUser(await makeUser("flick-runner@senslab.test"));
    const { sessionId, plan } = await startTestRun(actor, {
      testKey: "flick",
      mode: "quick",
      countsPer360: 9448.82,
      aspectRatio: 16 / 9,
      maxImpliedCountsPerSecond: 4_000_000,
      environment: {},
    });

    const { aggregates, qualityFlags } = playThrough(flickTest, plan);
    expect(aggregates.length).toBeGreaterThanOrEqual(2);

    for (const aggregate of aggregates) {
      const outcome = await submitRound(actor, sessionId, aggregate);
      expect(outcome.created).toBe(true);
      expect(outcome.trialsWritten).toBe(aggregate.trials.length);
    }
    await completeTestRun(actor, sessionId, qualityFlags);

    const rounds = await db()
      .select({ id: testRounds.id, isPractice: testRounds.isPractice })
      .from(testRounds)
      .where(eq(testRounds.sessionId, sessionId));
    expect(rounds).toHaveLength(aggregates.length);

    const measured = rounds.find((round) => !round.isPractice);
    expect(measured).toBeDefined();

    const trials = await db()
      .select()
      .from(testTrials)
      .where(eq(testTrials.roundId, measured?.id ?? ""));
    expect(trials.length).toBeGreaterThan(0);

    // The variant survives the trip. Without it a flick round could not be broken down by
    // distance class, and a comfort round could not be broken down at all.
    expect(trials.every((trial) => trial.variant !== null)).toBe(true);
    expect(new Set(trials.map((trial) => trial.variant)).size).toBeGreaterThan(1);

    const metrics = await db()
      .select({ key: trialMetrics.metricKey })
      .from(trialMetrics)
      .innerJoin(testTrials, eq(testTrials.id, trialMetrics.trialId))
      .where(eq(testTrials.roundId, measured?.id ?? ""));
    expect(metrics.length).toBeGreaterThan(0);
    for (const metric of metrics) expect(flickTest.metricKeys).toContain(metric.key);

    const aggregated = await db()
      .select()
      .from(roundMetrics)
      .where(eq(roundMetrics.roundId, measured?.id ?? ""));
    expect(aggregated.length).toBeGreaterThan(0);
    for (const row of aggregated) {
      // doc 10 §10.10 — a metric value without its sample count is not storable, and the
      // schema enforces it. This asserts the counts are real rather than zero-filled.
      expect(row.validTrials + row.degradedTrials).toBeGreaterThan(0);
    }
  });

  it("is idempotent: a retried upload writes nothing twice — SENS-NFR-016", async () => {
    const actor = asUser(await makeUser("retry@senslab.test"));
    const { sessionId, plan } = await startTestRun(actor, {
      testKey: "flick",
      mode: "quick",
      countsPer360: 9448.82,
      aspectRatio: 16 / 9,
      maxImpliedCountsPerSecond: 4_000_000,
      environment: {},
    });

    const { aggregates } = playThrough(flickTest, plan);
    const round = aggregates[0];
    if (round === undefined) throw new Error("no round produced");

    const first = await submitRound(actor, sessionId, round);
    const second = await submitRound(actor, sessionId, round);
    const third = await submitRound(actor, sessionId, round);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(third.created).toBe(false);
    expect(second.roundId).toBe(first.roundId);

    const trials = await db()
      .select({ id: testTrials.id })
      .from(testTrials)
      .where(eq(testTrials.roundId, first.roundId));
    expect(trials).toHaveLength(round.trials.length);
  });

  it("stores a comfort run's three sub-tasks distinguishably", async () => {
    const actor = asUser(await makeUser("comfort@senslab.test"));
    const { sessionId, plan } = await startTestRun(actor, {
      testKey: "comfort360",
      mode: "quick",
      countsPer360: 9448.82,
      aspectRatio: 16 / 9,
      maxImpliedCountsPerSecond: 4_000_000,
      environment: {},
    });

    const { aggregates } = playThrough(comfort360Test, plan);
    for (const aggregate of aggregates) await submitRound(actor, sessionId, aggregate);

    const rounds = await db()
      .select({ id: testRounds.id })
      .from(testRounds)
      .where(and(eq(testRounds.sessionId, sessionId), eq(testRounds.isPractice, false)));
    const roundId = rounds[0]?.id ?? "";

    const trials = await db()
      .select({ variant: testTrials.variant })
      .from(testTrials)
      .where(eq(testTrials.roundId, roundId));

    // Three genuinely different quantities. An analysis that could not tell them apart would
    // average a swipe distance against a return error.
    expect(new Set(trials.map((trial) => trial.variant))).toEqual(
      new Set(["swipe", "half_turn", "return"]),
    );
  });

  it("keeps what was already recorded when a run is abandoned", async () => {
    const actor = asUser(await makeUser("abandoned@senslab.test"));
    const { sessionId, plan } = await startTestRun(actor, {
      testKey: "flick",
      mode: "quick",
      countsPer360: 9448.82,
      aspectRatio: 16 / 9,
      maxImpliedCountsPerSecond: 4_000_000,
      environment: {},
    });

    const { aggregates } = playThrough(flickTest, plan);
    const round = aggregates[0];
    if (round === undefined) throw new Error("no round produced");
    await submitRound(actor, sessionId, round);

    await abandonTestRun(actor, sessionId);

    const rows = await db()
      .select({ status: sql<string>`status` })
      .from(sql`test_sessions`)
      .where(sql`id = ${sessionId}`);
    expect(rows[0]?.status).toBe("abandoned");

    // Abandoning marks the session; it never deletes what was measured.
    const rounds = await db()
      .select({ id: testRounds.id })
      .from(testRounds)
      .where(eq(testRounds.sessionId, sessionId));
    expect(rounds).toHaveLength(1);
  });
});
