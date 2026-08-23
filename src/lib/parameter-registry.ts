import { RELEASED_PARAMETER_SETS } from "@/core/params";
import type { ParameterSet } from "@/core/params/types";
import type { AlgorithmKind } from "@/core/types/vocabulary";
import { canonicalJson } from "./canonical-json";
import { sha256 } from "./crypto";

/**
 * Parameter-set integrity (doc 14 §14.9, `SENS-BR-029`).
 *
 * Released parameter sets are immutable. The database records the hash of each one; the code
 * ships the values. At boot they are compared, and a mismatch is a **startup failure** — if
 * the code and the database disagree about what produced a stored result, every historical
 * recommendation has become unexplainable and continuing would compound the problem.
 */

export interface ParameterSetDigest {
  readonly kind: AlgorithmKind;
  readonly version: string;
  readonly releasedAt: string;
  readonly notes: string;
  readonly hash: Buffer;
  readonly hashHex: string;
  readonly params: unknown;
}

export function digestParameterSet(set: ParameterSet<unknown>): ParameterSetDigest {
  const hash = sha256(canonicalJson(set.params));
  return {
    kind: set.kind,
    version: set.version,
    releasedAt: set.releasedAt,
    notes: set.notes,
    hash,
    hashHex: hash.toString("hex"),
    params: set.params,
  };
}

export function allParameterSetDigests(): readonly ParameterSetDigest[] {
  return RELEASED_PARAMETER_SETS.map(digestParameterSet);
}

export class ParameterIntegrityError extends Error {
  readonly mismatches: readonly string[];

  constructor(mismatches: readonly string[]) {
    super(
      `Algorithm parameter sets do not match the database:\n` +
        mismatches.map((m) => `  - ${m}`).join("\n") +
        `\nA released parameter set is immutable (SENS-BR-029). If the values legitimately ` +
        `changed, release a new version rather than editing an existing one.`,
    );
    this.name = "ParameterIntegrityError";
    this.mismatches = mismatches;
  }
}

export interface StoredParameterVersion {
  readonly kind: AlgorithmKind;
  readonly versionLabel: string;
  readonly paramsHash: Buffer;
}

/**
 * Compares the compiled parameter sets against what the database recorded.
 *
 * Returns the list of problems rather than throwing, so callers can decide: the boot path
 * throws, while a diagnostic endpoint or a test can report.
 */
export function findParameterMismatches(
  stored: readonly StoredParameterVersion[],
): readonly string[] {
  const problems: string[] = [];
  const storedByKey = new Map(stored.map((row) => [`${row.kind}:${row.versionLabel}`, row]));

  for (const digest of allParameterSetDigests()) {
    const key = `${digest.kind}:${digest.version}`;
    const row = storedByKey.get(key);
    if (row === undefined) {
      problems.push(`${key} is compiled into the application but has no algorithm_versions row`);
      continue;
    }
    if (row.paramsHash.toString("hex") !== digest.hashHex) {
      problems.push(
        `${key} hash mismatch: database has ${row.paramsHash.toString("hex").slice(0, 16)}…, ` +
          `code has ${digest.hashHex.slice(0, 16)}…`,
      );
    }
    storedByKey.delete(key);
  }

  // Rows the code no longer knows about are not an error: historical versions must remain in
  // the database so that results generated under them stay explainable (`SENS-BR-020`).
  return problems;
}

export function assertParameterIntegrity(stored: readonly StoredParameterVersion[]): void {
  const problems = findParameterMismatches(stored);
  if (problems.length > 0) throw new ParameterIntegrityError(problems);
}
