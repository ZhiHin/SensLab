import { and, asc, eq } from "drizzle-orm";
import { cmPer360FromCounts } from "@/core/sensitivity/canonical";
import type { CalibrationRoundResult, Candidate } from "@/core/calibration/contracts";
import type { ObservedTrial } from "@/core/scoring/standardise";
import type { TestKey } from "@/core/types/vocabulary";
import {
  calibrationCandidates,
  calibrationRounds,
  testDefinitions,
  testRounds,
  testTrials,
  trialMetrics,
} from "@/db/schema";
import { newId } from "@/lib/crypto";
import { notFound } from "@/lib/errors";
import type { Actor } from "./actor";
import { canOwn } from "./actor";
import { executor, type Executor } from "./transaction";

/**
 * Persistence for the adaptive search (FR-069, doc 13 §13.11).
 *
 * ## Why the audit trail is not optional
 *
 * Without `calibration_rounds`, "why did it end there?" has no answer beyond the final number,
 * and `SENS-BR-030`'s recompute guarantee has nothing to check itself against. Every round
 * writes its bracket, its fit, its drift model, its MDE and its decision — enough to redraw the
 * response curve and re-derive the recommendation without re-running a single trial.
 *
 * ## Why candidates are written before the round runs
 *
 * The candidate list *is* the server's decision about what to measure next. Writing it first
 * means the client receives a plan it cannot author, and the stored blind-label mapping is the
 * only place the identity of each candidate exists (`SENS-BR-007`, `SENS-BR-034`).
 */

export interface CandidateRow {
  readonly id: string;
  readonly roundIndex: number;
  readonly candidateIndex: number;
  readonly countsPer360: number;
  readonly blindLabel: string;
}

/** Writes one round's candidates. Idempotent on `(session, round, candidate)`. */
export async function saveCandidates(
  actor: Actor,
  sessionId: string,
  candidates: readonly Candidate[],
  deviceDpi: number,
  tx?: Executor,
): Promise<readonly CandidateRow[]> {
  if (!canOwn(actor)) throw notFound("session owner");
  const db = executor(tx);
  if (candidates.length === 0) return [];

  await db
    .insert(calibrationCandidates)
    .values(
      candidates.map((candidate) => ({
        id: newId(),
        sessionId,
        roundIndex: candidate.roundIndex,
        candidateIndex: candidate.candidateIndex,
        countsPer360: Number(candidate.countsPer360),
        cmPer360: Number(cmPer360FromCounts(Number(candidate.countsPer360), deviceDpi)),
        blindLabel: candidate.blindLabel,
        source: candidate.source,
      })),
    )
    // A retried plan request must not duplicate the round's candidates, and must not renumber
    // them either — the client may already be running against the first response.
    .onConflictDoNothing({
      target: [
        calibrationCandidates.sessionId,
        calibrationCandidates.roundIndex,
        calibrationCandidates.candidateIndex,
      ],
    });

  return listCandidates(sessionId, tx);
}

export async function listCandidates(
  sessionId: string,
  tx?: Executor,
): Promise<readonly CandidateRow[]> {
  const db = executor(tx);
  const rows = await db
    .select({
      id: calibrationCandidates.id,
      roundIndex: calibrationCandidates.roundIndex,
      candidateIndex: calibrationCandidates.candidateIndex,
      countsPer360: calibrationCandidates.countsPer360,
      blindLabel: calibrationCandidates.blindLabel,
    })
    .from(calibrationCandidates)
    .where(eq(calibrationCandidates.sessionId, sessionId))
    .orderBy(asc(calibrationCandidates.roundIndex), asc(calibrationCandidates.candidateIndex));

  return rows;
}

