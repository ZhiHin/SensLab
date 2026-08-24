import { execFileSync } from "node:child_process";
import { config } from "dotenv";
import postgres from "postgres";

/**
 * E2E global setup: clear the rate-limit counters.
 *
 * The auth screens are deliberately rate limited per IP over a one-hour window (`SENS-SEC-011`),
 * and the E2E suite exercises them from a single machine. That combination makes the suite
 * non-repeatable: running it twice in an hour trips the limiter, and the second run fails a test
 * that is asserting something else entirely.
 *
 * Clearing the counters before a run is a **test-isolation** fix, not a relaxation of the limit.
 * The limiter's own behaviour is covered by the integration suite, which asserts it triggers and
 * that it resets on schedule. What this removes is one run's ability to fail the next one.
 */
export default async function globalSetup(): Promise<void> {
  config({ path: [".env.test", ".env.local", ".env"], quiet: true });

  const url = process.env["DATABASE_MIGRATION_URL"] ?? process.env["DATABASE_URL"];
  if (url === undefined || url === "") {
    throw new Error(
      "E2E setup needs DATABASE_MIGRATION_URL or DATABASE_URL. Start the local database with " +
        "`npm run db:up` and copy .env.example to .env.local.",
    );
  }

  const sql = postgres(url, { max: 1, connect_timeout: 5, onnotice: () => {} });
  try {
    await sql`delete from rate_limit_counters`;
    // The results fixtures are rebuilt every run; stale sessions from previous runs go first so
    // the fixture account never accumulates.
    await sql`delete from test_sessions where user_id in (select id from users where email = ${"e2e-results@senslab.test"})`;
  } finally {
    await sql.end({ timeout: 5 });
  }

  // Results fixtures: real session loops, through the same script a developer can run by
  // hand. Shimming `server-only` the way the integration suite does.
  execFileSync("npx", ["tsx", "--tsconfig", "tsconfig.scripts.json", "scripts/e2e-fixtures.ts"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}
