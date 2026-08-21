import { and, eq, lt, sql } from "drizzle-orm";
import { rateLimitCounters } from "@/db/schema";
import { executor, type Executor } from "./transaction";

/**
 * Fixed-window rate limiting (doc 23 §23.8).
 *
 * PostgreSQL rather than Redis at MVP: the volumes do not justify another moving part, and a
 * database-backed limiter is correct across instances without one. The counter increment is a
 * single atomic upsert, so concurrent requests cannot both read a stale count.
 */

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly count: number;
  readonly limit: number;
  readonly retryAfterSeconds: number;
}

/**
 * Consumes one unit from `bucket`.
 *
 * `windowSeconds` defines a fixed window; the window a request belongs to is derived from its
 * timestamp so that no separate reset job is needed.
 */
export async function consumeRateLimit(
  bucket: string,
  limit: number,
  windowSeconds: number,
  now: Date,
  tx?: Executor,
): Promise<RateLimitResult> {
  const db = executor(tx);
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);

  const rows = await db
    .insert(rateLimitCounters)
    .values({ bucket, windowStart, count: 1, updatedAt: now })
    .onConflictDoUpdate({
      target: [rateLimitCounters.bucket, rateLimitCounters.windowStart],
      set: {
        count: sql`${rateLimitCounters.count} + 1`,
        updatedAt: now,
      },
    })
    .returning({ count: rateLimitCounters.count });

  const count = rows[0]?.count ?? limit + 1;
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000),
  );

  return { allowed: count <= limit, count, limit, retryAfterSeconds };
}

/** Reads a bucket without consuming. Used by tests and by diagnostics. */
export async function peekRateLimit(
  bucket: string,
  windowSeconds: number,
  now: Date,
  tx?: Executor,
): Promise<number> {
  const db = executor(tx);
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const rows = await db
    .select({ count: rateLimitCounters.count })
    .from(rateLimitCounters)
    .where(
      and(eq(rateLimitCounters.bucket, bucket), eq(rateLimitCounters.windowStart, windowStart)),
    )
    .limit(1);
  return rows[0]?.count ?? 0;
}

export async function purgeExpiredRateLimits(cutoff: Date, tx?: Executor): Promise<number> {
  const db = executor(tx);
  const rows = await db
    .delete(rateLimitCounters)
    .where(lt(rateLimitCounters.windowStart, cutoff))
    .returning({ bucket: rateLimitCounters.bucket });
  return rows.length;
}
