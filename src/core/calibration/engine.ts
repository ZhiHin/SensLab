import type { CalibrationParams } from "../params";
import { cmPer360FromCounts, countsPer360FromCm } from "../sensitivity/canonical";
import { countsPer360 } from "../types/brand";
import type { CalibrationDecision, CalibrationVerdict, DriftForm } from "../types/vocabulary";
import { bracketOf, toCountsPer360, toLogSensitivity } from "./bracket";
import type {
  AnchorRetestSummary,
  CalibrationResult,
  CalibrationRoundResult,
  CalibrationSpec,
  Candidate,
  CandidateEstimate,
  ScoredTrial,
  SearchBracket,
} from "./contracts";
import { fitDriftModel } from "./drift";
import { decideNextBracket } from "./response-surface";
import {
  anyPairDistinguishable,
  bootstrapPipeline,
  fitEnvelope,
  minimumDetectableEffect,
  type BootstrapOutcome,
} from "./significance";

/**
 * The calibration engine (doc 13).
 *
 * ## What it will not do
 *
 * It will not manufacture a peak. When the response is flat, or the candidates are
 * indistinguishable, or too few survived their sample minimums, it says so and returns a range
 * instead of a number (`SENS-BR-017`). A product that always produces a point recommendation is
 * a product that is lying some of the time, and the times it lies are exactly the times the
 * player would most benefit from knowing.
 *
 * ## Parameter-agnosticism
 *
 * Nothing here knows the parameter is a sensitivity. The engine optimises a scalar under a
 * supplied objective, which is what lets the same code run the post-MVP scope calibration with
 * no change beyond the domain and the constraint (doc 13 §13.12).
 */

export interface RoundInput {
  readonly roundIndex: number;
  readonly bracket: SearchBracket;
  readonly candidates: readonly Candidate[];
  /** Already-scored trials for this round, from the scoring pipeline. */
  readonly trials: readonly ScoredTrial[];
}

export interface CalibrationInput {
  readonly spec: CalibrationSpec;
  readonly params: CalibrationParams;
  readonly rounds: readonly RoundInput[];
  /** Minimum scorable trials for a candidate to enter the fit (`SENS-BR-012`). */
  readonly minimumTrialsPerCandidate: number;
  /** Session-level quality abort, decided outside the engine (doc 13 §13.10 condition 1). */
  readonly qualityAbort?: boolean;
  readonly deviceDpi: number;
}

/**
 * Analyses one round, given every round completed so far.
 *
 * Estimates are pooled across rounds, which is legitimate **only because `g(b)` has removed the
 * time effect**. Without the drift model this pooling would compare a warm player against a
 * tired one and call the difference a sensitivity preference.
 */
export function analyseRound(
  input: CalibrationInput,
  upToRound: number,
): {
  readonly result: CalibrationRoundResult;
  readonly estimates: readonly CandidateEstimate[];
  readonly bootstrap: BootstrapOutcome;
} | null {
  const rounds = input.rounds.filter((round) => round.roundIndex <= upToRound);
  const current = rounds[rounds.length - 1];
  if (current === undefined) return null;

  const trials = rounds.flatMap((round) => round.trials);
  const candidates = rounds.flatMap((round) => round.candidates);
  const candidateX = new Map(
    candidates.map((candidate) => [candidate.candidateIndex, candidate.x as number]),
  );

  const counts = new Map<number, number>();
  for (const trial of trials) {
    counts.set(trial.candidateIndex, (counts.get(trial.candidateIndex) ?? 0) + 1);
  }
  const excluded = new Set(
    candidates
      .filter(
        (candidate) =>
          (counts.get(candidate.candidateIndex) ?? 0) < input.minimumTrialsPerCandidate,
      )
      .map((candidate) => candidate.candidateIndex),
  );

  const fit = fitDriftModel({
    trials,
    candidateX,
    interiorKnots: input.params.drift.splineInteriorKnots,
    conditionNumberThreshold: input.params.drift.conditionNumberThreshold,
  });
  if (fit === null) return null;

  // A candidate below its minimum is excluded, never imputed. Estimating a candidate from too
  // few trials would give the fit a point it has not earned (`SENS-BR-012`).
  const estimates = fit.estimates.map((estimate) => ({
    ...estimate,
    insufficient: excluded.has(estimate.candidateIndex),
  }));

  const bootstrap = bootstrapPipeline({
    trials,
    candidateX,
    resamples: input.params.statistics.bootstrapResamples,
    interiorKnots: input.params.drift.splineInteriorKnots,
    conditionNumberThreshold: input.params.drift.conditionNumberThreshold,
    level: input.params.statistics.significanceLevel,
    seed: input.spec.seed,
    excluded,
  });

  const surface = decideNextBracket({
    estimates,
    bracket: current.bracket,
    domainLow: input.spec.domainLow as number,
    domainHigh: input.spec.domainHigh as number,
    constraintHigh: constraintHighX(input),
    narrowing: input.params.narrowing,
  });

  const mde = minimumDetectableEffect(estimates, input.params.statistics.significanceLevel);
  const decision = decideStop(input, {
    roundIndex: current.roundIndex,
    roundsComplete: rounds.length,
    bracket: surface.nextBracket,
    drift: fit.drift.deltaFirstToLast,
    driftForm: fit.drift.form,
    minimumDetectableEffect: mde,
    distinguishable: anyPairDistinguishable(bootstrap),
    usableCandidates: estimates.filter((estimate) => !estimate.insufficient).length,
    searchDecision: surface.decision,
  });

  return {
    result: {
      roundIndex: current.roundIndex,
      bracket: current.bracket,
      estimates,
      fit: surface.fit,
      drift: fit.drift,
      minimumDetectableEffect: mde,
      decision,
      nextBracket: decision.startsWith("stop") ? null : surface.nextBracket,
    },
    estimates,
    bootstrap,
  };
}

