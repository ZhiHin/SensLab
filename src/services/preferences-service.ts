import "server-only";
import { cookies, headers } from "next/headers";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/core/preferences";
import {
  MOTION_PREFERENCES,
  UNIT_PREFERENCES,
  type MotionPreference,
  type UnitPreference,
} from "@/core/types/vocabulary";
import { userRepo } from "@/repositories";
import type { Actor } from "@/repositories/actor";
import { withTransaction } from "@/repositories/transaction";
import { ValidationError } from "@/lib/errors";

/**
 * Display preferences, resolved per request (FR-103, doc 28 §28.10).
 *
 * ## Where a preference comes from
 *
 * ```
 *   signed in?  →  the account's stored preference
 *   otherwise   →  a cookie this browser set
 *   otherwise   →  Accept-Language for the locale, defaults for the rest
 * ```
 *
 * A guest gets a working preference without an account, and a signed-in user's choice follows
 * them between browsers. The cookie is **not** a fallback *for* a signed-in user: an account
 * that says centimetres means centimetres on every machine, and a stale cookie on a shared
 * computer must not quietly win.
 *
 * The cookie carries a display preference and nothing else — no identity, no measurement — so
 * it is set without consent gating and read without an actor.
 */

export const PREFERENCES_COOKIE = "senslab_prefs";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export interface Preferences {
  readonly locale: Locale;
  readonly unit: UnitPreference;
  readonly motion: MotionPreference;
}

export const DEFAULT_PREFERENCES: Preferences = Object.freeze({
  locale: DEFAULT_LOCALE,
  unit: "metric",
  motion: "system",
});

function isUnit(value: string): value is UnitPreference {
  return (UNIT_PREFERENCES as readonly string[]).includes(value);
}

function isMotion(value: string): value is MotionPreference {
  return (MOTION_PREFERENCES as readonly string[]).includes(value);
}

/** The best supported locale for an `Accept-Language` header, or null when none matches. */
export function localeFromAcceptLanguage(header: string | null): Locale | null {
  if (header === null) return null;
  const tags = header
    .split(",")
    .map((part) => {
      const [tag = "", quality = "q=1"] = part.trim().split(";");
      return { tag: tag.trim().toLowerCase(), q: Number(quality.replace("q=", "")) || 0 };
    })
    .sort((a, b) => b.q - a.q);

  for (const { tag } of tags) {
    // `zh`, `zh-cn`, `zh-hans` and `zh-hans-cn` all mean Simplified Chinese here. `zh-hant`
    // and `zh-tw` do not, and fall through to English rather than being served the wrong
    // script.
    if (tag === "zh" || tag.startsWith("zh-hans") || tag === "zh-cn" || tag === "zh-sg") {
      return "zh-Hans";
    }
    if (tag.startsWith("en")) return "en";
  }
  return null;
}

function fromCookie(raw: string | undefined): Partial<Preferences> {
  if (raw === undefined) return {};
  // A tiny `key=value` list rather than JSON: it stays readable in devtools, and a malformed
  // cookie degrades to the default instead of throwing on parse.
  const parsed: Record<string, string> = {};
  for (const pair of raw.split("|")) {
    const [key = "", value = ""] = pair.split("=");
    parsed[key] = value;
  }
  return {
    ...(parsed["locale"] !== undefined && isLocale(parsed["locale"])
      ? { locale: parsed["locale"] }
      : {}),
    ...(parsed["unit"] !== undefined && isUnit(parsed["unit"]) ? { unit: parsed["unit"] } : {}),
    ...(parsed["motion"] !== undefined && isMotion(parsed["motion"])
      ? { motion: parsed["motion"] }
      : {}),
  };
}

function toCookie(preferences: Preferences): string {
  return `locale=${preferences.locale}|unit=${preferences.unit}|motion=${preferences.motion}`;
}

export async function getPreferences(actor: Actor): Promise<Preferences> {
  if (actor.kind === "user") {
    const account = await userRepo.findAccount(actor);
    if (account !== null) {
      return {
        locale: isLocale(account.locale) ? account.locale : DEFAULT_LOCALE,
        unit: isUnit(account.unitPreference) ? account.unitPreference : "metric",
        motion: isMotion(account.motionPreference) ? account.motionPreference : "system",
      };
    }
  }

  const store = await cookies();
  const cookied = fromCookie(store.get(PREFERENCES_COOKIE)?.value);
  const headerLocale = localeFromAcceptLanguage((await headers()).get("accept-language"));

  return {
    locale: cookied.locale ?? headerLocale ?? DEFAULT_PREFERENCES.locale,
    unit: cookied.unit ?? DEFAULT_PREFERENCES.unit,
    motion: cookied.motion ?? DEFAULT_PREFERENCES.motion,
  };
}

/**
 * Stores a preference change.
 *
 * A signed-in user's preference goes to their account *and* to the cookie, so the page they
 * are on renders correctly before the next request re-reads the account. A guest's goes to the
 * cookie alone.
 */
export async function setPreferences(
  actor: Actor,
  update: Partial<Preferences>,
): Promise<Preferences> {
  if (update.locale !== undefined && !isLocale(update.locale)) {
    throw new ValidationError([{ path: "locale", message: "unsupported locale" }]);
  }
  if (update.unit !== undefined && !isUnit(update.unit)) {
    throw new ValidationError([{ path: "unit", message: "unsupported unit preference" }]);
  }
  if (update.motion !== undefined && !isMotion(update.motion)) {
    throw new ValidationError([{ path: "motion", message: "unsupported motion preference" }]);
  }

  const current = await getPreferences(actor);
  const next: Preferences = { ...current, ...update };

  if (actor.kind === "user") {
    await withTransaction((tx) =>
      userRepo.updatePreferences(
        actor,
        { locale: next.locale, unitPreference: next.unit, motionPreference: next.motion },
        tx,
      ),
    );
  }

  const store = await cookies();
  store.set(PREFERENCES_COOKIE, toCookie(next), {
    maxAge: COOKIE_MAX_AGE_SECONDS,
    sameSite: "lax",
    path: "/",
    // Readable by the client so a preference can be applied without a round trip; it carries
    // no identity and nothing that would matter if it were read.
    httpOnly: false,
  });

  return next;
}
