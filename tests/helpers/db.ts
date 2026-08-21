import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { newId, newSeed } from "@/lib/crypto";
import { algorithmRepo } from "@/repositories";
import { CURRENT_VERSIONS } from "@/core/params";
import type { Actor } from "@/repositories/actor";

/**
 * Integration-test database helpers.
 *
 * Isolation is by truncation of the *volatile* tables between tests, not by dropping the
 * schema: reference data (games, metric definitions, algorithm versions) is part of the
 * fixture, and re-seeding it per test would dominate the runtime for no benefit.
 *
 * `algorithm_versions` is deliberately never truncated — a trigger forbids deleting from it
 * (`SENS-BR-020`), and that trigger is itself something the suite verifies.
 */

const VOLATILE_TABLES = [
  "analytics_events",
  "telemetry_batches",
  "research_consents",
  "subjective_preferences",
  "validation_metric_deltas",
  "validation_runs",
  "recommendation_game_settings",
  "recommendation_dimension_scores",
  "recommendations",
  "candidate_scores",
  "round_metrics",
  "trial_metrics",
  "test_trials",
  "test_rounds",
  "calibration_rounds",
  "calibration_candidates",
  "session_quality_flags",
  "test_sessions",
  "user_game_settings",
  "hardware_profiles",
  "auth_tokens",
  "auth_sessions",
  "auth_identities",
  "user_profiles",
  "guest_sessions",
  "users",
  "rate_limit_counters",
] as const;

/**
 * Lazily resolves the connection.
 *
 * A function rather than a module-level constant because test files run sequentially in one
 * process and each closes the pool when it finishes; a captured handle would belong to a pool
 * the previous file already shut down.
 */
export const db = (): ReturnType<typeof getDb> => getDb();

/**
 * Clears the volatile tables between tests.
 *
 * Uses `DELETE`, not `TRUNCATE`, because the runtime role deliberately has no `TRUNCATE`
 * privilege (`SENS-SEC-015`) — and running the suite as the runtime role is the point: a test
 * that connects as the owner would not exercise the privileges production actually has.
 *
 * Deletion runs child-first even though most foreign keys cascade, so a future table that
 * omits `ON DELETE CASCADE` fails here loudly rather than leaving rows behind that quietly
 * contaminate the next test.
 */
export async function resetVolatileTables(): Promise<void> {
  const db = getDb();
  for (const table of VOLATILE_TABLES) {
    await db.execute(sql.raw(`delete from ${table}`));
  }
}

/** Resolves the algorithm version ids a session must pin (`SENS-BR-020`). */
export async function currentAlgorithmVersionIds(): Promise<{
  scoringVersionId: string;
  calibrationVersionId: string;
  confidenceVersionId: string;
}> {
  const resolved = await algorithmRepo.resolveAlgorithmVersionIds({
    scoring: CURRENT_VERSIONS.scoring,
    calibration: CURRENT_VERSIONS.calibration,
    confidence: CURRENT_VERSIONS.confidence,
  });

  const scoringVersionId = resolved.scoring;
  const calibrationVersionId = resolved.calibration;
  const confidenceVersionId = resolved.confidence;

  if (
    scoringVersionId === undefined ||
    calibrationVersionId === undefined ||
    confidenceVersionId === undefined
  ) {
    throw new Error("algorithm versions are not seeded; run `npm run db:seed`");
  }

  return { scoringVersionId, calibrationVersionId, confidenceVersionId };
}

export function makeHardwareSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    dpi: 800,
    dpiSource: "known",
    pollingRateHz: 1000,
    mousepadWidthMm: 450,
    ...overrides,
  };
}

export function makeEnvironmentFingerprint(overrides: Record<string, unknown> = {}) {
  return {
    viewport: { width: 2560, height: 1440 },
    screen: { width: 2560, height: 1440 },
    devicePixelRatio: 1,
    estimatedRefreshHz: 165,
    frameProbe: { meanMs: 6.06, p95Ms: 6.4, maxMs: 9.1, lateFrameRatio: 0.008, sampleCount: 495 },
    pointerLock: {
      supported: true,
      unadjustedMovementRequested: true,
      unadjustedMovementEffective: true,
    },
    browser: { name: "chrome", majorVersion: 140 },
    os: { family: "windows" },
    canvas: { cssWidth: 1920, cssHeight: 1080, backingWidth: 1920, backingHeight: 1080 },
    fovHorizontalHalfDeg: 51.5,
    aspectRatio: 16 / 9,
    testConfigVersion: "1.0.0",
    engineVersion: "1.0.0",
    timezoneOffsetMinutes: 0,
    ...overrides,
  };
}

/**
 * Asserts that a database operation failed for the expected reason.
 *
 * Drizzle wraps driver errors in a "Failed query: …" message and puts the PostgreSQL detail —
 * the constraint name, the permission denial — on `cause`. Matching only the outer message
 * would make these assertions pass for *any* failure, which would quietly turn a suite of
 * constraint tests into a suite that proves nothing.
 */
export async function expectDbFailure(operation: Promise<unknown>, pattern: RegExp): Promise<void> {
  let thrown: unknown;
  try {
    await operation;
  } catch (error: unknown) {
    thrown = error;
  }

  if (thrown === undefined) {
    throw new Error(`expected the operation to fail with ${pattern}, but it succeeded`);
  }

  const chain: string[] = [];
  let current: unknown = thrown;
  for (let depth = 0; depth < 6 && current !== undefined && current !== null; depth += 1) {
    if (current instanceof Error) {
      chain.push(current.message);
      current = (current as { cause?: unknown }).cause;
      continue;
    }
    chain.push(String(current));
    break;
  }

  const combined = chain.join("\n");
  if (!pattern.test(combined)) {
    throw new Error(`expected a failure matching ${pattern}, got:\n${combined}`);
  }
}

export const testSeed = (): bigint => newSeed();
export const testId = (): string => newId();

export const asUser = (userId: string): Actor => ({
  kind: "user",
  userId,
  guestSessionId: null,
});

export const asGuest = (guestSessionId: string): Actor => ({ kind: "guest", guestSessionId });
