import "server-only";
import {
  bracketOf,
  constraintHighBound,
  domainBounds,
  resolveConstraint,
  toLogSensitivity,
} from "@/core/calibration";
import { CALIBRATION_MODEL_V2, CURRENT_VERSIONS, SCORING_MODEL_V2 } from "@/core/params";
import { deriveRng } from "@/core/random";
import { cmPer360FromCounts } from "@/core/sensitivity/canonical";
import { computeObjective, type ObservedTrial } from "@/core/scoring";
import { mean, standardDeviation } from "@/core/statistics";
import { countsPer360 } from "@/core/types/brand";
import type { SessionQualityFlag } from "@/core/types/vocabulary";
import {
  FINE_TUNE_LABELS,
  analyseValidation,
  duelDecision,
  fineTuneCandidates,
  originalHeldUp,
  screeningRanking,
  validationSequence,
  type DuelDecision,
  type ValidationOutcome,
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
import type { CandidateAssignment, RoundAggregate, SessionPlan } from "@/test-engine/contracts";
import { createPairedBlocksPlan, createScreeningPlan } from "@/test-engine/plan";
import { getTestDefinition, scoredTestsForMode } from "@/test-engine/tests";
import { analyseCalibration, type CalibrationContext } from "./calibration-service";
import { generateRecommendation, readHardwareSnapshot } from "./recommendation-service";
import { VALIDATION_BLIND_LABELS } from "./validation-service";

/**
 * Fine-tuning (doc 17 §17.7–§17.8, FR-089, `SENS-BR-007`).
 *
 * ```
 *   start ──► screening: one short block per candidate (seeded order)
 *         ──► duel: the top two, one counterbalanced quartet at a time
 *                   ├─ interval excludes zero → stop
 *                   └─ budget reached        → stop
 *         ──► the same engine over everything measured
 *                   ├─ original outside the refined interval → superseding recommendation
 *                   └─ otherwise                             → "the original held up"
 *         ──► reveal, then one optional preference question
 * ```
 *
 * ## Block layout
 *
 * ```
 *   0            1 … 5            10 11 12 13   14 15 16 17
 *   practice     screening        duel quartet 1  duel quartet 2
 * ```
 *
 * Screening blocks occupy 1–9 (at most five are used); duel blocks start at 10 so the
 * adjacent-pair rule of the paired analysis applies unchanged. Everything the service needs
 * to resume — which stage is next, which two candidates duel, how many looks have happened —
 * is recovered from the stored blocks; nothing is held in client state (`SENS-BR-034`).
 *
 * ## The estimate is refined by the engine, not by the duel
 *
 * The duel decides *when to stop collecting*. The estimate comes from `runCalibration` over
 * every fine-tune trial — the same quadratic, drift model and bootstrap the calibration used
 * (FR-089). A superseding recommendation is written only when the refined interval excludes
 * the original; "nothing changed" is the expected common outcome and is stated as such.
 */

const PARAMS = CALIBRATION_MODEL_V2.params;
const PROTOCOL = PARAMS.fineTune;
const FIRST_DUEL_BLOCK = 10;
const FIRST_SCREENING_BLOCK = 1;

export interface StartFineTuneInput {
  readonly recommendationId: string;
  readonly aspectRatio: number;
  readonly environment: Readonly<Record<string, unknown>>;
  /** Test fixtures only. */
  readonly seed?: bigint;
}

export interface FineTuneStep {
  readonly sessionId: string;
  readonly recommendationId: string;
  readonly stage: "screening" | "duel";
  /** 1-based quartet number during the duel; 0 during screening. */
  readonly quartet: number;
  readonly quartetBudget: number;
  readonly plan: SessionPlan;
}

export type FineTuneProgress =
  | { readonly kind: "next"; readonly step: FineTuneStep }
  | {
      readonly kind: "finished";
      readonly sessionId: string;
      readonly recommendationId: string;
      readonly heldUp: boolean;
      readonly newRecommendationId: string | null;
    };

function maxImpliedCountsPerSecond(dpi: number): number {
  return Math.round((dpi * 1000) / 2.54);
}

function protocolTests() {
  return PROTOCOL.tests
    .map((key) => getTestDefinition(key))
    .filter((definition) => definition !== undefined);
}

/** The Quick floor of the fine-tune roster — the floor a one-block screening can meet. */
function screeningFloor(): number {
  return scoredTestsForMode("fine_tune").reduce((sum, definition) => {
    const entry = PARAMS.minimumValidTrials[definition.key];
    return sum + (entry?.quick ?? definition.minValidTrials("quick"));
  }, 0);
}

/* ------------------------------------------------------------------ start */

export async function startFineTune(
  actor: Actor,
  input: StartFineTuneInput,
): Promise<FineTuneStep> {
  if (!Number.isFinite(input.aspectRatio) || input.aspectRatio <= 0) {
    throw new ValidationError([{ path: "aspectRatio", message: "must be positive" }]);
  }
  const row = await recommendationRepo.findRecommendation(actor, input.recommendationId);
  if (row === null) throw notFound("recommendation");
  if (row.verdict !== "peak_found" || row.recommendedCounts360 === null) {
    throw new ValidationError([
      { path: "recommendationId", message: "fine-tuning needs a point recommendation" },
    ]);
  }
  if (row.supersededById !== null) {
    throw new ValidationError([
      { path: "recommendationId", message: "this recommendation has been superseded" },
    ]);
  }
  const parent = await sessionRepo.getTestSession(actor, row.sessionId);
  if (parent === null) throw notFound("session");
  const hardware = readHardwareSnapshot(row.hardwareSnapshot);

  const xStar = toLogSensitivity(row.recommendedCounts360) as number;
  const bounds = domainBounds(PARAMS, hardware.dpi);
  const constraint = resolveConstraint(
    { padWidthCm: hardware.padWidthCm, comfortableSwipeCm: null },
    PARAMS,
  );
  const ceiling = constraintHighBound(constraint, hardware.dpi);
  const specs = fineTuneCandidates(xStar, PROTOCOL.offsets, {
    low: bounds.low as number,
    high: ceiling === null ? (bounds.high as number) : Math.min(bounds.high, ceiling),
  });

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
        mode: "fine_tune",
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

    const labels = deriveRng(seed, "fine-tune-labels").shuffle(VALIDATION_BLIND_LABELS);
    await calibrationRepo.saveCandidates(
      actor,
      session.id,
      specs.map((spec, index) => ({
        roundIndex: 0,
        candidateIndex: index,
        x: toLogSensitivity(2 ** spec.x),
        countsPer360: countsPer360(2 ** spec.x),
        blindLabel: labels[index] ?? `#${index}`,
        source: "fine_tune",
      })),
      hardware.dpi,
      tx,
    );
    return { sessionId: session.id, seed };
  });

  const plan = await screeningPlan(sessionId, seed, hardware.dpi, input.aspectRatio);
  return {
    sessionId,
    recommendationId: row.id,
    stage: "screening",
    quartet: 0,
    quartetBudget: PROTOCOL.duelQuartetBudget,
    plan,
  };
}

