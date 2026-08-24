import { CALIBRATION_MODEL_V1, type CalibrationParams } from "./calibration-model-v1";
import type { ParameterSet } from "./types";

/**
 * `calibration_model_v2` — v1 plus the validation and fine-tuning protocol (doc 17), and the
 * post-MVP sample floors Phase 6 deferred.
 *
 * ## What changed and why it is a new version
 *
 * A released set is immutable (`SENS-BR-029`). Doc 17 needs constants v1 does not carry — how
 * many paired blocks a validation runs, how short its blocks are, the duel budget for a
 * fine-tune — and the post-MVP tests have declared their own floors since Phase 6 while the
 * set only named the MVP seven. Both belong in the released set rather than in code, so the
 * set is re-released. **Every search constant is identical to v1**: a session analysed under
 * v2 produces the same curve as under v1, and the golden fixture pins that.
 *
 * ## Validation (doc 17 §17.2)
 *
 * Paired ABBA/BAAB blocks, a reduced battery (Flick, Micro, Tracking — the most sensitivity
 * signal per second, doc 14 §14.7), four to eight blocks. Block lengths are short on purpose:
 * a block of six flicks, six micro-adjustments and two tracking sweeps is about forty seconds,
 * so eight blocks fit the "four to six minutes" doc 17 budgets.
 *
 * ## Fine-tuning (doc 17 §17.7)
 *
 * Five blinded candidates at `x* + {−δ₂, −δ₁, 0, +δ₁, +δ₂}`; a screening block per candidate
 * on Flick and Micro; then the top two duel in paired blocks with an early stop once the
 * paired interval excludes zero, up to a fixed budget. The duel advances one counterbalanced
 * quartet at a time, so a look happens after every two block pairs; the number of looks is
 * bounded by `duelQuartetBudget` and recoverable from the stored blocks; the interval is not adjusted for
 * multiplicity in this version — a known simplification doc 17 records.
 */

export interface ValidationProtocolParams {
  /** Paired blocks per validation, by the calibration's mode. Always a multiple of four. */
  readonly blocks: { readonly quick: number; readonly standard: number; readonly advanced: number };
  /** Trials of each test in one block. */
  readonly trialsPerBlock: Readonly<Record<string, number>>;
  /** Tests in the reduced battery, in roster order. */
  readonly tests: readonly string[];
  /** Fewest complete block pairs an analysis may be drawn from. */
  readonly minimumPairs: number;
  /** Two-sided level of every reported interval. */
  readonly intervalLevel: number;
  readonly bootstrapResamples: number;
}

export interface FineTuneProtocolParams {
  /** Candidate offsets from `x*` in log2 units — `−δ₂, −δ₁, 0, +δ₁, +δ₂`. */
  readonly offsets: readonly number[];
  /** Tests in the screening block and the duel. */
  readonly tests: readonly string[];
  readonly screeningTrialsPerBlock: Readonly<Record<string, number>>;
  readonly duelTrialsPerBlock: Readonly<Record<string, number>>;
  /** Counterbalanced quartets (ABBA / BAAB) the duel may run before it must stop. */
  readonly duelQuartetBudget: number;
}

export interface CalibrationParamsV2 extends CalibrationParams {
  readonly validation: ValidationProtocolParams;
  readonly fineTune: FineTuneProtocolParams;
}

const V1 = CALIBRATION_MODEL_V1.params;

export const CALIBRATION_MODEL_V2: ParameterSet<CalibrationParamsV2> = Object.freeze({
  kind: "calibration",
  version: "calibration_model_v2",
  releasedAt: "2026-08-23",
  notes:
    "Adds the validation and fine-tuning protocol (doc 17) and the post-MVP sample floors. " +
    "Every search constant is unchanged from v1; results are identical for the same trials.",
  params: Object.freeze({
    ...V1,
    minimumValidTrials: Object.freeze({
      ...V1.minimumValidTrials,
      "wide-flick": Object.freeze({ quick: 8, standard: 8, advanced: 16 }),
      "strafe-tracking": Object.freeze({ quick: 3, standard: 5, advanced: 8 }),
      "slide-tracking": Object.freeze({ quick: 3, standard: 4, advanced: 6 }),
      speed: Object.freeze({ quick: 8, standard: 12, advanced: 16 }),
      recoil: Object.freeze({ quick: 4, standard: 6, advanced: 8 }),
      ads: Object.freeze({ quick: 12, standard: 20, advanced: 24 }),
    }),
    validation: Object.freeze({
      blocks: Object.freeze({ quick: 4, standard: 8, advanced: 8 }),
      trialsPerBlock: Object.freeze({ flick: 6, micro: 6, tracking: 2 }),
      tests: Object.freeze(["flick", "micro", "tracking"]),
      minimumPairs: 2,
      intervalLevel: 0.9,
      bootstrapResamples: 2000,
    }),
    fineTune: Object.freeze({
      offsets: V1.fineTuneOffsets,
      tests: Object.freeze(["flick", "micro"]),
      screeningTrialsPerBlock: Object.freeze({ flick: 10, micro: 10 }),
      duelTrialsPerBlock: Object.freeze({ flick: 6, micro: 6 }),
      duelQuartetBudget: 2,
    }),
  }),
});
