import { deriveRng, type Rng } from "@/core/random";
import type { ScoredTrial } from "@/core/calibration/contracts";

/**
 * Synthetic players with a known optimum (doc 19 §19.12, harness 2).
 *
 * doc 19 calls this **the single most important test in the entire project**, and the reason is
 * simple: every other test asserts that a component computes what it was told to compute. This
 * one asserts that the whole pipeline, run on a player whose true optimum is known, *recovers
 * that optimum*. Nothing else can catch an error that is consistent across components.
 *
 * The players here generate **already-scored trials** — the objective's output — because the
 * calibration engine's contract starts there. A player that generated raw mouse movement would
 * be testing the metric layer again, which Phase 3 already tests directly against known traces.
 */

export interface PlayerShape {
  /** The player's true optimum, in log2(counts/360). */
  readonly optimumX: number;
  /** How sharply performance falls away from the optimum. 0 makes the player flat. */
  readonly curvature: number;
  /** Trial-level noise standard deviation. */
  readonly noiseSd: number;
  /**
   * Session drift in score units from the first block to the last.
   *
   * Positive is a player still warming up; negative is fatigue. Real sessions do both, which is
   * why the drift model is a spline rather than a slope.
   */
  readonly driftTotal?: number;
  /** When set, drift rises then falls — the shape a straight line cannot represent. */
  readonly driftShape?: "linear" | "warm_then_tire";
}

export interface GenerateTrialsInput {
  readonly shape: PlayerShape;
  /** Candidate index → the x it was run at. */
  readonly candidates: readonly { readonly candidateIndex: number; readonly x: number }[];
  /** Trials per candidate. */
  readonly trialsPerCandidate: number;
  /** Block index for each candidate, i.e. where in the session it ran. */
  readonly blockOf: (candidateIndex: number) => number;
  readonly roundIndex: number;
  readonly seed: string;
  /** Fraction of trials replaced with a wild value, for robustness tests. */
  readonly outlierRate?: number;
  readonly outlierMagnitude?: number;
}

/** Total blocks a session ran, used to normalise the drift curve. */
function driftAt(shape: PlayerShape, block: number, maxBlock: number): number {
  const total = shape.driftTotal ?? 0;
  if (total === 0 || maxBlock <= 0) return 0;
  const progress = block / maxBlock;

  if ((shape.driftShape ?? "linear") === "linear") return total * progress;

  // Warm up then tire: rises to a peak around two-thirds through, then falls back past zero.
  // A straight-line drift model cannot represent this, which is exactly why it is here.
  return total * Math.sin(Math.PI * progress) - total * 0.4 * progress;
}

/** Box–Muller from the seeded stream, so noise is reproducible. */
function gaussian(rng: Rng): number {
  const u1 = Math.max(rng.next(), 1e-12);
  const u2 = rng.next();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Generates one round of scored trials for a synthetic player.
 *
 * The underlying truth is a downward parabola centred on the player's optimum, plus the session
 * drift, plus noise:
 *
 * ```
 * score = −curvature·(x − optimum)² + g(block) + ε
 * ```
 */
export function generateTrials(input: GenerateTrialsInput): readonly ScoredTrial[] {
  const rng = deriveRng(input.seed, "synthetic-player", input.roundIndex);
  const maxBlock = Math.max(...input.candidates.map((c) => input.blockOf(c.candidateIndex)), 1);
  const outlierRate = input.outlierRate ?? 0;
  const outlierMagnitude = input.outlierMagnitude ?? 8;

  const trials: ScoredTrial[] = [];

  for (const candidate of input.candidates) {
    const block = input.blockOf(candidate.candidateIndex);
    const offset = candidate.x - input.shape.optimumX;
    const truth = -input.shape.curvature * offset * offset;

    for (let i = 0; i < input.trialsPerCandidate; i += 1) {
      const wild = outlierRate > 0 && rng.next() < outlierRate;
      const noise = gaussian(rng) * input.shape.noiseSd;
      const score =
        truth +
        driftAt(input.shape, block, maxBlock) +
        noise +
        // A wild trial is a genuine performance event, not a measurement error — it must enter
        // the estimator, and the bounded-influence clip is what stops it deciding the answer.
        (wild ? -outlierMagnitude : 0);

      trials.push({
        candidateIndex: candidate.candidateIndex,
        roundIndex: input.roundIndex,
        blockIndex: block,
        score,
      });
    }
  }

  return trials;
}

/** A player with a clear optimum at 30 cm/360-ish and moderate noise. */
export const CLEAR_PEAK: PlayerShape = { optimumX: 13.2, curvature: 1.2, noiseSd: 0.35 };

/**
 * A player whose response is genuinely flat.
 *
 * The honest answer for this player is "no uniquely distinguishable optimum" — not a point
 * recommendation drawn from noise (`SENS-BR-017`).
 */
export const FLAT: PlayerShape = { optimumX: 13.2, curvature: 0, noiseSd: 0.35 };

/** A player who gets monotonically better through the session — a warm-up that never ends. */
export const WARMING_UP: PlayerShape = {
  optimumX: 13.2,
  curvature: 1.2,
  noiseSd: 0.3,
  driftTotal: 1.0,
  driftShape: "linear",
};

/** A player who warms up and then tires — the shape a linear drift term cannot represent. */
export const WARM_THEN_TIRE: PlayerShape = {
  optimumX: 13.2,
  curvature: 1.2,
  noiseSd: 0.3,
  driftTotal: 1.2,
  driftShape: "warm_then_tire",
};

/**
 * A player so inconsistent that no candidate can be separated from another.
 *
 * The distinguishing property is not "noisy" on its own — it is that the **real effect is small
 * relative to the variance**. This player's response does have a peak; the session simply cannot
 * see it, which is a different finding from "the response is flat" and is reported differently
 * (doc 04 §4.4.9: variance, not sensitivity, is the limiter).
 */
export const INCONSISTENT: PlayerShape = { optimumX: 13.2, curvature: 0.1, noiseSd: 4.0 };
