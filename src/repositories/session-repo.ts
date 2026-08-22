import { and, desc, eq } from "drizzle-orm";
import {
  calibrationCandidates,
  roundMetrics,
  sessionQualityFlags,
  testDefinitions,
  testRounds,
  testSessions,
  testTrials,
  trialMetrics,
  type TestSessionRow,
} from "@/db/schema";
import type {
  EnvironmentClass,
  SessionMode,
  SessionQualityFlag,
  SessionStatus,
} from "@/core/types/vocabulary";
import type { RoundAggregate } from "@/test-engine/contracts";
import { newId } from "@/lib/crypto";
import { notFound } from "@/lib/errors";
import { canOwn, ownershipPredicate, type Actor } from "./actor";
import { executor, type Executor } from "./transaction";

/**
 * Calibration session persistence.
 *
 * The one function worth reading closely is {@link ingestRoundAggregate}. Round upload has to
 * be idempotent (`SENS-NFR-016`) because the client retries on a flaky connection, and it has
 * to be transactional (`SENS-NFR-020`) because a half-written round leaves a session whose
 * trial counts disagree with its aggregates. Both come from one place: the unique constraint
 * on `(session_id, presentation_order)`, used as the conflict target.
 */

export interface CreateSessionInput {
  readonly hardwareProfileId: string | null;
  /** Immutable copy taken at creation (`SENS-BR-035`). */
  readonly hardwareSnapshot: Readonly<Record<string, unknown>>;
  readonly primaryGameVersionId: string | null;
  readonly mode: SessionMode;
  readonly environment: Readonly<Record<string, unknown>>;
  readonly environmentClass: EnvironmentClass;
  readonly seed: bigint;
  readonly parentSessionId?: string | null;
  readonly scoringVersionId: string;
  readonly calibrationVersionId: string;
  readonly confidenceVersionId: string;
}

export async function createTestSession(
  actor: Actor,
  input: CreateSessionInput,
  tx?: Executor,
): Promise<TestSessionRow> {
  if (!canOwn(actor)) throw notFound("session owner");
  const db = executor(tx);

  const owner =
    actor.kind === "user"
      ? { userId: actor.userId, guestSessionId: null }
      : { userId: null, guestSessionId: actor.kind === "guest" ? actor.guestSessionId : null };

  const rows = await db
    .insert(testSessions)
    .values({
      id: newId(),
      userId: owner.userId,
      guestSessionId: owner.guestSessionId,
      hardwareProfileId: input.hardwareProfileId,
      hardwareSnapshot: input.hardwareSnapshot,
      primaryGameVersionId: input.primaryGameVersionId,
      mode: input.mode,
      status: "created",
      environment: input.environment,
      environmentClass: input.environmentClass,
      seed: input.seed,
      parentSessionId: input.parentSessionId ?? null,
      scoringVersionId: input.scoringVersionId,
      calibrationVersionId: input.calibrationVersionId,
      confidenceVersionId: input.confidenceVersionId,
    })
    .returning();

  const row = rows[0];
  if (row === undefined) throw notFound("session");
  return row;
}

