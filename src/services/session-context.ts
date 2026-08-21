import "server-only";
import { cookies } from "next/headers";
import { anonymousActor, guestActor, userActor, type Actor } from "@/repositories/actor";
import { authRepo, guestRepo } from "@/repositories";
import { hashToken } from "@/lib/crypto";
import { getEnv } from "@/lib/env";
import {
  GUEST_SESSION_SECONDS,
  SESSION_SLIDING_SECONDS,
  authCookieName,
  cookieOptions,
  guestCookieName,
} from "@/lib/cookies";

/**
 * Resolves the actor for the current request (doc 23 §23.4).
 *
 * **This is the only place in SensLab that produces an `Actor`.** It reads the session cookie,
 * hashes it, and looks it up. Nothing here consults a request body, a query parameter, or a
 * header a client controls — which is what makes `SENS-BR-034` a structural property rather
 * than a convention every future endpoint has to remember.
 */

export interface RequestContext {
  readonly actor: Actor;
  readonly authSessionId: string | null;
  readonly guestSessionId: string | null;
}

export async function getRequestContext(): Promise<RequestContext> {
  const env = getEnv();
  const jar = await cookies();
  const now = new Date();

  const authToken = jar.get(authCookieName())?.value;
  if (authToken !== undefined && authToken.length > 0) {
    const resolved = await authRepo.resolveSessionByTokenHash(
      hashToken(authToken, env.AUTH_SECRET),
      now,
    );
    if (resolved !== null) {
      const guestSessionId = await resolveGuestSessionId(jar.get(guestCookieName())?.value, now);
      // Sliding expiry, throttled to at most one write per hour.
      await authRepo.touchSession(
        resolved.sessionId,
        now,
        new Date(now.getTime() + SESSION_SLIDING_SECONDS * 1000),
      );
      return {
        actor: userActor(resolved.user.id, guestSessionId),
        authSessionId: resolved.sessionId,
        guestSessionId,
      };
    }
  }

  const guestSessionId = await resolveGuestSessionId(jar.get(guestCookieName())?.value, now);
  if (guestSessionId !== null) {
    return { actor: guestActor(guestSessionId), authSessionId: null, guestSessionId };
  }

  return { actor: anonymousActor, authSessionId: null, guestSessionId: null };
}

async function resolveGuestSessionId(token: string | undefined, now: Date): Promise<string | null> {
  if (token === undefined || token.length === 0) return null;
  const env = getEnv();
  const resolved = await guestRepo.resolveGuestSessionByTokenHash(
    hashToken(token, env.AUTH_SECRET),
    now,
  );
  if (resolved === null) return null;
  // A claimed guest session no longer confers guest ownership: its data now belongs to the
  // account that claimed it.
  if (resolved.claimedByUserId !== null) return null;
  return resolved.guestSessionId;
}

export async function getActor(): Promise<Actor> {
  return (await getRequestContext()).actor;
}

/* ------------------------------------------------------------------ cookie writes */

export async function setAuthCookie(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(authCookieName(), token, cookieOptions(SESSION_SLIDING_SECONDS));
}

export async function clearAuthCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(authCookieName(), "", cookieOptions(0));
}

export async function setGuestCookie(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(guestCookieName(), token, cookieOptions(GUEST_SESSION_SECONDS));
}

export async function clearGuestCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(guestCookieName(), "", cookieOptions(0));
}

/** The raw guest token, for the claim flow. Never accepted from anywhere else. */
export async function readGuestToken(): Promise<string | null> {
  const jar = await cookies();
  const value = jar.get(guestCookieName())?.value;
  return value === undefined || value.length === 0 ? null : value;
}
