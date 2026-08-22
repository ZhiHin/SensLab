import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { calibrationCandidates, calibrationRounds, testRounds } from "@/db/schema";
import { calibrationRepo, sessionRepo, userRepo } from "@/repositories";
import { hashPassword } from "@/lib/password";
import { withTransaction } from "@/repositories/transaction";
import {
  analyseCalibration,
  planCalibrationRound,
  type CalibrationContext,
} from "@/services/calibration-service";
import { CURRENT_VERSIONS } from "@/core/params";
import { algorithmRepo } from "@/repositories";
import { toLogSensitivity } from "@/core/calibration/bracket";
import type { RoundAggregate, TrialRecord } from "@/test-engine/contracts";
import type { SearchBracket } from "@/core/calibration/contracts";
import { asUser, db, resetVolatileTables } from "@tests/helpers/db";

/**
 * The server-side calibration boundary (doc 13, doc 23 §23.4).
 *
 * What this layer proves, and the unit suites cannot: that the **server** is the authority. The
 * candidate list is written before the client sees it, the objective is re-derived from stored
 * trials rather than accepted from the browser, and every round's decision lands in an audit
 * trail that can explain the recommendation long after the session is over (FR-069).
 */

const DPI = 800;

async function makeUser(email: string): Promise<string> {
  const { userId } = await userRepo.createUser({
    email,
    passwordHash: await hashPassword("correct-horse-battery"),
  });
  return userId;
}

async function makeSession(actor: ReturnType<typeof asUser>): Promise<string> {
  const versions = await algorithmRepo.resolveAlgorithmVersionIds({
    scoring: CURRENT_VERSIONS.scoring,
    calibration: CURRENT_VERSIONS.calibration,
    confidence: CURRENT_VERSIONS.confidence,
  });

  const session = await sessionRepo.createTestSession(actor, {
    hardwareProfileId: null,
    hardwareSnapshot: { dpi: DPI },
    primaryGameVersionId: null,
    mode: "standard",
    environment: {},
    environmentClass: "pass",
    seed: 987654321n,
    scoringVersionId: versions.scoring as string,
    calibrationVersionId: versions.calibration as string,
    confidenceVersionId: versions.confidence as string,
  });

  return session.id;
}

/** A block of flick trials for one candidate, with a performance that peaks at `optimumX`. */
function blockFor(options: {
  readonly candidateIndex: number;
  readonly x: number;
  readonly optimumX: number;
  readonly presentationOrder: number;
  readonly roundIndex: number;
  readonly trials: number;
}): RoundAggregate {
  const penalty = (options.x - options.optimumX) ** 2;

  const trials: TrialRecord[] = Array.from({ length: options.trials }, (_, index) => ({
    trialIndex: index,
    isPractice: false,
    validity: "valid" as const,
    invalidReason: null,
    isReplacement: false,
    startOffsetMs: index * 2600,
    durationMs: 500,
    hit: true,
    shots: 1,
    targetAngularRadiusDeg: 2,
    targetDistanceDeg: 20,
    targetDirectionDeg: 0,
    stimulusSeed: `round${options.roundIndex}:flick:${index}`,
    variant: "medium",
    qualityFlags: [],
    quality: { cleanFrameFraction: 1, hitchCount: 0, bufferOverflow: false },
    metrics: {
      // Deterministic and monotone in the distance from the optimum, with a small sawtooth so
      // the robust scale is not degenerate.
      adjustedAcquisitionTime: 300 + penalty * 220 + (index % 5) * 6,
      firstShotAccuracy: index % 4 === 0 ? 0 : 1,
      flickErrorNorm: 0.4 + penalty * 0.7 + (index % 3) * 0.03,
    },
  }));

  return {
    presentationOrder: options.presentationOrder,
    blockIndex: options.roundIndex,
    roundIndex: options.roundIndex,
    candidateIndex: options.candidateIndex,
    testKey: "flick",
    scopeKey: "hipfire",
    isPractice: false,
    startedAt: new Date("2026-08-22T10:00:00.000Z").toISOString(),
    completedAt: new Date("2026-08-22T10:02:00.000Z").toISOString(),
    trials,
    roundMetrics: {},
    qualitySummary: { lateFrameRatio: 0, hitchCount: 0, lockLossCount: 0 },
  };
}