/**
 * The stopping conditions, checked in doc 13 §13.10's order.
 *
 * The order is load-bearing. Quality and fatigue come first because a session that was not
 * measuring properly should not be reported as converged; indistinguishability comes before
 * convergence because a narrow bracket around candidates nobody can tell apart is not a result.
 */
function decideStop(
  input: CalibrationInput,
  state: {
    readonly roundIndex: number;
    readonly roundsComplete: number;
    readonly bracket: SearchBracket;
    readonly drift: number;
    readonly driftForm: DriftForm;
    readonly minimumDetectableEffect: number;
    readonly distinguishable: boolean;
    readonly usableCandidates: number;
    readonly searchDecision: Extract<
      CalibrationDecision,
      "narrow" | "narrow_conservative" | "shift"
    >;
  },
): CalibrationDecision {
  if (input.qualityAbort === true) return "stop_quality";

  // Fatigue needs *evidence*, not just a large number. A drift term fitted on a very noisy
  // player is itself noisy, and an unconditioned threshold would tell an inconsistent player
  // "you were still warming up" — a confident explanation of something that did not happen.
  // So the drift must have been identified at all, and must exceed what this session could
  // actually have detected. Refines doc 13 §13.10 condition 2; recorded as a deviation.
  const driftIdentified = state.driftForm !== "none";
  const driftExceedsNoise =
    !Number.isFinite(state.minimumDetectableEffect) ||
    Math.abs(state.drift) > state.minimumDetectableEffect;
  if (
    driftIdentified &&
    driftExceedsNoise &&
    Math.abs(state.drift) > input.params.drift.abortDeltaScore
  ) {
    return "stop_fatigue";
  }

  // Two rounds required, so a merely underpowered first round does not end the session early.
  if (!state.distinguishable && state.roundsComplete >= 2) return "stop_indistinguishable";

  if (state.bracket.halfWidth <= input.params.narrowing.minHalfWidth) return "stop_converged";
  if (state.roundIndex + 1 >= input.spec.roundBudget) return "stop_budget";

  return state.searchDecision;
}

/**
 * The x above which the physical constraint forbids the search from going.
 *
 * The constraint is a *maximum* in centimetres. Counts and centimetres are proportional, so
 * that is also a maximum in counts, and therefore an **upper** bound on x. Getting the
 * direction wrong would cap the fast end instead and recommend the opposite of what the player
 * can physically execute.
 */
function constraintHighX(input: CalibrationInput): number | null {
  const maxCm = input.spec.constraint.maxCmPer360;
  if (maxCm === null || !Number.isFinite(maxCm)) return null;
  return toLogSensitivity(countsPer360FromCm(maxCm, input.deviceDpi)) as number;
}

/**
 * Runs the whole calibration over completed rounds and produces the final result.
 *
 * Pure and deterministic given `(rounds, spec, params)`: re-running it over stored trials must
 * reproduce the stored recommendation exactly (`SENS-BR-030`), which is the test that keeps the
 * "explainable forever" promise real.
 */
