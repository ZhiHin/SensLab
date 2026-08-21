import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

/**
 * Database connection (doc 21 §21.4).
 *
 * The runtime uses `DATABASE_URL`, which must point at the least-privilege `senslab_app`
 * role — no DDL, no DROP, no TRUNCATE (`SENS-SEC-015`). The migration URL is separate and is
 * never read by the application process.
 *
 * Timeouts are set at connection level as a backstop; the authoritative values are set on the
 * role itself so that a connection which forgets them still cannot hold a transaction open.
 */

export type Database = PostgresJsDatabase<typeof schema>;

let client: postgres.Sql | null = null;
let database: Database | null = null;

export function getDb(): Database {
  if (database !== null) return database;

  const env = getEnv();
  client = postgres(env.DATABASE_URL, {
    max: env.DATABASE_POOL_MAX,
    idle_timeout: 30,
    connect_timeout: 10,
    // postgres.js prints notices to the console by default; route them nowhere so that the
    // structured logger stays the only log transport.
    onnotice: () => {},
    transform: { undefined: null },
  });

  database = drizzle(client, { schema, casing: "snake_case" });
  return database;
}

/** Closes the pool. Used by scripts and by the integration-test teardown. */
export async function closeDb(): Promise<void> {
  if (client !== null) {
    await client.end({ timeout: 5 });
    client = null;
    database = null;
  }
}

export { schema };
