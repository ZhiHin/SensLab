import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { authRepo, rateLimitRepo, userRepo } from "@/repositories";
import { asUser } from "@tests/helpers/db";
import { db, resetVolatileTables } from "@tests/helpers/db";
import { generateToken, hashToken } from "@/lib/crypto";
import { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from "@/lib/password";
import { ARGON2ID_PREFIX } from "@/lib/password";

/**
 * Authentication flows against the real database (doc 23 §23.3).
 *
 * These exercise the repository layer directly rather than the server actions, because the
 * properties worth asserting — single-use tokens, atomic consumption, immediate revocation —
 * live below the action boundary and would be obscured by form plumbing.
 */

const PEPPER = "integration-test-pepper-value-at-least-32-chars";

async function makeUser(email: string, password = "correct-horse-battery"): Promise<string> {
  const { userId } = await userRepo.createUser({
    email,
    passwordHash: await hashPassword(password),
  });
  return userId;
}

describe("password hashing", () => {
  it("produces an Argon2id digest, not a weaker variant", async () => {
    const digest = await hashPassword("a-sufficiently-long-password");
    expect(digest.startsWith(ARGON2ID_PREFIX)).toBe(true);
  });

  it("verifies the right password and rejects the wrong one", async () => {
    const digest = await hashPassword("a-sufficiently-long-password");
    expect(await verifyPassword(digest, "a-sufficiently-long-password")).toBe(true);
    expect(await verifyPassword(digest, "not-the-password")).toBe(false);
  });

  it("returns false rather than throwing on a corrupted digest", async () => {
    expect(await verifyPassword("$argon2id$garbage", "anything-at-all")).toBe(false);
    expect(await verifyPassword("", "anything-at-all")).toBe(false);
  });

  it("refuses to hash a password below the minimum length", async () => {
    await expect(hashPassword("a".repeat(MIN_PASSWORD_LENGTH - 1))).rejects.toThrow(RangeError);
  });

  it("salts, so the same password hashes differently every time", async () => {
    const a = await hashPassword("a-sufficiently-long-password");
    const b = await hashPassword("a-sufficiently-long-password");
    expect(a).not.toBe(b);
  });
});

describe("account creation", () => {
  beforeEach(async () => {
    await resetVolatileTables();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("creates the user, profile and password identity together", async () => {
    const userId = await makeUser("newuser@example.test");
    const found = await userRepo.findActiveUserByEmail("newuser@example.test");
    expect(found?.user.id).toBe(userId);
    expect(found?.passwordHash).not.toBeNull();

    const profiles = (await db().execute(
      sql`select user_id from user_profiles where user_id = ${userId}`,
    )) as unknown as { user_id: string }[];
    expect(profiles).toHaveLength(1);
  });

  it("treats email as case-insensitive — citext", async () => {
    await makeUser("MixedCase@Example.test");
    expect(await userRepo.findActiveUserByEmail("mixedcase@example.test")).not.toBeNull();
    expect(await userRepo.findActiveUserByEmail("MIXEDCASE@EXAMPLE.TEST")).not.toBeNull();
  });

  it("rejects a duplicate email at the database level", async () => {
    await makeUser("duplicate@example.test");
    await expect(makeUser("duplicate@example.test")).rejects.toThrow();
  });

  it("hides a soft-deleted account from authentication lookups", async () => {
    const userId = await makeUser("deleted@example.test");
    await db().execute(sql`update users set deleted_at = now() where id = ${userId}`);
    expect(await userRepo.findActiveUserByEmail("deleted@example.test")).toBeNull();
    expect(await userRepo.findUserById(userId)).toBeNull();
  });
});

describe("single-use tokens — SENS-SEC-011", () => {
  beforeEach(async () => {
    await resetVolatileTables();
  });

  it("consumes a verification token exactly once", async () => {
    const userId = await makeUser("verify@example.test");
    const token = generateToken();
    await userRepo.storeAuthToken({
      userId,
      purpose: "email_verify",
      tokenHash: hashToken(token, PEPPER),
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    const first = await userRepo.consumeAuthToken(
      hashToken(token, PEPPER),
      "email_verify",
      new Date(),
    );
    const second = await userRepo.consumeAuthToken(
      hashToken(token, PEPPER),
      "email_verify",
      new Date(),
    );

    expect(first?.userId).toBe(userId);
    expect(second).toBeNull();
  });

  it("burns an expired token rather than leaving it available", async () => {
    const userId = await makeUser("expired-token@example.test");
    const token = generateToken();
    await userRepo.storeAuthToken({
      userId,
      purpose: "password_reset",
      tokenHash: hashToken(token, PEPPER),
      expiresAt: new Date(Date.now() - 1000),
    });

    // The atomic claim happens first, so the token is consumed even though it is rejected.
    expect(
      await userRepo.consumeAuthToken(hashToken(token, PEPPER), "password_reset", new Date()),
    ).toBeNull();

    const rows = (await db().execute(
      sql`select consumed_at from auth_tokens where user_id = ${userId}`,
    )) as unknown as { consumed_at: Date | null }[];
    expect(rows[0]?.consumed_at).not.toBeNull();
  });

  it("does not accept a token issued for a different purpose", async () => {
    const userId = await makeUser("purpose@example.test");
    const token = generateToken();
    await userRepo.storeAuthToken({
      userId,
      purpose: "email_verify",
      tokenHash: hashToken(token, PEPPER),
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    expect(
      await userRepo.consumeAuthToken(hashToken(token, PEPPER), "password_reset", new Date()),
    ).toBeNull();
  });

  it("invalidates outstanding tokens when a new one is requested", async () => {
    const userId = await makeUser("reissue@example.test");
    const first = generateToken();
    await userRepo.storeAuthToken({
      userId,
      purpose: "password_reset",
      tokenHash: hashToken(first, PEPPER),
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    await userRepo.invalidateTokensForUser(userId, "password_reset", new Date());

    expect(
      await userRepo.consumeAuthToken(hashToken(first, PEPPER), "password_reset", new Date()),
    ).toBeNull();
  });

  it("marks the email verified and does not double-apply", async () => {
    const userId = await makeUser("mark-verified@example.test");
    await userRepo.markEmailVerified(asUser(userId));
    // Raw `execute` bypasses Drizzle's column decoding, so timestamps arrive as strings.
    // Comparing them verbatim is exactly what this test needs: the second call must not have
    // written a new value.
    const readVerifiedAt = async (): Promise<string | null> => {
      const rows = (await db().execute(
        sql`select email_verified_at::text as verified_at from users where id = ${userId}`,
      )) as unknown as { verified_at: string | null }[];
      return rows[0]?.verified_at ?? null;
    };

    const first = await readVerifiedAt();
    expect(first).not.toBeNull();

    await userRepo.markEmailVerified(asUser(userId));
    expect(await readVerifiedAt()).toBe(first);
  });
});

describe("session lifecycle — SENS-SEC-003 / SENS-SEC-012", () => {
  beforeEach(async () => {
    await resetVolatileTables();
  });

  it("resolves a session from its token hash and never stores the token", async () => {
    const userId = await makeUser("session@example.test");
    const token = generateToken();
    await authRepo.createAuthSession({
      userId,
      tokenHash: hashToken(token, PEPPER),
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    const resolved = await authRepo.resolveSessionByTokenHash(hashToken(token, PEPPER), new Date());
    expect(resolved?.user.id).toBe(userId);

    // The raw token appears nowhere in the table.
    const rows = (await db().execute(
      sql`select encode(token_hash, 'hex') as hex from auth_sessions`,
    )) as unknown as { hex: string }[];
    expect(rows[0]?.hex).not.toContain(token);
  });

  it("does not resolve an expired or revoked session", async () => {
    const userId = await makeUser("expiry@example.test");

    const expiredToken = generateToken();
    await authRepo.createAuthSession({
      userId,
      tokenHash: hashToken(expiredToken, PEPPER),
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(
      await authRepo.resolveSessionByTokenHash(hashToken(expiredToken, PEPPER), new Date()),
    ).toBeNull();

    const liveToken = generateToken();
    const sessionId = await authRepo.createAuthSession({
      userId,
      tokenHash: hashToken(liveToken, PEPPER),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    await authRepo.revokeSession(sessionId, new Date());
    expect(
      await authRepo.resolveSessionByTokenHash(hashToken(liveToken, PEPPER), new Date()),
    ).toBeNull();
  });

  it("revokes every session for a user, which a password reset relies on", async () => {
    const userId = await makeUser("revoke-all@example.test");
    const tokens = [generateToken(), generateToken(), generateToken()];
    for (const token of tokens) {
      await authRepo.createAuthSession({
        userId,
        tokenHash: hashToken(token, PEPPER),
        expiresAt: new Date(Date.now() + 3_600_000),
      });
    }

    expect(await authRepo.revokeAllSessionsForUser(userId, new Date())).toBe(3);
    for (const token of tokens) {
      expect(
        await authRepo.resolveSessionByTokenHash(hashToken(token, PEPPER), new Date()),
      ).toBeNull();
    }
  });

  it("throttles the sliding-expiry write to at most once per hour", async () => {
    const userId = await makeUser("touch@example.test");
    const token = generateToken();
    const sessionId = await authRepo.createAuthSession({
      userId,
      tokenHash: hashToken(token, PEPPER),
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    const before = await authRepo.resolveSessionByTokenHash(hashToken(token, PEPPER), new Date());

    // A touch moments after creation is a no-op: lastSeenAt is not yet an hour old.
    await authRepo.touchSession(sessionId, new Date(), new Date(Date.now() + 7_200_000));
    const unchanged = await authRepo.resolveSessionByTokenHash(
      hashToken(token, PEPPER),
      new Date(),
    );
    expect(unchanged?.expiresAt.getTime()).toBe(before?.expiresAt.getTime());

    // Two hours later it does update.
    const later = new Date(Date.now() + 7_200_000);
    await authRepo.touchSession(sessionId, later, new Date(later.getTime() + 3_600_000));
    const updated = await authRepo.resolveSessionByTokenHash(hashToken(token, PEPPER), later);
    expect(updated?.expiresAt.getTime()).toBeGreaterThan(before?.expiresAt.getTime() ?? 0);
  });

  it("hides sessions belonging to a soft-deleted user", async () => {
    const userId = await makeUser("deleted-session@example.test");
    const token = generateToken();
    await authRepo.createAuthSession({
      userId,
      tokenHash: hashToken(token, PEPPER),
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    await db().execute(sql`update users set deleted_at = now() where id = ${userId}`);
    expect(
      await authRepo.resolveSessionByTokenHash(hashToken(token, PEPPER), new Date()),
    ).toBeNull();
  });

  it("purges stale sessions on the retention sweep", async () => {
    const userId = await makeUser("purge@example.test");
    await authRepo.createAuthSession({
      userId,
      tokenHash: hashToken(generateToken(), PEPPER),
      expiresAt: new Date(Date.now() - 60 * 24 * 3_600_000),
    });
    expect(await authRepo.purgeStaleSessions(new Date(Date.now() - 30 * 24 * 3_600_000))).toBe(1);
  });
});

describe("rate limiting — doc 23 §23.8", () => {
  beforeEach(async () => {
    await resetVolatileTables();
  });

  it("allows up to the limit and then refuses", async () => {
    const now = new Date();
    const results = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      results.push(await rateLimitRepo.consumeRateLimit("test:bucket", 3, 900, now));
    }
    expect(results.map((result) => result.allowed)).toEqual([true, true, true, false, false]);
    expect(results[4]?.count).toBe(5);
    expect(results[4]?.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("counts atomically, so concurrent requests cannot both read a stale value", async () => {
    const now = new Date();
    await Promise.all(
      Array.from({ length: 20 }, () =>
        rateLimitRepo.consumeRateLimit("test:concurrent", 100, 900, now),
      ),
    );
    expect(await rateLimitRepo.peekRateLimit("test:concurrent", 900, now)).toBe(20);
  });

  it("starts a fresh count in the next window", async () => {
    const now = new Date();
    await rateLimitRepo.consumeRateLimit("test:window", 2, 60, now);
    const nextWindow = new Date(now.getTime() + 61_000);
    const result = await rateLimitRepo.consumeRateLimit("test:window", 2, 60, nextWindow);
    expect(result.count).toBe(1);
    expect(result.allowed).toBe(true);
  });

  it("keeps buckets independent", async () => {
    const now = new Date();
    await rateLimitRepo.consumeRateLimit("bucket:a", 1, 900, now);
    const other = await rateLimitRepo.consumeRateLimit("bucket:b", 1, 900, now);
    expect(other.allowed).toBe(true);
  });

  it("purges old windows", async () => {
    const old = new Date(Date.now() - 86_400_000);
    await rateLimitRepo.consumeRateLimit("bucket:old", 5, 900, old);
    expect(await rateLimitRepo.purgeExpiredRateLimits(new Date(Date.now() - 3_600_000))).toBe(1);
  });
});
