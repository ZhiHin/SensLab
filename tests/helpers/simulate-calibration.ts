import { CALIBRATION_MODEL_V1 } from "@/core/params";
import { deriveRng } from "@/core/random";
import { countsPer360FromCm } from "@/core/sensitivity/canonical";
import { bracketOf, toLogSensitivity } from "@/core/calibration/bracket";
import { anchorCandidate, generateCandidates } from "@/core/calibration/candidates";
import { logSensitivity } from "@/core/types/brand";
import { runCalibration, type CalibrationInput, type RoundInput } from "@/core/calibration/engine";
import type { CalibrationSpec, SearchBracket } from "@/core/calibration/contracts";
import { generateTrials, type PlayerShape } from "./synthetic-player";

/**
 * A whole simulated calibration: generate candidates, have the synthetic player produce
 * trials, analyse, narrow, repeat. The real search loop, not a re-implementation of it —
 * shared by the recovery suite and the recommendation assembly tests.
 */

const PARAMS = CALIBRATION_MODEL_V1.params;
const DPI = 800;

function specFor(
  bracket: SearchBracket,
  roundBudget: number,
  maxCmPer360: number | null,
): CalibrationSpec {
  return {
    parameterName: "hipfire_counts_per_360",
    domainLow: toLogSensitivity(countsPer360FromCm(PARAMS.domainCmPer360.max, DPI)),
    domainHigh: toLogSensitivity(countsPer360FromCm(PARAMS.domainCmPer360.min, DPI)),
    constraint:
      maxCmPer360 === null
        ? { maxCmPer360: null, source: "none", conflict: false }
        : { maxCmPer360, source: "pad_width", conflict: false },
    initialCentre: bracket.centre,
    initialHalfWidth: bracket.halfWidth,
    candidatesPerRound: 3,
    roundBudget,
    mode: "standard",
    seed: 20260822n,
    calibrationVersion: CALIBRATION_MODEL_V1.version,
  };
}

/**
 * Runs a whole simulated session: generate candidates, have the player produce trials, analyse,
 * narrow, repeat. This is the real search loop, not a re-implementation of it.
 */
export function simulate(options: {
  readonly shape: PlayerShape;
  readonly rounds?: number;
  readonly trialsPerCandidate?: number;
  readonly centreX?: number;
  readonly halfWidth?: number;
  readonly outlierRate?: number;
  readonly seed?: string;
  /** Set false to run without the anchor, which leaves the drift term unidentifiable. */
  readonly anchor?: boolean;
  /** A pad-width ceiling on cm/360, which clips the comfort range but never the search. */
  readonly maxCmPer360?: number;
}) {
  const maxCmPer360 = options.maxCmPer360 ?? null;
  const roundBudget = options.rounds ?? 3;
  const trialsPerCandidate = options.trialsPerCandidate ?? 24;
  const seed = options.seed ?? "recovery";

  const startCentre = options.centreX ?? 13.0;
  let bracket = bracketOf(startCentre, options.halfWidth ?? 0.5);
  const roundInputs: RoundInput[] = [];
  let nextCandidateIndex = 0;
  let block = 0;

  for (let roundIndex = 0; roundIndex < roundBudget; roundIndex += 1) {
    const generated = generateCandidates({
      bracket,
      roundIndex,
      count: 3,
      source: roundIndex === 0 ? "initial" : "narrowed",
      rng: deriveRng(seed, "labels", roundIndex),
      startIndex: nextCandidateIndex,
    });
    nextCandidateIndex += generated.length;

    // The anchor re-tests the round-1 centre in the final round. It is the only candidate that
    // shares an x with an earlier block, and that shared level measured at two widely separated
    // times is the entire mechanism by which the drift term becomes identifiable (doc 13 §13.5).
    const withAnchor =
      options.anchor !== false && roundIndex === roundBudget - 1 && roundBudget > 1;
    const candidates = withAnchor
      ? [
          ...generated,
          anchorCandidate({
            x: logSensitivity(startCentre),
            roundIndex,
            candidateIndex: nextCandidateIndex,
            rng: deriveRng(seed, "anchor", roundIndex),
          }),
        ]
      : generated;
    if (withAnchor) nextCandidateIndex += 1;

    const blockOf = new Map<number, number>();
    for (const candidate of candidates) {
      blockOf.set(candidate.candidateIndex, block);
      block += 1;
    }

    const trials = generateTrials({
      shape: options.shape,
      candidates: candidates.map((candidate) => ({
        candidateIndex: candidate.candidateIndex,
        x: candidate.x as number,
      })),
      trialsPerCandidate,
      blockOf: (index) => blockOf.get(index) ?? 0,
      roundIndex,
      seed,
      ...(options.outlierRate === undefined ? {} : { outlierRate: options.outlierRate }),
    });

    roundInputs.push({ roundIndex, bracket, candidates, trials });

    const input: CalibrationInput = {
      spec: specFor(bracket, roundBudget, maxCmPer360),
      params: { ...PARAMS, statistics: { ...PARAMS.statistics, bootstrapResamples: 200 } },
      rounds: roundInputs,
      minimumTrialsPerCandidate: 8,
      deviceDpi: DPI,
    };

    const partial = runCalibration(input);
    const last = partial.rounds[partial.rounds.length - 1];
    if (last?.nextBracket == null) break;
    bracket = last.nextBracket;
  }

  return runCalibration({
    spec: specFor(roundInputs[0]?.bracket ?? bracket, roundBudget, maxCmPer360),
    params: { ...PARAMS, statistics: { ...PARAMS.statistics, bootstrapResamples: 200 } },
    rounds: roundInputs,
    minimumTrialsPerCandidate: 8,
    deviceDpi: DPI,
  });
}
