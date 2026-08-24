import { and, desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Recommendation } from "@/core/recommendation";
import type { DimensionKey, ScopeKey } from "@/core/types/vocabulary";
import type { ConversionSuccess } from "@/game-adapters";
import {
  algorithmVersions,
  guestSessions,
  recommendationDimensionScores,
  recommendationGameSettings,
  recommendations,
  testSessions,
} from "@/db/schema";
import { newId } from "@/lib/crypto";
import { notFound } from "@/lib/errors";
import type { Actor } from "./actor";
import { canOwn, ownershipPredicate } from "./actor";
import { executor, type Executor } from "./transaction";

/**
 * Persistence for recommendations (doc 16, doc 20 §20.9).
 *
 * ## What is stored and what is not
 *
 * The canonical block, both ranges, the confidence index with its breakdown, the aim profile
 * with the structured explanation that produced it, and the response curve — everything needed
 * to show a reader *why*, a year later, without re-running a single trial (`SENS-BR-030`).
 *
 * Game settings are a **cache**, derived from the canonical block by an adapter, and **no row
 * is ever written for an unverified model** (`SENS-BR-014`). The absence of a row *is* the
 * unverified state: there is no stale number to leak into an export or a share card.
 *
 * ## Ownership
 *
 * A recommendation belongs to whoever owns its session, which is the only way to reach it.
 * Every read joins through `test_sessions` and composes the ownership predicate; there is no
 * lookup by id alone.
 */

export interface RecommendationRow {
  readonly id: string;
  readonly sessionId: string;
  readonly verdict: Recommendation["verdict"];
  readonly recommendedCounts360: number | null;
  readonly recommendedCm360: number | null;
  readonly hpRangeLowCm360: number | null;
  readonly hpRangeHighCm360: number | null;
  readonly hpRangeLevel: number;
  readonly comfortRangeLowCm360: number;
  readonly comfortRangeHighCm360: number;
  readonly constraintMaxCm360: number | null;
  readonly constraintSource: string;
  readonly confidenceIndex: number;
  readonly confidenceBreakdown: unknown;
  readonly settingsReliability: Recommendation["quality"]["settingsReliability"];
  readonly aimProfileKey: string | null;
  readonly aimProfileExplanation: unknown;
  readonly responseCurve: unknown;
  readonly acceptedCounts360: number | null;
  readonly parentRecommendationId: string | null;
  readonly supersededById: string | null;
  readonly createdAt: Date;
  /** The parameter-set labels the row was generated under (`SENS-BR-020`). */
  readonly scoringVersion: string;
  readonly calibrationVersion: string;
  readonly confidenceVersion: string;
  /** Owner context the page needs: a guest result expires (doc 04 §4.4.12). */
  readonly guestExpiresAt: Date | null;
  readonly sessionMode: string;
  readonly hardwareSnapshot: Readonly<Record<string, unknown>>;
  readonly environment: Readonly<Record<string, unknown>>;
  readonly primaryGameVersionId: string | null;
}

export interface DimensionScoreRow {
  readonly dimensionKey: DimensionKey;
  readonly score: number;
  readonly shape: number;
  readonly isProvisional: boolean;
  readonly n: number;
}

export interface SaveRecommendationInput {
  readonly sessionId: string;
  readonly recommendation: Recommendation;
  readonly versionIds: {
    readonly scoring: string;
    readonly calibration: string;
    readonly confidence: string;
  };
  /** The confidence breakdown and profile explanation as stored, serialisable. */
  readonly confidenceBreakdown: unknown;
  readonly parentRecommendationId?: string | null;
}

