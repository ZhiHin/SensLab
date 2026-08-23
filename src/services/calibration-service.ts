import "server-only";
import {
  analyseRound,
  anchorCandidate,
  bracketOf,
  constraintHighBound,
  domainBounds,
  generateCandidates,
  initialBracket,
  latinSquare,
  resolveConstraint,
  runCalibration,
  toLogSensitivity,
  type BracketAnchor,
  type CalibrationInput,
  type CalibrationResult,
  type Candidate,
  type RoundInput,
  type SearchBracket,
} from "@/core/calibration";
import { CALIBRATION_MODEL_V1, SCORING_MODEL_V2 } from "@/core/params";
import { deriveRng } from "@/core/random";
import { computeObjective } from "@/core/scoring";
import { logSensitivity } from "@/core/types/brand";
import type { SessionMode } from "@/core/types/vocabulary";
import { calibrationRepo, sessionRepo } from "@/repositories";
import type { Actor } from "@/repositories/actor";
import { withTransaction } from "@/repositories/transaction";
import { notFound } from "@/lib/errors";

/**
 * The server-side adaptive step (doc 13, doc 23 §23.4).
 *
 * ## Why this is on the server
 *
 * The client measures; **the server decides**. Every part of the decision lives here — which
 * sensitivities to test next, which candidate is which, and what the response curve says —
 * because each of them is something a client could otherwise choose in its own favour: a
 * favourable stimulus seed, a re-rolled candidate set, or simply a fabricated recommendation.
 *
 * The objective is **re-derived on the server from stored trials**, never accepted from the
 * browser. A client that could submit its own objective values could submit a curve with a peak
 * wherever it liked, and nothing downstream would be able to tell.
 *
 * ## What it does not do
 *
 * It produces a `CalibrationResult` — a response curve, a verdict and an interval. It does not
 * produce a `recommendations` row: that needs the confidence model (doc 15) and the aim profile
 * (doc 17), which are Phase 7. Storing a recommendation without its confidence would be storing
 * a number with no indication of how much to trust it.
 */

const CALIBRATION_PARAMS = CALIBRATION_MODEL_V1.params;
const SCORING_PARAMS = SCORING_MODEL_V2.params;

export interface CalibrationContext {
  readonly sessionId: string;
  readonly mode: SessionMode;
  readonly seed: bigint;
  readonly deviceDpi: number;
  /** What is already known about the player's sensitivity, if anything. */
  readonly anchor: BracketAnchor;
  readonly padWidthCm: number | null;
  readonly comfortableSwipeCm: number | null;
}

export interface PlannedCalibrationRound {
  readonly roundIndex: number;
  readonly bracket: SearchBracket;
  readonly candidates: readonly Candidate[];
  /** Presentation order for the round's blocks, counterbalanced by a Latin square. */
  readonly blockOrder: readonly number[];
}

function specFor(context: CalibrationContext, bracket: SearchBracket) {
  const bounds = domainBounds(CALIBRATION_PARAMS, context.deviceDpi);
  const constraint = resolveConstraint(
    { padWidthCm: context.padWidthCm, comfortableSwipeCm: context.comfortableSwipeCm },
    CALIBRATION_PARAMS,
  );

  return {
    parameterName: "hipfire_counts_per_360",
    domainLow: bounds.low,
    domainHigh: bounds.high,
    constraint,
    initialCentre: bracket.centre,
    initialHalfWidth: bracket.halfWidth,
    candidatesPerRound: candidatesPerRound(context.mode),
    roundBudget: roundBudget(context.mode),
    mode: context.mode,
    seed: context.seed,
    calibrationVersion: CALIBRATION_MODEL_V1.version,
  } as const;
}

function candidatesPerRound(mode: SessionMode): number {
  const counts = CALIBRATION_PARAMS.candidatesPerRound;
  return mode === "advanced" ? counts.advanced : mode === "quick" ? counts.quick : counts.standard;
}

function roundBudget(mode: SessionMode): number {
  const budget = CALIBRATION_PARAMS.roundBudget;
  return mode === "advanced" ? budget.advanced : mode === "quick" ? budget.quick : budget.standard;
}