describe("the server-side adaptive step", () => {
  beforeEach(async () => {
    await resetVolatileTables();
  });

  afterAll(async () => {
    await closeDb();
  });

  function contextFor(sessionId: string): CalibrationContext {
    return {
      sessionId,
      mode: "standard",
      seed: 987654321n,
      deviceDpi: DPI,
      anchor: { kind: "cold_start" },
      padWidthCm: null,
      comfortableSwipeCm: null,
    };
  }

  it("writes the candidates before the client ever sees them — SENS-BR-034", async () => {
    const actor = asUser(await makeUser("planner@senslab.test"));
    const sessionId = await makeSession(actor);

    const planned = await planCalibrationRound(actor, contextFor(sessionId), 0, null);

    expect(planned.candidates).toHaveLength(3);

    const stored = await db()
      .select()
      .from(calibrationCandidates)
      .where(eq(calibrationCandidates.sessionId, sessionId));

    expect(stored).toHaveLength(3);
    // The blind-label mapping exists only here. A client that could author it could learn which
    // candidate is which, and the measurement would be of its expectations (`SENS-BR-007`).
    for (const row of stored) {
      expect(["A", "B", "C", "D", "E", "F"]).toContain(row.blindLabel);
      expect(row.countsPer360).toBeGreaterThan(0);
      expect(row.cmPer360).toBeGreaterThan(0);
    }
  });

  it("is idempotent, so a retried plan request does not renumber the round", async () => {
    const actor = asUser(await makeUser("retry-plan@senslab.test"));
    const sessionId = await makeSession(actor);
    const context = contextFor(sessionId);

    const first = await planCalibrationRound(actor, context, 0, null);
    const second = await planCalibrationRound(actor, context, 0, null);

    expect(second.candidates.map((candidate) => candidate.candidateIndex)).toEqual(
      first.candidates.map((candidate) => candidate.candidateIndex),
    );

    const stored = await db()
      .select()
      .from(calibrationCandidates)
      .where(eq(calibrationCandidates.sessionId, sessionId));
    expect(stored).toHaveLength(3);
  });

  it("counterbalances the block order across rounds", async () => {
    const actor = asUser(await makeUser("counterbalance@senslab.test"));
    const sessionId = await makeSession(actor);
    const context = contextFor(sessionId);

    const first = await planCalibrationRound(actor, context, 0, null);
    const orders = [first.blockOrder];
    for (let round = 1; round < 3; round += 1) {
      const planned = await planCalibrationRound(actor, context, round, first.bracket);
      orders.push(planned.blockOrder);
    }

    // Every order is a permutation of its round's candidates, and consecutive rounds differ —
    // the final round has one more block than the others because of the anchor, so the strict
    // "each candidate in each position exactly once" property holds within a candidate count
    // rather than across the whole session. That property is asserted directly on the Latin
    // square in the unit suite.
    for (const order of orders) {
      expect(new Set(order).size).toBe(order.length);
    }
    expect(JSON.stringify(orders[0])).not.toBe(JSON.stringify(orders[1]));
  });

  it("attaches an ingested round to its candidate", async () => {
    const actor = asUser(await makeUser("attach@senslab.test"));
    const sessionId = await makeSession(actor);
    const planned = await planCalibrationRound(actor, contextFor(sessionId), 0, null);
    const candidate = planned.candidates[0];
    if (candidate === undefined) throw new Error("no candidate");

    await withTransaction((tx) =>
      sessionRepo.ingestRoundAggregate(
        actor,
        sessionId,
        blockFor({
          candidateIndex: candidate.candidateIndex,
          x: candidate.x as number,
          optimumX: candidate.x as number,
          presentationOrder: 0,
          roundIndex: 0,
          trials: 12,
        }),
        tx,
      ),
    );

    const rows = await db()
      .select({ candidateId: testRounds.candidateId })
      .from(testRounds)
      .where(eq(testRounds.sessionId, sessionId));

    // Without this link the trials could not be attributed to a sensitivity, which is the whole
    // reason for storing them.
    expect(rows[0]?.candidateId).not.toBeNull();
  });

  it("refuses a round naming a candidate the session does not have", async () => {
    const actor = asUser(await makeUser("bad-candidate@senslab.test"));
    const sessionId = await makeSession(actor);
    await planCalibrationRound(actor, contextFor(sessionId), 0, null);

    await expect(
      withTransaction((tx) =>
        sessionRepo.ingestRoundAggregate(
          actor,
          sessionId,
          blockFor({
            candidateIndex: 99,
            x: 13,
            optimumX: 13,
            presentationOrder: 0,
            roundIndex: 0,
            trials: 4,
          }),
          tx,
        ),
      ),
    ).rejects.toThrow(/candidate 99/);
  });

  it("re-derives the objective from stored trials and writes the audit trail — FR-069", async () => {
    const actor = asUser(await makeUser("analyse@senslab.test"));
    const sessionId = await makeSession(actor);
    const context = contextFor(sessionId);

    const planned = await planCalibrationRound(actor, context, 0, null);
    const optimumX = planned.candidates[1]?.x as number;

    let presentationOrder = 0;
    for (const candidate of planned.candidates) {
      await withTransaction((tx) =>
        sessionRepo.ingestRoundAggregate(
          actor,
          sessionId,
          blockFor({
            candidateIndex: candidate.candidateIndex,
            x: candidate.x as number,
            optimumX,
            presentationOrder,
            roundIndex: 0,
            trials: 60,
          }),
          tx,
        ),
      );
      presentationOrder += 1;
    }

    const observed = await calibrationRepo.loadObservedTrials(sessionId);
    // Every measured trial comes back with its metrics, attributed to a candidate and a block.
    expect(observed).toHaveLength(180);
    expect(observed.every((trial) => Object.keys(trial.metrics).length > 0)).toBe(true);

    const brackets = new Map<number, SearchBracket>([[0, planned.bracket]]);
    const outcome = await analyseCalibration(actor, context, brackets);

    expect(outcome.result.rounds.length).toBeGreaterThan(0);
    expect(outcome.result.candidates).toHaveLength(3);

    const audit = await db()
      .select()
      .from(calibrationRounds)
      .where(eq(calibrationRounds.sessionId, sessionId));

    expect(audit).toHaveLength(1);
    const round = audit[0];
    // Enough to redraw the response curve and explain the decision without re-running a trial.
    expect(round?.decision).toBeTruthy();
    expect(round?.driftForm).toBeTruthy();
    expect(round?.bracketLow as number).toBeLessThanOrEqual(round?.bracketHigh as number);
    expect(Number.isFinite(round?.mde as number)).toBe(true);
  });

  it("produces the identical result when re-run over the same stored trials — SENS-BR-030", async () => {
    const actor = asUser(await makeUser("recompute@senslab.test"));
    const sessionId = await makeSession(actor);
    const context = contextFor(sessionId);

    const planned = await planCalibrationRound(actor, context, 0, null);
    const optimumX = planned.candidates[1]?.x as number;

    let presentationOrder = 0;
    for (const candidate of planned.candidates) {
      await withTransaction((tx) =>
        sessionRepo.ingestRoundAggregate(
          actor,
          sessionId,
          blockFor({
            candidateIndex: candidate.candidateIndex,
            x: candidate.x as number,
            optimumX,
            presentationOrder,
            roundIndex: 0,
            trials: 40,
          }),
          tx,
        ),
      );
      presentationOrder += 1;
    }

    const brackets = new Map<number, SearchBracket>([[0, planned.bracket]]);
    const first = await analyseCalibration(actor, context, brackets);
    const second = await analyseCalibration(actor, context, brackets);

    // The recompute guarantee, end to end: same stored trials, same answer, forever.
    expect(second.result.verdict).toBe(first.result.verdict);
    expect(second.result.xStar).toBe(first.result.xStar);
    expect(second.result.estimates).toEqual(first.result.estimates);

    // And the audit trail was not duplicated by the second run.
    const audit = await db()
      .select()
      .from(calibrationRounds)
      .where(eq(calibrationRounds.sessionId, sessionId));
    expect(audit).toHaveLength(1);
  });

  it("records the algorithm versions that produced the session", async () => {
    const actor = asUser(await makeUser("versions@senslab.test"));
    const sessionId = await makeSession(actor);
    const session = await sessionRepo.getTestSession(actor, sessionId);

    // `SENS-BR-029`: a session that could not name the versions behind it is not reproducible.
    expect(session?.scoringVersionId).toBeTruthy();
    expect(session?.calibrationVersionId).toBeTruthy();
    expect(session?.confidenceVersionId).toBeTruthy();
    expect(session?.seed).toBeTruthy();
  });
});

/** Unused import guard: `toLogSensitivity` documents the x/counts relationship for readers. */
void toLogSensitivity;
