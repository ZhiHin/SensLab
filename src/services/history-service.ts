import "server-only";
import {
  comparability,
  dimensionChanges,
  recommendationChange,
  type Comparability,
  type ComparabilityDifference,
  type DimensionChange,
  type RecommendationChange,
} from "@/core/comparison";
import { AIM_PROFILE_RULES_V1, CALIBRATION_MODEL_V2, SCORING_MODEL_V2 } from "@/core/params";
import { sensitivityBand } from "@/core/recommendation";
import type { DimensionKey } from "@/core/types/vocabulary";
import { historyRepo } from "@/repositories";
import type { Actor } from "@/repositories/actor";
import { notFound } from "@/lib/errors";

/**
 * History and session comparison (FR-090, FR-093, FR-095, doc 17 §17.9, `SENS-BR-019`).
 *
 * ## What this service refuses to do
 *
 * It will not turn two numbers into a trend. Every comparison starts with a comparability
 * check, and a change is called meaningful only when the two high-performance ranges do not
 * overlap — a stricter rule than a formal test, chosen because a fabricated progress narrative
 * is the most tempting dishonesty available to a product like this one.
 *
 * The rules themselves live in `core/comparison`; this service supplies them with persisted
 * facts and shapes the result for the screen.
 */

const LEVEL = CALIBRATION_MODEL_V2.params.statistics.credibleIntervalLevel;
const PER_SIGMA = SCORING_MODEL_V2.params.displayScaling.perSigma;

export interface HistoryItem {
  readonly sessionId: string;
  readonly recommendationId: string | null;
  readonly startedAt: string;
  readonly mode: string;
  readonly status: string;
  readonly gameId: string | null;
  readonly gameName: string | null;
  readonly dpi: number | null;
  readonly hardwareProfileId: string | null;
  readonly hardwareProfileName: string | null;
  readonly hardwareProfileDeleted: boolean;
  readonly verdict: string | null;
  readonly recommendedCm360: number | null;
  readonly highPerformance: { readonly low: number; readonly high: number } | null;
  readonly confidenceIndex: number | null;
  readonly aimProfileKey: string | null;
  readonly aimProfileName: string | null;
  readonly validationVerdict: string | null;
  readonly superseded: boolean;
  readonly environmentClass: string;
  readonly versions: {
    readonly scoring: string | null;
    readonly calibration: string | null;
    readonly confidence: string | null;
  };
}

/** The display name for a stored profile key, in the band its recommendation fell in. */
function profileName(key: string | null, cm360: number | null): string | null {
  if (key === null) return null;
  const params = AIM_PROFILE_RULES_V1.params;
  const band = cm360 === null ? "mid" : sensitivityBand(cm360, params);
  return params.displayNames[`${key}:${band}`] ?? key;
}

function toItem(entry: historyRepo.HistoryEntry): HistoryItem {
  return {
    sessionId: entry.sessionId,
    recommendationId: entry.recommendationId,
    startedAt: entry.startedAt.toISOString(),
    mode: entry.mode,
    status: entry.status,
    gameId: entry.gameSlug,
    gameName: entry.gameDisplayName,
    dpi: entry.dpi,
    hardwareProfileId: entry.hardwareProfileId,
    hardwareProfileName: entry.hardwareProfileName,
    hardwareProfileDeleted: entry.hardwareProfileDeleted,
    verdict: entry.verdict,
    recommendedCm360: entry.recommendedCm360,
    highPerformance:
      entry.hpRangeLowCm360 === null || entry.hpRangeHighCm360 === null
        ? null
        : { low: entry.hpRangeLowCm360, high: entry.hpRangeHighCm360 },
    confidenceIndex: entry.confidenceIndex,
    aimProfileKey: entry.aimProfileKey,
    aimProfileName: profileName(entry.aimProfileKey, entry.recommendedCm360),
    validationVerdict: entry.validationVerdict,
    superseded: entry.supersededById !== null,
    environmentClass: entry.environmentClass,
    versions: {
      scoring: entry.scoringVersion,
      calibration: entry.calibrationVersion,
      confidence: entry.confidenceVersion,
    },
  };
}

export interface HistoryView {
  readonly items: readonly HistoryItem[];
  /** Distinct hardware profiles across the listed sessions, for the filter control. */
  readonly profiles: readonly { readonly id: string; readonly name: string }[];
  readonly filteredProfileId: string | null;
}