export async function getTestSession(
  actor: Actor,
  sessionId: string,
  tx?: Executor,
): Promise<TestSessionRow | null> {
  if (!canOwn(actor)) return null;
  const db = executor(tx);
  const rows = await db
    .select()
    .from(testSessions)
    .where(
      and(
        eq(testSessions.id, sessionId),
        ownershipPredicate(actor, {
          userId: testSessions.userId,
          guestSessionId: testSessions.guestSessionId,
        }),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listTestSessions(
  actor: Actor,
  limit = 25,
  tx?: Executor,
): Promise<readonly TestSessionRow[]> {
  if (!canOwn(actor)) return [];
  const db = executor(tx);
  return db
    .select()
    .from(testSessions)
    .where(
      ownershipPredicate(actor, {
        userId: testSessions.userId,
        guestSessionId: testSessions.guestSessionId,
      }),
    )
    .orderBy(desc(testSessions.startedAt))
    .limit(limit);
}

export async function updateSessionStatus(
  actor: Actor,
  sessionId: string,
  status: SessionStatus,
  tx?: Executor,
): Promise<void> {
  const db = executor(tx);
  const now = new Date();
  const rows = await db
    .update(testSessions)
    .set({
      status,
      updatedAt: now,
      ...(status === "completed" ? { completedAt: now } : {}),
    })
    .where(
      and(
        eq(testSessions.id, sessionId),
        ownershipPredicate(actor, {
          userId: testSessions.userId,
          guestSessionId: testSessions.guestSessionId,
        }),
      ),
    )
    .returning({ id: testSessions.id });

  if (rows[0] === undefined) throw notFound("session");
}

export async function addSessionQualityFlag(
  sessionId: string,
  flag: SessionQualityFlag,
  detail: Readonly<Record<string, unknown>> | null,
  tx?: Executor,
): Promise<void> {
  const db = executor(tx);
  await db
    .insert(sessionQualityFlags)
    .values({ sessionId, flag, detail })
    .onConflictDoNothing({ target: [sessionQualityFlags.sessionId, sessionQualityFlags.flag] });
}

export interface IngestOutcome {
  readonly roundId: string;
  /** False when this exact round had already been ingested — a retry, not a duplicate. */
  readonly created: boolean;
  readonly trialsWritten: number;
  readonly metricsWritten: number;
}

/**
 * Writes one round aggregate.
 *
 * Must be called inside a transaction. Idempotency is achieved by conflicting on
 * `(session_id, presentation_order)`: a retried upload finds the round already present and
 * returns without writing anything, so replaying the same payload three times produces one
 * round and one set of trials.
 */
export async function ingestRoundAggregate(
  actor: Actor,
  sessionId: string,
  aggregate: RoundAggregate,
  tx: Executor,
): Promise<IngestOutcome> {
  const session = await getTestSession(actor, sessionId, tx);
  if (session === null) throw notFound("session");

  const definitions = await tx
    .select({ id: testDefinitions.id })
    .from(testDefinitions)
    .where(and(eq(testDefinitions.key, aggregate.testKey), eq(testDefinitions.version, 1)))
    .limit(1);
  const definition = definitions[0];
  if (definition === undefined) throw notFound(`test definition "${aggregate.testKey}"`);

  // Resolve the candidate this round belongs to. A calibration round without one would leave
  // its trials unattributable to a sensitivity, which is the whole point of storing them.
  let candidateId: string | null = null;
  if (aggregate.candidateIndex !== null) {
    const found = await tx
      .select({ id: calibrationCandidates.id })
      .from(calibrationCandidates)
      .where(
        and(
          eq(calibrationCandidates.sessionId, sessionId),
          eq(calibrationCandidates.candidateIndex, aggregate.candidateIndex),
        ),
      )
      .limit(1);
    const row = found[0];
    if (row === undefined) throw notFound(`candidate ${aggregate.candidateIndex}`);
    candidateId = row.id;
  }

  const inserted = await tx
    .insert(testRounds)
    .values({
      id: newId(),
      sessionId,
      candidateId,
      testDefinitionId: definition.id,
      scopeKey: aggregate.scopeKey,
      blockIndex: aggregate.blockIndex,
      presentationOrder: aggregate.presentationOrder,
      isPractice: aggregate.isPractice,
      status: "completed",
      startedAt: new Date(aggregate.startedAt),
      completedAt: new Date(aggregate.completedAt),
    })
    .onConflictDoNothing({ target: [testRounds.sessionId, testRounds.presentationOrder] })
    .returning({ id: testRounds.id });

  const insertedRound = inserted[0];
  if (insertedRound === undefined) {
    const existing = await tx
      .select({ id: testRounds.id })
      .from(testRounds)
      .where(
        and(
          eq(testRounds.sessionId, sessionId),
          eq(testRounds.presentationOrder, aggregate.presentationOrder),
        ),
      )
      .limit(1);
    const existingRound = existing[0];
    if (existingRound === undefined) throw notFound("round");
    return { roundId: existingRound.id, created: false, trialsWritten: 0, metricsWritten: 0 };
  }

  const roundId = insertedRound.id;

  const trialRows = aggregate.trials.map((trial) => ({
    id: newId(),
    roundId,
    trialIndex: trial.trialIndex,
    isPractice: trial.isPractice,
    validity: trial.validity,
    invalidReason: trial.invalidReason,
    isReplacement: trial.isReplacement,
    startOffsetMs: trial.startOffsetMs,
    durationMs: trial.durationMs,
    hit: trial.hit,
    shots: trial.shots,
    targetAngularRadiusDeg: trial.targetAngularRadiusDeg,
    targetDistanceDeg: trial.targetDistanceDeg,
    targetDirectionDeg: trial.targetDirectionDeg,
    stimulusSeed: trial.stimulusSeed,
    variant: trial.variant,
    cleanFrameFraction: trial.quality.cleanFrameFraction,
    // Every flag the engine raised, not just the one this layer happened to know about. A
    // dropped flag is a session that looks cleaner than it was.
    qualityFlags: [...trial.qualityFlags],
  }));

  if (trialRows.length > 0) await tx.insert(testTrials).values(trialRows);

  const metricRows = aggregate.trials.flatMap((trial, index) => {
    const row = trialRows[index];
    if (row === undefined) return [];
    return Object.entries(trial.metrics).map(([metricKey, value]) => ({
      trialId: row.id,
      metricKey,
      value,
    }));
  });

  if (metricRows.length > 0) await tx.insert(trialMetrics).values(metricRows);

  const roundMetricRows = Object.entries(aggregate.roundMetrics).map(([metricKey, metric]) => ({
    roundId,
    metricKey,
    value: metric.value,
    validTrials: metric.validTrials,
    invalidTrials: metric.invalidTrials,
    degradedTrials: metric.degradedTrials,
    robustSd: metric.robustStandardDeviation,
    ciLow: metric.intervalLow,
    ciHigh: metric.intervalHigh,
  }));

  if (roundMetricRows.length > 0) await tx.insert(roundMetrics).values(roundMetricRows);

  return {
    roundId,
    created: true,
    trialsWritten: trialRows.length,
    metricsWritten: metricRows.length + roundMetricRows.length,
  };
}

export async function countRounds(sessionId: string, tx?: Executor): Promise<number> {
  const db = executor(tx);
  const rows = await db
    .select({ id: testRounds.id })
    .from(testRounds)
    .where(eq(testRounds.sessionId, sessionId));
  return rows.length;
}
