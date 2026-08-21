import { and, eq, isNull } from "drizzle-orm";
import { algorithmVersions } from "@/db/schema";
import type { AlgorithmKind } from "@/core/types/vocabulary";
import type { StoredParameterVersion } from "@/lib/parameter-registry";
import { executor, type Executor } from "./transaction";

/**
 * Algorithm version lookups.
 *
 * Reference data, not owned by anyone, so these take no actor. The important consumer is the
 * boot integrity check: the compiled parameter sets are hashed and compared against these
 * rows, and a mismatch stops the process (doc 14 §14.9).
 */

export async function listStoredParameterVersions(
  tx?: Executor,
): Promise<readonly StoredParameterVersion[]> {
  const db = executor(tx);
  const rows = await db
    .select({
      kind: algorithmVersions.kind,
      versionLabel: algorithmVersions.versionLabel,
      paramsHash: algorithmVersions.paramsHash,
    })
    .from(algorithmVersions);
  return rows;
}

export interface AlgorithmVersionRef {
  readonly id: string;
  readonly kind: AlgorithmKind;
  readonly versionLabel: string;
}

export async function findAlgorithmVersion(
  kind: AlgorithmKind,
  versionLabel: string,
  tx?: Executor,
): Promise<AlgorithmVersionRef | null> {
  const db = executor(tx);
  const rows = await db
    .select({
      id: algorithmVersions.id,
      kind: algorithmVersions.kind,
      versionLabel: algorithmVersions.versionLabel,
    })
    .from(algorithmVersions)
    .where(
      and(
        eq(algorithmVersions.kind, kind),
        eq(algorithmVersions.versionLabel, versionLabel),
        isNull(algorithmVersions.deprecatedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Resolves several versions at once — what session creation needs to pin its provenance. */
export async function resolveAlgorithmVersionIds(
  requested: Readonly<Partial<Record<AlgorithmKind, string>>>,
  tx?: Executor,
): Promise<Readonly<Partial<Record<AlgorithmKind, string>>>> {
  const resolved: Partial<Record<AlgorithmKind, string>> = {};
  for (const [kind, label] of Object.entries(requested)) {
    if (label === undefined) continue;
    const row = await findAlgorithmVersion(kind as AlgorithmKind, label, tx);
    if (row !== null) resolved[kind as AlgorithmKind] = row.id;
  }
  return resolved;
}
