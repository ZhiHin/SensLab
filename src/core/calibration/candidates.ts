import type { Rng } from "../random";
import { countsPer360, logSensitivity, type LogSensitivity } from "../types/brand";
import type { CandidateSource } from "../types/vocabulary";
import { toCountsPer360 } from "./bracket";
import type { Candidate, SearchBracket } from "./contracts";

/**
 * Candidate generation and blinding (doc 13 §13.5).
 *
 * ## Why three is the minimum
 *
 * Three points is the minimum for a quadratic fit, and therefore the minimum for **locating a
 * peak** rather than merely ranking three sensitivities. Four points (Advanced) buy one degree
 * of freedom for lack-of-fit, which is what lets Advanced's confidence legitimately exceed
 * Standard's rather than merely claiming to.
 *
 * ## Blinding
 *
 * Candidates carry opaque labels, and **the labels are re-shuffled every round** — so a player
 * cannot even track "the one called A" across rounds (`SENS-BR-007`). If a player knows which
 * candidate is which, they will not behave neutrally, and the entire measurement is of their
 * expectations rather than their aim. The mapping is held server-side and revealed only on the
 * result page.
 */

/** Opaque labels shown to the player. Meaningless by design. */
export const BLIND_LABELS = ["A", "B", "C", "D", "E", "F"] as const;
export type BlindLabel = (typeof BLIND_LABELS)[number];

/**
 * The offsets, as fractions of the bracket half-width, for a given candidate count.
 *
 * Three: the bracket's ends and its centre. Four: the ends plus two interior points at ±w/3,
 * which spreads the interior pair far enough apart to inform curvature without collapsing
 * towards the centre.
 */
export function candidateOffsets(count: number): readonly number[] {
  if (count === 3) return [-1, 0, 1];
  if (count === 4) return [-1, -1 / 3, 1 / 3, 1];
  throw new RangeError(`unsupported candidate count ${count}; doc 13 §13.5 defines 3 and 4`);
}

export interface GenerateCandidatesInput {
  readonly bracket: SearchBracket;
  readonly roundIndex: number;
  readonly count: number;
  readonly source: CandidateSource;
  /** Draws the label shuffle. Must come from the session seed (`SENS-BR-031`). */
  readonly rng: Rng;
  /** Index to continue numbering from, so candidate indices are unique across the session. */
  readonly startIndex: number;
}

/**
 * Generates one round's candidates, with labels shuffled.
 *
 * The candidate *index* is stable and ordered by x; only the visible label is shuffled. That
 * separation is what lets the engine reason about position while the player cannot.
 */
export function generateCandidates(input: GenerateCandidatesInput): readonly Candidate[] {
  const offsets = candidateOffsets(input.count);
  const labels = shuffledLabels(input.count, input.rng);

  return offsets.map((offset, position) => {
    const x = (input.bracket.centre as number) + offset * input.bracket.halfWidth;
    return {
      roundIndex: input.roundIndex,
      candidateIndex: input.startIndex + position,
      x: logSensitivity(x),
      countsPer360: countsPer360(toCountsPer360(x)),
      blindLabel: labels[position] as string,
      source: input.source,
    };
  });
}

/**
 * The anchor candidate: a re-test of the round-1 centre in the final round (doc 13 §13.5).
 *
 * A metrology check standard doing three jobs at once:
 *
 * 1. A within-session **test–retest** estimate — the same sensitivity measured early and late is
 *    a pure measure of session noise plus drift.
 * 2. It **identifies the drift term** far more strongly than counterbalancing can, because it is
 *    the same *x* at two widely separated times.
 * 3. A **sanity check on the result**: if the final estimate claims a large improvement over the
 *    starting point but the anchor re-test scores just as well, the result is downgraded.
 *
 * It costs one extra block, and it is the single highest-value addition to the naive
 * three-candidate design.
 */
export function anchorCandidate(input: {
  readonly x: LogSensitivity;
  readonly roundIndex: number;
  readonly candidateIndex: number;
  readonly rng: Rng;
}): Candidate {
  const labels = shuffledLabels(BLIND_LABELS.length, input.rng);
  return {
    roundIndex: input.roundIndex,
    candidateIndex: input.candidateIndex,
    x: input.x,
    countsPer360: countsPer360(toCountsPer360(input.x)),
    // Labelled like any other candidate: an anchor a player could recognise would be one they
    // could treat differently, which would destroy the very comparison it exists to provide.
    blindLabel: labels[0] as string,
    source: "anchor",
  };
}

/** Draws `count` labels in a seeded random order. */
function shuffledLabels(count: number, rng: Rng): readonly BlindLabel[] {
  if (count > BLIND_LABELS.length) {
    throw new RangeError(`only ${BLIND_LABELS.length} blind labels are defined`);
  }
  const pool: BlindLabel[] = [...BLIND_LABELS];
  // Fisher–Yates from the seeded stream, so the shuffle is reproducible from the session seed.
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = rng.nextInt(i + 1);
    const a = pool[i] as BlindLabel;
    const b = pool[j] as BlindLabel;
    pool[i] = b;
    pool[j] = a;
  }
  return pool.slice(0, count);
}
