import "server-only";
import { toLogSensitivity } from "@/core/calibration";
import { applyValidationMultiplier } from "@/core/confidence";
import { getMetricDefinition } from "@/core/metrics/registry";
import {
  CALIBRATION_MODEL_V2,
  CONFIDENCE_MODEL_V1,
  CURRENT_VERSIONS,
  SCORING_MODEL_V2,
} from "@/core/params";
import { deriveRng } from "@/core/random";
import type { ResponseCurve } from "@/core/recommendation";
import { cmPer360FromCounts, countsPer360FromCm } from "@/core/sensitivity/canonical";
import { countsPer360 } from "@/core/types/brand";
import type { SessionMode, SessionQualityFlag } from "@/core/types/vocabulary";
import {
  REPORTED_METRICS,
  VALIDATION_ARMS,
  analyseValidation,
  familiarityAdvisoryApplies,
  validationOffer,
  validationSequence,
  type MetricDelta,
  type ValidationAnalysis,
  type ValidationOffer,
  type ValidationVerdict,
} from "@/core/validation";
import {
  algorithmRepo,
  calibrationRepo,
  recommendationRepo,
  sessionRepo,
  validationRepo,
} from "@/repositories";
import type { Actor } from "@/repositories/actor";
import { withTransaction } from "@/repositories/transaction";
import { ValidationError, notFound } from "@/lib/errors";
import { newSeed } from "@/lib/crypto";
import type { RoundAggregate, SessionPlan } from "@/test-engine/contracts";
import { createPairedBlocksPlan } from "@/test-engine/plan";
import { getTestDefinition } from "@/test-engine/tests";
import { readHardwareSnapshot, type HardwareSnapshot } from "./recommendation-service";

/**
 * The validation test (doc 17 §17.1–§17.6, FR-086–088, `SENS-BR-016`).
 *
 * ```
 *   offer? ──► start (two blinded arms, ABBA sequence) ──► client runs the blocks
 *          ──► submit ──► paired analysis ──► verdict ──► confidence × multiplier
 *                                                      └─► worse: the original stands
 *          ──► the player accepts B, keeps A, or fine-tunes
 * ```
 *
 * ## What the server owns
 *
 * Which arm is which, the block sequence, the analysis and the verdict. The client receives a
 * plan with two blind labels drawn from an alphabet the calibration never used, runs it, and
 * uploads what it measured. Nothing about the verdict is derived from anything the client
 * could author (`SENS-BR-034`).
 *
 * ## When the recommendation loses
 *
 * The case a dishonest product would hide is handled first-class: the verdict is stated, the
 * numbers are shown in the same format as a win, the original is retained as the standing
 * value (`accepted_counts_360` ← A), and confidence is reduced by the documented factor. The
 * estimate itself is not deleted or edited — it remains the calibration's finding.
 */

const PARAMS = CALIBRATION_MODEL_V2.params;
const PROTOCOL = PARAMS.validation;

/** Blind labels for the two arms — deliberately disjoint from the calibration's A–F. */
export const VALIDATION_BLIND_LABELS: readonly string[] = Object.freeze([
  "K",
  "M",
  "P",
  "R",
  "T",
  "V",
]);

export interface StartValidationInput {
  readonly recommendationId: string;
  readonly aspectRatio: number;
  readonly environment: Readonly<Record<string, unknown>>;
  /** Test fixtures only; the browser path never passes one. */
  readonly seed?: bigint;
}

export interface ValidationStep {
  readonly sessionId: string;
  readonly recommendationId: string;
  readonly blocks: number;
  readonly framing: "vs_current" | "vs_starting_point";
  readonly plan: SessionPlan;
}

function maxImpliedCountsPerSecond(dpi: number): number {
  return Math.round((dpi * 1000) / 2.54);
}

function blocksForMode(mode: SessionMode): number {
  return mode === "advanced"
    ? PROTOCOL.blocks.advanced
    : mode === "quick"
      ? PROTOCOL.blocks.quick
      : PROTOCOL.blocks.standard;
}

/** The round-1 bracket centre of the calibration, in cm/360 — arm A for a cold start. */
async function startingPointCm(sessionId: string, dpi: number): Promise<number | null> {
  const rounds = await calibrationRepo.listRoundResults(sessionId);
  const first = rounds.find((round) => round.roundIndex === 0);
  if (first === undefined) return null;
  const centreX = (first.bracketLow + first.bracketHigh) / 2;
  return cmPer360FromCounts(2 ** centreX, dpi);
}

/* ------------------------------------------------------------------ offer */

