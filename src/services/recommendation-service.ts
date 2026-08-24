import "server-only";
import type { CalibrationResult } from "@/core/calibration";
import {
  AIM_PROFILE_RULES_V1,
  CALIBRATION_MODEL_V2,
  CONFIDENCE_MODEL_V1,
  CURRENT_VERSIONS,
  REFERENCE_DIST_PROVISIONAL_V2,
  SCORING_MODEL_V2,
} from "@/core/params";
import {
  assembleRecommendation,
  type AimProfileExplanation,
  type Recommendation,
  type ResponseCurve,
} from "@/core/recommendation";
import type { ConfidenceComponent } from "@/core/confidence";
import { cmPer360FromCounts, countsPer360FromCm } from "@/core/sensitivity/canonical";
import type {
  CalibrationVerdict,
  DpiSource,
  ScopeKey,
  SessionMode,
  SettingsReliability,
} from "@/core/types/vocabulary";
import { gameAdapterRegistry } from "@/game-adapters";
import { algorithmRepo, calibrationRepo, recommendationRepo, sessionRepo } from "@/repositories";
import type { Actor } from "@/repositories/actor";
import { withTransaction } from "@/repositories/transaction";
import { notFound } from "@/lib/errors";
import { scoredTestsForMode } from "@/test-engine/tests";
import { convertForGame, type GameSettingsView } from "./conversion-service";

/**
 * Producing and reading recommendations (doc 16).
 *
 * ## Generation is a pure function of stored facts
 *
 * Everything that goes into a recommendation — the calibration result, the trials, the
 * hardware snapshot, the environment — is already persisted when this runs. Generating it
 * twice gives the same object (`SENS-BR-030`), and nothing is accepted from the browser.
 *
 * ## No row without its confidence
 *
 * Phase 4 deliberately wrote no `recommendations` row because storing a sensitivity with no
 * indication of how much to trust it would be worse than storing nothing. The confidence model
 * and the aim profile exist now, so the row carries both — and for `insufficient_data` the
 * confidence is 0 with the verdict explaining why, never a fabricated point.
 */

export interface HardwareSnapshot {
  readonly dpi: number;
  readonly dpiSource: DpiSource;
  readonly currentCmPer360: number | null;
  readonly padWidthCm: number | null;
}

export function readHardwareSnapshot(
  snapshot: Readonly<Record<string, unknown>>,
): HardwareSnapshot {
  const dpi = Number(snapshot["dpi"]);
  const source = snapshot["dpiSource"];
  const current = snapshot["currentCmPer360"];
  const pad = snapshot["padWidthCm"];
  return {
    dpi: Number.isFinite(dpi) && dpi > 0 ? dpi : 800,
    dpiSource: source === "estimated" || source === "assumed" ? source : "known",
    currentCmPer360: typeof current === "number" && current > 0 ? current : null,
    padWidthCm: typeof pad === "number" && pad > 0 ? pad : null,
  };
}

/** The per-mode target: the scored roster's standard trial counts × candidates × rounds. */
export function targetTrialsForMode(mode: SessionMode): number {
  if (mode === "fine_tune") {
    // Screening over every candidate plus a duel run to its budget (doc 17 §17.7).
    const { offsets, screeningTrialsPerBlock, duelTrialsPerBlock, duelQuartetBudget } =
      CALIBRATION_MODEL_V2.params.fineTune;
    const perBlock = (table: Readonly<Record<string, number>>) =>
      Object.values(table).reduce((sum, count) => sum + count, 0);
    return (
      offsets.length * perBlock(screeningTrialsPerBlock) +
      duelQuartetBudget * 4 * perBlock(duelTrialsPerBlock)
    );
  }
  const perCandidate = scoredTestsForMode(mode).reduce(
    (sum, definition) => sum + definition.trialCount(mode),
    0,
  );
  const candidates = CALIBRATION_MODEL_V2.params.candidatesPerRound;
  const rounds = CALIBRATION_MODEL_V2.params.roundBudget;
  const pick = <T>(value: { quick: T; standard: T; advanced: T }): T =>
    mode === "advanced" ? value.advanced : mode === "quick" ? value.quick : value.standard;
  return perCandidate * pick(candidates) * pick(rounds);
}

