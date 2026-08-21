import type { AlgorithmKind } from "../types/vocabulary";

/**
 * Versioned algorithm parameter sets (doc 14 §14.9, `SENS-BR-029`).
 *
 * Every tuning constant in SensLab lives in one of these, never as a literal in code. Two
 * reasons, both load-bearing:
 *
 *  1. A result generated under v1 must remain renderable and explainable after v2 ships
 *     (`SENS-BR-020`). That requires the v1 numbers to still exist and to be addressable.
 *  2. Released sets are **immutable**. Changing a weight produces a new version, never an
 *     edit — otherwise every historical result silently changes meaning.
 *
 * The loader hashes the serialised parameters and verifies the hash against the
 * `algorithm_versions` row at boot; a mismatch is a startup failure, not a warning.
 */
export interface ParameterSet<T> {
  readonly kind: AlgorithmKind;
  readonly version: string;
  /** ISO-8601 date the set was released. Sets are immutable from this point. */
  readonly releasedAt: string;
  readonly notes: string;
  readonly params: T;
}

/** Marks a value as a product judgement rather than a measured fact. */
export type Assumption<T> = T;
