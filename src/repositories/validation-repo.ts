import { and, asc, eq } from "drizzle-orm";
import type { MetricDelta, ValidationVerdict } from "@/core/validation";
import {
  calibrationCandidates,
  recommendations,
  subjectivePreferences,
  testSessions,
  validationMetricDeltas,
  validationRuns,
} from "@/db/schema";
import { newId } from "@/lib/crypto";
import { notFound } from "@/lib/errors";
import { canOwn, ownershipPredicate, type Actor } from "./actor";
import { executor, type Executor } from "./transaction";

/**
 * Persistence for validation runs and subjective preferences (doc 20 §20.8, doc 17).
 *
 * ## The verdict is checked by the database, not only by the code
 *
 * `validation_runs` carries a CHECK that the verdict agrees with the composite interval —
 * `improved` needs `ci_low > 0`, `worse` needs `ci_high < 0` — and `validation_metric_deltas`
 * derives `is_significant` from the interval the same way. A code path that computed a
 * verdict its interval does not support cannot persist it (`SENS-BR-016`).
 *
 * ## Preference is recorded, never read by a computation
 *
 * `subjective_preferences` is written after the reveal and read only to be shown back. No
 * function in `core/` or `services/` consumes it for any number (`SENS-BR-002`, doc 17 §17.8).
 */

export interface SaveValidationRunInput {
  readonly recommendationId: string;
  readonly sessionId: string;
  readonly baselineCounts360: number;
  readonly candidateCounts360: number;
  readonly verdict: ValidationVerdict;
  readonly composite: { readonly delta: number; readonly ciLow: number; readonly ciHigh: number };
  readonly blockCount: number;
  readonly confidenceBefore: number;
  readonly confidenceAfter: number;
  readonly metrics: readonly MetricDelta[];
}

export interface ValidationRunRow {
  readonly id: string;
  readonly recommendationId: string;
  readonly sessionId: string;
  readonly baselineCounts360: number;
  readonly candidateCounts360: number;
  readonly verdict: ValidationVerdict;
  readonly compositeDelta: number;
  readonly compositeCiLow: number;
  readonly compositeCiHigh: number;
  readonly blockCount: number;
  readonly confidenceBefore: number;
  readonly confidenceAfter: number;
  readonly createdAt: Date;
}

export interface ValidationMetricDeltaRow {
  readonly metricKey: string;
  readonly delta: number;
  readonly deltaPct: number | null;
  readonly ciLow: number;
  readonly ciHigh: number;
  readonly isSignificant: boolean;
}

export async function saveValidationRun(
  actor: Actor,
  input: SaveValidationRunInput,
  tx?: Executor,
): Promise<string> {
  if (!canOwn(actor)) throw notFound("session owner");
  const db = executor(tx);
  const id = newId();

  await db.insert(validationRuns).values({
    id,
    recommendationId: input.recommendationId,
    sessionId: input.sessionId,
    baselineCounts360: input.baselineCounts360,
    candidateCounts360: input.candidateCounts360,
    verdict: input.verdict,
    compositeDelta: input.composite.delta,
    compositeCiLow: input.composite.ciLow,
    compositeCiHigh: input.composite.ciHigh,
    blockCount: input.blockCount,
    confidenceBefore: input.confidenceBefore,
    confidenceAfter: input.confidenceAfter,
  });

  // Every reported metric — consistency included — is a registered metric key (doc 10 §10.6),
  // so the foreign key holds and the significance CHECK re-derives the flag from the interval.
  if (input.metrics.length > 0) {
    await db.insert(validationMetricDeltas).values(
      input.metrics.map((metric) => ({
        validationRunId: id,
        metricKey: metric.key,
        delta: metric.delta,
        deltaPct: metric.deltaPct,
        ciLow: metric.ciLow,
        ciHigh: metric.ciHigh,
        isSignificant: metric.ciLow > 0 || metric.ciHigh < 0,
      })),
    );
  }

  return id;
}

export async function findValidationRunForRecommendation(
  actor: Actor,
  recommendationId: string,
  tx?: Executor,
): Promise<ValidationRunRow | null> {
  if (!canOwn(actor)) return null;
  const db = executor(tx);
  const rows = await db
    .select({
      id: validationRuns.id,
      recommendationId: validationRuns.recommendationId,
      sessionId: validationRuns.sessionId,
      baselineCounts360: validationRuns.baselineCounts360,
      candidateCounts360: validationRuns.candidateCounts360,
      verdict: validationRuns.verdict,
      compositeDelta: validationRuns.compositeDelta,
      compositeCiLow: validationRuns.compositeCiLow,
      compositeCiHigh: validationRuns.compositeCiHigh,
      blockCount: validationRuns.blockCount,
      confidenceBefore: validationRuns.confidenceBefore,
      confidenceAfter: validationRuns.confidenceAfter,
      createdAt: validationRuns.createdAt,
    })
    .from(validationRuns)
    .innerJoin(recommendations, eq(recommendations.id, validationRuns.recommendationId))
    .innerJoin(testSessions, eq(testSessions.id, recommendations.sessionId))
    .where(
      and(
        eq(validationRuns.recommendationId, recommendationId),
        ownershipPredicate(actor, {
          userId: testSessions.userId,
          guestSessionId: testSessions.guestSessionId,
        }),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listValidationMetricDeltas(
  validationRunId: string,
  tx?: Executor,
): Promise<readonly ValidationMetricDeltaRow[]> {
  const db = executor(tx);
  return db
    .select({
      metricKey: validationMetricDeltas.metricKey,
      delta: validationMetricDeltas.delta,
      deltaPct: validationMetricDeltas.deltaPct,
      ciLow: validationMetricDeltas.ciLow,
      ciHigh: validationMetricDeltas.ciHigh,
      isSignificant: validationMetricDeltas.isSignificant,
    })
    .from(validationMetricDeltas)
    .where(eq(validationMetricDeltas.validationRunId, validationRunId))
    .orderBy(asc(validationMetricDeltas.metricKey));
}

/* ------------------------------------------------------------------ preference */

export async function savePreference(
  actor: Actor,
  sessionId: string,
  chosenCandidateId: string,
  tx?: Executor,
): Promise<void> {
  if (!canOwn(actor)) throw notFound("session owner");
  const db = executor(tx);

  // The candidate must belong to the session: a preference for a candidate from another
  // session would be meaningless, and the foreign key alone would not say so.
  const owned = await db
    .select({ id: calibrationCandidates.id })
    .from(calibrationCandidates)
    .innerJoin(testSessions, eq(testSessions.id, calibrationCandidates.sessionId))
    .where(
      and(
        eq(calibrationCandidates.id, chosenCandidateId),
        eq(calibrationCandidates.sessionId, sessionId),
        ownershipPredicate(actor, {
          userId: testSessions.userId,
          guestSessionId: testSessions.guestSessionId,
        }),
      ),
    )
    .limit(1);
  if (owned.length === 0) throw notFound("candidate");

  await db
    .insert(subjectivePreferences)
    .values({ sessionId, chosenCandidateId })
    .onConflictDoUpdate({
      target: subjectivePreferences.sessionId,
      set: { chosenCandidateId },
    });
}

export async function findPreference(
  sessionId: string,
  tx?: Executor,
): Promise<{ readonly chosenCandidateId: string } | null> {
  const db = executor(tx);
  const rows = await db
    .select({ chosenCandidateId: subjectivePreferences.chosenCandidateId })
    .from(subjectivePreferences)
    .where(eq(subjectivePreferences.sessionId, sessionId))
    .limit(1);
  return rows[0] ?? null;
}
