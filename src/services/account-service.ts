import "server-only";
import { authRepo, exportRepo, guestRepo, userRepo } from "@/repositories";
import { requireUser, type Actor } from "@/repositories/actor";
import { withTransaction } from "@/repositories/transaction";
import { ValidationError, notFound, unauthenticated } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { hashPassword, verifyPassword } from "@/lib/password";

/**
 * Account management (FR-097, FR-098, SCR-044, SCR-045, `SENS-SEC-020`, `SENS-SEC-021`).
 *
 * ## Re-authentication before anything dangerous
 *
 * Changing a password and scheduling deletion both require the current password, even though
 * the caller is already signed in. A stolen session is the threat these guard against, and a
 * session alone must not be enough to take an account away from its owner (doc 23 §23.4).
 *
 * ## Deletion is scheduled, not immediate
 *
 * `pending_deletion` plus a purge date, every session revoked, sign-in refused. The window
 * makes an account recoverable — the most common deletion is a mistake or a bad day — and the
 * purge is what actually removes the data (doc 23 §23.11). Nothing here soft-deletes rows and
 * calls it deletion.
 */

const log = createLogger({ base: { component: "account-service" } });

/** Doc 23 §23.11: the live system is clear within 30 days. */
export const DELETION_WINDOW_DAYS = 30;
const MIN_PASSWORD_LENGTH = 12;

export interface AccountView {
  readonly email: string;
  readonly emailVerified: boolean;
  readonly displayName: string | null;
  readonly createdAt: string;
  readonly status: string;
  readonly deletionScheduledAt: string | null;
  readonly locale: string;
  readonly unitPreference: string;
  readonly motionPreference: string;
}

export async function getAccount(actor: Actor): Promise<AccountView | null> {
  const row = await userRepo.findAccount(actor);
  if (row === null) return null;
  return {
    email: row.email,
    emailVerified: row.emailVerifiedAt !== null,
    displayName: row.displayName,
    createdAt: row.createdAt.toISOString(),
    status: row.status,
    deletionScheduledAt: row.deletionScheduledAt?.toISOString() ?? null,
    locale: row.locale,
    unitPreference: row.unitPreference,
    motionPreference: row.motionPreference,
  };
}

export async function updateDisplayName(actor: Actor, displayName: string): Promise<void> {
  const trimmed = displayName.trim();
  if (trimmed.length > 64) {
    throw new ValidationError([{ path: "displayName", message: "64 characters at most" }]);
  }
  await withTransaction((tx) =>
    userRepo.updateDisplayName(actor, trimmed.length === 0 ? null : trimmed, tx),
  );
}

/** Confirms the caller knows the account's current password. */
async function reauthenticate(actor: Actor, currentPassword: string): Promise<void> {
  const stored = await userRepo.findPasswordHash(actor);
  if (stored === null) throw notFound("password identity");
  if (!(await verifyPassword(stored, currentPassword))) {
    throw unauthenticated("that password is not right");
  }
}

/**
 * Changes the password and revokes every other session.
 *
 * Doc 23 §23.4 requires a password change to invalidate access immediately: whoever else was
 * signed in is who the change is usually being made against.
 */
export async function changePassword(
  actor: Actor,
  input: { readonly currentPassword: string; readonly newPassword: string },
): Promise<{ readonly revokedSessions: number }> {
  const { userId } = requireUser(actor);
  if (input.newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError([
      { path: "newPassword", message: `at least ${MIN_PASSWORD_LENGTH} characters` },
    ]);
  }
  if (input.newPassword === input.currentPassword) {
    throw new ValidationError([{ path: "newPassword", message: "choose a different password" }]);
  }
  await reauthenticate(actor, input.currentPassword);

  const passwordHash = await hashPassword(input.newPassword);
  const now = new Date();
  const revoked = await withTransaction(async (tx) => {
    await userRepo.updatePasswordHash(actor, passwordHash, tx);
    // Any reset link already in flight is now a way back in for whoever requested it.
    await userRepo.invalidateTokensForUser(userId, "password_reset", now, tx);
    // Every session, including this one: the caller signs in again with the new password,
    // and so does whoever else was holding a session (doc 23 §23.4).
    return authRepo.revokeAllSessionsForUser(userId, now, tx);
  });

  log.info("password changed", { userId, revokedSessions: revoked });
  return { revokedSessions: revoked };
}

/* ------------------------------------------------------------------ export */

export interface ExportResult {
  readonly filename: string;
  readonly json: string;
}

/**
 * Session seeds are 64-bit and arrive as `bigint`, which JSON has no representation for.
 * They are written as decimal strings — the same form the engine already accepts, so an
 * exported session can be replayed from its export (`SENS-BR-031`).
 */
function jsonSafe(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

export async function exportAccountData(actor: Actor): Promise<ExportResult> {
  const { userId } = requireUser(actor);
  const now = new Date();
  const document = await exportRepo.exportAccount(actor, now);
  log.info("account exported", { userId });
  return {
    filename: `senslab-export-${now.toISOString().slice(0, 10)}.json`,
    json: JSON.stringify(document, jsonSafe, 2),
  };
}

/* ------------------------------------------------------------------ deletion */

export interface DeletionSchedule {
  readonly purgeAt: string;
  readonly revokedSessions: number;
}

export async function requestAccountDeletion(
  actor: Actor,
  currentPassword: string,
): Promise<DeletionSchedule> {
  const { userId } = requireUser(actor);
  await reauthenticate(actor, currentPassword);

  const purgeAt = new Date(Date.now() + DELETION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const revoked = await withTransaction(async (tx) => {
    await userRepo.scheduleDeletion(actor, purgeAt, tx);
    return authRepo.revokeAllSessionsForUser(userId, new Date(), tx);
  });

  log.info("account deletion scheduled", { userId, purgeAt: purgeAt.toISOString() });
  return { purgeAt: purgeAt.toISOString(), revokedSessions: revoked };
}

export async function cancelAccountDeletion(actor: Actor): Promise<void> {
  const { userId } = requireUser(actor);
  await withTransaction((tx) => userRepo.cancelDeletion(actor, tx));
  log.info("account deletion cancelled", { userId });
}

/**
 * The retention sweep (doc 23 §23.11, `SENS-BR-003`).
 *
 * Two jobs in one pass: accounts whose deletion window has elapsed are purged, and guest
 * sessions that expired unclaimed go with them. Both cascade through the schema, so nothing
 * has to enumerate what a session owns.
 */
export async function runRetentionSweep(
  now = new Date(),
): Promise<{ readonly accountsPurged: number; readonly guestSessionsPurged: number }> {
  const { accountsPurged, guestSessionsPurged } = await withTransaction(async (tx) => ({
    accountsPurged: await userRepo.purgeScheduledDeletions(now, tx),
    guestSessionsPurged: await guestRepo.purgeExpiredGuestSessions(now, tx),
  }));
  if (accountsPurged > 0 || guestSessionsPurged > 0) {
    log.info("retention sweep", { accountsPurged, guestSessionsPurged });
  }
  return { accountsPurged, guestSessionsPurged };
}
