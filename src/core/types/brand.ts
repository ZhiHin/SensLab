/**
 * Nominal typing helpers.
 *
 * SensLab carries several `number`s that must never be interchanged — counts per 360,
 * centimetres per 360, degrees, DPI, log-sensitivity. They are structurally identical
 * and semantically incompatible, which is exactly the situation branded types exist for.
 *
 * See docs/phase-0/11-canonical-sensitivity-model.md and docs/phase-0/35-glossary.md.
 */

declare const brand: unique symbol;

export type Brand<T, B extends string> = T & { readonly [brand]: B };

/** Mouse counts required for a full 360° in-game turn. The canonical unit (ADR-004). */
export type CountsPer360 = Brand<number, "CountsPer360">;

/** Centimetres of physical mouse travel per 360° turn. The presentation unit. */
export type CmPer360 = Brand<number, "CmPer360">;

/** Mouse counts per inch of physical movement (commonly called DPI). */
export type Dpi = Brand<number, "Dpi">;

/** An angle in degrees. */
export type Degrees = Brand<number, "Degrees">;

/** A physical distance in centimetres. */
export type Centimetres = Brand<number, "Centimetres">;

/** log2(countsPer360) — the calibration search variable (doc 13 §13.2). */
export type LogSensitivity = Brand<number, "LogSensitivity">;

/**
 * Constructors. These are unchecked casts by design: validation belongs to the Zod
 * schemas at the system boundary, not to every arithmetic step in the hot path.
 * Functions that *can* produce an invalid value validate explicitly and return a Result.
 */
export const countsPer360 = (value: number): CountsPer360 => value as CountsPer360;
export const cmPer360 = (value: number): CmPer360 => value as CmPer360;
export const dpi = (value: number): Dpi => value as Dpi;
export const degrees = (value: number): Degrees => value as Degrees;
export const centimetres = (value: number): Centimetres => value as Centimetres;
export const logSensitivity = (value: number): LogSensitivity => value as LogSensitivity;