export async function getHistory(
  actor: Actor,
  options: { readonly hardwareProfileId?: string; readonly limit?: number } = {},
): Promise<HistoryView> {
  const entries = await historyRepo.listHistory(actor, {
    ...(options.hardwareProfileId === undefined
      ? {}
      : { hardwareProfileId: options.hardwareProfileId }),
    ...(options.limit === undefined ? {} : { limit: options.limit }),
  });
  const items = entries.map(toItem);

  // The filter lists the profiles the *history* actually used, so a profile with no sessions
  // does not appear as an option that would return nothing.
  const unfiltered =
    options.hardwareProfileId === undefined
      ? entries
      : await historyRepo.listHistory(actor, { limit: 200 });
  const profiles = new Map<string, string>();
  for (const entry of unfiltered) {
    if (entry.hardwareProfileId !== null && entry.hardwareProfileName !== null) {
      profiles.set(entry.hardwareProfileId, entry.hardwareProfileName);
    }
  }

  return {
    items,
    profiles: [...profiles].map(([id, name]) => ({ id, name })),
    filteredProfileId: options.hardwareProfileId ?? null,
  };
}

/* ------------------------------------------------------------------ comparison */

export interface ComparisonSide extends HistoryItem {
  readonly qualityFlags: readonly string[];
  readonly dimensions: readonly {
    readonly dimension: DimensionKey;
    readonly score: number;
    readonly n: number;
    readonly provisional: boolean;
  }[];
}

export interface ComparisonView {
  readonly a: ComparisonSide;
  readonly b: ComparisonSide;
  readonly comparability: Comparability;
  readonly change: RecommendationChange;
  readonly confidence: { readonly from: number | null; readonly to: number | null };
  readonly dimensions: readonly DimensionChange[];
  readonly profileChanged: boolean;
  readonly level: number;
}

/** How each comparability difference reads on the page. */
export const DIFFERENCE_COPY: Readonly<Record<ComparabilityDifference, string>> = Object.freeze({
  hardware_profile: "a different hardware profile",
  dpi: "a different DPI",
  environment_class: "a different environment quality",
  mode: "a different session mode",
  scoring_version: "a different scoring model",
  calibration_version: "a different calibration model",
  confidence_version: "a different confidence model",
});

export async function compareSessions(
  actor: Actor,
  sessionA: string,
  sessionB: string,
): Promise<ComparisonView> {
  if (sessionA === sessionB) throw notFound("comparison");
  const entries = await historyRepo.findHistoryEntries(actor, [sessionA, sessionB]);
  const entryA = entries.find((entry) => entry.sessionId === sessionA);
  const entryB = entries.find((entry) => entry.sessionId === sessionB);
  if (entryA === undefined || entryB === undefined) throw notFound("session");

  const recommendationIds = [entryA.recommendationId, entryB.recommendationId].filter(
    (id): id is string => id !== null,
  );
  const [scores, flags] = await Promise.all([
    historyRepo.listDimensionScoresFor(recommendationIds),
    historyRepo.listQualityFlagsFor([sessionA, sessionB]),
  ]);

  const sideFor = (entry: historyRepo.HistoryEntry): ComparisonSide => ({
    ...toItem(entry),
    qualityFlags: flags
      .filter((flag) => flag.sessionId === entry.sessionId)
      .map((flag) => flag.flag),
    dimensions: scores
      .filter((score) => score.recommendationId === entry.recommendationId)
      .map((score) => ({
        dimension: score.dimensionKey,
        score: score.score,
        n: score.n,
        provisional: score.isProvisional,
      })),
  });

  const a = sideFor(entryA);
  const b = sideFor(entryB);

  const comparabilityInputs = (entry: historyRepo.HistoryEntry) => ({
    hardwareProfileId: entry.hardwareProfileId,
    dpi: entry.dpi ?? 0,
    environmentClass: entry.environmentClass,
    mode: entry.mode,
    scoringVersion: entry.scoringVersion ?? "",
    calibrationVersion: entry.calibrationVersion ?? "",
    confidenceVersion: entry.confidenceVersion ?? "",
  });

  return {
    a,
    b,
    comparability: comparability(comparabilityInputs(entryA), comparabilityInputs(entryB)),
    change: recommendationChange(
      { cm360: a.recommendedCm360, range: a.highPerformance },
      { cm360: b.recommendedCm360, range: b.highPerformance },
    ),
    confidence: { from: a.confidenceIndex, to: b.confidenceIndex },
    dimensions: dimensionChanges(
      a.dimensions.map((d) => ({ ...d, score: d.score })),
      b.dimensions.map((d) => ({ ...d, score: d.score })),
      { perSigma: PER_SIGMA, level: LEVEL },
    ),
    profileChanged:
      a.aimProfileKey !== null && b.aimProfileKey !== null && a.aimProfileKey !== b.aimProfileKey,
    level: LEVEL,
  };
}