export function runCalibration(input: CalibrationInput): CalibrationResult {
  const roundResults: CalibrationRoundResult[] = [];
  let latest: { estimates: readonly CandidateEstimate[]; bootstrap: BootstrapOutcome } | null =
    null;

  for (const round of input.rounds) {
    const analysed = analyseRound(input, round.roundIndex);
    if (analysed === null) continue;
    roundResults.push(analysed.result);
    latest = { estimates: analysed.estimates, bootstrap: analysed.bootstrap };
    if (analysed.result.decision.startsWith("stop")) break;
  }

  const candidates = input.rounds.flatMap((round) => round.candidates);
  const last = roundResults[roundResults.length - 1];

  if (last === undefined || latest === null) {
    return insufficient(input, candidates, roundResults);
  }

  const usable = latest.estimates.filter((estimate) => !estimate.insufficient);
  // Fewer than three usable candidates cannot describe a curve, only an ordering.
  if (usable.length < 3) return insufficient(input, candidates, roundResults, last);

  const anchor = anchorRetest(input, latest.estimates);
  const distinguishable = anyPairDistinguishable(latest.bootstrap);
  const vertexX = last.fit?.concave === true ? last.fit.vertexX : null;

  // A peak is claimed only where it was measured. The same tolerance that turns a narrow into
  // a shift (doc 13 §13.8) applies to the verdict: a vertex beyond the measured span plus the
  // tolerance is the quadratic extrapolating, and a session that ran out of rounds while
  // shifting towards it has located a slope, not a peak.
  const span = usable.map((estimate) => estimate.x as number);
  const tolerance = input.params.narrowing.vertexClipFactor * (last.bracket.halfWidth as number);
  const spanLow = Math.min(...span) - tolerance;
  const spanHigh = Math.max(...span) + tolerance;
  const peakBeyondMeasured =
    vertexX === null ? null : vertexX < spanLow ? "below" : vertexX > spanHigh ? "above" : null;

  const peak =
    distinguishable &&
    vertexX !== null &&
    peakBeyondMeasured === null &&
    latest.bootstrap.vertexInterval !== null;

  const verdict: CalibrationVerdict = peak ? "peak_found" : "indistinguishable";
  const xStar = peak ? vertexX : null;

  return {
    verdict,
    xStar,
    countsPer360: xStar === null ? null : countsPer360(toCountsPer360(xStar)),
    credibleInterval: peak ? latest.bootstrap.vertexInterval : null,
    comfortRange: comfortRange(input, latest, last, xStar === null ? null : (xStar as number)),
    candidates,
    estimates: latest.estimates,
    rounds: roundResults,
    fit: last.fit,
    drift: last.drift,
    anchorRetest: anchor,
    minimumDetectableEffect: last.minimumDetectableEffect,
    fitBand: fitEnvelope(
      latest.bootstrap,
      measuredRange(usable),
      input.params.statistics.significanceLevel,
    ),
    peakBeyondMeasured,
    stopReason: last.decision,
    constraint: input.spec.constraint,
    seed: input.spec.seed,
    calibrationVersion: input.spec.calibrationVersion,
  };
}

/** The span of sensitivities actually measured, padded a little so the curve has margins. */
function measuredRange(estimates: readonly CandidateEstimate[]): {
  readonly low: number;
  readonly high: number;
} {
  const xs = estimates.map((estimate) => estimate.x as number);
  const low = Math.min(...xs);
  const high = Math.max(...xs);
  const pad = Math.max(0.05, (high - low) * 0.15);
  return { low: low - pad, high: high + pad };
}

/**
 * The comfort range (doc 16 §16.3): sensitivities whose fitted performance is statistically
 * indistinguishable from the peak.
 *
 * ```
 * comfortRange = { x : α̂(x*) − α̂(x) ≤ MDE }
 * ```
 *
 * For a concave quadratic the drop from the vertex is `|b₂|·(x − x*)²`, so the plateau is
 * `x* ± √(MDE / |b₂|)` in closed form. It is clipped to the span of sensitivities actually
 * measured — the plateau beyond the last candidate is extrapolation — and widened to contain
 * the high-performance interval, which doc 16 asserts as an invariant: "where the peak is"
 * can never be a broader claim than "what you can use".
 *
 * Because a response curve is flat near its maximum this is typically **wider** than the
 * credible interval on the peak, and it is usually the more actionable number. Without a
 * peak it is the span of candidates that could not be told apart, which is the only
 * sensitivity statement an indistinguishable session can make.
 */
