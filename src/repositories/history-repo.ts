import { and, desc, eq, inArray, isNull, isNotNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  algorithmVersions,
  gameVersions,
  games,
  hardwareProfiles,
  recommendationDimensionScores,
  recommendations,
  sessionQualityFlags,
  testSessions,
  validationRuns,
} from "@/db/schema";
import type { DimensionKey } from "@/core/types/vocabulary";
import { canOwn, ownershipPredicate, type Actor } from "./actor";
import { executor, type Executor } from "./transaction";

/**
 * History reads (FR-090, FR-093, SCR-041, SCR-042).
 *
 * One query per screen rather than one per row: a history list that fetched its game name, its
 * hardware profile and its validation verdict per session would issue four queries per row and
 * still be a list. Everything the list shows is joined here.
 *
 * Ownership is composed into every query (`ownershipPredicate`), so another user's session is
 * not filtered out of a result set — it is never in one.
 */

export interface HistoryEntry {
  readonly sessionId: string;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly mode: string;
  readonly status: string;
  readonly environmentClass: string;
  readonly hardwareProfileId: string | null;
  readonly hardwareProfileName: string | null;
  readonly hardwareProfileDeleted: boolean;
  readonly dpi: number | null;
  readonly gameSlug: string | null;
  readonly gameDisplayName: string | null;
  readonly recommendationId: string | null;
  readonly verdict: string | null;
  readonly recommendedCm360: number | null;
  readonly hpRangeLowCm360: number | null;
  readonly hpRangeHighCm360: number | null;
  readonly confidenceIndex: number | null;
  readonly aimProfileKey: string | null;
  readonly supersededById: string | null;
  readonly validationVerdict: string | null;
  readonly scoringVersion: string | null;
  readonly calibrationVersion: string | null;
  readonly confidenceVersion: string | null;
}

const scoringVersion = alias(algorithmVersions, "history_scoring_version");
const calibrationVersion = alias(algorithmVersions, "history_calibration_version");
const confidenceVersion = alias(algorithmVersions, "history_confidence_version");

const historySelection = {
  sessionId: testSessions.id,
  startedAt: testSessions.startedAt,
  completedAt: testSessions.completedAt,
  mode: testSessions.mode,
  status: testSessions.status,
  environmentClass: testSessions.environmentClass,
  hardwareSnapshot: testSessions.hardwareSnapshot,
  hardwareProfileId: testSessions.hardwareProfileId,
  hardwareProfileName: hardwareProfiles.name,
  hardwareProfileDeletedAt: hardwareProfiles.deletedAt,
  gameSlug: games.slug,
  gameDisplayName: games.displayName,
  recommendationId: recommendations.id,
  verdict: recommendations.verdict,
  recommendedCm360: recommendations.recommendedCm360,
  hpRangeLowCm360: recommendations.hpRangeLowCm360,
  hpRangeHighCm360: recommendations.hpRangeHighCm360,
  confidenceIndex: recommendations.confidenceIndex,
  aimProfileKey: recommendations.aimProfileKey,
  supersededById: recommendations.supersededById,
  validationVerdict: validationRuns.verdict,
  scoringVersion: scoringVersion.versionLabel,
  calibrationVersion: calibrationVersion.versionLabel,
  confidenceVersion: confidenceVersion.versionLabel,
};

type HistoryRow = { [K in keyof typeof historySelection]: unknown };

function toEntry(row: HistoryRow): HistoryEntry {
  const snapshot = (row.hardwareSnapshot ?? {}) as Record<string, unknown>;
  const dpi = snapshot["dpi"];
  return {
    ...(row as unknown as Omit<HistoryEntry, "dpi" | "hardwareProfileDeleted">),
    // The snapshot, not the profile: a profile edited since the session must not rewrite what
    // the session was run at (`SENS-BR-035`).
    dpi: typeof dpi === "number" ? dpi : null,
    hardwareProfileDeleted: row.hardwareProfileDeletedAt !== null,
  };
}

