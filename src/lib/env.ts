import { z } from "zod";

/**
 * Environment validation (doc 18 §18.10).
 *
 * Parsed once, at first access, through a schema. A missing or malformed variable is a
 * **startup failure**, not a runtime surprise three screens into a calibration.
 *
 * Nothing here is ever exposed to the client: there is no `NEXT_PUBLIC_` variable in this
 * schema, and a CI check greps the built bundle to keep it that way (`SENS-SEC-014`).
 */

const postgresUrl = z
  .string()
  .min(1)
  .refine(
    (value) => value.startsWith("postgres://") || value.startsWith("postgresql://"),
    "must be a postgres:// or postgresql:// connection string",
  );

const secret = z
  .string()
  .min(32, "must be at least 32 characters of high-entropy random data")
  .refine((value) => !value.startsWith("replace-me"), "must be replaced with a real secret");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url(),

  DATABASE_URL: postgresUrl,
  DATABASE_MIGRATION_URL: postgresUrl.optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

  AUTH_SECRET: secret,
  ABUSE_HASH_SALT: secret,

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  /**
   * How many reverse proxies sit in front of this application.
   *
   * `X-Forwarded-For` is a list that each hop **appends** to, so the entry a proxy added is at
   * the right and everything to its left was supplied by whoever called it — including the
   * client, who may write anything there. Reading the leftmost entry therefore takes the one
   * value an attacker fully controls, which would let them vary it per request and slip past
   * every per-IP rate limit in `auth-service` (`SENS-SEC-011`).
   *
   * The client address is the entry this many places from the right. `1` suits the usual
   * single reverse proxy or load balancer; raise it if traffic passes through more hops you
   * control, and set `0` only when the app is exposed directly and nothing rewrites the
   * header. Getting it too high is the safe direction: it falls back to the leftmost entry
   * rather than trusting a forged one.
   */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(1),
});

export type Env = z.infer<typeof envSchema>;

export class EnvironmentError extends Error {
  constructor(issues: string[]) {
    super(
      `Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join("\n")}\n` +
        `See .env.example for the full list of required variables.`,
    );
    this.name = "EnvironmentError";
  }
}

let cached: Env | null = null;

/**
 * Validated environment.
 *
 * Lazy so that importing a module which happens to reference `env` does not blow up a
 * client bundle or a build step that has no need of secrets.
 */
export function getEnv(): Env {
  if (cached !== null) return cached;

  if (typeof window !== "undefined") {
    throw new Error(
      "getEnv() was called in the browser. Server-only configuration must never reach the client.",
    );
  }

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new EnvironmentError(
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
  }

  cached = parsed.data;
  return cached;
}

/** Test support: forces the next `getEnv()` to re-read `process.env`. */
export function resetEnvCache(): void {
  cached = null;
}

/** Parses an arbitrary record — used by tests and by the migration script. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new EnvironmentError(
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
  }
  return parsed.data;
}

export const isProduction = (): boolean => getEnv().NODE_ENV === "production";
export const isTest = (): boolean => getEnv().NODE_ENV === "test";
