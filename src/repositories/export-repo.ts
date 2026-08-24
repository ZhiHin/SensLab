import { desc, eq, inArray } from "drizzle-orm";
import {
  calibrationCandidates,
  calibrationRounds,
  hardwareProfiles,
  recommendationDimensionScores,
  recommendationGameSettings,
  recommendations,
  researchConsents,
  roundMetrics,
  sessionQualityFlags,
  subjectivePreferences,
  testRounds,
  testSessions,
  testTrials,
  trialMetrics,
  userGameSettings,
  userProfiles,
  users,
  validationMetricDeltas,
  validationRuns,
} from "@/db/schema";
import { requireUser, type Actor } from "./actor";
import { executor, type Executor } from "./transaction";

/**
 * Data export (`SENS-SEC-020`, doc 23 §23.11).
 *
 * Everything the account owns, read through the user's own id: account, profile, hardware
 * profiles, sessions with their environment and quality, rounds, trials, metrics,
 * recommendations with breakdowns and converted settings, validation runs, preferences and
 * consents.
 *
 * The traversal starts from the user's sessions and follows keys downward, so a row that is
 * not reachable from this user is not in the document — the export cannot leak by forgetting
 * a predicate, because there is no unscoped query in it.
 */

export interface ExportDocument {
  readonly exportedAt: string;
  readonly account: unknown;
  readonly profile: unknown;
  readonly hardwareProfiles: readonly unknown[];
  readonly gameSettings: readonly unknown[];
  readonly consents: readonly unknown[];
  readonly sessions: readonly unknown[];
  readonly qualityFlags: readonly unknown[];
  readonly candidates: readonly unknown[];
  readonly calibrationRounds: readonly unknown[];
  readonly testRounds: readonly unknown[];
  readonly roundMetrics: readonly unknown[];
  readonly trials: readonly unknown[];
  readonly trialMetrics: readonly unknown[];
  readonly recommendations: readonly unknown[];
  readonly dimensionScores: readonly unknown[];
  readonly convertedSettings: readonly unknown[];
  readonly validationRuns: readonly unknown[];
  readonly validationMetricDeltas: readonly unknown[];
  readonly preferences: readonly unknown[];
}

export async function exportAccount(
  actor: Actor,
  now: Date,
  tx?: Executor,
): Promise<ExportDocument> {
  const { userId } = requireUser(actor);
  const db = executor(tx);

  const [account] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const [profile] = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);

  const [profiles, gameSettings, consents, sessions] = await Promise.all([
    db.select().from(hardwareProfiles).where(eq(hardwareProfiles.userId, userId)),
    db.select().from(userGameSettings).where(eq(userGameSettings.userId, userId)),
    db.select().from(researchConsents).where(eq(researchConsents.userId, userId)),
    db
      .select()
      .from(testSessions)
      .where(eq(testSessions.userId, userId))
      .orderBy(desc(testSessions.startedAt)),
  ]);

  const sessionIds = sessions.map((session) => session.id);
  const empty = sessionIds.length === 0;

  const [flags, candidates, searchRounds, rounds, recommendationRows, preferences] =
    await Promise.all([
      empty
        ? []
        : db
            .select()
            .from(sessionQualityFlags)
            .where(inArray(sessionQualityFlags.sessionId, sessionIds)),
      empty
        ? []
        : db
            .select()
            .from(calibrationCandidates)
            .where(inArray(calibrationCandidates.sessionId, sessionIds)),
      empty
        ? []
        : db
            .select()
            .from(calibrationRounds)
            .where(inArray(calibrationRounds.sessionId, sessionIds)),
      empty ? [] : db.select().from(testRounds).where(inArray(testRounds.sessionId, sessionIds)),
      empty
        ? []
        : db.select().from(recommendations).where(inArray(recommendations.sessionId, sessionIds)),
      empty
        ? []
        : db
            .select()
            .from(subjectivePreferences)
            .where(inArray(subjectivePreferences.sessionId, sessionIds)),
    ]);

  const roundIds = rounds.map((round) => round.id);
  const recommendationIds = recommendationRows.map((recommendation) => recommendation.id);

  const [metrics, trials, dimensionScores, convertedSettings, runs] = await Promise.all([
    roundIds.length === 0
      ? []
      : db.select().from(roundMetrics).where(inArray(roundMetrics.roundId, roundIds)),
    roundIds.length === 0
      ? []
      : db.select().from(testTrials).where(inArray(testTrials.roundId, roundIds)),
    recommendationIds.length === 0
      ? []
      : db
          .select()
          .from(recommendationDimensionScores)
          .where(inArray(recommendationDimensionScores.recommendationId, recommendationIds)),
    recommendationIds.length === 0
      ? []
      : db
          .select()
          .from(recommendationGameSettings)
          .where(inArray(recommendationGameSettings.recommendationId, recommendationIds)),
    recommendationIds.length === 0
      ? []
      : db
          .select()
          .from(validationRuns)
          .where(inArray(validationRuns.recommendationId, recommendationIds)),
  ]);

  const trialIds = trials.map((trial) => trial.id);
  const runIds = runs.map((run) => run.id);
  const [trialMetricRows, deltaRows] = await Promise.all([
    trialIds.length === 0
      ? []
      : db.select().from(trialMetrics).where(inArray(trialMetrics.trialId, trialIds)),
    runIds.length === 0
      ? []
      : db
          .select()
          .from(validationMetricDeltas)
          .where(inArray(validationMetricDeltas.validationRunId, runIds)),
  ]);

  return {
    exportedAt: now.toISOString(),
    // The password digest is deliberately absent: exporting a credential would be a new way
    // to lose one, and it is not the user's data in any useful sense.
    account:
      account === undefined
        ? null
        : {
            id: account.id,
            email: account.email,
            status: account.status,
            emailVerifiedAt: account.emailVerifiedAt,
            deletionScheduledAt: account.deletionScheduledAt,
            createdAt: account.createdAt,
          },
    profile: profile ?? null,
    hardwareProfiles: profiles,
    gameSettings,
    consents,
    sessions,
    qualityFlags: flags,
    candidates,
    calibrationRounds: searchRounds,
    testRounds: rounds,
    roundMetrics: metrics,
    trials,
    trialMetrics: trialMetricRows,
    recommendations: recommendationRows,
    dimensionScores,
    convertedSettings,
    validationRuns: runs,
    validationMetricDeltas: deltaRows,
    preferences,
  };
}
