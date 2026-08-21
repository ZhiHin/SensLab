import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { unauthenticated } from "@/lib/errors";

/**
 * The authenticated actor (doc 23 §23.4).
 *
 * Resolved **once per request from the session cookie**. There is no code path anywhere in
 * SensLab that constructs an `Actor` from a request body or a query parameter — that is the
 * whole mechanism behind `SENS-BR-034`, and it is why every repository function takes an
 * actor as its first argument rather than an owner id.
 */

export type Actor =
  | { readonly kind: "user"; readonly userId: string; readonly guestSessionId: string | null }
  | { readonly kind: "guest"; readonly guestSessionId: string }
  | { readonly kind: "anonymous" };

export const anonymousActor: Actor = { kind: "anonymous" };

export const userActor = (userId: string, guestSessionId: string | null = null): Actor => ({
  kind: "user",
  userId,
  guestSessionId,
});

export const guestActor = (guestSessionId: string): Actor => ({ kind: "guest", guestSessionId });

export function isAuthenticated(
  actor: Actor,
): actor is { kind: "user"; userId: string; guestSessionId: string | null } {
  return actor.kind === "user";
}

/** Narrows to an authenticated actor or throws. For endpoints that require an account. */
export function requireUser(actor: Actor): {
  readonly kind: "user";
  readonly userId: string;
  readonly guestSessionId: string | null;
} {
  if (!isAuthenticated(actor)) throw unauthenticated("this action requires an account");
  return actor;
}

/** True when the actor can own resources at all. */
export function canOwn(actor: Actor): boolean {
  return actor.kind !== "anonymous";
}

/**
 * SQL ownership predicate for a table with `user_id` and `guest_session_id` columns.
 *
 * Every query over an owned resource composes this. Returning a never-matching predicate for
 * an anonymous actor — rather than throwing — means a forgotten guard degrades to "no rows"
 * instead of "all rows", which is the correct direction to fail in.
 */
export function ownershipPredicate(
  actor: Actor,
  columns: { readonly userId: PgColumn; readonly guestSessionId: PgColumn },
): SQL {
  switch (actor.kind) {
    case "user":
      return eq(columns.userId, actor.userId);
    case "guest":
      return and(eq(columns.guestSessionId, actor.guestSessionId), isNull(columns.userId)) as SQL;
    case "anonymous":
      return MATCHES_NOTHING;
  }
}

/** Ownership predicate for a table owned only by registered users. */
export function userOwnershipPredicate(actor: Actor, userIdColumn: PgColumn): SQL {
  return actor.kind === "user" ? eq(userIdColumn, actor.userId) : MATCHES_NOTHING;
}

/**
 * An explicitly impossible predicate.
 *
 * Used wherever an actor cannot own the resource in question. Written as a literal false
 * rather than as a null-check so that the intent is unmistakable in a query plan and in
 * review: this is "no rows", not "rows that happen to have no owner".
 */
const MATCHES_NOTHING: SQL = sql`false`;