export async function validationOfferFor(
  actor: Actor,
  recommendationId: string,
): Promise<ValidationOffer | null> {
  const row = await recommendationRepo.findRecommendation(actor, recommendationId);
  if (row === null) return null;
  const hardware = readHardwareSnapshot(row.hardwareSnapshot);
  const existing = await validationRepo.findValidationRunForRecommendation(actor, row.id);

  return validationOffer({
    verdict: row.verdict,
    recommendedCm360: row.recommendedCm360,
    currentCm360: hardware.currentCmPer360,
    startingPointCm360: await startingPointCm(row.sessionId, hardware.dpi),
    highPerformance:
      row.hpRangeLowCm360 === null || row.hpRangeHighCm360 === null
        ? null
        : { low: row.hpRangeLowCm360, high: row.hpRangeHighCm360 },
    curve: (row.responseCurve as ResponseCurve | null) ?? null,
    alreadyValidated: existing !== null,
  });
}

/* ------------------------------------------------------------------ start */

export async function startValidation(
  actor: Actor,
  input: StartValidationInput,
): Promise<ValidationStep> {
  if (!Number.isFinite(input.aspectRatio) || input.aspectRatio <= 0) {
    throw new ValidationError([{ path: "aspectRatio", message: "must be positive" }]);
  }
  const row = await recommendationRepo.findRecommendation(actor, input.recommendationId);
  if (row === null) throw notFound("recommendation");
  const offer = await validationOfferFor(actor, row.id);
  if (offer === null || !offer.offered || offer.baselineCm360 === null) {
    throw new ValidationError([
      { path: "recommendationId", message: `validation is not offered (${offer?.reason})` },
    ]);
  }

  const parent = await sessionRepo.getTestSession(actor, row.sessionId);
  if (parent === null) throw notFound("session");
  const hardware = readHardwareSnapshot(row.hardwareSnapshot);
  const baselineCounts = countsPer360FromCm(offer.baselineCm360, hardware.dpi);
  const candidateCounts = row.recommendedCounts360;
  if (candidateCounts === null) throw notFound("recommended value");

  const { sessionId, seed } = await withTransaction(async (tx) => {
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
    const seed = input.seed ?? newSeed();
    const session = await sessionRepo.createTestSession(
      actor,
      {
        hardwareProfileId: parent.hardwareProfileId,
        hardwareSnapshot: { ...hardware },
        primaryGameVersionId: parent.primaryGameVersionId,
        mode: "validation",
        environment: input.environment,
        environmentClass: "pass",
        seed,
        parentSessionId: parent.id,
        scoringVersionId: versions.scoring,
        calibrationVersionId: versions.calibration,
        confidenceVersionId: versions.confidence,
      },
      tx,
    );
    await sessionRepo.updateSessionStatus(actor, session.id, "in_progress", tx);

    // Two candidates, labelled from a fresh alphabet in a seeded shuffle. Their identity lives
    // only here and in the analysis that reads them back (`SENS-BR-007`).
    const labels = deriveRng(seed, "validation-labels").shuffle(VALIDATION_BLIND_LABELS);
    await calibrationRepo.saveCandidates(
      actor,
      session.id,
      [
        {
          roundIndex: 0,
          candidateIndex: VALIDATION_ARMS.baseline,
          x: toLogSensitivity(Number(baselineCounts)),
          countsPer360: countsPer360(Number(baselineCounts)),
          blindLabel: labels[0] ?? "K",
          source: "validation_original",
        },
        {
          roundIndex: 0,
          candidateIndex: VALIDATION_ARMS.candidate,
          x: toLogSensitivity(candidateCounts),
          countsPer360: countsPer360(candidateCounts),
          blindLabel: labels[1] ?? "M",
          source: "validation_recommended",
        },
      ],
      hardware.dpi,
      tx,
    );
    return { sessionId: session.id, seed };
  });

  return {
    sessionId,
    recommendationId: row.id,
    blocks: blocksForMode(parent.mode),
    framing: offer.reason === "offered_vs_starting_point" ? "vs_starting_point" : "vs_current",
    plan: await planFor(sessionId, seed, parent.mode, hardware, input.aspectRatio),
  };
}

async function planFor(
  sessionId: string,
  seed: bigint,
  parentMode: SessionMode,
  hardware: HardwareSnapshot,
  aspectRatio: number,
): Promise<SessionPlan> {
  const candidates = await calibrationRepo.listCandidates(sessionId);
  const baseline = candidates.find((c) => c.candidateIndex === VALIDATION_ARMS.baseline);
  const candidate = candidates.find((c) => c.candidateIndex === VALIDATION_ARMS.candidate);
  if (baseline === undefined || candidate === undefined) throw notFound("validation arms");

  const blocks = blocksForMode(parentMode);
  const sequence = validationSequence(blocks, deriveRng(seed, "validation-sequence"));
  const tests = PROTOCOL.tests
    .map((key) => getTestDefinition(key))
    .filter((definition) => definition !== undefined);

  return createPairedBlocksPlan({
    sessionId,
    seed: seed.toString(),
    mode: "validation",
    arms: {
      A: {
        candidateIndex: baseline.candidateIndex,
        countsPer360: countsPer360(baseline.countsPer360),
        blindLabel: baseline.blindLabel,
      },
      B: {
        candidateIndex: candidate.candidateIndex,
        countsPer360: countsPer360(candidate.countsPer360),
        blindLabel: candidate.blindLabel,
      },
    },
    sequence,
    tests,
    trialsPerBlock: PROTOCOL.trialsPerBlock,
    baselineCountsPer360: countsPer360(baseline.countsPer360),
    aspectRatio,
    maxImpliedCountsPerSecond: maxImpliedCountsPerSecond(hardware.dpi),
    practice: true,
    firstBlockIndex: 2,
    presentationOffset: 0,
  });
}

