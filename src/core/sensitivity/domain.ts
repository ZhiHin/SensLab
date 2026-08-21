import {
  cmPer360,
  countsPer360,
  logSensitivity,
  type CmPer360,
  type CountsPer360,
  type Dpi,
  type LogSensitivity,
} from "../types/brand";
import { cmPer360FromCounts, countsPer360FromCm } from "./canonical";

/**
 * The admissible sensitivity domain and the log-space the search operates in.
 *
 * doc 11 §11.10 — the domain is a *product* bound, not a claim about what is optimal:
 * below roughly 8 cm/360 a full turn is a wrist flick and fine control collapses for
 * essentially everyone; above roughly 100 cm/360 a full turn needs several lifts on any
 * realistic desk. Keeping the search inside that band stops it wandering somewhere no
 * human can operate.
 *
 * These constants are `TUNABLE` and live in the versioned calibration parameter set; the
 * values here are the v1 defaults and the parameter set is the authority at runtime.
 */

export interface SensitivityDomain {
  readonly minCmPer360: number;
  readonly maxCmPer360: number;
}

export const DEFAULT_SENSITIVITY_DOMAIN: SensitivityDomain = {
  minCmPer360: 8,
  maxCmPer360: 100,
};

/* --------------------------------------------------------------- log space (doc 13 §13.2) */

/**
 * The search variable. Log because sensitivity is perceived multiplicatively: the gap
 * between 20 and 25 cm/360 matters, the gap between 80 and 85 does not, and a linear
 * search would waste evaluations at one end and skip resolution at the other.
 */
export function toLogSensitivity(counts: CountsPer360 | number): LogSensitivity {
  if (!Number.isFinite(counts) || counts <= 0) {
    throw new RangeError(`counts/360 must be positive, received ${counts}`);
  }
  return logSensitivity(Math.log2(counts));
}

export function fromLogSensitivity(x: LogSensitivity | number): CountsPer360 {
  if (!Number.isFinite(x)) throw new RangeError(`log sensitivity must be finite, received ${x}`);
  return countsPer360(2 ** x);
}

/** Log2 offset corresponding to a multiplicative ratio: 1.5× → 0.585. */
export function logDeltaForRatio(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    throw new RangeError(`ratio must be positive, received ${ratio}`);
  }
  return Math.log2(ratio);
}

/** Inverse of {@link logDeltaForRatio}. */
export function ratioForLogDelta(delta: number): number {
  if (!Number.isFinite(delta)) throw new RangeError(`delta must be finite, received ${delta}`);
  return 2 ** delta;
}

/** Percentage change represented by a log2 offset: 0.1 → ~7.18%. */
export function percentChangeForLogDelta(delta: number): number {
  return (ratioForLogDelta(delta) - 1) * 100;
}

/* --------------------------------------------------------------- domain in each unit */

export function domainInCounts(
  deviceDpi: Dpi | number,
  domain: SensitivityDomain = DEFAULT_SENSITIVITY_DOMAIN,
): { readonly min: CountsPer360; readonly max: CountsPer360 } {
  return {
    min: countsPer360FromCm(domain.minCmPer360, deviceDpi),
    max: countsPer360FromCm(domain.maxCmPer360, deviceDpi),
  };
}

export function domainInLogSensitivity(
  deviceDpi: Dpi | number,
  domain: SensitivityDomain = DEFAULT_SENSITIVITY_DOMAIN,
): { readonly min: LogSensitivity; readonly max: LogSensitivity } {
  const counts = domainInCounts(deviceDpi, domain);
  return { min: toLogSensitivity(counts.min), max: toLogSensitivity(counts.max) };
}

export function isWithinDomain(
  distance: CmPer360 | number,
  domain: SensitivityDomain = DEFAULT_SENSITIVITY_DOMAIN,
): boolean {
  return distance >= domain.minCmPer360 && distance <= domain.maxCmPer360;
}

export function clampToDomain(
  distance: CmPer360 | number,
  domain: SensitivityDomain = DEFAULT_SENSITIVITY_DOMAIN,
): CmPer360 {
  return cmPer360(Math.min(Math.max(distance, domain.minCmPer360), domain.maxCmPer360));
}

