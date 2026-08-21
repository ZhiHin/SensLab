import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import postgres from "postgres";

/**
 * Applies the database role separation (doc 21 §21.3).
 *
 * Run after `db:migrate`, because the read-only grants reference the support views that the
 * post-migration step creates. Idempotent; safe to re-run after any migration that adds
 * tables (the default privileges cover future ones, but re-running is harmless).
 */

config({ path: [".env.local", ".env"], quiet: true });

const url = process.env["DATABASE_MIGRATION_URL"];
if (url === undefined || url === "") {
  console.error(
    "DATABASE_MIGRATION_URL must be set: roles are created with the owner connection, " +
      "never with the runtime role.",
  );
  process.exit(1);
}

async function main(): Promise<void> {
  const client = postgres(url as string, { max: 1, onnotice: () => {} });
  try {
    const sql = readFileSync(
      resolve(import.meta.dirname, "..", "src/db/sql/010-roles.sql"),
      "utf8",
    );
    await client.unsafe(sql);
    console.log("[roles] applied");
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error("[roles] failed:", error);
  process.exit(1);
});
