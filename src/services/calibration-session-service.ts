import "server-only";
import { bracketOf, toLogSensitivity, type SearchBracket } from "@/core/calibration";
import { CALIBRATION_MODEL_V3, CURRENT_VERSIONS } from "@/core/params";
import {
  countsPer360FromCm,
  cmPer360FromCounts,
  degreesPerCount,
} from "@/core/sensitivity/canonical";
import { countsPer360 } from "@/core/types/brand";
import type { SessionMode, SessionQualityFlag } from "@/core/types/vocabulary";
import {
  algorithmRepo,
  calibrationRepo,
  gameRepo,
  hardwareRepo,
  sessionRepo,
} from "@/repositories";
import type { Actor } from "@/repositories/actor";
import { withTransaction } from "@/repositories/transaction";
import { ValidationError, notFound } from "@/lib/errors";
import { newSeed } from "@/lib/crypto";
import type { RoundAggregate, SessionPlan } from "@/test-engine/contracts";
import { createCalibrationRoundPlan } from "@/test-engine/plan";
import { SENSITIVITY_INDEPENDENT_TESTS, scoredTestsForMode } from "@/test-engine/tests";
import {
  analyseCalibration,
  planCalibrationRound,
  type CalibrationContext,
} from "./calibration-service";
import {
  generateRecommendation,
  readHardwareSnapshot,
  type HardwareSnapshot,
} from "./recommendation-service";

/**
 * The calibration session loop (doc 04 journey J-01, doc 13, doc 23 §23.4).
 *
 * ```
 *   start ──► plan round 0 ──► client runs it ──► submit ──► analyse ──► decide
 *                 ▲                                                        │
 *                 └──────── plan next round ◄──── continue ◄──────────────┤
 *                                                                          └─► stop ──► recommend
 * ```
 *
 * ## The server decides, the client measures
 *
 * The client receives a plan for one round and returns what it measured. Which sensitivities
 * to test next, whether to stop, and what the answer is are all decided here from persisted
 * facts — a client that could author any of those could author the result (`SENS-BR-034`).
 *
 * ## Why this exists in this phase
 *
 * No execution phase assigned the session orchestration, and without it nothing can produce
 * a recommendation for a real user — which makes a results page an exhibit rather than a
 * product. This is the minimal honest loop: the polished onboarding, environment check and
 * transitions are Phase 10, and the hardware-profile persistence is Phase 9.
 */

export interface StartCalibrationInput {
  readonly mode: SessionMode;
  readonly dpi: number;
  readonly dpiSource: HardwareSnapshot["dpiSource"];
  readonly currentCmPer360: number | null;
  readonly padWidthCm: number | null;
  readonly gameId: string | null;
  /**
   * The hardware profile this session runs at (FR-095, `SENS-BR-018`). The snapshot is still
   * written from the values passed in, so editing the profile afterwards cannot rewrite what
   * this session measured (`SENS-BR-035`) — the id is what lets history group and compare.
   */
  readonly hardwareProfileId?: string | null;
  readonly aspectRatio: number;
  readonly environment: Readonly<Record<string, unknown>>;
  /**
   * Pins the session seed. **Test fixtures only** — the server action that the browser reaches
   * never passes one, so a client cannot choose its stimulus sequence (`SENS-BR-034`).
   */
  readonly seed?: bigint;
}

export interface CalibrationStep {
  readonly sessionId: string;
  readonly roundIndex: number;
  readonly roundBudget: number;
  readonly plan: SessionPlan;
}

export type CalibrationProgress =
  | { readonly kind: "next_round"; readonly step: CalibrationStep }
  | { readonly kind: "finished"; readonly recommendationId: string; readonly verdict: string };

const MIN_DPI = 100;
const MAX_DPI = 32_000;

/** Counts/s a real mouse cannot exceed at this DPI: 10 m/s of hand travel (doc 23 §23.10). */
function maxImpliedCountsPerSecond(dpi: number): number {
  return Math.round((dpi * 1000) / 2.54);
}

function roundBudget(mode: SessionMode): number {
  const budget = CALIBRATION_MODEL_V3.params.roundBudget;
  return mode === "advanced" ? budget.advanced : mode === "quick" ? budget.quick : budget.standard;
}

/* ------------------------------------------------------------------ start */

