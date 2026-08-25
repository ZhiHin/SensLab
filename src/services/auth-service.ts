import "server-only";
import {
  authRepo,
  guestRepo,
  rateLimitRepo,
  userRepo,
  withTransaction,
  type Actor,
} from "@/repositories";
import { requireUser } from "@/repositories/actor";
import type {
  CompletePasswordResetInput,
  RequestPasswordResetInput,
  SignInInput,
  SignUpInput,
} from "@/features/auth/schema";
import { GUEST_SESSION_SECONDS, SESSION_ABSOLUTE_SECONDS } from "@/lib/cookies";
import { generateToken, hashAbuseIdentifier, hashToken } from "@/lib/crypto";
import { getEnv } from "@/lib/env";
import { conflict, rateLimited } from "@/lib/errors";
import { hashPassword, verifyPassword } from "@/lib/password";
import { createLogger } from "@/lib/logger";

/**
 * Authentication use cases (doc 23 §23.3).
 *
 * Two behaviours in this file matter more than the mechanics:
 *
 *  - **Enumeration resistance.** Registration, sign-in and password reset return the same
 *    shape regardless of whether an account exists, and sign-in performs a password
 *    verification even when the user is unknown so that the timing does not give it away
 *    (`SENS-SEC-010`).
 *  - **The guest claim is cookie-driven.** {@link claimGuestSessionForUser} takes the raw
 *    token read from the HttpOnly cookie, never an id from a caller (`SENS-SEC-018`).
 */

const log = createLogger({ base: { component: "auth-service" } });

/**
 * A pre-computed Argon2id digest of a value no user will ever supply.
 *
 * Verified against when the email is unknown, so that a sign-in attempt for a non-existent
 * account costs the same time as one for a real account. Without this, response timing is a
 * reliable account-existence oracle.
 */
const TIMING_DECOY_PASSWORD = "senslab-timing-decoy-value";
let timingDecoyHash: string | null = null;

async function getTimingDecoyHash(): Promise<string> {
  timingDecoyHash ??= await hashPassword(TIMING_DECOY_PASSWORD);
  return timingDecoyHash;
}

export interface AuthOutcome {
  /** Present only when authentication succeeded. Set as the session cookie by the caller. */
  readonly sessionToken: string | null;
  readonly userId: string | null;
  /** Always safe to show. Identical for success and for "no such account". */
  readonly message: string;
}

export interface RequestMetadata {
  readonly ip?: string;
  readonly userAgent?: string;
}

function abuseHashes(metadata: RequestMetadata): {
  ipHash?: Buffer;
  userAgentHash?: Buffer;
} {
  const salt = getEnv().ABUSE_HASH_SALT;
  return {
    ...(metadata.ip === undefined ? {} : { ipHash: hashAbuseIdentifier(metadata.ip, salt) }),
    ...(metadata.userAgent === undefined
      ? {}
      : { userAgentHash: hashAbuseIdentifier(metadata.userAgent, salt) }),
  };
}

/**
 * Names a rate-limit bucket without writing down who it is about.
 *
 * The counters are persisted, so a bucket keyed `signin-account:someone@example.com` would put
 * a plaintext address in a table outside the account model: readable by anything with database
 * access, an enumeration of who has tried to sign in and when, and — because nothing joins it
 * to a user row — untouched by account deletion (`SENS-SEC-021`). The same argument applies to
 * a raw IP, which is personal data in its own right.
 *
 * The identifier is hashed with the same keyed digest used for the abuse fingerprints on auth
 * events, so the limiter keeps working exactly as before while the table stops being a record
 * of people. The prefix stays readable so an operator can still tell which limiter a row
 * belongs to.
 */
function bucketKey(prefix: string, identifier: string): string {
  return `${prefix}:${hashAbuseIdentifier(identifier, getEnv().ABUSE_HASH_SALT).toString("base64url")}`;
}

async function enforceRateLimit(
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const result = await rateLimitRepo.consumeRateLimit(bucket, limit, windowSeconds, new Date());
  if (!result.allowed) throw rateLimited(result.retryAfterSeconds);
}

