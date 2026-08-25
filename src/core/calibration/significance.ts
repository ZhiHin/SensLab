import { deriveRng, type Rng } from "../random";
import { median, normalQuantile, percentileInterval, zForLevel } from "../statistics";
import type { CandidateEstimate, CredibleInterval, ScoredTrial } from "./contracts";
import { fitDriftModel } from "./drift";
import { fitResponseSurface } from "./response-surface";

/**
 * Distinguishability, the bootstrap and the minimum detectable effect (doc 13 §13.9).
 *
 * ## Why the bootstrap refits the whole pipeline
 *
 * Each resample re-runs the drift model *and* the quadratic, not just the final step. Only that
 * propagates every source of estimation uncertainty into `x*`. A bootstrap that resampled the
 * candidate estimates while treating the drift fit as fixed would report an interval far too
 * narrow, and the product would present a confident range it had not earned.
 *
 * ## Why trials, not blocks
 *
 * The trial is the independent replicate. Block-level resampling would be preferable in
 * principle, but with three or four blocks per candidate it has almost no resolution — it would
 * produce an interval determined by which of four blocks were drawn.
 *
 * ## Why 90% and not 95%
 *
 * This is a **decision procedure with a symmetric cost of error**, not a hypothesis test
 * guarding against a false discovery in the literature. Demanding 95% here would systematically
 * bias the product toward "we could not tell" — an answer that is honest when true and cowardly
 * when not.
 */

export interface BootstrapInput {
  readonly trials: readonly ScoredTrial[];
  readonly candidateX: ReadonlyMap<number, number>;
  readonly resamples: number;
  readonly interiorKnots: number;
  readonly conditionNumberThreshold: number;
  readonly level: number;
  readonly seed: bigint;
  /** Candidates excluded for insufficient samples, so a resample cannot reinstate them. */
  readonly excluded: ReadonlySet<number>;
}

export interface BootstrapOutcome {
  /** Bootstrap distribution of the fitted vertex, ascending. Empty when never concave. */
  readonly vertexSamples: readonly number[];
  /** Credible interval on `x*`, or null when too few resamples produced a concave fit. */
  readonly vertexInterval: CredibleInterval | null;
  /** Fraction of resamples whose fit was concave — a direct measure of peak evidence. */
  readonly concaveFraction: number;
  /**
   * Credible interval on the quadratic coefficient `b₂` — the curvature itself.
   *
   * Doc 13 §13.9 calls two candidates distinguishable when the bootstrap interval on their
   * difference excludes zero. This is that same rule applied to the quantity a peak verdict
   * asserts: that the response *bends*. An interval containing zero means the data are
   * consistent with a flat response whatever shape the single point estimate happened to take.
   *
   * Consumed from `calibration_model_v3` onward; see that set for the measured effect.
   * Null when no resample produced a surface at all.
   */
  readonly curvatureInterval: CredibleInterval | null;
  /** Per-pair differences: `key = "i:j"`, value = the resampled distribution's interval. */
  readonly pairIntervals: ReadonlyMap<string, CredibleInterval>;
  readonly resamplesUsed: number;
  /**
   * The quadratic coefficients of every resample that produced a surface, concave or not.
   *
   * Retained so the response curve can show the bootstrap *envelope* of the fit — the soft
   * band doc 25 §25.9 draws around the curve — without re-running the bootstrap.
   */
  readonly surfaceSamples: readonly (readonly number[])[];
}

/** Groups trials by candidate so a resample draws within candidate, not across the session. */
function groupByCandidate(
  trials: readonly ScoredTrial[],
): ReadonlyMap<number, readonly ScoredTrial[]> {
  const grouped = new Map<number, ScoredTrial[]>();
  for (const trial of trials) {
    const list = grouped.get(trial.candidateIndex) ?? [];
    list.push(trial);
    grouped.set(trial.candidateIndex, list);
  }
  return grouped;
}

/** Draws one resample: trials within each candidate, with replacement. */
function resample(
  grouped: ReadonlyMap<number, readonly ScoredTrial[]>,
  rng: Rng,
): readonly ScoredTrial[] {
  const out: ScoredTrial[] = [];
  for (const trials of grouped.values()) {
    for (let i = 0; i < trials.length; i += 1) {
      out.push(trials[rng.nextInt(trials.length)] as ScoredTrial);
    }
  }
  return out;
}

