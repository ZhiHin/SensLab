import { err, ok, type Result } from "../../core/types/result";
import { modelError, type ModelError } from "./errors";

/**
 * Form B — measured anchor points with monotone interpolation (doc 11 §11.2, doc 12 §12.5).
 *
 * For a game whose setting-to-rotation relationship is not linear, or not *known* to be
 * linear, the adapter stores what was actually measured and interpolates between those
 * points. Two properties make this safe where a fitted curve would not be:
 *
 * **It is monotone by construction.** Fritsch–Carlson limiting means the interpolant can
 * never overshoot between two anchors, so a curve through measured points cannot invent a
 * local reversal that the game does not have. An unconstrained cubic spline can and does.
 *
 * **It refuses to extrapolate.** Outside the measured range there is no evidence, so there
 * is no number — the same rule as an unverified game, applied to the part of a verified
 * game that was never measured. The UI reports "outside the range we have measured".
 *
 * Interpolation is on log–log axes because sensitivity is perceived and expressed
 * multiplicatively; a straight line in that space is the correct null model, and the
 * residual the anchors have to explain is much smaller there than on linear axes.
 */

export interface TableAnchor {
  readonly setting: number;
  readonly countsPer360: number;
}

export interface TableParams {
  readonly form: "table";
  /** Measured points, strictly monotone in both coordinates. At least five (doc 12 §12.5). */
  readonly anchors: readonly TableAnchor[];
  readonly interpolation: "monotone_cubic_loglog";
  /** Only one policy is permitted. It is spelled out rather than implied. */
  readonly extrapolation: "refuse";
}

/** Fewer than this and an interpolant is describing the interpolator, not the game. */
export const MIN_ANCHORS = 5;

export function assertTableParams(params: TableParams): void {
  const { anchors } = params;
  if (anchors.length < MIN_ANCHORS) {
    throw new RangeError(
      `a table model needs at least ${MIN_ANCHORS} measured anchors, received ${anchors.length}`,
    );
  }
  for (const anchor of anchors) {
    if (!Number.isFinite(anchor.setting) || anchor.setting <= 0) {
      throw new RangeError(
        `anchor setting must be positive and finite, received ${anchor.setting}`,
      );
    }
    if (!Number.isFinite(anchor.countsPer360) || anchor.countsPer360 <= 0) {
      throw new RangeError(
        `anchor counts/360 must be positive and finite, received ${anchor.countsPer360}`,
      );
    }
  }
  for (let i = 1; i < anchors.length; i += 1) {
    const previous = anchors[i - 1] as TableAnchor;
    const current = anchors[i] as TableAnchor;
    if (current.setting <= previous.setting) {
      throw new RangeError(
        `anchors must be strictly increasing in setting; ${current.setting} follows ${previous.setting}`,
      );
    }
  }
  // Counts must move strictly in one direction. A reversal means either a mismeasurement or
  // a genuinely non-monotone game, and the second needs Form C and a reviewed derivation
  // rather than an interpolant that will silently pick one of the two branches.
  const first = anchors[0] as TableAnchor;
  const second = anchors[1] as TableAnchor;
  const descending = second.countsPer360 < first.countsPer360;
  for (let i = 1; i < anchors.length; i += 1) {
    const previous = (anchors[i - 1] as TableAnchor).countsPer360;
    const current = (anchors[i] as TableAnchor).countsPer360;
    if (current === previous || current < previous !== descending) {
      throw new RangeError(
        `anchors must be strictly monotone in counts/360; ${current} follows ${previous}`,
      );
    }
  }
}

/* ------------------------------------------------------------------ monotone cubic Hermite */

interface Spline {
  readonly xs: readonly number[];
  readonly ys: readonly number[];
  readonly tangents: readonly number[];
}

/**
 * Fritsch–Carlson monotone cubic Hermite tangents.
 *
 * The limiting step is what separates this from an ordinary cubic spline: where the initial
 * tangent estimates would produce an overshoot, they are scaled back onto the monotonicity
 * circle. The interpolant then stays inside the box formed by every consecutive pair of
 * anchors, so it cannot report a rotation the measurements do not support.
 */
function buildSpline(xs: readonly number[], ys: readonly number[]): Spline {
  const n = xs.length;
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const run = (xs[i + 1] as number) - (xs[i] as number);
    slopes.push(((ys[i + 1] as number) - (ys[i] as number)) / run);
  }

  const tangents: number[] = new Array<number>(n);
  tangents[0] = slopes[0] as number;
  tangents[n - 1] = slopes[n - 2] as number;
  for (let i = 1; i < n - 1; i += 1) {
    tangents[i] = ((slopes[i - 1] as number) + (slopes[i] as number)) / 2;
  }

  for (let i = 0; i < n - 1; i += 1) {
    const slope = slopes[i] as number;
    if (slope === 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    const alpha = (tangents[i] as number) / slope;
    const beta = (tangents[i + 1] as number) / slope;
    const magnitude = alpha * alpha + beta * beta;
    if (magnitude > 9) {
      const scale = 3 / Math.sqrt(magnitude);
      tangents[i] = scale * alpha * slope;
      tangents[i + 1] = scale * beta * slope;
    }
  }

  return { xs, ys, tangents };
}

