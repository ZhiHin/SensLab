import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load the local environment for drizzle-kit's own CLI invocations. The application never
// relies on this: it validates the environment through src/lib/env.ts.
config({ path: [".env.local", ".env"], quiet: true });

const url = process.env["DATABASE_MIGRATION_URL"] ?? process.env["DATABASE_URL"];
if (url === undefined || url === "") {
  throw new Error(
    "DATABASE_MIGRATION_URL (preferred) or DATABASE_URL must be set to generate or apply migrations.",
  );
}

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url },
  casing: "snake_case",
  strict: true,
  verbose: true,
});
