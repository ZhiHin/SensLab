import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import {
  algorithmVersions,
  testDefinitions,
  testRounds,
  testTrials,
  trialMetrics,
} from "@/db/schema";
import { CURRENT_VERSIONS, RELEASED_PARAMETER_SETS } from "@/core/params";
import { ADVANCED_TEST_KEYS, TEST_KEYS } from "@/core/types/vocabulary";
import { userRepo } from "@/repositories";
import { hashPassword } from "@/lib/password";
import { completeTestRun, startTestRun, submitRound } from "@/services/test-run-service";
import { runBootChecks } from "@/services/boot-service";
import {
  scopeCalibrationAvailable,
  scopesOfferedForGame,
} from "@/services/scope-calibration-service";
import { ADVANCED_TESTS, adsTest, getTestDefinition, recoilTest } from "@/test-engine/tests";
import { LAUNCH_ADAPTERS } from "@/game-adapters";
import { asUser, db, resetVolatileTables } from "@tests/helpers/db";
import { runBattery } from "@tests/helpers/battery-runner";

/**
 * The post-MVP tests against the real database (Phase 6).
 *
 * Three things only this layer can prove: the seed knows the new tests and the new parameter
 * versions, a recoil run and an ADS run survive ingest with their new metrics and scope intact,
 * and Scope Calibration is offered to exactly the games doc 09 §9.14 allows — which, with
 * every adapter unverified, is none.
 */

async function makeUser(email: string): Promise<string> {
  const { userId } = await userRepo.createUser({
    email,
    passwordHash: await hashPassword("correct-horse-battery"),
  });
  return userId;
}

describe("the seed and the boot check", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("stores a definition for every test, including the advanced six", async () => {
    const rows = await db().select({ key: testDefinitions.key }).from(testDefinitions);
    const keys = new Set(rows.map((row) => row.key));
    for (const key of TEST_KEYS) expect(keys.has(key), key).toBe(true);
    expect(keys.size).toBe(TEST_KEYS.length);
  });

  it("stores every released parameter version, current and historical, and boots clean", async () => {
    const rows = await db()
      .select({ kind: algorithmVersions.kind, versionLabel: algorithmVersions.versionLabel })
      .from(algorithmVersions);
    const stored = new Set(rows.map((row) => `${row.kind}:${row.versionLabel}`));
    for (const set of RELEASED_PARAMETER_SETS) {
      expect(stored.has(`${set.kind}:${set.version}`), set.version).toBe(true);
    }
    expect(stored.has("scoring:scoring_model_v1")).toBe(true);
    expect(stored.has("scoring:scoring_model_v2")).toBe(true);
    expect(CURRENT_VERSIONS.scoring).toBe("scoring_model_v2");

    const boot = await runBootChecks();
    expect(boot.parameterProblems).toEqual([]);
    expect(boot.ok).toBe(true);
  });
});

describe("advanced runs reach the database", () => {
  beforeEach(async () => {
    await resetVolatileTables();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("persists a recoil run with its family variants and recoil metrics", async () => {
    const actor = asUser(await makeUser("recoil-runner@senslab.test"));
    const { sessionId, plan } = await startTestRun(actor, {
      testKey: "recoil",
      mode: "quick",
      countsPer360: 9448.82,
      aspectRatio: 16 / 9,
      maxImpliedCountsPerSecond: 4_000_000,
      environment: {},
    });

    const { aggregates } = runBattery(recoilTest, { plan });
    for (const aggregate of aggregates) {
      const outcome = await submitRound(actor, sessionId, aggregate);
      expect(outcome.created).toBe(true);
    }
    await completeTestRun(actor, sessionId, []);

    const rounds = await db()
      .select({ id: testRounds.id, isPractice: testRounds.isPractice })
      .from(testRounds)
      .where(eq(testRounds.sessionId, sessionId));
    const measured = rounds.find((round) => !round.isPractice);
    expect(measured).toBeDefined();

    const trials = await db()
      .select({ variant: testTrials.variant })
      .from(testTrials)
      .where(eq(testTrials.roundId, measured?.id ?? ""));
    expect(trials.length).toBeGreaterThan(0);
    // The family label is the variant, and every family was presented.
    expect(new Set(trials.map((trial) => trial.variant)).size).toBe(4);

    const metrics = await db()
      .select({ key: trialMetrics.metricKey })
      .from(trialMetrics)
      .innerJoin(testTrials, eq(testTrials.id, trialMetrics.trialId))
      .where(eq(testTrials.roundId, measured?.id ?? ""));
    const keys = new Set(metrics.map((metric) => metric.key));
    for (const key of [
      "recoilDeviationVertical",
      "recoilCompensationGain",
      "stabilityUnderRecoil",
    ]) {
      expect(keys.has(key), key).toBe(true);
    }
    for (const metric of metrics) expect(recoilTest.metricKeys).toContain(metric.key);
  });

  it("persists an ADS run under the simulated scope, controls and scoped trials both", async () => {
    const actor = asUser(await makeUser("ads-runner@senslab.test"));
    const { sessionId, plan } = await startTestRun(actor, {
      testKey: "ads",
      mode: "quick",
      countsPer360: 9448.82,
      aspectRatio: 16 / 9,
      maxImpliedCountsPerSecond: 4_000_000,
      environment: {},
    });
    expect(plan.rounds.every((round) => round.scopeKey === "ads")).toBe(true);

    const { aggregates } = runBattery(adsTest, { plan, scopeKey: "ads" });
    for (const aggregate of aggregates) await submitRound(actor, sessionId, aggregate);
    await completeTestRun(actor, sessionId, []);

    const rounds = await db()
      .select({
        id: testRounds.id,
        scopeKey: testRounds.scopeKey,
        isPractice: testRounds.isPractice,
      })
      .from(testRounds)
      .where(eq(testRounds.sessionId, sessionId));
    expect(rounds.every((round) => round.scopeKey === "ads")).toBe(true);

    const measured = rounds.find((round) => !round.isPractice);
    const trials = await db()
      .select({ variant: testTrials.variant })
      .from(testTrials)
      .where(eq(testTrials.roundId, measured?.id ?? ""));
    const variants = trials.map((trial) => trial.variant);
    expect(variants.filter((v) => v === "ads").length).toBe(variants.length / 2);
    expect(variants.filter((v) => v === "hipfire").length).toBe(variants.length / 2);
  });

  it("starts a run for every advanced test", async () => {
    const actor = asUser(await makeUser("all-advanced@senslab.test"));
    for (const definition of ADVANCED_TESTS) {
      const { plan } = await startTestRun(actor, {
        testKey: definition.key,
        mode: "quick",
        countsPer360: 9448.82,
        aspectRatio: 16 / 9,
        maxImpliedCountsPerSecond: 4_000_000,
        environment: {},
      });
      expect(plan.rounds.length).toBeGreaterThan(0);
      expect(getTestDefinition(definition.key)).toBe(definition);
    }
    expect(ADVANCED_TEST_KEYS).toHaveLength(6);
  });
});

describe("scope calibration exposure — doc 09 §9.14", () => {
  it("offers no scope for any launch game, because none has a verified roster", () => {
    for (const adapter of LAUNCH_ADAPTERS) {
      expect(scopesOfferedForGame(adapter.identity.gameId)).toEqual([]);
      expect(scopeCalibrationAvailable(adapter.identity.gameId)).toBe(false);
    }
    expect(scopesOfferedForGame("not-a-game")).toEqual([]);
  });
});
