import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { hardwareRepo, sessionRepo, userRepo, withTransaction } from "@/repositories";
import { runBootChecks } from "@/services/boot-service";
import { listGameOptions } from "@/services/game-service";
import { gameAdapterRegistry } from "@/game-adapters";
import { countsPer360FromCm } from "@/core/sensitivity/canonical";
import { hashPassword } from "@/lib/password";
import type { RoundAggregate } from "@/test-engine/contracts";
import {
  asUser,
  currentAlgorithmVersionIds,
  db,
  makeEnvironmentFingerprint,
  makeHardwareSnapshot,
  resetVolatileTables,
  testSeed,
} from "@tests/helpers/db";

/**
 * Session persistence, round ingest and the boot integrity checks.
 *
 * The ingest properties are the ones that matter: a client on a flaky connection retries, so
 * the write must be idempotent (`SENS-NFR-016`), and a half-written round would leave a
 * session whose trial counts disagree with its aggregates, so it must be transactional
 * (`SENS-NFR-020`).
 */

async function makeUser(email: string): Promise<string> {
  const { userId } = await userRepo.createUser({
    email,
    passwordHash: await hashPassword("correct-horse-battery"),
  });
  return userId;
}

function makeRound(presentationOrder: number, trialCount = 3): RoundAggregate {
  const startedAt = new Date("2026-08-20T12:00:00.000Z").toISOString();
  const completedAt = new Date("2026-08-20T12:00:40.000Z").toISOString();

  return {
    presentationOrder,
    blockIndex: presentationOrder,
    roundIndex: 0,
    candidateIndex: null,
    testKey: "flick",
    scopeKey: "hipfire",
    isPractice: false,
    startedAt,
    completedAt,
    trials: Array.from({ length: trialCount }, (_, index) => ({
      trialIndex: index,
      isPractice: false,
      validity: "valid" as const,
      invalidReason: null,
      isReplacement: false,
      startOffsetMs: index * 2600,
      durationMs: 2400 + index,
      hit: true,
      shots: 1,
      targetAngularRadiusDeg: 1.8,
      targetDistanceDeg: 18 + index,
      targetDirectionDeg: 45,
      stimulusSeed: `seed-${presentationOrder}-${index}`,
      variant: null,
      qualityFlags: [],
      quality: { cleanFrameFraction: 0.99, hitchCount: 0, bufferOverflow: false },
      metrics: {
        targetAcquisitionTime: 680 + index * 5,
        adjustedAcquisitionTime: 520 + index * 5,
        firstShotAccuracy: 1,
        flickErrorNorm: 0.42,
        pathEfficiency: 0.81,
      },
    })),
    roundMetrics: {
      adjustedAcquisitionTime: {
        value: 525,
        validTrials: trialCount,
        invalidTrials: 0,
        degradedTrials: 0,
        robustStandardDeviation: 40,
        intervalLow: 500,
        intervalHigh: 550,
      },
      firstShotAccuracy: {
        value: 1,
        validTrials: trialCount,
        invalidTrials: 0,
        degradedTrials: 0,
        robustStandardDeviation: null,
        intervalLow: 0.72,
        intervalHigh: 1,
      },
    },
    qualitySummary: { lateFrameRatio: 0.006, hitchCount: 0, lockLossCount: 0 },
  };
}

async function makeSession(actor: ReturnType<typeof asUser>) {
  const versions = await currentAlgorithmVersionIds();
  return sessionRepo.createTestSession(actor, {
    hardwareProfileId: null,
    hardwareSnapshot: makeHardwareSnapshot(),
    primaryGameVersionId: null,
    mode: "standard",
    environment: makeEnvironmentFingerprint(),
    environmentClass: "pass",
    seed: testSeed(),
    ...versions,
  });
}