async function candidateAssignments(sessionId: string): Promise<readonly CandidateAssignment[]> {
  const rows = await calibrationRepo.listCandidates(sessionId);
  return rows.map((row) => ({
    candidateIndex: row.candidateIndex,
    countsPer360: countsPer360(row.countsPer360),
    blindLabel: row.blindLabel,
  }));
}

async function screeningPlan(
  sessionId: string,
  seed: bigint,
  dpi: number,
  aspectRatio: number,
): Promise<SessionPlan> {
  const candidates = await candidateAssignments(sessionId);
  const order = deriveRng(seed, "screening-order").shuffle(candidates.map((_, i) => i));
  const recommended =
    candidates.find((c) => c.candidateIndex === recommendedIndex(candidates)) ?? candidates[0];
  if (recommended === undefined) throw notFound("fine-tune candidates");
  return createScreeningPlan({
    sessionId,
    seed: seed.toString(),
    mode: "fine_tune",
    candidates,
    order,
    tests: protocolTests(),
    trialsPerBlock: PROTOCOL.screeningTrialsPerBlock,
    baselineCountsPer360: recommended.countsPer360,
    aspectRatio,
    maxImpliedCountsPerSecond: maxImpliedCountsPerSecond(dpi),
    presentationOffset: 0,
  });
}

/** The candidate at offset 0 — the recommendation itself — by nearest x to the median. */
function recommendedIndex(candidates: readonly CandidateAssignment[]): number {
  const sorted = [...candidates].sort((a, b) => Number(a.countsPer360) - Number(b.countsPer360));
  const middle = sorted[Math.floor(sorted.length / 2)];
  return middle?.candidateIndex ?? 0;
}

/* ------------------------------------------------------------------ submit + advance */

export interface SubmitFineTuneInput {
  readonly sessionId: string;
  readonly aggregates: readonly RoundAggregate[];
  readonly qualityFlags: readonly SessionQualityFlag[];
  readonly aspectRatio: number;
}

