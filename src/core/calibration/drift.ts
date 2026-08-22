import { quantile, solveLinearSystem } from "../statistics";
import type { DriftForm } from "../types/vocabulary";
import type { CandidateEstimate, DriftModelSummary, ScoredTrial } from "./contracts";
import { logSensitivity } from "../types/brand";

/**
 * The drift model: separating the candidate effect from learning and fatigue (doc 13 §13.7).
 *
 * ```
 * y_t = μ + α_i + g(b_t) + ε_t
 * ```
 *
 * ## Why this is not optional
 *
 * A player's performance changes over a twenty-minute session — they warm up, they learn, they
 * tire. Left unmodelled, that drift is **confounded with candidate order**, and counterbalancing
 * alone removes only its *average* effect, not its contribution to variance. Without `g(b)` the
 * search would read a warm-up as a preference for whichever sensitivity happened to run last.
 *
 * ## Why `g` is not forced monotone
 *
 * Real sessions warm up *and then* fatigue. A monotone drift term would fit a rising session and
 * a falling one, but not the common shape that does both — and it would push the difference into
 * `α`, which is exactly the term it must not touch.
 *
 * ## The honest caveat
 *
 * Later rounds test a narrower sensitivity range *and* occur later in time, so drift and round
 * are partially confounded. The design is identified primarily from within-round contrasts and
 * from the anchor candidate, which is the same *x* at two widely separated times. When the design
 * becomes ill-conditioned the model falls back to a straight line and says so, and the confidence
 * model applies a penalty. This is a real limitation of a single-session design; it is recorded
 * rather than papered over.
 */

export interface DriftFitInput {
  readonly trials: readonly ScoredTrial[];
  /** Candidate index → the x it was run at. */
  readonly candidateX: ReadonlyMap<number, number>;
  readonly interiorKnots: number;
  /** Above this design condition estimate, fall back to a linear drift. */
  readonly conditionNumberThreshold: number;
}

export interface DriftFitResult {
  readonly estimates: readonly CandidateEstimate[];
  readonly drift: DriftModelSummary;
  /** Residual standard deviation, used for the minimum detectable effect. */
  readonly residualSd: number;
  /** Number of trials that entered the estimator. */
  readonly usedTrials: number;
}

/**
 * Fits the model by weighted least squares.
 *
 * Every scorable trial enters exactly once — no trimming, no imputation. A candidate with too
 * few trials is excluded by the caller (`SENS-BR-012`) rather than estimated from nothing.
 */
export function fitDriftModel(input: DriftFitInput): DriftFitResult | null {
  const candidates = [...new Set(input.trials.map((trial) => trial.candidateIndex))].sort(
    (a, b) => a - b,
  );
  if (candidates.length < 2 || input.trials.length < candidates.length + 2) return null;

  const blocks = input.trials.map((trial) => trial.blockIndex);
  const meanBlock = blocks.reduce((sum, block) => sum + block, 0) / blocks.length;

  const attempt = (form: DriftForm): (DriftFitResult & { pivotRatio: number }) | null => {
    const basis =
      form === "none"
        ? []
        : form === "spline"
          ? splineBasis(blocks, input.interiorKnots)
          : linearBasis();
    return solveModel(input.trials, candidates, basis, meanBlock, form, input.candidateX);
  };

  // A drift term is only identifiable when some sensitivity was measured in more than one
  // block — which is precisely the job of the anchor candidate (doc 13 §13.5). Within a single
  // round every candidate occupies exactly one block, so α and g are perfectly confounded and
  // fitting a drift term would be fitting noise with a straight face.
  if (identifiable(input)) {
    const spline = input.interiorKnots > 0 ? attempt("spline") : null;
    if (spline !== null && spline.pivotRatio <= input.conditionNumberThreshold) {
      return stripPivot(spline);
    }

    // The spline design was ill-conditioned. A straight line is a weaker model, and recording
    // which one ran is what lets the confidence model price the difference.
    const linear = attempt("linear_fallback");
    if (linear !== null && linear.pivotRatio <= input.conditionNumberThreshold) {
      return stripPivot(linear);
    }
  }

  const none = attempt("none");
  return none === null ? null : stripPivot(none);
}

/**
 * Whether a drift term can be separated from the candidate effects at all.
 *
 * True when at least one x was measured across more than one block. Without that the design is
 * exactly collinear: with N candidates in N blocks and a bijection between them, no amount of
 * arithmetic can say whether a late block scored well because of its sensitivity or because of
 * when it ran.
 */