export async function startCalibrationSession(
  actor: Actor,
  input: StartCalibrationInput,
): Promise<CalibrationStep> {
  if (!Number.isFinite(input.dpi) || input.dpi < MIN_DPI || input.dpi > MAX_DPI) {
    throw new ValidationError([
      { path: "dpi", message: `must be between ${MIN_DPI} and ${MAX_DPI}` },
    ]);
  }
  if (
    input.currentCmPer360 !== null &&
    !(input.currentCmPer360 > 0 && input.currentCmPer360 < 500)
  ) {
    throw new ValidationError([
      { path: "currentCmPer360", message: "must be between 0 and 500 cm" },
    ]);
  }
  if (!Number.isFinite(input.aspectRatio) || input.aspectRatio <= 0) {
    throw new ValidationError([{ path: "aspectRatio", message: "must be positive" }]);
  }

  const gameVersion =
    input.gameId === null ? null : await gameRepo.findGameVersionBySlug(input.gameId);

  // A profile the actor does not own is not attached: the lookup composes ownership, so an
  // id from elsewhere resolves to null rather than borrowing someone else's hardware.
  const profileId =
    input.hardwareProfileId === undefined || input.hardwareProfileId === null
      ? null
      : ((await hardwareRepo.getHardwareProfile(actor, input.hardwareProfileId))?.id ?? null);

  const { sessionId, seed } = await withTransaction(async (tx) => {
    const versions = await algorithmRepo.resolveAlgorithmVersionIds(
      {
        scoring: CURRENT_VERSIONS.scoring,
        calibration: CURRENT_VERSIONS.calibration,
        confidence: CURRENT_VERSIONS.confidence,
      },
      tx,
    );
    const { scoring, calibration, confidence } = versions;
    if (scoring === undefined || calibration === undefined || confidence === undefined) {
      throw notFound("algorithm versions");
    }

    const seed = input.seed ?? newSeed();
    const hardwareSnapshot: HardwareSnapshot = {
      dpi: input.dpi,
      dpiSource: input.dpiSource,
      currentCmPer360: input.currentCmPer360,
      padWidthCm: input.padWidthCm,
    };

    const session = await sessionRepo.createTestSession(
      actor,
      {
        hardwareProfileId: profileId,
        hardwareSnapshot: { ...hardwareSnapshot },
        primaryGameVersionId: gameVersion?.gameVersionId ?? null,
        mode: input.mode,
        environment: input.environment,
        environmentClass: "pass",
        seed,
        scoringVersionId: scoring,
        calibrationVersionId: calibration,
        confidenceVersionId: confidence,
      },
      tx,
    );
    await sessionRepo.updateSessionStatus(actor, session.id, "in_progress", tx);
    return { sessionId: session.id, seed };
  });

  const context = contextFor(
    sessionId,
    input.mode,
    seed,
    {
      dpi: input.dpi,
      dpiSource: input.dpiSource,
      currentCmPer360: input.currentCmPer360,
      padWidthCm: input.padWidthCm,
    },
    null,
  );

  const planned = await planCalibrationRound(actor, context, 0, null);
  return stepFor(sessionId, context, planned.roundIndex, planned, input.aspectRatio, null, 0);
}

/* ------------------------------------------------------------------ submit + advance */

export interface SubmitCalibrationRoundInput {
  readonly sessionId: string;
  readonly roundIndex: number;
  readonly aggregates: readonly RoundAggregate[];
  readonly qualityFlags: readonly SessionQualityFlag[];
  readonly aspectRatio: number;
}

export async function submitCalibrationRound(
  actor: Actor,
  input: SubmitCalibrationRoundInput,
): Promise<CalibrationProgress> {
  const session = await sessionRepo.getTestSession(actor, input.sessionId);
  if (session === null) throw notFound("session");
  const hardware = readHardwareSnapshot(session.hardwareSnapshot as Record<string, unknown>);
  const mode = session.mode;

  await withTransaction(async (tx) => {
    for (const aggregate of input.aggregates) {
      await sessionRepo.ingestRoundAggregate(actor, input.sessionId, aggregate, tx);
    }
    for (const flag of input.qualityFlags) {
      await sessionRepo.addSessionQualityFlag(input.sessionId, flag, null, tx);
    }
  });

  // The comfort test ran in round 0; from here on it bounds the search (doc 13 §13.4).
  const comfortDeg = await sessionRepo.findComfortSwipeDeg(input.sessionId);
  const baselineCm = baselineCmFor(hardware);
  const comfortableSwipeCm = comfortDeg === null ? null : (comfortDeg / 360) * baselineCm;

  const context = contextFor(input.sessionId, mode, session.seed, hardware, comfortableSwipeCm);

  // Brackets are rebuilt from the stored round audit, so a resumed session needs no client
  // state beyond the session id.
  const stored = await calibrationRepo.listRoundResults(input.sessionId);
  const brackets = new Map<number, SearchBracket>(
    stored.map((round) => [
      round.roundIndex,
      bracketOf(
        (round.bracketLow + round.bracketHigh) / 2,
        (round.bracketHigh - round.bracketLow) / 2,
      ),
    ]),
  );
  const candidates = await calibrationRepo.listCandidates(input.sessionId);
  const currentRound = Math.max(0, ...candidates.map((candidate) => candidate.roundIndex));
  if (!brackets.has(currentRound)) {
    // The round that was just run has no audit row yet. Its bracket is recovered from its own
    // candidates: they sit exactly at the bracket's ends (doc 13 §13.5), so the span of the
    // generated candidates — the anchor excluded, it re-tests an earlier round's centre — *is*
    // the bracket the round was planned from. Nothing is re-derived from the previous round,
    // whose decision (narrow or shift) is what moved the bracket in the first place.
    const own = candidates
      .filter((candidate) => candidate.roundIndex === currentRound && candidate.source !== "anchor")
      .map((candidate) => toLogSensitivity(candidate.countsPer360) as number);
    if (own.length > 0) {
      const low = Math.min(...own);
      const high = Math.max(...own);
      brackets.set(currentRound, bracketOf((low + high) / 2, (high - low) / 2));
    }
  }

  const analysis = await analyseCalibration(actor, context, brackets);
  const budget = roundBudget(mode);
  const nextRound = currentRound + 1;

  if (analysis.nextBracket !== null && nextRound < budget) {
    const planned = await planCalibrationRound(actor, context, nextRound, analysis.nextBracket);
    const offset = await sessionRepo.countRounds(input.sessionId);
    const step = stepFor(
      input.sessionId,
      context,
      nextRound,
      planned,
      input.aspectRatio,
      comfortableSwipeCm,
      offset,
    );
    return { kind: "next_round", step };
  }

  const flags = await sessionRepo.listSessionQualityFlags(input.sessionId);
  const environment = session.environment as Record<string, unknown>;
  const generated = await generateRecommendation(actor, {
    sessionId: input.sessionId,
    calibration: analysis.result,
    hardware,
    mode,
    rawInputEffective: environment["unadjustedMovementEffective"] !== false,
    windowResized: flags.includes("window_resized"),
    pointerLockLosses: flags.filter((flag) => flag === "unstable_pointer_lock").length,
  });

  await withTransaction(async (tx) => {
    await sessionRepo.updateSessionStatus(actor, input.sessionId, "completed", tx);
  });

  return {
    kind: "finished",
    recommendationId: generated.recommendationId,
    verdict: generated.recommendation.verdict,
  };
}