export async function submitFineTune(
  actor: Actor,
  input: SubmitFineTuneInput,
): Promise<FineTuneProgress> {
  const session = await sessionRepo.getTestSession(actor, input.sessionId);
  if (session === null || session.mode !== "fine_tune") throw notFound("fine-tune session");
  if (session.parentSessionId === null) throw notFound("parent session");
  const recommendation = await recommendationRepo.findRecommendationForSession(
    actor,
    session.parentSessionId,
  );
  if (recommendation === null || recommendation.recommendedCounts360 === null) {
    throw notFound("recommendation");
  }
  const hardware = readHardwareSnapshot(session.hardwareSnapshot as Record<string, unknown>);

  await withTransaction(async (tx) => {
    for (const aggregate of input.aggregates) {
      await sessionRepo.ingestRoundAggregate(actor, input.sessionId, aggregate, tx);
    }
    for (const flag of input.qualityFlags) {
      await sessionRepo.addSessionQualityFlag(input.sessionId, flag, null, tx);
    }
  });

  const state = await fineTuneState(input.sessionId, session.seed);
  const offset = await sessionRepo.countRounds(input.sessionId);

  if (state.duelQuartetsRun === 0 && state.duel.stop === false) {
    // Screening is in; the first duel quartet is next.
    const plan = await duelPlan(input.sessionId, session.seed, state.topTwo, hardware.dpi, {
      aspectRatio: input.aspectRatio,
      quartet: 0,
      presentationOffset: offset,
    });
    return {
      kind: "next",
      step: {
        sessionId: input.sessionId,
        recommendationId: recommendation.id,
        stage: "duel",
        quartet: 1,
        quartetBudget: PROTOCOL.duelQuartetBudget,
        plan,
      },
    };
  }

  if (!state.duel.stop) {
    const plan = await duelPlan(input.sessionId, session.seed, state.topTwo, hardware.dpi, {
      aspectRatio: input.aspectRatio,
      quartet: state.duelQuartetsRun,
      presentationOffset: offset,
    });
    return {
      kind: "next",
      step: {
        sessionId: input.sessionId,
        recommendationId: recommendation.id,
        stage: "duel",
        quartet: state.duelQuartetsRun + 1,
        quartetBudget: PROTOCOL.duelQuartetBudget,
        plan,
      },
    };
  }

  // The duel has stopped: refine with the engine over everything measured.
  const xStar = toLogSensitivity(recommendation.recommendedCounts360) as number;
  const outerOffset = Math.max(...PROTOCOL.offsets.map((offset) => Math.abs(offset)));
  const context: CalibrationContext = {
    sessionId: input.sessionId,
    mode: "fine_tune",
    seed: session.seed,
    deviceDpi: hardware.dpi,
    anchor: { kind: "prior_recommendation", countsPer360: countsPer360(2 ** xStar) },
    padWidthCm: hardware.padWidthCm,
    comfortableSwipeCm: null,
    minimumTrialsPerCandidate: screeningFloor(),
  };
  const analysis = await analyseCalibration(
    actor,
    context,
    new Map([[0, bracketOf(xStar, outerOffset)]]),
  );
  const heldUp = originalHeldUp(analysis.result, xStar);

  let newRecommendationId: string | null = null;
  if (!heldUp) {
    const flags = await sessionRepo.listSessionQualityFlags(input.sessionId);
    const environment = session.environment as Record<string, unknown>;
    const generated = await generateRecommendation(actor, {
      sessionId: input.sessionId,
      calibration: analysis.result,
      hardware,
      mode: "fine_tune",
      rawInputEffective: environment["unadjustedMovementEffective"] !== false,
      windowResized: flags.includes("window_resized"),
      pointerLockLosses: flags.filter((flag) => flag === "unstable_pointer_lock").length,
      parentRecommendationId: recommendation.id,
    });
    newRecommendationId = generated.recommendationId;
  }

  await withTransaction(async (tx) => {
    await sessionRepo.updateSessionStatus(actor, input.sessionId, "completed", tx);
  });

  return {
    kind: "finished",
    sessionId: input.sessionId,
    recommendationId: recommendation.id,
    heldUp,
    newRecommendationId,
  };
}

export async function abandonFineTune(actor: Actor, sessionId: string): Promise<void> {
  await withTransaction(async (tx) => {
    await sessionRepo.updateSessionStatus(actor, sessionId, "abandoned", tx);
  });
}

/* ------------------------------------------------------------------ state from storage */

interface FineTuneState {
  readonly screening: readonly ObservedTrial[];
  readonly topTwo: readonly [number, number];
  readonly duelQuartetsRun: number;
  readonly duelOutcome: ValidationOutcome | null;
  readonly duel: DuelDecision;
}

