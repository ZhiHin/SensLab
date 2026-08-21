import { el } from "./descriptive";

/**
 * The small amount of linear algebra the calibration engine needs.
 *
 * Kept deliberately minimal and dependency-free: the response-surface fit (doc 13 §13.8)
 * is a weighted least-squares problem with three or four parameters, and the drift model
 * (doc 13 §13.7) is a modestly larger one. Both are solved by forming the normal equations
 * and running Gaussian elimination with partial pivoting — appropriate at this size, and
 * far easier to test and reason about than pulling in a matrix library.
 */

export type Matrix = readonly (readonly number[])[];

export interface LinearSystemFailure {
  readonly kind: "singular";
  readonly pivotColumn: number;
  readonly message: string;
}

function element(matrix: Matrix, row: number, column: number): number {
  const r = matrix[row];
  if (r === undefined) throw new RangeError(`row ${row} out of range`);
  return el(r, column);
}

/**
 * Condition-number estimate via the ratio of largest to smallest pivot magnitude during
 * elimination. Not a true κ, but it is monotone in the same direction and it is what
 * doc 13 §13.7 needs in order to decide whether to fall back to a linear drift model.
 */
export interface SolveResult {
  readonly solution: number[];
  readonly pivotRatio: number;
}

/** Solves `A x = b` for a square, dense `A`. Returns null when `A` is numerically singular. */
export function solveLinearSystem(a: Matrix, b: readonly number[]): SolveResult | null {
  const n = b.length;
  if (a.length !== n) {
    throw new RangeError(
      `solveLinearSystem() dimension mismatch: A has ${a.length} rows, b has ${n}`,
    );
  }

  // Working copy as an augmented matrix.
  const m: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    const row = new Array<number>(n + 1);
    for (let j = 0; j < n; j += 1) row[j] = element(a, i, j);
    row[n] = el(b, i);
    m.push(row);
  }

  let maxPivot = 0;
  let minPivot = Number.POSITIVE_INFINITY;

  for (let col = 0; col < n; col += 1) {
    let pivotRow = col;
    let pivotMagnitude = Math.abs((m[col] as number[])[col] as number);
    for (let row = col + 1; row < n; row += 1) {
      const candidate = Math.abs((m[row] as number[])[col] as number);
      if (candidate > pivotMagnitude) {
        pivotMagnitude = candidate;
        pivotRow = row;
      }
    }

    if (pivotMagnitude < 1e-12) return null;

    if (pivotRow !== col) {
      const tmp = m[col] as number[];
      m[col] = m[pivotRow] as number[];
      m[pivotRow] = tmp;
    }

    maxPivot = Math.max(maxPivot, pivotMagnitude);
    minPivot = Math.min(minPivot, pivotMagnitude);

    const pivotRowValues = m[col] as number[];
    const pivot = pivotRowValues[col] as number;

    for (let row = col + 1; row < n; row += 1) {
      const target = m[row] as number[];
      const factor = (target[col] as number) / pivot;
      if (factor === 0) continue;
      for (let j = col; j <= n; j += 1) {
        target[j] = (target[j] as number) - factor * (pivotRowValues[j] as number);
      }
    }
  }

  const solution = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row -= 1) {
    const values = m[row] as number[];
    let acc = values[n] as number;
    for (let j = row + 1; j < n; j += 1) {
      acc -= (values[j] as number) * (solution[j] as number);
    }
    solution[row] = acc / (values[row] as number);
  }

  return {
    solution,
    pivotRatio: minPivot === 0 ? Number.POSITIVE_INFINITY : maxPivot / minPivot,
  };
}

/**
 * Solves a tridiagonal system with the Thomas algorithm — used by the natural cubic
 * spline. O(n) rather than O(n³), and numerically stable for the diagonally dominant
 * systems a spline produces.
 */
export function solveTridiagonal(
  sub: readonly number[],
  diag: readonly number[],
  sup: readonly number[],
  rhs: readonly number[],
): number[] | null {
  const n = diag.length;
  if (sub.length !== n || sup.length !== n || rhs.length !== n) {
    throw new RangeError("solveTridiagonal() requires four arrays of equal length");
  }

  const c = new Array<number>(n).fill(0);
  const d = new Array<number>(n).fill(0);

  let denominator = el(diag, 0);
  if (Math.abs(denominator) < 1e-12) return null;
  c[0] = el(sup, 0) / denominator;
  d[0] = el(rhs, 0) / denominator;

  for (let i = 1; i < n; i += 1) {
    denominator = el(diag, i) - el(sub, i) * (c[i - 1] as number);
    if (Math.abs(denominator) < 1e-12) return null;
    c[i] = el(sup, i) / denominator;
    d[i] = (el(rhs, i) - el(sub, i) * (d[i - 1] as number)) / denominator;
  }

  const x = new Array<number>(n).fill(0);
  x[n - 1] = d[n - 1] as number;
  for (let i = n - 2; i >= 0; i -= 1) {
    x[i] = (d[i] as number) - (c[i] as number) * (x[i + 1] as number);
  }
  return x;
}
