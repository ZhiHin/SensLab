import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { guestSessions, hardwareProfiles, testSessions } from "@/db/schema";
import { newId } from "@/lib/crypto";
import { executor, type Executor } from "./transaction";

/**
 * Guest identity and the claim flow (doc 23 §23.6).
 *
 * The risky operation in this product is "this anonymous result is now mine". Done wrong it is
 * an account takeover of someone else's data. The safety comes from one rule, enforced here:
 * **the guest session is resolved from the HttpOnly cookie's token hash and from nothing
 * else.** No function in this file accepts a guest session id from a caller.
 */

export interface CreateGuestSessionInput {
  readonly tokenHash: Buffer;
  readonly expiresAt: Date;
}

export async function createGuestSession(
  input: CreateGuestSessionInput,
  tx?: Executor,
): Promise<string> {
  const db = executor(tx);
  const id = newId();
  await db.insert(guestSessions).values({
    id,
    tokenHash: input.tokenHash,
    expiresAt: input.expiresAt,
  });
  return id;
}

export interface ResolvedGuestSession {
  readonly guestSessionId: string;
  readonly expiresAt: Date;
  readonly claimedByUserId: string | null;
}

export async function resolveGuestSessionByTokenHash(
  tokenHash: Buffer,
  now: Date,
  tx?: Executor,
): Promise<ResolvedGuestSession | null> {
  const db = executor(tx);
  const rows = await db
    .select({
      guestSessionId: guestSessions.id,
      expiresAt: guestSessions.expiresAt,
      claimedByUserId: guestSessions.claimedByUserId,
    })
    .from(guestSessions)
    .where(and(eq(guestSessions.tokenHash, tokenHash), gt(guestSessions.expiresAt, now)))
    .limit(1);
  return rows[0] ?? null;
}

export interface ClaimResult {
  readonly claimed: boolean;
  readonly reason?: "already_claimed" | "expired" | "unknown";
  readonly sessionsMoved: number;
  readonly hardwareProfilesMoved: number;
}

/**
 * Claims a guest session for a user.
 *
 * Idempotent and transactional. The `claimed_by_user_id is null` predicate in the UPDATE is
 * what makes the claim atomic: two concurrent requests race, and exactly one wins. A second
 * attempt on an already-claimed session is a no-op, not an error.
 *
 * Must be called inside a transaction so that the claim and the ownership transfer commit
 * together — a claim without the transfer would orphan the guest's results.
 */
export async function claimGuestSession(
  tokenHash: Buffer,
  userId: string,
  now: Date,
  tx: Executor,
): Promise<ClaimResult> {
  const claimedRows = await tx
    .update(guestSessions)
    .set({ claimedByUserId: userId, claimedAt: now })
    .where(
      and(
        eq(guestSessions.tokenHash, tokenHash),
        isNull(guestSessions.claimedByUserId),
        gt(guestSessions.expiresAt, now),
      ),
    )
    .returning({ id: guestSessions.id });

  const claimedRow = claimedRows[0];
  if (claimedRow === undefined) {
    // Distinguish "someone already claimed it" from "no such session" for the caller's
    // messaging, without leaking whether a token exists to an unauthenticated caller.
    const existing = await tx
      .select({ id: guestSessions.id, claimedByUserId: guestSessions.claimedByUserId })
      .from(guestSessions)
      .where(eq(guestSessions.tokenHash, tokenHash))
      .limit(1);
    const row = existing[0];
    if (row === undefined) {
      return { claimed: false, reason: "unknown", sessionsMoved: 0, hardwareProfilesMoved: 0 };
    }
    if (row.claimedByUserId !== null) {
      return {
        claimed: false,
        reason: "already_claimed",
        sessionsMoved: 0,
        hardwareProfilesMoved: 0,
      };
    }
    return { claimed: false, reason: "expired", sessionsMoved: 0, hardwareProfilesMoved: 0 };
  }

  const movedSessions = await tx
    .update(testSessions)
    .set({ userId, guestSessionId: null, updatedAt: now })
    .where(eq(testSessions.guestSessionId, claimedRow.id))
    .returning({ id: testSessions.id });

  const movedProfiles = await tx
    .update(hardwareProfiles)
    .set({ userId, guestSessionId: null, updatedAt: now })
    .where(eq(hardwareProfiles.guestSessionId, claimedRow.id))
    .returning({ id: hardwareProfiles.id });

  return {
    claimed: true,
    sessionsMoved: movedSessions.length,
    hardwareProfilesMoved: movedProfiles.length,
  };
}

/**
 * Retention sweep for unclaimed guest sessions (`SENS-BR-003`).
 *
 * Deleting the guest session cascades to its hardware profiles and calibration sessions, and
 * from there to rounds, trials, metrics and recommendations.
 */
export async function purgeExpiredGuestSessions(now: Date, tx?: Executor): Promise<number> {
  const db = executor(tx);
  const rows = await db
    .delete(guestSessions)
    .where(and(lt(guestSessions.expiresAt, now), isNull(guestSessions.claimedByUserId)))
    .returning({ id: guestSessions.id });
  return rows.length;
}
