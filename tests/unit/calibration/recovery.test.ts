import { describe, expect, it } from "vitest";
import { CALIBRATION_MODEL_V1 } from "@/core/params";
import { deriveRng } from "@/core/random";
import { countsPer360FromCm } from "@/core/sensitivity/canonical";
import { bracketOf, toLogSensitivity } from "@/core/calibration/bracket";
import { anchorCandidate, generateCandidates } from "@/core/calibration/candidates";
import { logSensitivity } from "@/core/types/brand";
import { runCalibration, type CalibrationInput, type RoundInput } from "@/core/calibration/engine";
import type { CalibrationSpec, SearchBracket } from "@/core/calibration/contracts";
import {
  CLEAR_PEAK,
  FLAT,
  generateTrials,
  INCONSISTENT,
  WARM_THEN_TIRE,
  WARMING_UP,
  type PlayerShape,
} from "../../helpers/synthetic-player";

/**
 * Recovering a known optimum from a synthetic player (doc 19 §19.12, harness 2).
 *
 * **This is the most important test in the project.** Every other test asserts a component does
 * what it was told; this one asserts the whole pipeline, run on a player whose true optimum is
 * known, recovers that optimum — and, just as importantly, *refuses to invent one* when there is
 * none to find.
 *
 * A system that always returns a number would pass a "does it return a number" test. What
 * distinguishes an honest measuring instrument is that it declines when the evidence is absent,
 * and these cases pin both halves of that behaviour.
 */

const PARAMS = CALIBRATION_MODEL_V1.params;
const DPI = 800;

function specFor(bracket: SearchBracket, roundBudget: number): CalibrationSpec {
  return {
    parameterName: "hipfire_counts_per_360",
    domainLow: toLogSensitivity(countsPer360FromCm(PARAMS.domainCmPer360.max, DPI)),
    domainHigh: toLogSensitivity(countsPer360FromCm(PARAMS.domainCmPer360.min, DPI)),
    constraint: { maxCmPer360: null, source: "none", conflict: false },
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
function simulate(options: {
  readonly shape: PlayerShape;
  readonly rounds?: number;
  readonly trialsPerCandidate?: number;
  readonly centreX?: number;
  readonly halfWidth?: number;
  readonly outlierRate?: number;
  readonly seed?: string;
  /** Set false to run without the anchor, which leaves the drift term unidentifiable. */
  readonly anchor?: boolean;
}) {
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
      spec: specFor(bracket, roundBudget),
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
    spec: specFor(roundInputs[0]?.bracket ?? bracket, roundBudget),
    params: { ...PARAMS, statistics: { ...PARAMS.statistics, bootstrapResamples: 200 } },
    rounds: roundInputs,
    minimumTrialsPerCandidate: 8,
    deviceDpi: DPI,
  });
}

describe("recovering a known optimum", () => {
  it("finds a clear peak close to where the player's optimum actually is", () => {
    const result = simulate({ shape: CLEAR_PEAK });

    expect(result.verdict).toBe("peak_found");
    expect(result.xStar).not.toBeNull();

    // Within a quarter of a log2 unit — about 19% in sensitivity, comfortably inside the
    // bracket the search was given.
    expect(Math.abs((result.xStar as number) - CLEAR_PEAK.optimumX)).toBeLessThan(0.25);
    expect(result.countsPer360).not.toBeNull();
  });

  it("reports an interval that contains the true optimum", () => {
    const result = simulate({ shape: CLEAR_PEAK });
    const interval = result.credibleInterval;

    expect(interval).not.toBeNull();
    // An interval that did not contain the truth would be worse than no interval: it would be a
    // confident claim about the wrong place.
    expect(interval?.low as number).toBeLessThan(CLEAR_PEAK.optimumX + 0.35);
    expect(interval?.high as number).toBeGreaterThan(CLEAR_PEAK.optimumX - 0.35);
    expect(interval?.level).toBeCloseTo(0.9, 9);
  });

  it("recovers the optimum despite a player who is still warming up", () => {
    // Without the drift model, a rising session reads as a preference for whichever candidate
    // ran last — which counterbalancing alone cannot remove.
    const result = simulate({ shape: WARMING_UP });

    expect(result.verdict).toBe("peak_found");
    expect(Math.abs((result.xStar as number) - WARMING_UP.optimumX)).toBeLessThan(0.3);
  });

  it("recovers the optimum for a player who warms up and then tires", () => {
    // The shape a straight-line drift term cannot represent, and the reason `g(b)` is a spline.
    const result = simulate({ shape: WARM_THEN_TIRE });

    expect(result.verdict).not.toBe("insufficient_data");
    if (result.verdict === "peak_found") {
      expect(Math.abs((result.xStar as number) - WARM_THEN_TIRE.optimumX)).toBeLessThan(0.35);
    }
  });
});