/**
 * Everything the next decision needs, derived from stored trials alone. The ranking is a
 * deterministic function of the screening blocks, so it is recomputed rather than stored.
 */
async function fineTuneState(sessionId: string, seed: bigint): Promise<FineTuneState> {
  const trials = await calibrationRepo.loadObservedTrials(sessionId, undefined, {
    blockIndexFrom: "planned",
  });
  const screening = trials.filter(
    (trial) => trial.blockIndex >= FIRST_SCREENING_BLOCK && trial.blockIndex < FIRST_DUEL_BLOCK,
  );
  const duelTrials = trials.filter((trial) => trial.blockIndex >= FIRST_DUEL_BLOCK);
  const candidates = await calibrationRepo.listCandidates(sessionId);

  const objective = computeObjective(screening, { parameters: SCORING_MODEL_V2.params });
  const estimates = candidates.map((candidate) => {
    const scores = objective.trials
      .filter((trial) => trial.candidateIndex === candidate.candidateIndex)
      .map((trial) => trial.score);
    const n = scores.length;
    return {
      candidateIndex: candidate.candidateIndex,
      x: toLogSensitivity(candidate.countsPer360) as number,
      mean: n === 0 ? Number.NEGATIVE_INFINITY : mean(scores),
      standardError: n > 1 ? standardDeviation(scores) / Math.sqrt(n) : 1,
      trials: n,
    };
  });
  const ranked = screeningRanking(estimates.filter((e) => e.trials > 0));
  const first = ranked[0] ?? candidates[0]?.candidateIndex ?? 0;
  const second = ranked[1] ?? candidates[1]?.candidateIndex ?? first;
  const topTwo: [number, number] = [first, second];

  const duelBlocks = new Set(duelTrials.map((trial) => trial.blockIndex)).size;
  const duelQuartetsRun = Math.floor(duelBlocks / 4);
  const duelOutcome =
    duelQuartetsRun === 0
      ? null
      : analyseValidation({
          trials: duelTrials,
          scoring: SCORING_MODEL_V2.params,
          level: PARAMS.validation.intervalLevel,
          resamples: PARAMS.validation.bootstrapResamples,
          minimumPairs: 1,
          seed: `${seed.toString()}:duel`,
          arms: { baseline: first, candidate: second },
        });
  const duel =
    duelOutcome === null
      ? { stop: false, winner: null, reason: "continue" as const }
      : duelDecision(duelOutcome, duelQuartetsRun, PROTOCOL.duelQuartetBudget);

  return { screening, topTwo, duelQuartetsRun, duelOutcome, duel };
}

async function duelPlan(
  sessionId: string,
  seed: bigint,
  topTwo: readonly [number, number],
  dpi: number,
  options: {
    readonly aspectRatio: number;
    readonly quartet: number;
    readonly presentationOffset: number;
  },
): Promise<SessionPlan> {
  const candidates = await candidateAssignments(sessionId);
  const A = candidates.find((c) => c.candidateIndex === topTwo[0]);
  const B = candidates.find((c) => c.candidateIndex === topTwo[1]);
  if (A === undefined || B === undefined) throw notFound("duel candidates");
  const sequence = validationSequence(4, deriveRng(seed, "duel-sequence", options.quartet));
  return createPairedBlocksPlan({
    sessionId,
    seed: `${seed.toString()}:duel${options.quartet}`,
    mode: "fine_tune",
    arms: { A, B },
    sequence,
    tests: protocolTests(),
    trialsPerBlock: PROTOCOL.duelTrialsPerBlock,
    baselineCountsPer360: A.countsPer360,
    aspectRatio: options.aspectRatio,
    maxImpliedCountsPerSecond: maxImpliedCountsPerSecond(dpi),
    practice: false,
    firstBlockIndex: FIRST_DUEL_BLOCK + 4 * options.quartet,
    presentationOffset: options.presentationOffset,
  });
}

/* ------------------------------------------------------------------ preference */

export async function recordPreference(
  actor: Actor,
  input: { readonly sessionId: string; readonly candidateId: string },
): Promise<void> {
  const session = await sessionRepo.getTestSession(actor, input.sessionId);
  if (session === null || session.mode !== "fine_tune") throw notFound("fine-tune session");
  if (session.status !== "completed") {
    throw new ValidationError([
      { path: "sessionId", message: "preference is asked only after the reveal" },
    ]);
  }
  await withTransaction((tx) =>
    validationRepo.savePreference(actor, input.sessionId, input.candidateId, tx),
  );
}

/* ------------------------------------------------------------------ read model */