export async function abandonCalibrationSession(actor: Actor, sessionId: string): Promise<void> {
  await withTransaction(async (tx) => {
    await sessionRepo.updateSessionStatus(actor, sessionId, "abandoned", tx);
  });
}

/* ------------------------------------------------------------------ helpers */

function baselineCmFor(hardware: HardwareSnapshot): number {
  // The baseline runs the sensitivity-independent tests at a sensible mid-band value: the
  // player's own if they gave one, else the domain centre.
  return hardware.currentCmPer360 ?? 30;
}

function contextFor(
  sessionId: string,
  mode: SessionMode,
  seed: bigint,
  hardware: HardwareSnapshot,
  comfortableSwipeCm: number | null,
): CalibrationContext {
  return {
    sessionId,
    mode,
    seed,
    deviceDpi: hardware.dpi,
    anchor:
      hardware.currentCmPer360 === null
        ? { kind: "cold_start" }
        : {
            kind: "current_sensitivity",
            countsPer360: countsPer360FromCm(hardware.currentCmPer360, hardware.dpi),
          },
    padWidthCm: hardware.padWidthCm,
    comfortableSwipeCm,
  };
}

function stepFor(
  sessionId: string,
  context: CalibrationContext,
  roundIndex: number,
  planned: Awaited<ReturnType<typeof planCalibrationRound>>,
  aspectRatio: number,
  comfortableSwipeCm: number | null,
  presentationOffset: number,
): CalibrationStep {
  const baselineCounts = countsPer360FromCm(
    baselineCmFor({
      dpi: context.deviceDpi,
      dpiSource: "known",
      currentCmPer360:
        context.anchor.kind === "cold_start"
          ? null
          : cmPer360FromCounts(context.anchor.countsPer360, context.deviceDpi),
      padWidthCm: context.padWidthCm,
    }),
    context.deviceDpi,
  );

  const physicalConstraint =
    comfortableSwipeCm === null
      ? undefined
      : {
          // The reach in counts at the sensitivity the trial runs at is what `pathTruncated`
          // compares against; the engine converts per trial. Here the reach is expressed in
          // counts at the baseline, which is DPI-free once inside the engine.
          maxSingleSwipeCounts:
            ((comfortableSwipeCm / cmPer360FromCounts(baselineCounts, context.deviceDpi)) * 360) /
            degreesPerCount(baselineCounts),
        };

  const plan = createCalibrationRoundPlan({
    sessionId,
    seed: context.seed.toString(),
    mode: context.mode,
    roundIndex,
    candidates: planned.candidates.map((candidate) => ({
      candidateIndex: candidate.candidateIndex,
      countsPer360: countsPer360(Number(candidate.countsPer360)),
      blindLabel: candidate.blindLabel,
    })),
    blockOrder: planned.blockOrder,
    scoredTests: scoredTestsForMode(context.mode),
    baselineTests: SENSITIVITY_INDEPENDENT_TESTS,
    baselineCountsPer360: baselineCounts,
    aspectRatio,
    maxImpliedCountsPerSecond: maxImpliedCountsPerSecond(context.deviceDpi),
    presentationOffset,
    ...(physicalConstraint === undefined ? {} : { physicalConstraint }),
  });

  return { sessionId, roundIndex, roundBudget: roundBudget(context.mode), plan };
}