export interface GenerateRecommendationInput {
  readonly sessionId: string;
  readonly calibration: CalibrationResult;
  readonly hardware: HardwareSnapshot;
  readonly mode: SessionMode;
  readonly rawInputEffective: boolean;
  readonly windowResized: boolean;
  readonly pointerLockLosses: number;
  /** Set by a fine-tune: the new row supersedes this one (doc 16 §16.9). */
  readonly parentRecommendationId?: string;
}

export async function generateRecommendation(
  actor: Actor,
  input: GenerateRecommendationInput,
): Promise<{ readonly recommendationId: string; readonly recommendation: Recommendation }> {
  const [trials, quality] = await Promise.all([
    calibrationRepo.loadObservedTrials(input.sessionId),
    sessionRepo.summariseSessionQuality(input.sessionId),
  ]);

  const recommendation = assembleRecommendation({
    calibration: input.calibration,
    trials,
    dpi: input.hardware.dpi,
    dpiSource: input.hardware.dpiSource,
    currentCmPer360: input.hardware.currentCmPer360,
    targetTrials: targetTrialsForMode(input.mode),
    environment: {
      rawInputEffective: input.rawInputEffective,
      cleanFrameFraction: quality.cleanFrameFraction,
      pointerLockLosses: input.pointerLockLosses,
      windowResized: input.windowResized,
    },
    params: {
      scoring: SCORING_MODEL_V2.params,
      reference: REFERENCE_DIST_PROVISIONAL_V2.params,
      confidence: CONFIDENCE_MODEL_V1.params,
      aimProfile: AIM_PROFILE_RULES_V1.params,
    },
    versions: {
      scoring: CURRENT_VERSIONS.scoring,
      calibration: CURRENT_VERSIONS.calibration,
      confidence: CURRENT_VERSIONS.confidence,
      aimProfile: CURRENT_VERSIONS.aim_profile,
    },
  });

  const recommendationId = await withTransaction(async (tx) => {
    const versions = await algorithmRepo.resolveAlgorithmVersionIds(
      {
        scoring: CURRENT_VERSIONS.scoring,
        calibration: CURRENT_VERSIONS.calibration,
        confidence: CURRENT_VERSIONS.confidence,
      },
      tx,
    );
    if (
      versions.scoring === undefined ||
      versions.calibration === undefined ||
      versions.confidence === undefined
    ) {
      throw notFound("algorithm versions");
    }

    const id = await recommendationRepo.saveRecommendation(
      actor,
      {
        sessionId: input.sessionId,
        recommendation,
        versionIds: {
          scoring: versions.scoring,
          calibration: versions.calibration,
          confidence: versions.confidence,
        },
        confidenceBreakdown: recommendation.quality.confidence ?? { index: 0, components: [] },
        parentRecommendationId: input.parentRecommendationId ?? null,
      },
      tx,
    );

    // Verified game settings are cached here. With every adapter unverified nothing is written,
    // and that absence is the honest state (`SENS-BR-014`).
    return id;
  });

  return { recommendationId, recommendation };
}

/* ------------------------------------------------------------------ reading */

export interface RecommendationView {
  readonly id: string;
  readonly sessionId: string;
  readonly verdict: CalibrationVerdict;
  readonly createdAt: string;
  readonly mode: SessionMode;
  readonly canonical: {
    readonly countsPer360: number | null;
    readonly cmPer360: number | null;
    readonly degreesPerCm: number | null;
  };
  readonly ranges: {
    readonly highPerformance: {
      readonly low: number;
      readonly high: number;
      readonly level: number;
    } | null;
    readonly comfort: { readonly low: number; readonly high: number };
    readonly constraint: { readonly maxCm360: number; readonly source: string } | null;
  };
  readonly confidence: {
    readonly index: number;
    readonly components: readonly ConfidenceComponent[];
    readonly verdictCapped: boolean;
    readonly ceiling: number;
  } | null;
  readonly settingsReliability: SettingsReliability;
  readonly profile: {
    readonly key: string | null;
    readonly explanation: AimProfileExplanation | null;
    readonly dimensions: readonly {
      readonly dimension: string;
      readonly score: number;
      readonly shape: number;
      readonly provisional: boolean;
      readonly n: number;
    }[];
  };
  readonly responseCurve: ResponseCurve | null;
  readonly hardware: HardwareSnapshot;
  readonly versions: {
    readonly scoring: string;
    readonly calibration: string;
    readonly confidence: string;
  };
  readonly isGuest: boolean;
  readonly guestExpiresAt: string | null;
  readonly supersededById: string | null;
  readonly primaryGameId: string | null;
}