describe("round ingest", () => {
  beforeEach(async () => {
    await resetVolatileTables();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("writes the round, its trials and both metric levels", async () => {
    const alice = asUser(await makeUser("ingest@example.test"));
    const session = await makeSession(alice);

    const outcome = await withTransaction((tx) =>
      sessionRepo.ingestRoundAggregate(alice, session.id, makeRound(0), tx),
    );

    expect(outcome.created).toBe(true);
    expect(outcome.trialsWritten).toBe(3);
    expect(outcome.metricsWritten).toBe(3 * 5 + 2);

    const trials = (await db().execute(
      sql`select count(*)::int as count from test_trials`,
    )) as unknown as { count: number }[];
    expect(trials[0]?.count).toBe(3);

    const roundMetrics = (await db().execute(
      sql`select count(*)::int as count from round_metrics`,
    )) as unknown as { count: number }[];
    expect(roundMetrics[0]?.count).toBe(2);
  });

  it("is idempotent: replaying the same payload three times writes one round — SENS-NFR-016", async () => {
    const alice = asUser(await makeUser("idempotent-ingest@example.test"));
    const session = await makeSession(alice);
    const payload = makeRound(0);

    const outcomes = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      outcomes.push(
        await withTransaction((tx) =>
          sessionRepo.ingestRoundAggregate(alice, session.id, payload, tx),
        ),
      );
    }

    expect(outcomes.map((outcome) => outcome.created)).toEqual([true, false, false]);
    // All three resolve to the same round.
    expect(new Set(outcomes.map((outcome) => outcome.roundId)).size).toBe(1);

    expect(await sessionRepo.countRounds(session.id)).toBe(1);
    const trials = (await db().execute(
      sql`select count(*)::int as count from test_trials`,
    )) as unknown as { count: number }[];
    expect(trials[0]?.count).toBe(3);
  });

  it("accepts distinct presentation orders as distinct rounds", async () => {
    const alice = asUser(await makeUser("multi-round@example.test"));
    const session = await makeSession(alice);

    for (const order of [0, 1, 2]) {
      await withTransaction((tx) =>
        sessionRepo.ingestRoundAggregate(alice, session.id, makeRound(order), tx),
      );
    }
    expect(await sessionRepo.countRounds(session.id)).toBe(3);
  });

  it("writes a round whole or not at all — SENS-NFR-020", async () => {
    const alice = asUser(await makeUser("atomic@example.test"));
    const session = await makeSession(alice);

    // A metric key that does not exist in the registry fails the foreign key *after* the
    // round and trials have been inserted, so the rollback is what keeps the data consistent.
    const poisoned: RoundAggregate = {
      ...makeRound(0),
      roundMetrics: {
        notARealMetric: {
          value: 1,
          validTrials: 3,
          invalidTrials: 0,
          degradedTrials: 0,
          robustStandardDeviation: null,
          intervalLow: null,
          intervalHigh: null,
        },
      },
    };

    await expect(
      withTransaction((tx) => sessionRepo.ingestRoundAggregate(alice, session.id, poisoned, tx)),
    ).rejects.toThrow();

    expect(await sessionRepo.countRounds(session.id)).toBe(0);
    const trials = (await db().execute(
      sql`select count(*)::int as count from test_trials`,
    )) as unknown as { count: number }[];
    expect(trials[0]?.count).toBe(0);
  });

  it("refuses to ingest into another user's session", async () => {
    const alice = asUser(await makeUser("owner@example.test"));
    const bob = asUser(await makeUser("intruder@example.test"));
    const session = await makeSession(alice);

    await expect(
      withTransaction((tx) => sessionRepo.ingestRoundAggregate(bob, session.id, makeRound(0), tx)),
    ).rejects.toThrow(/not found/i);

    expect(await sessionRepo.countRounds(session.id)).toBe(0);
  });
});

describe("hardware snapshot immutability — SENS-BR-035", () => {
  beforeEach(async () => {
    await resetVolatileTables();
  });

  it("does not rewrite history when the profile is later edited", async () => {
    const alice = asUser(await makeUser("snapshot@example.test"));
    const profile = await hardwareRepo.createHardwareProfile(alice, {
      name: "Main Setup",
      dpi: 800,
      dpiSource: "known",
    });

    const versions = await currentAlgorithmVersionIds();
    const session = await sessionRepo.createTestSession(alice, {
      hardwareProfileId: profile.id,
      hardwareSnapshot: makeHardwareSnapshot({ dpi: 800 }),
      primaryGameVersionId: null,
      mode: "standard",
      environment: makeEnvironmentFingerprint(),
      environmentClass: "pass",
      seed: testSeed(),
      ...versions,
    });

    // The user later corrects their DPI.
    await hardwareRepo.updateHardwareProfile(alice, profile.id, { dpi: 1600 });

    const stored = await sessionRepo.getTestSession(alice, session.id);
    const snapshot = stored?.hardwareSnapshot as { dpi: number };
    expect(snapshot.dpi).toBe(800);

    const current = await hardwareRepo.getHardwareProfile(alice, profile.id);
    expect(current?.dpi).toBe(1600);
  });

  it("keeps historical sessions readable after the profile is soft-deleted", async () => {
    const alice = asUser(await makeUser("soft-delete@example.test"));
    const profile = await hardwareRepo.createHardwareProfile(alice, {
      name: "Retired Setup",
      dpi: 400,
      dpiSource: "known",
    });
    const versions = await currentAlgorithmVersionIds();
    const session = await sessionRepo.createTestSession(alice, {
      hardwareProfileId: profile.id,
      hardwareSnapshot: makeHardwareSnapshot({ dpi: 400 }),
      primaryGameVersionId: null,
      mode: "quick",
      environment: makeEnvironmentFingerprint(),
      environmentClass: "pass",
      seed: testSeed(),
      ...versions,
    });

    await hardwareRepo.softDeleteHardwareProfile(alice, profile.id);

    const stored = await sessionRepo.getTestSession(alice, session.id);
    expect(stored).not.toBeNull();
    expect((stored?.hardwareSnapshot as { dpi: number }).dpi).toBe(400);
  });
});

describe("session status transitions", () => {
  beforeEach(async () => {
    await resetVolatileTables();
  });

  it("stamps completedAt when a session completes", async () => {
    const alice = asUser(await makeUser("complete@example.test"));
    const session = await makeSession(alice);
    expect(session.completedAt).toBeNull();

    await sessionRepo.updateSessionStatus(alice, session.id, "completed");
    const after = await sessionRepo.getTestSession(alice, session.id);
    expect(after?.status).toBe("completed");
    expect(after?.completedAt).not.toBeNull();
  });

  it("records queryable quality flags — SENS-BR-010", async () => {
    const alice = asUser(await makeUser("flags@example.test"));
    const session = await makeSession(alice);

    await sessionRepo.addSessionQualityFlag(session.id, "no_raw_input", { browser: "firefox" });
    // Adding the same flag twice is a no-op rather than an error.
    await sessionRepo.addSessionQualityFlag(session.id, "no_raw_input", null);
    await sessionRepo.addSessionQualityFlag(session.id, "frame_degradation", null);

    const rows = (await db().execute(
      sql`select flag from session_quality_flags where session_id = ${session.id} order by flag`,
    )) as unknown as { flag: string }[];
    // Postgres orders enum values by declaration order, not alphabetically, so compare the
    // set: what matters here is which flags exist and that the repeated insert was a no-op.
    expect([...rows.map((row) => row.flag)].sort()).toEqual(["frame_degradation", "no_raw_input"]);
  });
});

describe("boot integrity and the adapter roster", () => {
  it("passes with the seeded database — doc 14 §14.9, doc 12 §12.4", async () => {
    const result = await runBootChecks();
    expect(result.parameterProblems, result.parameterProblems.join("; ")).toEqual([]);
    expect(result.adapterProblems, result.adapterProblems.join("; ")).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("lists all five launch games as unverified — doc 36", async () => {
    const options = await listGameOptions();
    expect(options).toHaveLength(5);
    for (const option of options) {
      expect(option.verificationStatus, option.slug).toBe("unverified");
      expect(option.canConvert, option.slug).toBe(false);
      expect(option.openRegisterEntries.length, option.slug).toBeGreaterThan(0);
    }
  });

  it("keeps the two Delta Force builds separate — SENS-BR-015", async () => {
    const options = await listGameOptions();
    const global = options.find((option) => option.slug === "delta-force-global");
    const china = options.find((option) => option.slug === "delta-force-cn");

    expect(global?.region).toBe("global");
    expect(china?.region).toBe("cn");
    expect(global?.openRegisterEntries).not.toEqual(china?.openRegisterEntries);
  });

  it("stores no sensitivity model for any unverified game", async () => {
    const rows = (await db().execute(
      sql`select count(*)::int as count from game_sensitivity_models`,
    )) as unknown as { count: number }[];
    // The absence of a model IS the unverified state (SENS-BR-014). A row here would mean
    // someone had recorded constants without completing verification.
    expect(rows[0]?.count).toBe(0);
  });

  it("refuses to convert for every launch game, end to end", async () => {
    const counts = countsPer360FromCm(31.2, 800);
    for (const summary of gameAdapterRegistry.listCurrent()) {
      const adapter = gameAdapterRegistry.resolve(summary.gameId);
      const outcome = adapter?.fromCanonical(counts, { dpi: 800, scopeKey: "hipfire" });
      expect(outcome?.ok, summary.gameId).toBe(false);
      if (outcome !== undefined && !outcome.ok) {
        expect(outcome.error.code).toBe("EXTERNAL_VERIFICATION_REQUIRED");
      }
    }
  });
});