function evaluate(spline: Spline, x: number): number {
  const { xs, ys, tangents } = spline;
  const last = xs.length - 1;
  if (x <= (xs[0] as number)) return ys[0] as number;
  if (x >= (xs[last] as number)) return ys[last] as number;

  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if ((xs[mid] as number) <= x) lo = mid;
    else hi = mid;
  }

  const h = (xs[hi] as number) - (xs[lo] as number);
  const t = (x - (xs[lo] as number)) / h;
  const t2 = t * t;
  const t3 = t2 * t;

  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;

  return (
    h00 * (ys[lo] as number) +
    h10 * h * (tangents[lo] as number) +
    h01 * (ys[hi] as number) +
    h11 * h * (tangents[hi] as number)
  );
}

/**
 * Splines are cached per params object.
 *
 * Adapter parameters are immutable (`SENS-BR-029`, doc 12 §12.9), so a `WeakMap` keyed on the
 * params object is safe, and it keeps `fromCanonical` from rebuilding the interpolant on every
 * call — which matters because the inverse below evaluates it around sixty times.
 */
const SPLINE_CACHE = new WeakMap<TableParams, Spline>();

function splineFor(params: TableParams): Spline {
  const cached = SPLINE_CACHE.get(params);
  if (cached !== undefined) return cached;
  const built = buildSpline(
    params.anchors.map((anchor) => Math.log(anchor.setting)),
    params.anchors.map((anchor) => Math.log(anchor.countsPer360)),
  );
  SPLINE_CACHE.set(params, built);
  return built;
}

/* ------------------------------------------------------------------ the model interface */

export interface Bounds {
  readonly min: number;
  readonly max: number;
}

export function tableSettingBounds(params: TableParams): Bounds {
  const anchors = params.anchors;
  return {
    min: (anchors[0] as TableAnchor).setting,
    max: (anchors[anchors.length - 1] as TableAnchor).setting,
  };
}

export function tableCountsBounds(params: TableParams): Bounds {
  const values = params.anchors.map((anchor) => anchor.countsPer360);
  return { min: Math.min(...values), max: Math.max(...values) };
}

/**
 * Relative slack on the range checks.
 *
 * `Math.exp(Math.log(x))` is not always `x`, so evaluating the interpolant at its own
 * endpoint anchor can land an ulp outside the measured range and be refused for being
 * outside a range it defines. The tolerance is far below any measurement precision — a
 * genuine extrapolation is refused, float noise is not.
 */
const BOUND_TOLERANCE = 1e-12;

const within = (value: number, bounds: Bounds): boolean =>
  value >= bounds.min * (1 - BOUND_TOLERANCE) && value <= bounds.max * (1 + BOUND_TOLERANCE);

export function tableCountsForSetting(
  params: TableParams,
  settingValue: number,
): Result<number, ModelError> {
  const bounds = tableSettingBounds(params);
  if (!within(settingValue, bounds)) {
    return err(
      modelError(
        "OUTSIDE_MEASURED_RANGE",
        `setting ${settingValue} lies outside the measured range [${bounds.min}, ${bounds.max}]`,
      ),
    );
  }
  // Monotone interpolation cannot leave the box formed by the anchors, so clamping restores
  // that guarantee against floating-point drift rather than concealing an extrapolation.
  const counts = tableCountsBounds(params);
  const raw = Math.exp(evaluate(splineFor(params), Math.log(settingValue)));
  return ok(Math.min(Math.max(raw, counts.min), counts.max));
}

/**
 * The inverse, by bisection on the forward interpolant.
 *
 * Deliberately *not* a second spline fitted the other way round: two independently fitted
 * curves are not inverses of each other, and doc 11 §11.11 requires
 * `toCanonical(fromCanonical(x))` to return `x` within 1e-9 relative before quantisation.
 * Inverting the one curve numerically satisfies that to machine precision, and monotonicity
 * makes bisection unconditionally convergent.
 */
export function tableSettingForCounts(
  params: TableParams,
  counts: number,
): Result<number, ModelError> {
  const bounds = tableCountsBounds(params);
  if (!within(counts, bounds)) {
    return err(
      modelError(
        "OUTSIDE_MEASURED_RANGE",
        `counts/360 ${counts} lies outside the measured range [${bounds.min}, ${bounds.max}]`,
      ),
    );
  }

  const spline = splineFor(params);
  const target = Math.log(counts);
  const settings = tableSettingBounds(params);
  let lo = Math.log(settings.min);
  let hi = Math.log(settings.max);

  const descending = evaluate(spline, hi) < evaluate(spline, lo);

  // A hundred halvings of an interval a few log units wide reaches the floating-point floor
  // long before the loop ends; the early exits are what actually terminate it.
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const mid = (lo + hi) / 2;
    const value = evaluate(spline, mid);
    if (Math.abs(value - target) < 1e-15) return ok(Math.exp(mid));
    const belowTarget = descending ? value > target : value < target;
    if (belowTarget) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-15) break;
  }

  return ok(Math.exp((lo + hi) / 2));
}
