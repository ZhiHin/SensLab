import { and, eq, isNull } from "drizzle-orm";
import { authIdentities, authTokens, userProfiles, users, type UserRow } from "@/db/schema";
import type { AuthTokenPurpose } from "@/core/types/vocabulary";
import { newId } from "@/lib/crypto";
import type { Actor } from "./actor";
import { requireUser } from "./actor";
import { executor, type Executor } from "./transaction";

/**
 * User and credential access.
 *
 * Lookups by email deliberately do **not** take an actor: they are part of authentication,
 * which happens before an actor exists. Everything that reads or writes an existing user's
 * data takes one and filters on it.
 */

export interface CreateUserInput {
  readonly email: string;
  readonly passwordHash: string;
  readonly displayName?: string;
}

export async function createUser(
  input: CreateUserInput,
  tx?: Executor,
): Promise<{ readonly userId: string }> {
  const db = executor(tx);
  const userId = newId();

  await db.insert(users).values({ id: userId, email: input.email, status: "active" });
  await db.insert(userProfiles).values({
    userId,
    displayName: input.displayName ?? null,
  });
  await db.insert(authIdentities).values({
    id: newId(),
    userId,
    provider: "password",
    providerAccountId: input.email.toLowerCase(),
    secretHash: input.passwordHash,
  });

  return { userId };
}

/** Authentication-time lookup. Returns null for soft-deleted accounts. */
export async function findActiveUserByEmail(
  email: string,
  tx?: Executor,
): Promise<{ readonly user: UserRow; readonly passwordHash: string | null } | null> {
  const db = executor(tx);
  const rows = await db
    .select({ user: users, secretHash: authIdentities.secretHash })
    .from(users)
    .leftJoin(
      authIdentities,
      and(eq(authIdentities.userId, users.id), eq(authIdentities.provider, "password")),
    )
    .where(and(eq(users.email, email), isNull(users.deletedAt)))
    .limit(1);

  const row = rows[0];
  if (row === undefined) return null;
  return { user: row.user, passwordHash: row.secretHash };
}

export async function findUserById(userId: string, tx?: Executor): Promise<UserRow | null> {
  const db = executor(tx);
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function markEmailVerified(actor: Actor, tx?: Executor): Promise<void> {
  const { userId } = requireUser(actor);
  const db = executor(tx);
  await db
    .update(users)
    .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)));
}

export async function updatePasswordHash(
  actor: Actor,
  passwordHash: string,
  tx?: Executor,
): Promise<void> {
  const { userId } = requireUser(actor);
  const db = executor(tx);
  await db
    .update(authIdentities)
    .set({ secretHash: passwordHash, updatedAt: new Date() })
    .where(and(eq(authIdentities.userId, userId), eq(authIdentities.provider, "password")));
}

/* ------------------------------------------------------------------ single-use tokens */

export interface StoreTokenInput {
  readonly userId: string;
  readonly purpose: AuthTokenPurpose;
  readonly tokenHash: Buffer;
  readonly expiresAt: Date;
}

export async function storeAuthToken(input: StoreTokenInput, tx?: Executor): Promise<string> {
  const db = executor(tx);
  const id = newId();
  await db.insert(authTokens).values({
    id,
    userId: input.userId,
    purpose: input.purpose,
    tokenHash: input.tokenHash,
    expiresAt: input.expiresAt,
  });
  return id;
}

/**
 * Consumes a token atomically.
 *
 * The `consumed_at is null` predicate in the UPDATE is what makes it single-use
 * (`SENS-SEC-011`): two concurrent requests race, and exactly one updates a row.
 */
export async function consumeAuthToken(
  tokenHash: Buffer,
  purpose: AuthTokenPurpose,
  now: Date,
  tx?: Executor,
): Promise<{ readonly userId: string } | null> {
  const db = executor(tx);
  const rows = await db
    .update(authTokens)
    .set({ consumedAt: now })
    .where(
      and(
        eq(authTokens.tokenHash, tokenHash),
        eq(authTokens.purpose, purpose),
        isNull(authTokens.consumedAt),
      ),
    )
    .returning({ userId: authTokens.userId, expiresAt: authTokens.expiresAt });

  const row = rows[0];
  if (row === undefined) return null;
  // Expiry is checked after the atomic claim so that an expired token is still burned rather
  // than left available for a later attempt.
  if (row.expiresAt.getTime() <= now.getTime()) return null;
  return { userId: row.userId };
}

export async function invalidateTokensForUser(
  userId: string,
  purpose: AuthTokenPurpose,
  now: Date,
  tx?: Executor,
): Promise<void> {
  const db = executor(tx);
  await db
    .update(authTokens)
    .set({ consumedAt: now })
    .where(
      and(
        eq(authTokens.userId, userId),
        eq(authTokens.purpose, purpose),
        isNull(authTokens.consumedAt),
      ),
    );
}
