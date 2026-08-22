import type { Rng } from "../random";
import type { TestKey } from "../types/vocabulary";

/**
 * Presentation design: blocking, ordering and randomisation (doc 13 §13.6).
 *
 * ## Why a Latin square rather than a shuffle
 *
 * A player's performance depends on *when* in the session a block ran — warm-up early, fatigue
 * late. A random order removes that effect only on average, and with three rounds "on average"
 * is not close enough. A Latin square guarantees each candidate occupies **each position exactly
 * once**, so position effects cancel exactly rather than approximately.
 *
 * ## Why the same test does not open two consecutive blocks
 *
 * Test order within a block is randomised, but the constraint stops a player facing the same
 * task at the start of two blocks in a row — which would give that pairing a practice advantage
 * that belongs to the order, not the sensitivity.
 */

/**
 * A cyclic Latin square with a seeded starting row.
 *
 * Row `r` is the candidate order for round `r`. Cyclic construction is used rather than a random
 * Latin square because it is the only family that guarantees the property we actually need —
 * each candidate in each position exactly once — for any candidate count, and because it is
 * reproducible from a single seeded offset.
 */
export function latinSquare(size: number, rng: Rng): readonly (readonly number[])[] {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError(`Latin square size must be a positive integer, received ${size}`);
  }

  const offset = rng.nextInt(size);
  const rows: number[][] = [];

  for (let row = 0; row < size; row += 1) {
    const order: number[] = [];
    for (let position = 0; position < size; position += 1) {
      order.push((position + row + offset) % size);
    }
    rows.push(order);
  }

  return rows;
}

/**
 * The block order for one round: which candidate goes in which position.
 *
 * Returns candidate *positions* (0-based within the round), which the caller maps onto its own
 * candidate indices.
 */
export function blockOrderForRound(
  square: readonly (readonly number[])[],
  roundIndex: number,
): readonly number[] {
  const row = square[roundIndex % square.length];
  if (row === undefined) throw new RangeError("Latin square has no rows");
  return row;
}

/**
 * Randomised test order for a block, avoiding a repeat of the previous block's opener.
 *
 * Falls back to the plain shuffle when every ordering would repeat the opener — with one test
 * there is no alternative, and refusing to produce an order would be worse than repeating one.
 */
export function testOrderForBlock(
  tests: readonly TestKey[],
  rng: Rng,
  previousOpener: TestKey | null,
): readonly TestKey[] {
  if (tests.length <= 1) return [...tests];

  const shuffled = shuffle(tests, rng);
  if (previousOpener === null || shuffled[0] !== previousOpener) return shuffled;

  // Rotate the offending opener out of first place rather than reshuffling: a reshuffle loop
  // would consume an unpredictable number of draws from the seeded stream and make the whole
  // session non-reproducible.
  const swapWith = 1 + rng.nextInt(shuffled.length - 1);
  const rotated = [...shuffled];
  const first = rotated[0] as TestKey;
  const other = rotated[swapWith] as TestKey;
  rotated[0] = other;
  rotated[swapWith] = first;
  return rotated;
}

/** Seeded Fisher–Yates. */
function shuffle<T>(values: readonly T[], rng: Rng): T[] {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = rng.nextInt(i + 1);
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

/**
 * The stimulus seed for a (round, test, trial), **matched across candidates**.
 *
 * Candidate *i*'s flick trial *k* gets the same seeded target distance and direction as
 * candidate *j*'s flick trial *k*. This is a **paired design**, and it removes stimulus variance
 * from the between-candidate comparison — a substantial power gain for free, and the
 * second-highest-value decision in doc 13 after blinding.
 *
 * The candidate index is deliberately **not** part of the seed. The round index is, so nothing
 * is memorised between rounds.
 */
export function matchedStimulusSeed(
  sessionSeed: string,
  roundIndex: number,
  testKey: TestKey,
): string {
  return `${sessionSeed}:round${roundIndex}:${testKey}`;
}
