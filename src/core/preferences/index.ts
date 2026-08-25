import type { MotionPreference, UnitPreference } from "../types/vocabulary";

/**
 * Display preferences (FR-103, doc 28 §28.10).
 *
 * ## Units are presentation, never measurement
 *
 * The canonical value is `counts_per_360` and the derived physical value is centimetres
 * (doc 11). A user who prefers inches changes what the *label* says and nothing else: no
 * stored value, no comparison, and no game conversion is ever computed in inches. This module
 * therefore converts at the very last step, next to the formatter, where it cannot leak into
 * anything that reasons about the number.
 *
 * ## Units are independent of locale
 *
 * A player in an English interface may still want centimetres, and one reading Chinese may
 * want inches. Locale selects the language and the number formatting; the unit preference is
 * a separate axis, exactly as doc 28 §28.10 requires.
 */

export const LOCALES = ["en", "zh-Hans"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/** The BCP 47 tag for `Intl` and the `lang` attribute. */
export function intlLocale(locale: Locale): string {
  return locale === "zh-Hans" ? "zh-Hans-CN" : "en";
}

const CM_PER_INCH = 2.54;

export interface DistanceDisplay {
  readonly value: number;
  /** The unit symbol, already localised for display. */
  readonly unit: "cm" | "in";
  /** Value and unit as one string, for a label that is not composed from parts. */
  readonly text: string;
}

/**
 * A distance in centimetres, expressed in the user's preferred unit.
 *
 * Inches get two decimals rather than one: at 30 cm/360 an inch reading is ~11.8, and one
 * decimal there is a coarser step than one decimal in centimetres. Matching the *precision*
 * rather than the digit count keeps the two units equally trustworthy to read.
 */
export function formatDistance(
  centimetres: number,
  preference: UnitPreference,
  locale: Locale = DEFAULT_LOCALE,
): DistanceDisplay {
  const imperial = preference === "imperial";
  const value = imperial ? centimetres / CM_PER_INCH : centimetres;
  const digits = imperial ? 2 : 1;
  const formatted = new Intl.NumberFormat(intlLocale(locale), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
  const unit = imperial ? "in" : "cm";
  return { value, unit, text: `${formatted} ${unit}` };
}

/** A range in the preferred unit, formatted as one string with a single unit suffix. */
export function formatDistanceRange(
  lowCm: number,
  highCm: number,
  preference: UnitPreference,
  locale: Locale = DEFAULT_LOCALE,
): string {
  const low = formatDistance(lowCm, preference, locale);
  const high = formatDistance(highCm, preference, locale);
  return `${low.text.replace(` ${low.unit}`, "")} — ${high.text}`;
}

/** The `/360°` denominator, which is a unit label rather than a translatable sentence. */
export function per360Label(preference: UnitPreference): string {
  return preference === "imperial" ? "in / 360°" : "cm / 360°";
}

/**
 * Whether motion should be reduced, from the account's override and the OS setting.
 *
 * `system` defers to the OS. An explicit `full` **overrides** a system preference for reduced
 * motion, which is deliberate and is why the setting exists: a user whose OS-wide setting is
 * on for other reasons can still ask for SensLab's motion, and doc 27 §27.6 permits exactly
 * this override in the product's own settings.
 */
export function shouldReduceMotion(
  preference: MotionPreference,
  systemPrefersReduced: boolean,
): boolean {
  if (preference === "reduced") return true;
  if (preference === "full") return false;
  return systemPrefersReduced;
}
