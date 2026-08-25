import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });

/**
 * The retention sweep (doc 23 §23.11, `SENS-BR-003`, `SENS-SEC-021`).
 *
 * Data with a stated lifetime does not delete itself. Guest results expire after seven days
 * and a requested account deletion completes after thirty; both promises are made to the user
 * on screen and in the privacy copy, and both are kept by this running on a schedule.
 *
 * ## Why this calls repositories rather than `runRetentionSweep`
 *
 * The service layer imports `server-only`, which throws by design outside the Next.js server
 * bundle — that guard is what stops a service reaching a client component, and a scheduled job
 * is not a reason to weaken it. The three deletes below are the same three the service
 * performs, in the same transaction, against the same repository functions; the service keeps
 * its own copy for the in-app path (account deletion completing while the app is running) and
 * `tests/integration/accounts-history.test.ts` covers the behaviour through it.
 *
 * Idempotent and safe against a live database: it deletes only rows already past their
 * deadline. Running it twice does nothing the second time. Not running it at all corrupts
 * nothing — it means the product retains data it said it would not.
 *
 * Exits non-zero on failure so a scheduler notices. See `docs/operations/deployment.md`.
 */
async function main(): Promise<void> {
  // Imported after dotenv so env validation sees the loaded values.
  const { closeDb } = await import("../src/db/client");
  const { guestRepo, rateLimitRepo, userRepo } = await import("../src/repositories");
  const { withTransaction } = await import("../src/repositories/transaction");

  const now = new Date();
  try {
    const summary = await withTransaction(async (tx) => ({
      accountsPurged: await userRepo.purgeScheduledDeletions(now, tx),
      guestSessionsPurged: await guestRepo.purgeExpiredGuestSessions(now, tx),
      // Counters for closed windows are pure overhead. A day of slack keeps a sweep that runs
      // slightly early from clearing a window still being counted against.
      rateLimitWindowsPurged: await rateLimitRepo.purgeExpiredRateLimits(
        new Date(now.getTime() - 24 * 60 * 60 * 1000),
        tx,
      ),
    }));

    console.log("[sweep] done:", JSON.stringify(summary));
  } catch (error: unknown) {
    console.error("[sweep] failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

void main();