function anchorEnabled(mode: SessionMode): boolean {
  const enabled = CALIBRATION_PARAMS.anchorEnabled;
  return mode === "advanced"
    ? enabled.advanced
    : mode === "quick"
      ? enabled.quick
      : enabled.standard;
}

/**
 * Plans one calibration round and records its candidates.
 *
 * `bracket` is the search's state, which the caller carries forward from the previous round's
 * analysis. The first round derives its bracket from whatever is known about the player.
 */
export async function planCalibrationRound(
  actor: Actor,
  context: CalibrationContext,
  roundIndex: number,
  previousBracket: SearchBracket | null,
): Promise<PlannedCalibrationRound> {
  const constraint = resolveConstraint(
    { padWidthCm: context.padWidthCm, comfortableSwipeCm: context.comfortableSwipeCm },
    CALIBRATION_PARAMS,
  );

  const bracket =
    previousBracket ??
    initialBracket(context.anchor, CALIBRATION_PARAMS, context.deviceDpi, constraint);

  const existing = await calibrationRepo.listCandidates(context.sessionId);

  // A replanned round returns **the same candidates**, not a fresh set. The client may already
  // be running against the first response, and a second call that renumbered the round would
  // leave its ingested trials pointing at candidates nobody is measuring.
  const alreadyPlanned = existing.filter((row) => row.roundIndex === roundIndex);
  if (alreadyPlanned.length > 0) {
    return {
      roundIndex,
      bracket,
      candidates: alreadyPlanned.map((row) => ({
        roundIndex: row.roundIndex,
        candidateIndex: row.candidateIndex,
        x: toLogSensitivity(row.countsPer360),
        countsPer360: row.countsPer360 as never,
        blindLabel: row.blindLabel,
        source: roundIndex === 0 ? ("initial" as const) : ("narrowed" as const),
      })),
      blockOrder: blockOrderFor(context, roundIndex, alreadyPlanned.length),
    };
  }

  const startIndex = existing.length;

  const count = candidatesPerRound(context.mode);
  const generated = generateCandidates({
    bracket,
    roundIndex,
    count,
    source: roundIndex === 0 ? "initial" : "narrowed",
    rng: deriveRng(context.seed, "blind-labels", roundIndex),
    startIndex,
  });

  // The anchor re-tests the round-1 centre in the final round. It is the only candidate that
  // shares a sensitivity with an earlier block, and that repeat is what makes the drift term
  // identifiable at all (doc 13 §13.5).
  const isFinal = roundIndex === roundBudget(context.mode) - 1;
  const firstRoundCentre = existing[0]?.countsPer360;
  const withAnchor =
    isFinal && anchorEnabled(context.mode) && roundIndex > 0 && firstRoundCentre !== undefined;

  const candidates = withAnchor
    ? [
        ...generated,
        anchorCandidate({
          x: toLogSensitivity(anchorCounts(existing)),
          roundIndex,
          candidateIndex: startIndex + generated.length,
          rng: deriveRng(context.seed, "anchor", roundIndex),
        }),
      ]
    : generated;

  await withTransaction((tx) =>
    calibrationRepo.saveCandidates(actor, context.sessionId, candidates, context.deviceDpi, tx),
  );

  return {
    roundIndex,
    bracket,
    candidates,
    blockOrder: blockOrderFor(context, roundIndex, candidates.length),
  };
}

/**
 * The block order for a round, from a Latin square over the round's candidates.
 *
 * Each candidate occupies each position exactly once across a full cycle, so position effects —
 * warm-up early, fatigue late — cancel exactly rather than approximately (doc 13 §13.6).
 */
function blockOrderFor(
  context: CalibrationContext,
  roundIndex: number,
  candidateCount: number,
): readonly number[] {
  const square = latinSquare(candidateCount, deriveRng(context.seed, "counterbalance", 0));
  return square[roundIndex % square.length] ?? Array.from({ length: candidateCount }, (_, i) => i);
}

/** The sensitivity the anchor re-tests: the *centre* candidate of round 1. */
function anchorCounts(existing: readonly calibrationRepo.CandidateRow[]): number {
  const firstRound = existing.filter((candidate) => candidate.roundIndex === 0);
  const middle = firstRound[Math.floor(firstRound.length / 2)];
  return middle?.countsPer360 ?? firstRound[0]?.countsPer360 ?? 1;
}