/** Writes one recommendation and its dimension scores. One per session. */
export async function saveRecommendation(
  actor: Actor,
  input: SaveRecommendationInput,
  tx?: Executor,
): Promise<string> {
  if (!canOwn(actor)) throw notFound("session owner");
  const db = executor(tx);
  const { recommendation } = input;

  const id = newId();
  await db.insert(recommendations).values({
    id,
    sessionId: input.sessionId,
    verdict: recommendation.verdict,
    recommendedCounts360: recommendation.canonical.recommendedCountsPer360,
    recommendedCm360: recommendation.canonical.recommendedCmPer360,
    hpRangeLowCm360: recommendation.ranges.highPerformance?.lowCm360 ?? null,
    hpRangeHighCm360: recommendation.ranges.highPerformance?.highCm360 ?? null,
    hpRangeLevel: recommendation.ranges.highPerformance?.level ?? 0.9,
    comfortRangeLowCm360: recommendation.ranges.comfort.lowCm360,
    comfortRangeHighCm360: recommendation.ranges.comfort.highCm360,
    constraintMaxCm360: recommendation.ranges.constraint?.maxCm360 ?? null,
    constraintSource: (recommendation.ranges.constraint?.source ?? "none") as "none",
    confidenceIndex: recommendation.quality.confidence?.index ?? 0,
    confidenceBreakdown: input.confidenceBreakdown,
    settingsReliability: recommendation.quality.settingsReliability,
    aimProfileKey: recommendation.profile.classification.key,
    aimProfileExplanation: recommendation.profile.explanation,
    responseCurve: recommendation.evidence.responseCurve,
    // Null until the player decides. The column records what they were *told to use after
    // validation* (doc 20 §20.8); writing the recommendation into it at creation would make
    // an untested estimate indistinguishable from an accepted one.
    acceptedCounts360: null,
    scoringVersionId: input.versionIds.scoring,
    calibrationVersionId: input.versionIds.calibration,
    confidenceVersionId: input.versionIds.confidence,
    parentRecommendationId: input.parentRecommendationId ?? null,
    supersededById: null,
  });

  const dimensions = recommendation.profile.dimensions;
  if (dimensions.length > 0) {
    await db.insert(recommendationDimensionScores).values(
      dimensions.map((dimension) => ({
        recommendationId: id,
        dimensionKey: dimension.dimension,
        score: dimension.score,
        shape: dimension.shape,
        isProvisional: dimension.provisional,
        n: dimension.sampleCount,
      })),
    );
  }

  if (input.parentRecommendationId) {
    await db
      .update(recommendations)
      .set({ supersededById: id })
      .where(eq(recommendations.id, input.parentRecommendationId));
  }

  return id;
}

/** Caches one verified conversion. Never called for an unverified scope — the caller gates. */
export async function saveGameSetting(
  recommendationId: string,
  gameVersionId: string,
  scopeKey: ScopeKey,
  dpi: number,
  conversion: ConversionSuccess,
  tx?: Executor,
): Promise<void> {
  const db = executor(tx);
  for (const setting of conversion.settings) {
    await db
      .insert(recommendationGameSettings)
      .values({
        id: newId(),
        recommendationId,
        gameVersionId,
        scopeKey,
        dpi,
        settingKey: setting.key,
        settingValue: String(setting.value),
        idealSettingValue: String(setting.idealValue),
        achievedCounts360: conversion.achievedCountsPer360,
        quantisationErrorPct: conversion.quantisationErrorPct,
        wasClamped: setting.clamped,
        conversionMethod: conversion.conversionMethod,
        conversionCoefficient: conversion.conversionCoefficient,
        adapterVersion: conversion.adapterVersion,
      })
      .onConflictDoNothing();
  }
}

const scoringVersion = alias(algorithmVersions, "scoring_version");
const calibrationVersion = alias(algorithmVersions, "calibration_version");
const confidenceVersion = alias(algorithmVersions, "confidence_version");

const ownedSelection = {
  id: recommendations.id,
  sessionId: recommendations.sessionId,
  verdict: recommendations.verdict,
  recommendedCounts360: recommendations.recommendedCounts360,
  recommendedCm360: recommendations.recommendedCm360,
  hpRangeLowCm360: recommendations.hpRangeLowCm360,
  hpRangeHighCm360: recommendations.hpRangeHighCm360,
  hpRangeLevel: recommendations.hpRangeLevel,
  comfortRangeLowCm360: recommendations.comfortRangeLowCm360,
  comfortRangeHighCm360: recommendations.comfortRangeHighCm360,
  constraintMaxCm360: recommendations.constraintMaxCm360,
  constraintSource: recommendations.constraintSource,
  confidenceIndex: recommendations.confidenceIndex,
  confidenceBreakdown: recommendations.confidenceBreakdown,
  settingsReliability: recommendations.settingsReliability,
  aimProfileKey: recommendations.aimProfileKey,
  aimProfileExplanation: recommendations.aimProfileExplanation,
  responseCurve: recommendations.responseCurve,
  acceptedCounts360: recommendations.acceptedCounts360,
  parentRecommendationId: recommendations.parentRecommendationId,
  supersededById: recommendations.supersededById,
  createdAt: recommendations.createdAt,
  scoringVersion: scoringVersion.versionLabel,
  calibrationVersion: calibrationVersion.versionLabel,
  confidenceVersion: confidenceVersion.versionLabel,
  guestExpiresAt: guestSessions.expiresAt,
  sessionMode: testSessions.mode,
  hardwareSnapshot: testSessions.hardwareSnapshot,
  environment: testSessions.environment,
  primaryGameVersionId: testSessions.primaryGameVersionId,
};