/* ------------------------------------------------------------------ registration */

export interface RegistrationResult extends AuthOutcome {
  /** The raw verification token, handed to the email transport. Never logged. */
  readonly verificationToken: string | null;
}

export async function register(
  input: SignUpInput,
  metadata: RequestMetadata = {},
): Promise<RegistrationResult> {
  await enforceRateLimit(bucketKey("register", metadata.ip ?? "unknown"), 5, 3600);

  const env = getEnv();
  const now = new Date();

  return withTransaction(async (tx) => {
    const existing = await userRepo.findActiveUserByEmail(input.email, tx);
    if (existing !== null) {
      // Same shape and comparable cost as a successful registration: an attacker cannot
      // distinguish "taken" from "created" (`SENS-SEC-010`).
      await hashPassword(input.password);
      log.info("registration attempted for existing email", { outcome: "duplicate" });
      return {
        sessionToken: null,
        userId: null,
        verificationToken: null,
        message: "Check your email to finish setting up your account.",
      };
    }

    const passwordHash = await hashPassword(input.password);
    const { userId } = await userRepo.createUser(
      {
        email: input.email,
        passwordHash,
        ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
      },
      tx,
    );

    const verificationToken = generateToken();
    await userRepo.storeAuthToken(
      {
        userId,
        purpose: "email_verify",
        tokenHash: hashToken(verificationToken, env.AUTH_SECRET),
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      },
      tx,
    );

    const sessionToken = generateToken();
    await authRepo.createAuthSession(
      {
        userId,
        tokenHash: hashToken(sessionToken, env.AUTH_SECRET),
        expiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_SECONDS * 1000),
        ...abuseHashes(metadata),
      },
      tx,
    );

    log.info("account created", { userId });
    return {
      sessionToken,
      userId,
      verificationToken,
      message: "Check your email to finish setting up your account.",
    };
  });
}

/* ------------------------------------------------------------------ sign in / out */

export async function signIn(
  input: SignInInput,
  metadata: RequestMetadata = {},
): Promise<AuthOutcome> {
  await enforceRateLimit(bucketKey("signin", metadata.ip ?? "unknown"), 10, 900);
  await enforceRateLimit(bucketKey("signin-account", input.email), 10, 900);

  const env = getEnv();
  const now = new Date();
  const found = await userRepo.findActiveUserByEmail(input.email);

  // Always run a verification, even with no account, so the timing is uninformative.
  const storedHash = found?.passwordHash ?? (await getTimingDecoyHash());
  const passwordMatches = await verifyPassword(storedHash, input.password);

  const genericFailure: AuthOutcome = {
    sessionToken: null,
    userId: null,
    message: "That email and password combination did not match.",
  };

  if (found === null || found.passwordHash === null || !passwordMatches) {
    log.info("sign-in failed", { outcome: "rejected" });
    return genericFailure;
  }

  if (found.user.status !== "active") {
    log.warn("sign-in blocked for non-active account", { userId: found.user.id });
    return genericFailure;
  }

  const sessionToken = generateToken();
  await authRepo.createAuthSession({
    userId: found.user.id,
    tokenHash: hashToken(sessionToken, env.AUTH_SECRET),
    expiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_SECONDS * 1000),
    ...abuseHashes(metadata),
  });

  log.info("sign-in succeeded", { userId: found.user.id });
  return { sessionToken, userId: found.user.id, message: "Signed in." };
}

export async function signOut(authSessionId: string | null): Promise<void> {
  if (authSessionId === null) return;
  await authRepo.revokeSession(authSessionId, new Date());
}

/* ------------------------------------------------------------------ email verification */

export async function verifyEmail(token: string): Promise<{ readonly verified: boolean }> {
  const env = getEnv();
  const now = new Date();
  const claimed = await userRepo.consumeAuthToken(
    hashToken(token, env.AUTH_SECRET),
    "email_verify",
    now,
  );
  if (claimed === null) return { verified: false };

  await userRepo.markEmailVerified({ kind: "user", userId: claimed.userId, guestSessionId: null });
  log.info("email verified", { userId: claimed.userId });
  return { verified: true };
}

