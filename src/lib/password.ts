import { hash, verify } from "@node-rs/argon2";

/**
 * Password hashing (doc 23 §23.3, `SENS-SEC-002`).
 *
 * Argon2id, memory-hard. The cost parameters below are the documented starting point and
 * should be re-benchmarked on the production instance during deployment and tuned to roughly
 * 250 ms per hash — a hash that is fast on the deploy target is fast for an attacker too.
 *
 * The algorithm is not passed explicitly: `@node-rs/argon2` defaults to Argon2id, and the
 * library's `Algorithm` enum is an ambient const enum that cannot be imported under
 * `verbatimModuleSyntax`. Rather than hardcode its numeric value, {@link hashPassword}
 * asserts the produced digest's algorithm prefix, which verifies the guarantee at runtime
 * instead of assuming it — and a unit test covers the same assertion.
 */

export const ARGON2_OPTIONS = {
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 1,
} as const;

/** Minimum length. No composition rules: they reduce entropy and annoy users (doc 23 §23.3). */
export const MIN_PASSWORD_LENGTH = 10;

export const ARGON2ID_PREFIX = "$argon2id$";

export async function hashPassword(password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new RangeError(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const digest = await hash(password, ARGON2_OPTIONS);
  if (!digest.startsWith(ARGON2ID_PREFIX)) {
    throw new Error(
      `expected an Argon2id digest but the hasher produced "${digest.slice(0, 12)}…". ` +
        `Refusing to store a password hashed with a weaker variant.`,
    );
  }
  return digest;
}

/**
 * Verifies a password against a stored digest.
 *
 * Returns false rather than throwing on a malformed stored hash, so that a corrupted row
 * produces a failed login instead of a 500 that reveals its shape.
 */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}