function toRow(row: {
  [K in keyof typeof ownedSelection]: unknown;
}): RecommendationRow {
  return {
    ...(row as unknown as RecommendationRow),
    hardwareSnapshot: (row.hardwareSnapshot ?? {}) as Readonly<Record<string, unknown>>,
    environment: (row.environment ?? {}) as Readonly<Record<string, unknown>>,
    guestExpiresAt: (row.guestExpiresAt as Date | null) ?? null,
  };
}

/** The recommendation, if the actor owns its session. */
export async function findRecommendation(
  actor: Actor,
  recommendationId: string,
  tx?: Executor,
): Promise<RecommendationRow | null> {
  if (!canOwn(actor)) return null;
  const db = executor(tx);
  const rows = await db
    .select(ownedSelection)
    .from(recommendations)
    .innerJoin(testSessions, eq(testSessions.id, recommendations.sessionId))
    .innerJoin(scoringVersion, eq(scoringVersion.id, recommendations.scoringVersionId))
    .innerJoin(calibrationVersion, eq(calibrationVersion.id, recommendations.calibrationVersionId))
    .innerJoin(confidenceVersion, eq(confidenceVersion.id, recommendations.confidenceVersionId))
    .leftJoin(guestSessions, eq(guestSessions.id, testSessions.guestSessionId))
    .where(
      and(
        eq(recommendations.id, recommendationId),
        ownershipPredicate(actor, {
          userId: testSessions.userId,
          guestSessionId: testSessions.guestSessionId,
        }),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toRow(row);
}

export async function findRecommendationForSession(
  actor: Actor,
  sessionId: string,
  tx?: Executor,
): Promise<RecommendationRow | null> {
  if (!canOwn(actor)) return null;
  const db = executor(tx);
  const rows = await db
    .select(ownedSelection)
    .from(recommendations)
    .innerJoin(testSessions, eq(testSessions.id, recommendations.sessionId))
    .innerJoin(scoringVersion, eq(scoringVersion.id, recommendations.scoringVersionId))
    .innerJoin(calibrationVersion, eq(calibrationVersion.id, recommendations.calibrationVersionId))
    .innerJoin(confidenceVersion, eq(confidenceVersion.id, recommendations.confidenceVersionId))
    .leftJoin(guestSessions, eq(guestSessions.id, testSessions.guestSessionId))
    .where(
      and(
        eq(recommendations.sessionId, sessionId),
        ownershipPredicate(actor, {
          userId: testSessions.userId,
          guestSessionId: testSessions.guestSessionId,
        }),
      ),
    )
    .orderBy(desc(recommendations.createdAt))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toRow(row);
}

export async function listDimensionScores(
  recommendationId: string,
  tx?: Executor,
): Promise<readonly DimensionScoreRow[]> {
  const db = executor(tx);
  return db
    .select({
      dimensionKey: recommendationDimensionScores.dimensionKey,
      score: recommendationDimensionScores.score,
      shape: recommendationDimensionScores.shape,
      isProvisional: recommendationDimensionScores.isProvisional,
      n: recommendationDimensionScores.n,
    })
    .from(recommendationDimensionScores)
    .where(eq(recommendationDimensionScores.recommendationId, recommendationId));
}

/* ------------------------------------------------------------------ after validation */

export interface RecommendationUpdate {
  /** The index after the validation multiplier (doc 15 §15.8). */
  readonly confidenceIndex?: number;
  /** What the player is told to use — the original after a loss, the recommendation on accept. */
  readonly acceptedCounts360?: number | null;
}

/**
 * Applies a validation outcome to the recommendation row. Nothing else on the row is ever
 * updated: the canonical value, ranges, curve and profile are immutable once written, and
 * a refinement is a new row (doc 16 §16.9).
 */
export async function updateRecommendation(
  actor: Actor,
  recommendationId: string,
  update: RecommendationUpdate,
  tx?: Executor,
): Promise<void> {
  const owned = await findRecommendation(actor, recommendationId, tx);
  if (owned === null) throw notFound("recommendation");
  const db = executor(tx);
  await db
    .update(recommendations)
    .set({
      ...(update.confidenceIndex === undefined ? {} : { confidenceIndex: update.confidenceIndex }),
      ...(update.acceptedCounts360 === undefined
        ? {}
        : { acceptedCounts360: update.acceptedCounts360 }),
    })
    .where(eq(recommendations.id, recommendationId));
}
