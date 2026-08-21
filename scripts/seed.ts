import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });

/**
 * Seeds reference data (doc 21 §21.9).
 *
 * Idempotent: re-running after every migration is expected, and in CI it runs on a fresh
 * database on every integration test run.
 */
async function main(): Promise<void> {
  // Imported after dotenv so that env validation sees the loaded values.
  const { getDb, closeDb } = await import("../src/db/client");
  const { seedAll, verifySeededParameterHashes } = await import("../src/db/seed");

  const db = getDb();
  try {
    const summary = await seedAll(db);
    console.log("[seed] applied:", summary);

    const problems = await verifySeededParameterHashes(db);
    if (problems.length > 0) {
      console.error("[seed] parameter hash verification failed:");
      for (const problem of problems) console.error(`  - ${problem}`);
      process.exitCode = 1;
      return;
    }
    console.log("[seed] parameter hashes verified");
  } finally {
    await closeDb();
  }
}

main().catch((error: unknown) => {
  console.error("[seed] failed:", error);
  process.exit(1);
});