/* ------------------------------------------------------------------ submit */

export interface SubmitValidationInput {
  readonly sessionId: string;
  readonly aggregates: readonly RoundAggregate[];
  readonly qualityFlags: readonly SessionQualityFlag[];
}

export type ValidationProgress =
  | {
      readonly kind: "finished";
      readonly recommendationId: string;
      readonly verdict: ValidationVerdict;
    }
  | { readonly kind: "insufficient"; readonly pairs: number; readonly required: number };

export async function submitValidation(
  actor: Actor,
  input: SubmitValidationInput,
): Promise<ValidationProgress> {
  const session = await sessionRepo.getTestSession(actor, input.sessionId);
  if (session === null || session.mode !== "validation") throw notFound("validation session");
  if (session.parentSessionId === null) throw notFound("parent session");
  const recommendation = await recommendationRepo.findRecommendationForSession(
    actor,
    session.parentSessionId,
  );
  if (recommendation === null) throw notFound("recommendation");

  await withTransaction(async (tx) => {
    for (const aggregate of input.aggregates) {
      await sessionRepo.ingestRoundAggregate(actor, input.sessionId, aggregate, tx);
    }
    for (const flag of input.qualityFlags) {
      await sessionRepo.addSessionQualityFlag(input.sessionId, flag, null, tx);
    }
  });

  const analysis = await analyseValidationSession(input.sessionId, session.seed);
  if (analysis.kind === "insufficient") {
    return { kind: "insufficient", pairs: analysis.pairs, required: analysis.required };
  }

  const candidates = await calibrationRepo.listCandidates(input.sessionId);
  const baseline = candidates.find((c) => c.candidateIndex === VALIDATION_ARMS.baseline);
  const candidate = candidates.find((c) => c.candidateIndex === VALIDATION_ARMS.candidate);
  if (baseline === undefined || candidate === undefined) throw notFound("validation arms");

  const confidenceBefore = recommendation.confidenceIndex;
  const confidenceAfter = applyValidationMultiplier(
    confidenceBefore,
    analysis.verdict,
    recommendation.verdict === "indistinguishable" ? "indistinguishable" : "peak_found",
    CONFIDENCE_MODEL_V1.params,
  );

  await withTransaction(async (tx) => {
    await validationRepo.saveValidationRun(
      actor,
      {
        recommendationId: recommendation.id,
        sessionId: input.sessionId,
        baselineCounts360: baseline.countsPer360,
        candidateCounts360: candidate.countsPer360,
        verdict: analysis.verdict,
        composite: analysis.composite,
        blockCount: analysis.blocks,
        confidenceBefore,
        confidenceAfter,
        metrics: analysis.metrics,
      },
      tx,
    );
    await recommendationRepo.updateRecommendation(
      actor,
      recommendation.id,
      {
        confidenceIndex: confidenceAfter,
        // A loss retains the original as the standing value (doc 17 §17.5 step 3). Any other
        // verdict leaves the choice to the player.
        ...(analysis.verdict === "worse" ? { acceptedCounts360: baseline.countsPer360 } : {}),
      },
      tx,
    );
    await sessionRepo.updateSessionStatus(actor, input.sessionId, "completed", tx);
  });

  return { kind: "finished", recommendationId: recommendation.id, verdict: analysis.verdict };
}

/** The paired analysis over the stored trials — a pure function of persisted facts. */
export async function analyseValidationSession(
  sessionId: string,
  seed: bigint,
): Promise<ReturnType<typeof analyseValidation>> {
  const trials = await calibrationRepo.loadObservedTrials(sessionId, undefined, {
    blockIndexFrom: "planned",
  });
  return analyseValidation({
    trials,
    scoring: SCORING_MODEL_V2.params,
    level: PROTOCOL.intervalLevel,
    resamples: PROTOCOL.bootstrapResamples,
    minimumPairs: PROTOCOL.minimumPairs,
    seed: seed.toString(),
  });
}