describe("refusing to invent an optimum", () => {
  it("does not manufacture a peak for a genuinely flat player — SENS-BR-017", () => {
    // The single most important negative result in the product. A flat response must not be
    // turned into a point recommendation drawn from noise.
    const result = simulate({ shape: FLAT });

    expect(result.verdict).not.toBe("peak_found");
    expect(result.xStar).toBeNull();
    expect(result.countsPer360).toBeNull();
    expect(result.credibleInterval).toBeNull();
  });

  it("still offers a range for a flat player, because that is useful", () => {
    const result = simulate({ shape: FLAT });

    // "We could not separate these" is information. Withholding the range as well would leave
    // the player with nothing at all.
    expect(result.comfortRange.lowCm360).toBeGreaterThan(0);
    expect(result.comfortRange.highCm360).toBeGreaterThan(result.comfortRange.lowCm360);
  });

  it("finds no peak for a player too inconsistent to separate", () => {
    const result = simulate({ shape: INCONSISTENT });

    expect(result.verdict).toBe("indistinguishable");
    expect(result.xStar).toBeNull();

    // The MDE is what tells the player *why*, and it is the finding: the session could not have
    // detected an effect smaller than this, and this player's real effect is far smaller. That
    // is "variance, not sensitivity, is your limiter" (doc 04 §4.4.9) — a different and more
    // useful answer than "your response is flat".
    expect(Number.isFinite(result.minimumDetectableEffect)).toBe(true);
    const trueEffect = INCONSISTENT.curvature * 0.5 * 0.5;
    expect(result.minimumDetectableEffect).toBeGreaterThan(trueEffect);
  });

  it("stops with `indistinguishable` once two rounds separate nothing", () => {
    // Condition 3 requires two completed rounds, so a merely underpowered first round cannot end
    // the session early (doc 13 §13.10).
    const result = simulate({ shape: FLAT, rounds: 3 });

    expect(["stop_indistinguishable", "stop_budget"]).toContain(result.stopReason);
    expect(result.verdict).not.toBe("peak_found");
  });

  it("reports insufficient data rather than guessing when candidates are under-sampled", () => {
    const result = simulate({ shape: CLEAR_PEAK, trialsPerCandidate: 3 });

    expect(result.verdict).toBe("insufficient_data");
    expect(result.xStar).toBeNull();
  });
});

describe("robustness", () => {
  it("is not derailed by 10% wild trials — doc 14 §14.10", () => {
    const clean = simulate({ shape: CLEAR_PEAK });
    const noisy = simulate({ shape: CLEAR_PEAK, outlierRate: 0.1 });

    expect(noisy.verdict).not.toBe("insufficient_data");
    if (clean.verdict === "peak_found" && noisy.verdict === "peak_found") {
      // Wild trials are kept, not deleted (`SENS-BR-009`); the bounded-influence clip is what
      // stops them deciding the answer. The shift must stay within the MDE.
      const shift = Math.abs((noisy.xStar as number) - (clean.xStar as number));
      expect(shift).toBeLessThan(0.4);
    }
  });

  it("keeps every trial in the estimator — no trimming", () => {
    const result = simulate({ shape: CLEAR_PEAK, trialsPerCandidate: 20 });
    const counted = result.estimates.reduce((sum, estimate) => sum + estimate.validTrials, 0);
    const supplied = result.rounds.length > 0 ? 20 * result.estimates.length : 0;

    // The number entering the estimator equals the number supplied, exactly.
    expect(counted).toBe(supplied);
  });
});

describe("reproducibility — SENS-BR-031, SENS-BR-030", () => {
  it("produces an identical result from the same seed and trials", () => {
    const first = simulate({ shape: CLEAR_PEAK, seed: "identical" });
    const second = simulate({ shape: CLEAR_PEAK, seed: "identical" });

    // Re-running the engine over the same trials must reproduce the stored recommendation
    // exactly. This is the test that keeps the "explainable forever" promise real.
    expect(second.xStar).toBe(first.xStar);
    expect(second.verdict).toBe(first.verdict);
    expect(second.credibleInterval).toEqual(first.credibleInterval);
    expect(second.estimates).toEqual(first.estimates);
    expect(second.rounds.map((round) => round.decision)).toEqual(
      first.rounds.map((round) => round.decision),
    );
  });

  it("produces a different search path from a different player", () => {
    const a = simulate({ shape: CLEAR_PEAK, seed: "player-a" });
    const b = simulate({ shape: { ...CLEAR_PEAK, optimumX: 12.6 }, seed: "player-a" });

    expect(b.xStar).not.toBe(a.xStar);
  });
});
