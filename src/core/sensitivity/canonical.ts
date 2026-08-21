import {
  cmPer360,
  countsPer360,
  degrees,
  type Centimetres,
  type CmPer360,
  type CountsPer360,
  type Degrees,
  type Dpi,
} from "../types/brand";

/**
 * The canonical sensitivity maths (doc 11).
 *
 * `countsPer360` — mouse counts required for a full 360° in-game turn — is the
 * authoritative representation (ADR-004). Centimetres are a *presentation* derived from it
 * using the session DPI, and DPI is the one number in this product that we cannot verify.
 * Keeping counts canonical is what lets a recommendation stay valid when the DPI turns out
 * to be wrong, and what keeps DPI out of the engine's inner loop entirely.
 *
 * None of this depends on any game. Nothing in this file may ever learn about one.
 */

export const CM_PER_INCH = 2.54;
export const FULL_TURN_DEGREES = 360;

/** 2.54 × 360 — appears in every closed-form cm/360 expression. */
export const CM_DEGREE_CONSTANT = CM_PER_INCH * FULL_TURN_DEGREES;

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number, received ${value}`);
  }
}

/** counts/360 = cm/360 × DPI ÷ 2.54 */
export function countsPer360FromCm(
  distance: CmPer360 | number,
  deviceDpi: Dpi | number,
): CountsPer360 {
  assertPositiveFinite(distance, "cm/360");
  assertPositiveFinite(deviceDpi, "DPI");
  return countsPer360((distance * deviceDpi) / CM_PER_INCH);
}

/** cm/360 = 2.54 × counts/360 ÷ DPI */
export function cmPer360FromCounts(
  counts: CountsPer360 | number,
  deviceDpi: Dpi | number,
): CmPer360 {
  assertPositiveFinite(counts, "counts/360");
  assertPositiveFinite(deviceDpi, "DPI");
  return cmPer360((CM_PER_INCH * counts) / deviceDpi);
}

/**
 * Degrees of view rotation produced by one mouse count.
 *
 * This is the quantity the test engine actually applies to the camera, and it is
 * DPI-independent — which is precisely why the engine never needs to know the DPI.
 */
export function degreesPerCount(counts: CountsPer360 | number): Degrees {
  assertPositiveFinite(counts, "counts/360");
  return degrees(FULL_TURN_DEGREES / counts);
}

export function countsPer360FromDegreesPerCount(perCount: Degrees | number): CountsPer360 {
  assertPositiveFinite(perCount, "degrees per count");
  return countsPer360(FULL_TURN_DEGREES / perCount);
}

/** Degrees of rotation per centimetre of physical mouse travel. */
export function degreesPerCm(distance: CmPer360 | number): number {
  assertPositiveFinite(distance, "cm/360");
  return FULL_TURN_DEGREES / distance;
}

export function inchesPer360(distance: CmPer360 | number): number {
  assertPositiveFinite(distance, "cm/360");
  return distance / CM_PER_INCH;
}

/** Physical distance required to turn through a given angle. */
export function centimetresForRotation(
  distance: CmPer360 | number,
  angle: Degrees | number,
): Centimetres {
  assertPositiveFinite(distance, "cm/360");
  if (!Number.isFinite(angle)) throw new RangeError(`angle must be finite, received ${angle}`);
  return ((Math.abs(angle) / FULL_TURN_DEGREES) * distance) as Centimetres;
}

/** Angle turned by a given physical distance. */
export function rotationForCentimetres(
  distance: CmPer360 | number,
  travel: Centimetres | number,
): Degrees {
  assertPositiveFinite(distance, "cm/360");
  return degrees((travel / distance) * FULL_TURN_DEGREES);
}

/**
 * eDPI — DPI multiplied by a game's own sensitivity number.
 *
 * Displayed only as a familiarity aid for communities that use it. It is meaningless across
 * games and is never an internal quantity (doc 11 §11.1).
 */
export function eDpi(deviceDpi: Dpi | number, gameSetting: number): number {
  assertPositiveFinite(deviceDpi, "DPI");
  assertPositiveFinite(gameSetting, "game sensitivity");
  return deviceDpi * gameSetting;
}
