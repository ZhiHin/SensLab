import type { Rng } from "../random";

/**
 * The validation block sequence (doc 17 §17.2).
 *
 * ```
 *   quartet = randomly chosen from { ABBA, BAAB }, then repeated:  e.g.  ABBA BAAB
 * ```
 *
 * ABBA counterbalancing cancels a *linear* time trend exactly: within each quartet the two
 * arms sit at the same mean position in time. That is why it is preferred over alternation
 * for a run this short — and short enough that assuming the drift is linear is defensible,
 * unlike the calibration search, which needs a spline (doc 13 §13.7).
 *
 * The pairing used by the analysis is the adjacent pair: blocks `(0,1)`, `(2,3)`, … . In both
 * admissible quartets every adjacent pair contains one block of each arm, so pairing by
 * position needs no bookkeeping.
 */

export type ValidationArm = "A" | "B";

const QUARTETS: readonly (readonly ValidationArm[])[] = [
  ["A", "B", "B", "A"],
  ["B", "A", "A", "B"],
];

export function validationSequence(blocks: number, rng: Rng): readonly ValidationArm[] {
  if (!Number.isInteger(blocks) || blocks <= 0 || blocks % 4 !== 0) {
    throw new RangeError(
      `a validation needs a positive multiple of four blocks, received ${blocks}`,
    );
  }
  const sequence: ValidationArm[] = [];
  for (let quartet = 0; quartet < blocks / 4; quartet += 1) {
    sequence.push(...rng.pick(QUARTETS));
  }
  return sequence;
}

/** True when every quartet is ABBA or BAAB — the property the design rests on. */
export function isCounterbalanced(sequence: readonly ValidationArm[]): boolean {
  if (sequence.length === 0 || sequence.length % 4 !== 0) return false;
  for (let start = 0; start < sequence.length; start += 4) {
    const quartet = sequence.slice(start, start + 4).join("");
    if (quartet !== "ABBA" && quartet !== "BAAB") return false;
  }
  return true;
}

/** The pair a block belongs to: adjacent blocks form a pair. */
export function pairIndexOf(blockIndex: number): number {
  return Math.floor(blockIndex / 2);
}
