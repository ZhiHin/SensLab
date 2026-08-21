/**
 * A total result type for operations that can fail in an expected, meaningful way.
 *
 * SensLab uses this rather than exceptions for domain failures whose whole point is that
 * the caller must not proceed — most importantly game conversion, where an unverified
 * adapter must never yield a number (`SENS-BR-013`, `SENS-BR-014`). A discriminated union
 * makes "I forgot to handle the failure" a type error rather than a runtime surprise, which
 * a thrown exception cannot do.
 */

export type Ok<T> = { readonly ok: true; readonly value: T };

export type Err<E> = { readonly ok: false; readonly error: E };

export type Result<T, E> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });

export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export const isOk = <T, E>(result: Result<T, E>): result is Ok<T> => result.ok;

export const isErr = <T, E>(result: Result<T, E>): result is Err<E> => !result.ok;

/**
 * Unwrap a result, throwing if it failed.
 *
 * Only for call sites where a failure genuinely is a programming error (tests, and code
 * that has already checked the precondition). Never use this to defeat a verification gate.
 */
export function unwrap<T, E>(result: Result<T, E>, context?: string): T {
  if (result.ok) return result.value;
  const detail = typeof result.error === "string" ? result.error : JSON.stringify(result.error);
  throw new Error(`${context ?? "unwrap"} failed: ${detail}`);
}

export function mapOk<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}