/* ------------------------------------------------------------------ password reset */

export interface PasswordResetRequestResult {
  /** Null when no account exists. The caller's response is identical either way. */
  readonly resetToken: string | null;
  readonly userId: string | null;
  readonly message: string;
}

export async function requestPasswordReset(
  input: RequestPasswordResetInput,
  metadata: RequestMetadata = {},
): Promise<PasswordResetRequestResult> {
  await enforceRateLimit(bucketKey("reset", metadata.ip ?? "unknown"), 3, 3600);
  await enforceRateLimit(bucketKey("reset-account", input.email), 3, 3600);

  const env = getEnv();
  const now = new Date();
  const message = "If that email has an account, a reset link is on its way.";
  const found = await userRepo.findActiveUserByEmail(input.email);
  if (found === null) return { resetToken: null, userId: null, message };

  const resetToken = generateToken();
  await withTransaction(async (tx) => {
    // Requesting a new link invalidates any outstanding one.
    await userRepo.invalidateTokensForUser(found.user.id, "password_reset", now, tx);
    await userRepo.storeAuthToken(
      {
        userId: found.user.id,
        purpose: "password_reset",
        tokenHash: hashToken(resetToken, env.AUTH_SECRET),
        expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
      },
      tx,
    );
  });

  return { resetToken, userId: found.user.id, message };
}

export async function completePasswordReset(
  input: CompletePasswordResetInput,
): Promise<{ readonly reset: boolean }> {
  const env = getEnv();
  const now = new Date();

  return withTransaction(async (tx) => {
    const claimed = await userRepo.consumeAuthToken(
      hashToken(input.token, env.AUTH_SECRET),
      "password_reset",
      now,
      tx,
    );
    if (claimed === null) return { reset: false };

    const actor: Actor = { kind: "user", userId: claimed.userId, guestSessionId: null };
    await userRepo.updatePasswordHash(actor, await hashPassword(input.password), tx);

    // Every existing session is revoked: a password reset must end any session an attacker
    // already holds (`SENS-SEC-012`).
    const revoked = await authRepo.revokeAllSessionsForUser(claimed.userId, now, tx);
    log.info("password reset completed", { userId: claimed.userId, revokedSessions: revoked });
    return { reset: true };
  });
}

/* ------------------------------------------------------------------ guest sessions */

export interface IssuedGuestSession {
  readonly token: string;
  readonly guestSessionId: string;
}

export async function issueGuestSession(): Promise<IssuedGuestSession> {
  const env = getEnv();
  const token = generateToken();
  const guestSessionId = await guestRepo.createGuestSession({
    tokenHash: hashToken(token, env.AUTH_SECRET),
    expiresAt: new Date(Date.now() + GUEST_SESSION_SECONDS * 1000),
  });
  return { token, guestSessionId };
}

/**
 * Claims a guest session for the signed-in user.
 *
 * `guestToken` comes from the HttpOnly cookie and from nowhere else. A request that supplies
 * an arbitrary session identifier has no way to reach this function with it — the parameter
 * is a raw token, and only the browser that was issued it holds one.
 */
export async function claimGuestSessionForUser(
  actor: Actor,
  guestToken: string | null,
): Promise<guestRepo.ClaimResult> {
  const { userId } = requireUser(actor);
  if (guestToken === null) {
    return { claimed: false, reason: "unknown", sessionsMoved: 0, hardwareProfilesMoved: 0 };
  }

  const env = getEnv();
  const result = await withTransaction((tx) =>
    guestRepo.claimGuestSession(hashToken(guestToken, env.AUTH_SECRET), userId, new Date(), tx),
  );

  if (result.claimed) {
    log.info("guest session claimed", {
      userId,
      sessionsMoved: result.sessionsMoved,
      hardwareProfilesMoved: result.hardwareProfilesMoved,
    });
  }
  return result;
}

/** Guards against a second account claiming an already-claimed guest session. */
export function assertClaimable(result: guestRepo.ClaimResult): void {
  if (!result.claimed && result.reason === "already_claimed") {
    throw conflict("that guest session has already been claimed");
  }
}