export function clampCountsToDomain(
  counts: CountsPer360 | number,
  deviceDpi: Dpi | number,
  domain: SensitivityDomain = DEFAULT_SENSITIVITY_DOMAIN,
): CountsPer360 {
  const bounds = domainInCounts(deviceDpi, domain);
  return countsPer360(Math.min(Math.max(counts, bounds.min), bounds.max));
}

/* --------------------------------------------------------------- physical constraint */

/**
 * doc 13 §13.4 — the low-sensitivity end is bounded by what the player can physically do.
 *
 * `rho` encodes that a player does not need to execute a full 360° in one motion: the
 * common demand is a fast ~180° turn plus margin. At the v1 default of 0.55, a player whose
 * comfortable swipe is 22 cm is not offered anything slower than 40 cm/360.
 */
export interface PhysicalConstraintInput {
  /** Declared mousepad width in centimetres, if the user gave one. */
  readonly padWidthCm?: number;
  /** Median comfortable one-motion swipe measured by the 360 Comfort Test. */
  readonly comfortableSwipeCm?: number;
  /** Fraction of a full turn a player must be able to execute comfortably. */
  readonly rho?: number;
  /** Multiplier applied to the measured swipe before it becomes a bound. */
  readonly kappa?: number;
}

export interface PhysicalConstraint {
  readonly maxCmPer360: number | null;
  readonly source: "pad_width" | "measured" | "none";
  /** True when the declared pad width and the measured swipe disagree materially. */
  readonly conflict: boolean;
}

export const DEFAULT_CONSTRAINT_RHO = 0.55;
export const DEFAULT_CONSTRAINT_KAPPA = 1.0;

export function derivePhysicalConstraint(input: PhysicalConstraintInput): PhysicalConstraint {
  const rho = input.rho ?? DEFAULT_CONSTRAINT_RHO;
  const kappa = input.kappa ?? DEFAULT_CONSTRAINT_KAPPA;

  if (rho <= 0 || rho > 1) throw new RangeError(`rho must be in (0, 1], received ${rho}`);
  if (kappa <= 0) throw new RangeError(`kappa must be positive, received ${kappa}`);

  const measured =
    input.comfortableSwipeCm !== undefined && input.comfortableSwipeCm > 0
      ? input.comfortableSwipeCm * kappa
      : null;
  const declared = input.padWidthCm !== undefined && input.padWidthCm > 0 ? input.padWidthCm : null;

  if (measured === null && declared === null) {
    return { maxCmPer360: null, source: "none", conflict: false };
  }

  // A measured swipe that exceeds the declared pad by more than 20% is not a contradiction
  // to resolve in favour of the smaller number — the player may simply have desk space
  // beyond the pad, or mismeasured the pad. The measurement wins and the conflict is recorded.
  const conflict = measured !== null && declared !== null && measured > declared * 1.2;

  const usableSwipeCm =
    measured !== null && declared !== null
      ? conflict
        ? measured
        : Math.min(declared, measured)
      : (measured ?? declared);

  if (usableSwipeCm === null) {
    return { maxCmPer360: null, source: "none", conflict: false };
  }

  return {
    maxCmPer360: usableSwipeCm / rho,
    source: measured !== null ? "measured" : "pad_width",
    conflict,
  };
}

/** Applies a physical constraint on top of the admissible domain. */
export function effectiveDomain(
  domain: SensitivityDomain,
  constraint: PhysicalConstraint,
): SensitivityDomain {
  if (constraint.maxCmPer360 === null) return domain;
  const max = Math.min(domain.maxCmPer360, constraint.maxCmPer360);
  return {
    minCmPer360: Math.min(domain.minCmPer360, max),
    maxCmPer360: max,
  };
}

/** Convenience: express a canonical value in every unit a surface might need. */
export interface SensitivityView {
  readonly countsPer360: CountsPer360;
  readonly cmPer360: CmPer360;
  readonly inchesPer360: number;
  readonly degreesPerCm: number;
  readonly logSensitivity: LogSensitivity;
}

export function describeSensitivity(
  counts: CountsPer360 | number,
  deviceDpi: Dpi | number,
): SensitivityView {
  const cm = cmPer360FromCounts(counts, deviceDpi);
  return {
    countsPer360: countsPer360(counts),
    cmPer360: cm,
    inchesPer360: cm / 2.54,
    degreesPerCm: 360 / cm,
    logSensitivity: toLogSensitivity(counts),
  };
}
