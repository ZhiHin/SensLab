/**
 * Seeded pseudo-random number generation.
 *
 * Every random draw in SensLab — candidate order, target placement, timing jitter,
 * bootstrap resampling — derives from a single persisted session seed, so that any
 * session's exact stimulus sequence and any recommendation can be reproduced
 * (`SENS-BR-031`, doc 19 §19.8).
 *
 * `Math.random()` is never used anywhere in the domain. An architecture test enforces it.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, maxExclusive). */
  nextInt(maxExclusive: number): number;
  /** Uniform in [min, max). */
  nextRange(min: number, max: number): number;
  /** Uniformly picks one element. Throws on an empty array. */
  pick<T>(values: readonly T[]): T;
  /** Returns a new array, Fisher–Yates shuffled. Does not mutate the input. */
  shuffle<T>(values: readonly T[]): T[];
}

/**
 * cyrb128 — expands an arbitrary string into four well-mixed 32-bit seeds.
 * Not cryptographic; its job is decorrelation of streams, not secrecy.
 */
export function cyrb128(input: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;

  for (let i = 0; i < input.length; i += 1) {
    const k = input.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }

  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);

  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

/**
 * sfc32 — small, fast, statistically solid counter-based generator with a 128-bit state.
 * Chosen over an LCG (poor low-bit behaviour) and over a crypto RNG (not reproducible).
 */
export function sfc32(a: number, b: number, c: number, d: number): Rng {
  let s0 = a >>> 0;
  let s1 = b >>> 0;
  let s2 = c >>> 0;
  let s3 = d >>> 0;

  const next = (): number => {
    const t = (((s0 + s1) | 0) + s3) | 0;
    s3 = (s3 + 1) | 0;
    s0 = s1 ^ (s1 >>> 9);
    s1 = (s2 + (s2 << 3)) | 0;
    s2 = ((s2 << 21) | (s2 >>> 11)) >>> 0;
    s2 = (s2 + t) | 0;
    return (t >>> 0) / 4294967296;
  };

  const nextInt = (maxExclusive: number): number => {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new RangeError(`nextInt requires a positive integer bound, received ${maxExclusive}`);
    }
    return Math.floor(next() * maxExclusive);
  };

  return {
    next,
    nextInt,
    nextRange: (min, max) => min + next() * (max - min),
    pick<T>(values: readonly T[]): T {
      if (values.length === 0) throw new RangeError("pick() requires a non-empty array");
      const chosen = values[nextInt(values.length)];
      /* istanbul ignore next -- bounded by nextInt above */
      if (chosen === undefined) throw new RangeError("pick() produced an out-of-range index");
      return chosen;
    },
    shuffle<T>(values: readonly T[]): T[] {
      const out = [...values];
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = nextInt(i + 1);
        const a2 = out[i] as T;
        const b2 = out[j] as T;
        out[i] = b2;
        out[j] = a2;
      }
      return out;
    },
  };
}

/**
 * Derives an independent generator for one purpose from the session seed.
 *
 * Separate streams per purpose matter: changing the number of trials in one test must not
 * shift the target positions of another, and the paired-stimulus design (doc 13 §13.6)
 * requires candidate *i*'s trial *k* to draw exactly what candidate *j*'s trial *k* drew.
 */
export function deriveRng(
  seed: bigint | number | string,
  stream: string,
  ...indices: number[]
): Rng {
  // Strings are accepted because a session seed crosses the network as one — a 64-bit value
  // does not survive JSON as a number. Hashing makes the representation irrelevant, so
  // `deriveRng(42)` and `deriveRng("42")` are deliberately the same stream.
  const key = `${seed.toString()}::${stream}${indices.length > 0 ? `::${indices.join(":")}` : ""}`;
  const [a, b, c, d] = cyrb128(key);
  const rng = sfc32(a, b, c, d);
  // Discard the first few outputs: counter-based generators correlate slightly across
  // near-identical seeds until the state has mixed.
  for (let i = 0; i < 12; i += 1) rng.next();
  return rng;
}