function comfortRange(
  input: CalibrationInput,
  latest: { estimates: readonly CandidateEstimate[]; bootstrap: BootstrapOutcome },
  last: CalibrationRoundResult,
  xStar: number | null,
): { readonly lowCm360: number; readonly highCm360: number } {
  const usable = latest.estimates.filter((estimate) => !estimate.insufficient);
  const xs = usable.map((estimate) => estimate.x as number);
  const measuredLow = Math.min(...xs);
  const measuredHigh = Math.max(...xs);

  let low = measuredLow;
  let high = measuredHigh;

  const curvature = last.fit?.coefficients[2];
  const mde = last.minimumDetectableEffect;
  if (
    xStar !== null &&
    last.fit?.concave === true &&
    curvature !== undefined &&
    curvature < 0 &&
    Number.isFinite(mde) &&
    mde > 0
  ) {
    const halfWidth = Math.sqrt(mde / -curvature);
    low = Math.max(measuredLow, xStar - halfWidth);
    high = Math.min(measuredHigh, xStar + halfWidth);

    const interval = latest.bootstrap.vertexInterval;
    if (interval !== null) {
      low = Math.min(low, interval.low);
      high = Math.max(high, interval.high);
    }
  }

  // Both ranges are clipped by the physical constraint (doc 16 §16.3). Not by the search
  // domain: a candidate that was measured is a fact wherever it sat, and the constraint is
  // the only bound that says the player *cannot use* a value.
  const ceiling = constraintHighX(input);
  if (ceiling !== null && ceiling > low) high = Math.min(high, ceiling);

  const toCm = (x: number): number =>
    cmPer360FromCounts(countsPer360(toCountsPer360(x)), input.deviceDpi) as unknown as number;

  // Counts and centimetres run in the same direction, so the low end of x is the low end of
  // centimetres.
  return { lowCm360: toCm(low), highCm360: toCm(high) };
}

/** The anchor's re-test contrast: the same x measured early and late (doc 13 §13.5). */
function anchorRetest(
  input: CalibrationInput,
  estimates: readonly CandidateEstimate[],
): AnchorRetestSummary | null {
  const candidates = input.rounds.flatMap((round) => round.candidates);
  const anchor = candidates.find((candidate) => candidate.source === "anchor");
  if (anchor === undefined) return null;

  const anchorEstimate = estimates.find(
    (estimate) => estimate.candidateIndex === anchor.candidateIndex,
  );
  if (anchorEstimate === undefined) return null;

  // The original candidate at the same x, from an earlier round.
  const original = candidates.find(
    (candidate) =>
      candidate.source !== "anchor" &&
      Math.abs((candidate.x as number) - (anchor.x as number)) < 1e-9,
  );
  const originalEstimate =
    original === undefined
      ? undefined
      : estimates.find((estimate) => estimate.candidateIndex === original.candidateIndex);
  if (originalEstimate === undefined) return null;

  return {
    deltaScore: anchorEstimate.alphaHat - originalEstimate.alphaHat,
    standardError: Math.hypot(anchorEstimate.standardError, originalEstimate.standardError),
  };
}

/** The honest failure: not enough usable evidence to describe a response at all. */
function insufficient(
  input: CalibrationInput,
  candidates: readonly Candidate[],
  rounds: readonly CalibrationRoundResult[],
  last?: CalibrationRoundResult,
): CalibrationResult {
  const bracket = input.rounds[0]?.bracket ?? bracketOf(0, 0);
  const toCm = (x: number): number =>
    cmPer360FromCounts(countsPer360(toCountsPer360(x)), input.deviceDpi) as unknown as number;

  return {
    verdict: "insufficient_data",
    xStar: null,
    countsPer360: null,
    credibleInterval: null,
    comfortRange: {
      lowCm360: toCm(bracket.low as number),
      highCm360: toCm(bracket.high as number),
    },
    candidates,
    estimates: last?.estimates ?? [],
    rounds,
    fit: last?.fit ?? null,
    drift: last?.drift ?? {
      form: "linear_fallback",
      deltaFirstToLast: 0,
      conditionNumber: Number.POSITIVE_INFINITY,
    },
    anchorRetest: null,
    minimumDetectableEffect: last?.minimumDetectableEffect ?? Number.POSITIVE_INFINITY,
    fitBand: [],
    peakBeyondMeasured: null,
    stopReason: last?.decision ?? "stop_budget",
    constraint: input.spec.constraint,
    seed: input.spec.seed,
    calibrationVersion: input.spec.calibrationVersion,
  };
}
