import { getDb, type Database } from "@/db/client";

/**
 * Transaction handle.
 *
 * Services orchestrate transactions; repositories run inside them. Both take an `Executor`
 * so that the same repository function works standalone or as part of a larger unit of work
 * without a second code path.
 */
export type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Runs `work` in a single transaction.
 *
 * Round ingest depends on this: a round is written whole or not at all (`SENS-NFR-020`).
 * A half-written round would leave a session whose trial counts silently disagree with its
 * aggregates, which is exactly the kind of quiet corruption this product cannot tolerate.
 *
 * No transaction may span a network call to anything else (doc 21 §21.4).
 */
export async function withTransaction<T>(work: (tx: Executor) => Promise<T>): Promise<T> {
  const db = getDb();
  return db.transaction(async (tx) => work(tx));
}

/** Resolves an optional executor to the default connection. */
export function executor(given?: Executor): Executor {
  return given ?? getDb();
}