function identifiable(input: DriftFitInput): boolean {
  const blocksPerLevel = new Map<string, Set<number>>();
  for (const trial of input.trials) {
    const level = levelKey(input.candidateX.get(trial.candidateIndex) ?? Number.NaN);
    const blocks = blocksPerLevel.get(level) ?? new Set<number>();
    blocks.add(trial.blockIndex);
    blocksPerLevel.set(level, blocks);
  }
  for (const blocks of blocksPerLevel.values()) if (blocks.size > 1) return true;
  return false;
}

/**
 * Groups candidates by the sensitivity they ran at.
 *
 * The anchor candidate is a *different candidate index* at the *same x* as the round-1 centre.
 * Keying the candidate effect by x rather than by index is what lets those two share a level —
 * and that shared level, measured at two widely separated times, is the whole mechanism by
 * which the anchor identifies the drift term (doc 13 §13.5).
 */
function levelKey(x: number): string {
  return Number.isFinite(x) ? x.toFixed(9) : "unknown";
}

function stripPivot(result: DriftFitResult & { pivotRatio: number }): DriftFitResult {
  const { estimates, drift, residualSd, usedTrials } = result;
  return { estimates, drift, residualSd, usedTrials };
}

/** A drift basis: functions of block index, excluding the intercept. */
type Basis = readonly ((block: number) => number)[];

function linearBasis(): Basis {
  return [(block) => block];
}

/**
 * Natural cubic spline basis (ESL §5.2.1), excluding the intercept.
 *
 * Knots are placed at the observed block range's ends plus interior quantiles, so the basis
 * adapts to however many blocks the session actually ran. A natural spline is used rather than a
 * plain cubic because it is **linear beyond the boundary knots** — which stops the drift term
 * making wild claims about the start and end of the session, where there is least data.
 */
function splineBasis(blocks: readonly number[], interiorKnots: number): Basis {
  const sorted = [...blocks].sort((a, b) => a - b);
  const low = sorted[0] as number;
  const high = sorted[sorted.length - 1] as number;

  const interior: number[] = [];
  for (let i = 1; i <= interiorKnots; i += 1) {
    interior.push(quantile(sorted, i / (interiorKnots + 1)));
  }

  const knots = [low, ...interior, high].filter(
    (knot, index, all) => index === 0 || knot > (all[index - 1] as number),
  );

  // With fewer than three distinct knots a natural cubic spline *is* a straight line, so the
  // basis degenerates to the linear one rather than producing collinear columns.
  if (knots.length < 3) return linearBasis();

  const last = knots[knots.length - 1] as number;
  const secondLast = knots[knots.length - 2] as number;

  const cube = (value: number): number => (value > 0 ? value ** 3 : 0);
  const d = (knot: number) => (block: number) =>
    (cube(block - knot) - cube(block - last)) / (last - knot);

  const basis: ((block: number) => number)[] = [(block) => block];
  for (let k = 0; k < knots.length - 2; k += 1) {
    const dk = d(knots[k] as number);
    const dLast = d(secondLast);
    basis.push((block) => dk(block) - dLast(block));
  }

  return basis;
}