export interface AnalysisOutcome {
  readonly result: CalibrationResult;
  /** Null when the search has stopped. */
  readonly nextBracket: SearchBracket | null;
}

/**
 * Analyses everything measured so far and records the round's decision.
 *
 * Re-derives the objective from stored trials, fits the drift model, fits the response surface,
 * bootstraps, and writes the audit trail. Pure computation over persisted facts — running it
 * again produces the same answer (`SENS-BR-030`).
 */
export async function analyseCalibration(
  actor: Actor,
  context: CalibrationContext,
  brackets: ReadonlyMap<number, SearchBracket>,
): Promise<AnalysisOutcome> {
  const session = await sessionRepo.getTestSession(actor, context.sessionId);
  if (session === null) throw notFound("session");

  const [observed, candidateRows] = await Promise.all([
    calibrationRepo.loadObservedTrials(context.sessionId),
    calibrationRepo.listCandidates(context.sessionId),
  ]);

  const objective = computeObjective(observed, { parameters: SCORING_PARAMS });

  const byRound = new Map<number, RoundInput>();
  for (const row of candidateRows) {
    const bracket = brackets.get(row.roundIndex) ?? bracketOf(0, 0);
    const entry = byRound.get(row.roundIndex) ?? {
      roundIndex: row.roundIndex,
      bracket,
      candidates: [],
      trials: [],
    };

    byRound.set(row.roundIndex, {
      ...entry,
      candidates: [
        ...entry.candidates,
        {
          roundIndex: row.roundIndex,
          candidateIndex: row.candidateIndex,
          x: toLogSensitivity(row.countsPer360),
          countsPer360: row.countsPer360 as never,
          blindLabel: row.blindLabel,
          source: "initial",
        },
      ],
    });
  }

  for (const trial of objective.trials) {
    const entry = byRound.get(trial.roundIndex);
    if (entry === undefined) continue;
    byRound.set(trial.roundIndex, { ...entry, trials: [...entry.trials, trial] });
  }

  const rounds = [...byRound.values()].sort((a, b) => a.roundIndex - b.roundIndex);
  const latestRound = rounds[rounds.length - 1];
  const bracket = latestRound?.bracket ?? bracketOf(0, 0);

  const input: CalibrationInput = {
    spec: specFor(context, bracket),
    params: CALIBRATION_PARAMS,
    rounds,
    minimumTrialsPerCandidate: minimumTrials(context.mode),
    deviceDpi: context.deviceDpi,
  };

  const result = runCalibration(input);

  // Persist every round's decision, so the whole search is auditable (FR-069).
  await withTransaction(async (tx) => {
    for (const round of result.rounds) {
      const analysed = analyseRound(input, round.roundIndex);
      await calibrationRepo.saveRoundResult(
        actor,
        context.sessionId,
        round,
        {
          value:
            round.fit?.vertexX === undefined
              ? null
              : ((round.fit?.vertexX ?? null) as number | null),
          low: analysed?.bootstrap.vertexInterval?.low ?? null,
          high: analysed?.bootstrap.vertexInterval?.high ?? null,
        },
        tx,
      );
    }
  });

  const last = result.rounds[result.rounds.length - 1];
  return { result, nextBracket: last?.nextBracket ?? null };
}

/** The per-candidate sample floor, taken from the most demanding scored test in the mode. */
function minimumTrials(mode: SessionMode): number {
  const minimums = CALIBRATION_PARAMS.minimumValidTrials;
  const scored = ["flick", "micro", "tracking", "switching", "precision"];
  const perTest = scored.map((key) => {
    const entry = minimums[key];
    if (entry === undefined) return 0;
    return mode === "advanced" ? entry.advanced : mode === "quick" ? entry.quick : entry.standard;
  });
  // Summed: a candidate's block runs every scored test, so its usable sample is the total across
  // them, not the largest single one.
  return perTest.reduce((sum, value) => sum + value, 0);
}

/** Re-exported for callers building a spec without importing the core module directly. */
export { constraintHighBound, logSensitivity };
