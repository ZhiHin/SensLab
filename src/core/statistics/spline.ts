import { el } from "./descriptive";
import { solveTridiagonal } from "./linear-algebra";

/**
 * Natural cubic spline interpolation.
 *
 * Used by the drift model in doc 13 §13.7, which represents session-wide warm-up and
 * fatigue as a smooth function of block index. A spline rather than a straight line
 * because real sessions warm up *and then* fatigue, and a monotone model cannot express
 * that shape.
 *
 * "Natural" boundary conditions (zero second derivative at the ends) are the right choice
 * here: we have no information about behaviour beyond the observed blocks, and a natural
 * spline makes the weakest assumption available.
 */

export interface Spline {
  /** Evaluate at `x`. Outside the knot range the end segments extend linearly. */
  evaluate(x: number): number;
  readonly knotsX: readonly number[];
  readonly knotsY: readonly number[];
}

export type SplineFailure =
  | { readonly kind: "insufficient_knots"; readonly received: number }
  | { readonly kind: "unsorted_knots"; readonly index: number }
  | { readonly kind: "duplicate_knots"; readonly index: number }
  | { readonly kind: "singular_system" };

export type SplineOutcome =
  | { readonly ok: true; readonly spline: Spline }
  | { readonly ok: false; readonly failure: SplineFailure };

export function naturalCubicSpline(xs: readonly number[], ys: readonly number[]): SplineOutcome {
  if (xs.length !== ys.length) {
    throw new RangeError("naturalCubicSpline() requires xs and ys of equal length");
  }
  const n = xs.length;
  if (n < 3) return { ok: false, failure: { kind: "insufficient_knots", received: n } };

  for (let i = 1; i < n; i += 1) {
    const prev = el(xs, i - 1);
    const current = el(xs, i);
    if (current === prev) return { ok: false, failure: { kind: "duplicate_knots", index: i } };
    if (current < prev) return { ok: false, failure: { kind: "unsorted_knots", index: i } };
  }

  // Interval widths.
  const h = new Array<number>(n - 1).fill(0);
  for (let i = 0; i < n - 1; i += 1) h[i] = el(xs, i + 1) - el(xs, i);

  // Tridiagonal system for the second derivatives (moments), with natural end conditions.
  const sub = new Array<number>(n).fill(0);
  const diag = new Array<number>(n).fill(1);
  const sup = new Array<number>(n).fill(0);
  const rhs = new Array<number>(n).fill(0);

  for (let i = 1; i < n - 1; i += 1) {
    const hPrev = h[i - 1] as number;
    const hCurr = h[i] as number;
    sub[i] = hPrev;
    diag[i] = 2 * (hPrev + hCurr);
    sup[i] = hCurr;
    rhs[i] = 6 * ((el(ys, i + 1) - el(ys, i)) / hCurr - (el(ys, i) - el(ys, i - 1)) / hPrev);
  }

  const moments = solveTridiagonal(sub, diag, sup, rhs);
  if (moments === null) return { ok: false, failure: { kind: "singular_system" } };

  const knotsX = [...xs];
  const knotsY = [...ys];

  const segmentIndexFor = (x: number): number => {
    if (x <= el(knotsX, 0)) return 0;
    if (x >= el(knotsX, n - 1)) return n - 2;
    let low = 0;
    let high = n - 1;
    while (high - low > 1) {
      const mid = (low + high) >> 1;
      if (el(knotsX, mid) <= x) low = mid;
      else high = mid;
    }
    return low;
  };

  const evaluateSegment = (i: number, x: number): number => {
    const hi = h[i] as number;
    const xi = el(knotsX, i);
    const xi1 = el(knotsX, i + 1);
    const mi = moments[i] as number;
    const mi1 = moments[i + 1] as number;
    const a = xi1 - x;
    const b = x - xi;
    return (
      (mi * a * a * a + mi1 * b * b * b) / (6 * hi) +
      (el(knotsY, i) / hi - (mi * hi) / 6) * a +
      (el(knotsY, i + 1) / hi - (mi1 * hi) / 6) * b
    );
  };

  const derivativeAt = (i: number, x: number): number => {
    const hi = h[i] as number;
    const xi = el(knotsX, i);
    const xi1 = el(knotsX, i + 1);
    const mi = moments[i] as number;
    const mi1 = moments[i + 1] as number;
    const a = xi1 - x;
    const b = x - xi;
    return (
      (-3 * mi * a * a + 3 * mi1 * b * b) / (6 * hi) -
      (el(knotsY, i) / hi - (mi * hi) / 6) +
      (el(knotsY, i + 1) / hi - (mi1 * hi) / 6)
    );
  };

  return {
    ok: true,
    spline: {
      knotsX,
      knotsY,
      evaluate(x: number): number {
        const first = el(knotsX, 0);
        const last = el(knotsX, n - 1);
        // Linear extension outside the knot range — a cubic extrapolates violently, and
        // we have no basis for claiming curvature we did not observe.
        if (x < first) return el(knotsY, 0) + derivativeAt(0, first) * (x - first);
        if (x > last) return el(knotsY, n - 1) + derivativeAt(n - 2, last) * (x - last);
        return evaluateSegment(segmentIndexFor(x), x);
      },
    },
  };
}