function solveModel(
  trials: readonly ScoredTrial[],
  candidates: readonly number[],
  basis: Basis,
  meanBlock: number,
  form: DriftForm,
  candidateX: ReadonlyMap<number, number>,
): (DriftFitResult & { pivotRatio: number }) | null {
  // Levels are sensitivities, not candidate instances — see `levelKey`.
  const levels = [
    ...new Set(candidates.map((index) => levelKey(candidateX.get(index) ?? Number.NaN))),
  ];
  const levelOf = (candidateIndex: number): number =>
    levels.indexOf(levelKey(candidateX.get(candidateIndex) ?? Number.NaN));

  const levelColumns = levels.length - 1;
  if (levelColumns < 1) return null;

  const columns = 1 + levelColumns + basis.length;
  if (trials.length <= columns) return null;

  // Sum-to-zero (effect) coding, which is the identifiability constraint doc 13 §13.7
  // specifies: the last level's effect is minus the sum of the others.
  const design: number[][] = trials.map((trial) => {
    const row = new Array<number>(columns).fill(0);
    row[0] = 1;

    const level = levelOf(trial.candidateIndex);
    if (level < levelColumns) row[1 + level] = 1;
    else for (let j = 0; j < levelColumns; j += 1) row[1 + j] = -1;

    // Centred at the mean block so that g(b̄) = 0 exactly, which is what makes μ the session
    // mean rather than an arbitrary offset.
    basis.forEach((fn, index) => {
      row[1 + levelColumns + index] = fn(trial.blockIndex) - fn(meanBlock);
    });

    return row;
  });

  const y = trials.map((trial) => trial.score);
  const normal = normalEquations(design, y);
  const solved = solveLinearSystem(normal.xtx, normal.xty);
  if (solved === null) return null;

  const beta = solved.solution;
  const residuals = design.map(
    (row, index) =>
      (y[index] as number) - row.reduce((sum, value, j) => sum + value * (beta[j] as number), 0),
  );
  const degreesOfFreedom = trials.length - columns;
  const residualVariance =
    residuals.reduce((sum, residual) => sum + residual * residual, 0) / degreesOfFreedom;

  // Standard errors from the diagonal of (X'X)⁻¹σ², obtained by solving against unit vectors.
  const variances = diagonalOfInverse(normal.xtx).map((value) => value * residualVariance);

  const levelAlpha = levels.map((_, position) =>
    position < levelColumns
      ? (beta[1 + position] as number)
      : -sumOf(beta.slice(1, 1 + levelColumns)),
  );

  const levelSe = levels.map((_, position) => {
    if (position < levelColumns) return Math.sqrt(Math.max(variances[1 + position] ?? 0, 0));
    // The omitted level's variance is that of the negated sum. Without the full covariance
    // matrix this is an upper bound rather than the exact value — the conservative direction
    // for a confidence claim, which is the direction to err in.
    const total = variances.slice(1, 1 + levelColumns).reduce((sum, value) => sum + value, 0);
    return Math.sqrt(Math.max(total, 0));
  });

  const counts = new Map<number, number>();
  for (const trial of trials) {
    counts.set(trial.candidateIndex, (counts.get(trial.candidateIndex) ?? 0) + 1);
  }

  const estimates: CandidateEstimate[] = candidates.map((candidateIndex) => {
    const level = levelOf(candidateIndex);
    return {
      candidateIndex,
      roundIndex: trials.find((trial) => trial.candidateIndex === candidateIndex)?.roundIndex ?? 0,
      x: logSensitivity(candidateX.get(candidateIndex) ?? Number.NaN),
      alphaHat: levelAlpha[level] as number,
      standardError: levelSe[level] as number,
      validTrials: counts.get(candidateIndex) ?? 0,
      insufficient: false,
    };
  });

  const driftAt = (block: number): number =>
    basis.reduce(
      (sum, fn, index) =>
        sum + (beta[1 + levelColumns + index] as number) * (fn(block) - fn(meanBlock)),
      0,
    );

  const sortedBlocks = [...trials.map((trial) => trial.blockIndex)].sort((a, b) => a - b);
  const firstBlock = sortedBlocks[0] as number;
  const lastBlock = sortedBlocks[sortedBlocks.length - 1] as number;

  return {
    estimates,
    drift: {
      form,
      deltaFirstToLast: driftAt(lastBlock) - driftAt(firstBlock),
      conditionNumber: solved.pivotRatio,
    },
    residualSd: Math.sqrt(Math.max(residualVariance, 0)),
    usedTrials: trials.length,
    pivotRatio: solved.pivotRatio,
  };
}

function normalEquations(
  design: readonly (readonly number[])[],
  y: readonly number[],
): { xtx: number[][]; xty: number[] } {
  const columns = (design[0] ?? []).length;
  const xtx: number[][] = Array.from({ length: columns }, () => new Array<number>(columns).fill(0));
  const xty = new Array<number>(columns).fill(0);

  for (let t = 0; t < design.length; t += 1) {
    const row = design[t] as readonly number[];
    const target = y[t] as number;
    for (let i = 0; i < columns; i += 1) {
      const rowI = row[i] as number;
      xty[i] = (xty[i] as number) + rowI * target;
      const xtxRow = xtx[i] as number[];
      for (let j = 0; j < columns; j += 1) {
        xtxRow[j] = (xtxRow[j] as number) + rowI * (row[j] as number);
      }
    }
  }

  return { xtx, xty };
}

/** Diagonal of the inverse, obtained by solving against each unit vector in turn. */
function diagonalOfInverse(matrix: readonly (readonly number[])[]): number[] {
  const size = matrix.length;
  const diagonal = new Array<number>(size).fill(Number.POSITIVE_INFINITY);

  for (let i = 0; i < size; i += 1) {
    const unit = new Array<number>(size).fill(0);
    unit[i] = 1;
    const solved = solveLinearSystem(
      matrix.map((row) => [...row]),
      unit,
    );
    if (solved === null) return diagonal;
    diagonal[i] = solved.solution[i] as number;
  }

  return diagonal;
}

function sumOf(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}