export async function getRecommendation(
  actor: Actor,
  recommendationId: string,
): Promise<RecommendationView | null> {
  const row = await recommendationRepo.findRecommendation(actor, recommendationId);
  if (row === null) return null;
  const dimensions = await recommendationRepo.listDimensionScores(row.id);
  const breakdown = row.confidenceBreakdown as {
    index?: number;
    components?: ConfidenceComponent[];
    verdictCapped?: boolean;
    ceiling?: number;
  } | null;

  return {
    id: row.id,
    sessionId: row.sessionId,
    verdict: row.verdict,
    createdAt: row.createdAt.toISOString(),
    mode: row.sessionMode as SessionMode,
    canonical: {
      countsPer360: row.recommendedCounts360,
      cmPer360: row.recommendedCm360,
      degreesPerCm: row.recommendedCm360 === null ? null : 360 / row.recommendedCm360,
    },
    ranges: {
      highPerformance:
        row.hpRangeLowCm360 === null || row.hpRangeHighCm360 === null
          ? null
          : { low: row.hpRangeLowCm360, high: row.hpRangeHighCm360, level: row.hpRangeLevel },
      comfort: { low: row.comfortRangeLowCm360, high: row.comfortRangeHighCm360 },
      constraint:
        row.constraintMaxCm360 === null
          ? null
          : { maxCm360: row.constraintMaxCm360, source: row.constraintSource },
    },
    confidence:
      row.verdict === "insufficient_data" ||
      breakdown === null ||
      breakdown.components === undefined
        ? null
        : {
            index: row.confidenceIndex,
            components: breakdown.components,
            verdictCapped: breakdown.verdictCapped ?? false,
            ceiling: breakdown.ceiling ?? CONFIDENCE_MODEL_V1.params.ceiling,
          },
    settingsReliability: row.settingsReliability,
    profile: {
      key: row.aimProfileKey,
      explanation: (row.aimProfileExplanation as AimProfileExplanation | null) ?? null,
      dimensions: dimensions.map((d) => ({
        dimension: d.dimensionKey,
        score: d.score,
        shape: d.shape,
        provisional: d.isProvisional,
        n: d.n,
      })),
    },
    responseCurve: (row.responseCurve as ResponseCurve | null) ?? null,
    hardware: readHardwareSnapshot(row.hardwareSnapshot),
    versions: {
      scoring: CURRENT_VERSIONS.scoring,
      calibration: CURRENT_VERSIONS.calibration,
      confidence: CURRENT_VERSIONS.confidence,
    },
    isGuest: row.guestExpiresAt !== null,
    guestExpiresAt: row.guestExpiresAt?.toISOString() ?? null,
    supersededById: row.supersededById,
    primaryGameId: null,
  };
}

/**
 * Game settings for a recommendation, derived at read time (doc 16 §16.8, FR-078).
 *
 * Changing the output game re-derives; it never re-runs a test and never writes to the
 * session. For `indistinguishable` the canonical target is the centre of the comfort range,
 * and the view says so.
 */
export function settingsForRecommendation(
  view: RecommendationView,
  gameId: string | null,
  scopeKey: ScopeKey = "hipfire",
): GameSettingsView {
  const counts =
    view.canonical.countsPer360 ??
    countsPer360FromCm((view.ranges.comfort.low + view.ranges.comfort.high) / 2, view.hardware.dpi);
  return convertForGame({
    gameId: gameId ?? "",
    scopeKey,
    countsPer360: counts,
    dpi: view.hardware.dpi,
  });
}

/** The games a user can switch the output to: every current adapter. */
export function outputGameOptions(): readonly {
  gameId: string;
  displayName: string;
  status: string;
}[] {
  return gameAdapterRegistry.listCurrent().map((summary) => ({
    gameId: summary.gameId,
    displayName: summary.displayName,
    status: summary.status,
  }));
}

/** The canonical value in the form the settings block and copy controls need. */
export function canonicalTargetCm(view: RecommendationView): number {
  return (
    view.canonical.cmPer360 ??
    cmPer360FromCounts(
      countsPer360FromCm(
        (view.ranges.comfort.low + view.ranges.comfort.high) / 2,
        view.hardware.dpi,
      ),
      view.hardware.dpi,
    )
  );
}