/** Writes one round's analysis. Idempotent on `(session, round)`. */
export async function saveRoundResult(
  actor: Actor,
  sessionId: string,
  result: CalibrationRoundResult,
  xStar: {
    readonly value: number | null;
    readonly low: number | null;
    readonly high: number | null;
  },
  tx?: Executor,
): Promise<void> {
  if (!canOwn(actor)) throw notFound("session owner");
  const db = executor(tx);

  await db
    .insert(calibrationRounds)
    .values({
      id: newId(),
      sessionId,
      roundIndex: result.roundIndex,
      bracketLow: result.bracket.low as number,
      bracketHigh: result.bracket.high as number,
      fitB0: result.fit?.coefficients[0] ?? null,
      fitB1: result.fit?.coefficients[1] ?? null,
      fitB2: result.fit?.coefficients[2] ?? null,
      fitR2Adj: result.fit?.rSquaredAdjusted ?? null,
      fitConcave: result.fit?.concave ?? null,
      xStar: xStar.value,
      xStarCiLow: xStar.low,
      xStarCiHigh: xStar.high,
      driftForm: result.drift.form,
      driftDelta: result.drift.deltaFirstToLast,
      // A non-finite condition estimate means the design was singular. Storing a sentinel keeps
      // the column NOT NULL while remaining obviously an extreme rather than a real number.
      driftConditionNumber: Number.isFinite(result.drift.conditionNumber)
        ? result.drift.conditionNumber
        : Number.MAX_SAFE_INTEGER,
      mde: Number.isFinite(result.minimumDetectableEffect)
        ? result.minimumDetectableEffect
        : Number.MAX_SAFE_INTEGER,
      decision: result.decision,
    })
    .onConflictDoNothing({ target: [calibrationRounds.sessionId, calibrationRounds.roundIndex] });
}

export interface StoredRound {
  readonly roundIndex: number;
  readonly decision: string;
  readonly bracketLow: number;
  readonly bracketHigh: number;
}

export async function listRoundResults(
  sessionId: string,
  tx?: Executor,
): Promise<readonly StoredRound[]> {
  const db = executor(tx);
  return db
    .select({
      roundIndex: calibrationRounds.roundIndex,
      decision: calibrationRounds.decision,
      bracketLow: calibrationRounds.bracketLow,
      bracketHigh: calibrationRounds.bracketHigh,
    })
    .from(calibrationRounds)
    .where(eq(calibrationRounds.sessionId, sessionId))
    .orderBy(asc(calibrationRounds.roundIndex));
}

/**
 * Reads every measured trial of a session back as scoring input.
 *
 * The **server** re-derives the objective from stored trials rather than trusting a score the
 * client computed. A client that could submit its own objective values could submit a curve
 * with a peak wherever it liked (`SENS-BR-034`).
 */
export async function loadObservedTrials(
  sessionId: string,
  tx?: Executor,
): Promise<readonly ObservedTrial[]> {
  const db = executor(tx);

  const rows = await db
    .select({
      testKey: testDefinitions.key,
      candidateIndex: calibrationCandidates.candidateIndex,
      roundIndex: calibrationCandidates.roundIndex,
      blockIndex: testRounds.presentationOrder,
      trialId: testTrials.id,
      trialIndex: testTrials.trialIndex,
      validity: testTrials.validity,
      isPractice: testTrials.isPractice,
      scopeKey: testRounds.scopeKey,
      variant: testTrials.variant,
    })
    .from(testTrials)
    .innerJoin(testRounds, eq(testRounds.id, testTrials.roundId))
    .innerJoin(testDefinitions, eq(testDefinitions.id, testRounds.testDefinitionId))
    .innerJoin(calibrationCandidates, eq(calibrationCandidates.id, testRounds.candidateId))
    .where(and(eq(testRounds.sessionId, sessionId), eq(testTrials.isPractice, false)))
    .orderBy(asc(testRounds.presentationOrder), asc(testTrials.trialIndex));

  if (rows.length === 0) return [];

  const metricRows = await db
    .select({
      trialId: trialMetrics.trialId,
      metricKey: trialMetrics.metricKey,
      value: trialMetrics.value,
    })
    .from(trialMetrics)
    .innerJoin(testTrials, eq(testTrials.id, trialMetrics.trialId))
    .innerJoin(testRounds, eq(testRounds.id, testTrials.roundId))
    .where(eq(testRounds.sessionId, sessionId));

  const byTrial = new Map<string, Record<string, number>>();
  for (const metric of metricRows) {
    const bucket = byTrial.get(metric.trialId) ?? {};
    bucket[metric.metricKey] = metric.value;
    byTrial.set(metric.trialId, bucket);
  }

  return rows.map((row) => ({
    testKey: row.testKey as TestKey,
    candidateIndex: row.candidateIndex,
    roundIndex: row.roundIndex,
    blockIndex: row.blockIndex,
    trialIndex: row.trialIndex,
    validity: row.validity,
    isPractice: row.isPractice,
    scopeKey: row.scopeKey,
    variant: row.variant,
    metrics: byTrial.get(row.trialId) ?? {},
  }));
}