/** The joins every history read shares. */
function historyQuery(db: Executor) {
  return db
    .select(historySelection)
    .from(testSessions)
    .leftJoin(hardwareProfiles, eq(hardwareProfiles.id, testSessions.hardwareProfileId))
    .leftJoin(gameVersions, eq(gameVersions.id, testSessions.primaryGameVersionId))
    .leftJoin(games, eq(games.id, gameVersions.gameId))
    .leftJoin(recommendations, eq(recommendations.sessionId, testSessions.id))
    .leftJoin(validationRuns, eq(validationRuns.recommendationId, recommendations.id))
    .leftJoin(scoringVersion, eq(scoringVersion.id, testSessions.scoringVersionId))
    .leftJoin(calibrationVersion, eq(calibrationVersion.id, testSessions.calibrationVersionId))
    .leftJoin(confidenceVersion, eq(confidenceVersion.id, testSessions.confidenceVersionId));
}

export interface ListHistoryOptions {
  readonly limit?: number;
  /** Restrict to one hardware profile. */
  readonly hardwareProfileId?: string;
}

/**
 * What history lists: a session that produced a recommendation of its own, or a calibration
 * that did not.
 *
 * A validation session, and a fine-tune whose candidates held up, produce no recommendation —
 * they are steps in another session's story, reachable from the result they belong to, and a
 * row for one would read as a calibration that failed. A fine-tune that *did* supersede has a
 * recommendation and appears, which is what makes history the honest sequence doc 16 §16.9
 * describes rather than a filtered version of it.
 */
const listedInHistory = or(isNotNull(recommendations.id), isNull(testSessions.parentSessionId));

export async function listHistory(
  actor: Actor,
  options: ListHistoryOptions = {},
  tx?: Executor,
): Promise<readonly HistoryEntry[]> {
  if (!canOwn(actor)) return [];
  const db = executor(tx);

  const rows = await historyQuery(db)
    .where(
      and(
        ownershipPredicate(actor, {
          userId: testSessions.userId,
          guestSessionId: testSessions.guestSessionId,
        }),
        options.hardwareProfileId === undefined
          ? undefined
          : eq(testSessions.hardwareProfileId, options.hardwareProfileId),
        listedInHistory,
      ),
    )
    .orderBy(desc(testSessions.startedAt))
    .limit(options.limit ?? 50);

  return rows.map(toEntry);
}

/** The two sides of a comparison, in one round trip, both ownership-checked. */
export async function findHistoryEntries(
  actor: Actor,
  sessionIds: readonly string[],
  tx?: Executor,
): Promise<readonly HistoryEntry[]> {
  if (!canOwn(actor) || sessionIds.length === 0) return [];
  const db = executor(tx);
  const rows = await historyQuery(db).where(
    and(
      inArray(testSessions.id, [...sessionIds]),
      ownershipPredicate(actor, {
        userId: testSessions.userId,
        guestSessionId: testSessions.guestSessionId,
      }),
    ),
  );
  return rows.map(toEntry);
}

export interface DimensionScoreEntry {
  readonly recommendationId: string;
  readonly dimensionKey: DimensionKey;
  readonly score: number;
  readonly shape: number;
  readonly isProvisional: boolean;
  readonly n: number;
}

export async function listDimensionScoresFor(
  recommendationIds: readonly string[],
  tx?: Executor,
): Promise<readonly DimensionScoreEntry[]> {
  if (recommendationIds.length === 0) return [];
  const db = executor(tx);
  return db
    .select({
      recommendationId: recommendationDimensionScores.recommendationId,
      dimensionKey: recommendationDimensionScores.dimensionKey,
      score: recommendationDimensionScores.score,
      shape: recommendationDimensionScores.shape,
      isProvisional: recommendationDimensionScores.isProvisional,
      n: recommendationDimensionScores.n,
    })
    .from(recommendationDimensionScores)
    .where(inArray(recommendationDimensionScores.recommendationId, [...recommendationIds]));
}

export async function listQualityFlagsFor(
  sessionIds: readonly string[],
  tx?: Executor,
): Promise<readonly { readonly sessionId: string; readonly flag: string }[]> {
  if (sessionIds.length === 0) return [];
  const db = executor(tx);
  return db
    .select({ sessionId: sessionQualityFlags.sessionId, flag: sessionQualityFlags.flag })
    .from(sessionQualityFlags)
    .where(inArray(sessionQualityFlags.sessionId, [...sessionIds]));
}
