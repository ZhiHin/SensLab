import { execFileSync } from "node:child_process";
import { config } from "dotenv";
import postgres from "postgres";

/**
 * Integration-test global setup.
 *
 * Brings the database to a known state before the suite runs: extensions, migrations,
 * post-migration objects, then the seed. All three steps are idempotent, so this is the same
 * path a developer runs locally and the same path CI runs against an ephemeral instance —
 * which is the point. A test suite that runs against a differently-prepared database is
 * testing something other than production.
 */
export default async function globalSetup(): Promise<void> {
  config({ path: [".env.test", ".env.local", ".env"], quiet: true });

  const url = process.env["DATABASE_MIGRATION_URL"] ?? process.env["DATABASE_URL"];
  if (url === undefined || url === "") {
    throw new Error(
      "Integration tests need DATABASE_MIGRATION_URL or DATABASE_URL. " +
        "Start the local database with `npm run db:up` and copy .env.example to .env.local.",
    );
  }

  await assertReachable(url);

  const run = (script: string): void => {
    execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", script], {
      stdio: "pipe",
      env: process.env,
    });
  };

  run("scripts/migrate.ts");
  run("scripts/seed.ts");
}

async function assertReachable(url: string): Promise<void> {
  const client = postgres(url, { max: 1, connect_timeout: 5, onnotice: () => {} });
  try {
    await client`select 1`;
  } catch (error: unknown) {
    throw new Error(
      `Could not reach the test database. Run \`npm run db:up\` first.\n` +
        `  ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    await client.end({ timeout: 5 });
  }
}
