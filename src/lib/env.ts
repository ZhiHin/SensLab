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

const envShape = z.object({
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

  /**
   * Which email transport delivers verification and password-reset messages.
   *
   * `console` writes the message to stdout and is the development default. In production it
   * refuses to pretend: it reports `delivered: false` and logs an error on every send, because
   * a transport that silently swallows a password-reset link is worse than one that is absent.
   */
  EMAIL_TRANSPORT: z.enum(["console", "resend", "postmark"]).default("console"),
  /** Provider API key. Required by every transport except `console`. */
  EMAIL_API_KEY: z.string().min(1).optional(),
  /**
   * The `From` address, which must be on a domain the provider has verified. Providers reject
   * unverified senders outright, so a wrong value here fails every send rather than degrading.
   */
  EMAIL_FROM: z.email().optional(),
});

/**
 * Every variable this application reads.
 *
 * Exported so a test can hold `.env.example` to it. The template is what a new clone copies,
 * and a variable that exists in the schema but not in the template is one that nobody can
 * discover until it fails at startup.
 */
export const ENV_KEYS = Object.keys(envShape.shape);

const envSchema = envShape
  // Cross-field, because "which variables are required" depends on the transport chosen. A
  // provider selected without credentials would otherwise fail on the first real send — during
  // somebody's password reset — instead of at startup.
  .superRefine((env, ctx) => {
    if (env.EMAIL_TRANSPORT === "console") return;
    for (const key of ["EMAIL_API_KEY", "EMAIL_FROM"] as const) {
      if (env[key] === undefined) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `is required when EMAIL_TRANSPORT is "${env.EMAIL_TRANSPORT}"`,
        });
      }
    }
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