export function bootstrapPipeline(input: BootstrapInput): BootstrapOutcome {
  const grouped = groupByCandidate(input.trials);
  const vertexSamples: number[] = [];
  const surfaceSamples: (readonly number[])[] = [];
  const pairSamples = new Map<string, number[]>();
  let concave = 0;
  let used = 0;

  for (let draw = 0; draw < input.resamples; draw += 1) {
    // A separate stream per resample rather than one long stream: adding a resample must not
    // shift the draws of the ones before it, or the bootstrap would not be reproducible when the
    // resample count changed.
    const rng = deriveRng(input.seed, "calibration-bootstrap", draw);
    const drawn = resample(grouped, rng);

    const fit = fitDriftModel({
      trials: drawn,
      candidateX: input.candidateX,
      interiorKnots: input.interiorKnots,
      conditionNumberThreshold: input.conditionNumberThreshold,
    });
    if (fit === null) continue;

    used += 1;

    const estimates = fit.estimates.map((estimate) => ({
      ...estimate,
      insufficient: input.excluded.has(estimate.candidateIndex),
    }));

    for (let i = 0; i < estimates.length; i += 1) {
      for (let j = i + 1; j < estimates.length; j += 1) {
        const a = estimates[i] as CandidateEstimate;
        const b = estimates[j] as CandidateEstimate;
        if (a.insufficient || b.insufficient) continue;
        const key = `${a.candidateIndex}:${b.candidateIndex}`;
        const list = pairSamples.get(key) ?? [];
        list.push(a.alphaHat - b.alphaHat);
        pairSamples.set(key, list);
      }
    }

    const surface = fitResponseSurface(estimates);
    if (surface !== null) surfaceSamples.push(surface.coefficients);
    if (surface?.concave === true && surface.vertexX !== null) {
      concave += 1;
      vertexSamples.push(surface.vertexX as number);
    }
  }

  vertexSamples.sort((a, b) => a - b);

  const pairIntervals = new Map<string, CredibleInterval>();
  for (const [key, samples] of pairSamples) {
    const sorted = [...samples].sort((a, b) => a - b);
    const interval = percentileInterval(sorted, median(sorted), input.level);
    pairIntervals.set(key, { low: interval.low, high: interval.high, level: input.level });
  }

  // An interval drawn from a handful of concave resamples would be noise wearing a number. If
  // fewer than a fifth of resamples found a peak, there is no peak to put an interval around.
  const vertexInterval =
    used > 0 && vertexSamples.length >= Math.max(20, used * 0.2)
      ? (() => {
          const interval = percentileInterval(vertexSamples, median(vertexSamples), input.level);
          return { low: interval.low, high: interval.high, level: input.level };
        })()
      : null;

  // The curvature interval comes from the same resamples as everything else, so it cannot
  // disagree with the vertex interval about what the bootstrap saw.
  const curvatures = surfaceSamples.map((c) => c[2] as number).sort((a, b) => a - b);
  const curvatureInterval =
    curvatures.length === 0
      ? null
      : (() => {
          const i = percentileInterval(curvatures, median(curvatures), input.level);
          return { low: i.low, high: i.high, level: input.level };
        })();

  return {
    vertexSamples,
    vertexInterval,
    curvatureInterval,
    concaveFraction: used === 0 ? 0 : concave / used,
    pairIntervals,
    resamplesUsed: used,
    surfaceSamples,
  };
}

export interface FitBandPoint {
  readonly x: number;
  readonly low: number;
  readonly high: number;
}

/**
 * Samples the bootstrap fit envelope across a range of x.
 *
 * At each x the band is the credible interval of the resampled surfaces' values there. It is
 * not a confidence band on the *peak* — that is `vertexInterval` — but on the curve itself,
 * and it is what makes a flat result look flat rather than merely unlabelled.
 */
export function fitEnvelope(
  outcome: BootstrapOutcome,
  range: { readonly low: number; readonly high: number },
  level: number,
  points = 41,
): readonly FitBandPoint[] {
  if (outcome.surfaceSamples.length < 20 || !(range.high > range.low)) return [];
  const out: FitBandPoint[] = [];
  for (let i = 0; i < points; i += 1) {
    const x = range.low + ((range.high - range.low) * i) / (points - 1);
    const values = outcome.surfaceSamples
      .map((c) => (c[0] ?? 0) + (c[1] ?? 0) * x + (c[2] ?? 0) * x * x)
      .sort((a, b) => a - b);
    const interval = percentileInterval(values, median(values), level);
    out.push({ x, low: interval.low, high: interval.high });
  }
  return out;
}

/**
 * Whether any pair of candidates is distinguishable at the configured level.
 *
 * "Distinguishable" means the bootstrap interval on the *difference* excludes zero. This is the
 * condition that separates the two answers a naive system conflates: **"these sensitivities are
 * genuinely equivalent"** and **"we could not tell"**.
 */
export function anyPairDistinguishable(outcome: BootstrapOutcome): boolean {
  for (const interval of outcome.pairIntervals.values()) {
    if (interval.low > 0 || interval.high < 0) return true;
  }
  return false;
}

/**
 * The minimum detectable effect: the smallest candidate difference the achieved sample size
 * could have found at 80% power.
 *
 * ```
 * MDE = (z_{1−α/2} + z_{0.80}) × SE(difference)
 * ```
 *
 * Reported so a flat result can be read properly. Without it, "no difference found" is
 * ambiguous between a genuinely flat response and a session too short to see one.
 */
export function minimumDetectableEffect(
  estimates: readonly CandidateEstimate[],
  level: number,
): number {
  const usable = estimates.filter(
    (estimate) => !estimate.insufficient && Number.isFinite(estimate.standardError),
  );
  if (usable.length < 2) return Number.POSITIVE_INFINITY;

  // The typical pairwise standard error: the pooled SE of a difference between two candidates
  // measured with the median precision achieved this session.
  const errors = usable.map((estimate) => estimate.standardError).sort((a, b) => a - b);
  const middle = errors[Math.floor(errors.length / 2)] as number;
  const differenceSe = Math.sqrt(2) * middle;

  const zAlpha = zForLevel(level);
  const zPower = normalQuantile(0.8);
  return (zAlpha + zPower) * differenceSe;
}
