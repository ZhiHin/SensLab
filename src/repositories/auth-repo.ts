import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import { authSessions, users, type UserRow } from "@/db/schema";
import { newId } from "@/lib/crypto";
import { executor, type Executor } from "./transaction";

/**
 * Session storage (doc 23 §23.3, ADR-016).
 *
 * Opaque server-side sessions rather than JWTs. The deciding factor is revocation: a password
 * change and an account deletion must invalidate access *immediately*, and a stateless token
 * cannot do that without a revocation list — which is a session store with extra steps.
 *
 * Only the HMAC of the token is stored. A database disclosure therefore yields no usable
 * sessions.
 */

export interface CreateSessionInput {
  readonly userId: string;
  readonly tokenHash: Buffer;
  readonly expiresAt: Date;
  readonly ipHash?: Buffer;
  readonly userAgentHash?: Buffer;
}

export async function createAuthSession(input: CreateSessionInput, tx?: Executor): Promise<string> {
  const db = executor(tx);
  const id = newId();
  await db.insert(authSessions).values({
    id,
    userId: input.userId,
    tokenHash: input.tokenHash,
    expiresAt: input.expiresAt,
    ipHash: input.ipHash ?? null,
    userAgentHash: input.userAgentHash ?? null,
  });
  return id;
}

export interface ResolvedSession {
  readonly sessionId: string;
  readonly user: UserRow;
  readonly expiresAt: Date;
  readonly lastSeenAt: Date;
}

/** Resolves a session token to its user, or null when expired, revoked or unknown. */
export async function resolveSessionByTokenHash(
  tokenHash: Buffer,
  now: Date,
  tx?: Executor,
): Promise<ResolvedSession | null> {
  const db = executor(tx);
  const rows = await db
    .select({
      sessionId: authSessions.id,
      expiresAt: authSessions.expiresAt,
      lastSeenAt: authSessions.lastSeenAt,
      user: users,
    })
    .from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
    .where(
      and(
        eq(authSessions.tokenHash, tokenHash),
        isNull(authSessions.revokedAt),
        gt(authSessions.expiresAt, now),
        isNull(users.deletedAt),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;
  return {
    sessionId: row.sessionId,
    user: row.user,
    expiresAt: row.expiresAt,
    lastSeenAt: row.lastSeenAt,
  };
}

/**
 * Sliding expiry.
 *
 * `lastSeenAt` is refreshed at most once per hour so that an authenticated request does not
 * cost a write on every page view.
 */
export async function touchSession(
  sessionId: string,
  now: Date,
  newExpiry: Date,
  tx?: Executor,
): Promise<void> {
  const db = executor(tx);
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  await db
    .update(authSessions)
    .set({ lastSeenAt: now, expiresAt: newExpiry })
    .where(and(eq(authSessions.id, sessionId), lt(authSessions.lastSeenAt, oneHourAgo)));
}

export async function revokeSession(sessionId: string, now: Date, tx?: Executor): Promise<void> {
  const db = executor(tx);
  await db.update(authSessions).set({ revokedAt: now }).where(eq(authSessions.id, sessionId));
}

/** Revokes every session for a user. Used on password change and on account deletion. */
export async function revokeAllSessionsForUser(
  userId: string,
  now: Date,
  tx?: Executor,
): Promise<number> {
  const db = executor(tx);
  const rows = await db
    .update(authSessions)
    .set({ revokedAt: now })
    .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)))
    .returning({ id: authSessions.id });
  return rows.length;
}

/** Retention sweep: expired or revoked sessions older than the cutoff (doc 20 §20.11). */
export async function purgeStaleSessions(cutoff: Date, tx?: Executor): Promise<number> {
  const db = executor(tx);
  const rows = await db
    .delete(authSessions)
    .where(or(lt(authSessions.expiresAt, cutoff), lt(authSessions.revokedAt, cutoff)))
    .returning({ id: authSessions.id });
  return rows.length;
}