export interface FineTuneCandidateView {
  readonly candidateId: string;
  readonly candidateIndex: number;
  readonly blindLabel: string;
  readonly revealLabel: string;
  readonly cm360: number;
  /** Screening effect in score units, or null when the candidate was not measured. */
  readonly screeningScore: number | null;
  readonly inDuel: boolean;
}

export interface FineTuneView {
  readonly sessionId: string;
  readonly recommendationId: string;
  readonly completed: boolean;
  readonly candidates: readonly FineTuneCandidateView[];
  readonly duel: {
    readonly quartets: number;
    readonly verdict: "first" | "second" | "no_measurable_difference" | null;
    readonly composite: {
      readonly delta: number;
      readonly ciLow: number;
      readonly ciHigh: number;
    } | null;
    readonly reason: DuelDecision["reason"];
  };
  readonly heldUp: boolean;
  readonly newRecommendationId: string | null;
  /** The refined estimate, for the "what changed" statement. */
  readonly refinedCm360: number | null;
  readonly originalCm360: number;
  readonly preference: { readonly candidateId: string; readonly measuredBest: boolean } | null;
}

export async function getFineTune(actor: Actor, sessionId: string): Promise<FineTuneView | null> {
  const session = await sessionRepo.getTestSession(actor, sessionId);
  if (session === null || session.mode !== "fine_tune" || session.parentSessionId === null) {
    return null;
  }
  const recommendation = await recommendationRepo.findRecommendationForSession(
    actor,
    session.parentSessionId,
  );
  if (recommendation === null || recommendation.recommendedCounts360 === null) return null;
  const hardware = readHardwareSnapshot(session.hardwareSnapshot as Record<string, unknown>);
  const [state, rows, preference, ownRecommendation] = await Promise.all([
    fineTuneState(sessionId, session.seed),
    calibrationRepo.listCandidates(sessionId),
    validationRepo.findPreference(sessionId),
    recommendationRepo.findRecommendationForSession(actor, sessionId),
  ]);

  const xStar = toLogSensitivity(recommendation.recommendedCounts360) as number;
  const objective = computeObjective(state.screening, { parameters: SCORING_MODEL_V2.params });
  const candidates: FineTuneCandidateView[] = rows.map((row) => {
    const scores = objective.trials
      .filter((trial) => trial.candidateIndex === row.candidateIndex)
      .map((trial) => trial.score);
    const offset = (toLogSensitivity(row.countsPer360) as number) - xStar;
    const offsetIndex = nearestOffsetIndex(offset);
    return {
      candidateId: row.id,
      candidateIndex: row.candidateIndex,
      blindLabel: row.blindLabel,
      revealLabel: FINE_TUNE_LABELS[offsetIndex] ?? "Candidate",
      cm360: cmPer360FromCounts(row.countsPer360, hardware.dpi),
      screeningScore: scores.length === 0 ? null : mean(scores),
      inDuel: state.topTwo.includes(row.candidateIndex),
    };
  });

  const measuredBest = duelWinnerIndex(state) ?? state.topTwo[0];
  const chosen =
    preference === null ? null : rows.find((r) => r.id === preference.chosenCandidateId);

  return {
    sessionId,
    recommendationId: recommendation.id,
    completed: session.status === "completed",
    candidates,
    duel: {
      quartets: state.duelQuartetsRun,
      verdict:
        state.duelOutcome === null || state.duelOutcome.kind !== "analysed"
          ? null
          : state.duelOutcome.verdict === "improved"
            ? "second"
            : state.duelOutcome.verdict === "worse"
              ? "first"
              : "no_measurable_difference",
      composite:
        state.duelOutcome === null || state.duelOutcome.kind !== "analysed"
          ? null
          : state.duelOutcome.composite,
      reason: state.duel.reason,
    },
    heldUp: ownRecommendation === null,
    newRecommendationId: ownRecommendation?.id ?? null,
    refinedCm360: ownRecommendation?.recommendedCm360 ?? null,
    originalCm360: cmPer360FromCounts(recommendation.recommendedCounts360, hardware.dpi),
    preference:
      chosen === undefined || chosen === null
        ? null
        : { candidateId: chosen.id, measuredBest: chosen.candidateIndex === measuredBest },
  };
}

function duelWinnerIndex(state: FineTuneState): number | null {
  if (state.duel.winner === null) return null;
  return state.duel.winner === "A" ? state.topTwo[0] : state.topTwo[1];
}

function nearestOffsetIndex(offset: number): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  PROTOCOL.offsets.forEach((candidate, index) => {
    const distance = Math.abs(candidate - offset);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}
