import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Migration runner.
 *
 * Three ordered steps, all idempotent, all forward-only (doc 21 §21.2):
 *
 *   1. `sql/000-extensions.sql`      — extensions the generated schema depends on.
 *   2. the generated Drizzle migrations.
 *   3. `sql/900-post-migration.sql`  — the immutability triggers, the comments and the
 *                                      support views, none of which Drizzle can express
 *                                      from a schema definition.
 *
 * Connects with `DATABASE_MIGRATION_URL` (the owner/migrator role) rather than the runtime
 * role, which by design has no DDL privileges (`SENS-SEC-015`).
 */

config({ path: [".env.local", ".env"], quiet: true });

const url = process.env["DATABASE_MIGRATION_URL"] ?? process.env["DATABASE_URL"];
if (url === undefined || url === "") {
  console.error(
    "DATABASE_MIGRATION_URL (preferred) or DATABASE_URL must be set. See .env.example.",
  );
  process.exit(1);
}

const root = resolve(import.meta.dirname, "..");
const readSql = (name: string): string => readFileSync(resolve(root, "src/db/sql", name), "utf8");

async function main(): Promise<void> {
  const client = postgres(url as string, { max: 1, onnotice: () => {} });

  try {
    console.log("[migrate] applying extensions");
    await client.unsafe(readSql("000-extensions.sql"));

    console.log("[migrate] applying generated migrations");
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: resolve(root, "src/db/migrations") });

    console.log("[migrate] applying post-migration objects");
    await client.unsafe(readSql("900-post-migration.sql"));

    console.log("[migrate] done");
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error("[migrate] failed:", error);
  process.exit(1);
});
