import { getEnv } from "./env";

/**
 * Cookie policy (doc 23 §23.2, `SENS-SEC-004`).
 *
 * Both cookies are `HttpOnly`, `Secure`, `SameSite=Lax`, host-scoped with no `Domain`
 * attribute, and carry the `__Host-` prefix in any deployment served over HTTPS. The prefix
 * is what makes host-scoping enforceable by the browser rather than merely intended.
 *
 * `__Host-` requires `Secure`, and a browser silently rejects the cookie without it — so on a
 * plain-HTTP local development origin the prefix is dropped rather than producing a cookie
 * that never arrives. The name is derived, never hardcoded at call sites, so the two cannot
 * drift apart.
 */

const HOST_PREFIX = "__Host-";

function usesSecureOrigin(): boolean {
  return getEnv().APP_URL.startsWith("https://");
}

function cookieName(base: string): string {
  return usesSecureOrigin() ? `${HOST_PREFIX}${base}` : base;
}

export const authCookieName = (): string => cookieName("senslab_auth");
export const guestCookieName = (): string => cookieName("senslab_guest");

export interface CookieOptions {
  readonly httpOnly: true;
  readonly secure: boolean;
  readonly sameSite: "lax";
  readonly path: "/";
  readonly maxAge: number;
}

export function cookieOptions(maxAgeSeconds: number): CookieOptions {
  return {
    httpOnly: true,
    secure: usesSecureOrigin(),
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/** Sliding session window: 30 days, with a 90-day absolute cap (doc 23 §23.3). */
export const SESSION_SLIDING_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_ABSOLUTE_SECONDS = 90 * 24 * 60 * 60;

/** Guest results expire after seven days (`SENS-BR-003`). */
export const GUEST_SESSION_SECONDS = 7 * 24 * 60 * 60;