/* ------------------------------------------------------------------ decide */

export type ValidationChoice = "accept_recommended" | "keep_original";

export async function decideValidation(
  actor: Actor,
  input: { readonly recommendationId: string; readonly choice: ValidationChoice },
): Promise<void> {
  const run = await validationRepo.findValidationRunForRecommendation(
    actor,
    input.recommendationId,
  );
  if (run === null) throw notFound("validation run");
  await withTransaction((tx) =>
    recommendationRepo.updateRecommendation(
      actor,
      input.recommendationId,
      {
        acceptedCounts360:
          input.choice === "accept_recommended" ? run.candidateCounts360 : run.baselineCounts360,
      },
      tx,
    ),
  );
}

export async function abandonValidation(actor: Actor, sessionId: string): Promise<void> {
  await withTransaction(async (tx) => {
    await sessionRepo.updateSessionStatus(actor, sessionId, "abandoned", tx);
  });
}

/* ------------------------------------------------------------------ read model */

export interface ValidationMetricView {
  readonly key: string;
  readonly label: string;
  readonly unit: string;
  readonly direction: "higher_better" | "lower_better";
  readonly delta: number;
  readonly deltaPct: number | null;
  readonly ciLow: number;
  readonly ciHigh: number;
  readonly significant: boolean;
  readonly favoursCandidate: boolean;
}

export interface ValidationView {
  readonly recommendationId: string;
  readonly sessionId: string;
  readonly verdict: ValidationVerdict;
  readonly baselineCm360: number;
  readonly candidateCm360: number;
  /** Relative change of B against A in cm/360, signed: positive is a larger cm/360 (slower). */
  readonly changePct: number;
  readonly composite: { readonly delta: number; readonly ciLow: number; readonly ciHigh: number };
  readonly metrics: readonly ValidationMetricView[];
  readonly blocks: number;
  readonly confidenceBefore: number;
  readonly confidenceAfter: number;
  readonly familiarityAdvisory: boolean;
  readonly accepted: "recommended" | "original" | null;
  readonly createdAt: string;
}

export async function getValidation(
  actor: Actor,
  recommendationId: string,
): Promise<ValidationView | null> {
  const run = await validationRepo.findValidationRunForRecommendation(actor, recommendationId);
  if (run === null) return null;
  const [row, deltas] = await Promise.all([
    recommendationRepo.findRecommendation(actor, recommendationId),
    validationRepo.listValidationMetricDeltas(run.id),
  ]);
  if (row === null) return null;
  const hardware = readHardwareSnapshot(row.hardwareSnapshot);
  const baselineCm = cmPer360FromCounts(run.baselineCounts360, hardware.dpi);
  const candidateCm = cmPer360FromCounts(run.candidateCounts360, hardware.dpi);

  const metrics: ValidationMetricView[] = [];
  for (const reported of REPORTED_METRICS) {
    const stored = deltas.find((delta) => delta.metricKey === reported.key);
    if (stored === undefined) continue;
    const definition = getMetricDefinition(reported.key);
    const direction: ValidationMetricView["direction"] =
      definition?.direction === "lower_better" ? "lower_better" : "higher_better";
    metrics.push({
      key: reported.key,
      label: reported.label,
      unit: definition?.unit ?? "1",
      direction,
      delta: stored.delta,
      deltaPct: stored.deltaPct,
      ciLow: stored.ciLow,
      ciHigh: stored.ciHigh,
      significant: stored.isSignificant,
      favoursCandidate: (direction === "lower_better" ? -stored.delta : stored.delta) > 0,
    });
  }

  const accepted =
    row.acceptedCounts360 === null
      ? null
      : Math.abs(row.acceptedCounts360 - run.candidateCounts360) < 1e-6
        ? "recommended"
        : Math.abs(row.acceptedCounts360 - run.baselineCounts360) < 1e-6
          ? "original"
          : null;

  return {
    recommendationId,
    sessionId: run.sessionId,
    verdict: run.verdict,
    baselineCm360: baselineCm,
    candidateCm360: candidateCm,
    changePct: ((candidateCm - baselineCm) / baselineCm) * 100,
    composite: {
      delta: run.compositeDelta,
      ciLow: run.compositeCiLow,
      ciHigh: run.compositeCiHigh,
    },
    metrics,
    blocks: run.blockCount,
    confidenceBefore: run.confidenceBefore,
    confidenceAfter: run.confidenceAfter,
    familiarityAdvisory: familiarityAdvisoryApplies(
      run.baselineCounts360,
      run.candidateCounts360,
      PARAMS.familiarityAdvisoryLogDelta,
    ),
    accepted,
    createdAt: run.createdAt.toISOString(),
  };
}

/** Re-exported so the read model's callers need not reach into core for the type. */
export type { MetricDelta, ValidationAnalysis };
