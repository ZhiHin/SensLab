import { describe, expect, it } from "vitest";
import { CALIBRATION_MODEL_V2, SCORING_MODEL_V2 } from "@/core/params";
import { deriveRng } from "@/core/random";
import type { ObservedTrial } from "@/core/scoring";
import {
  VALIDATION_ARMS,
  analyseValidation,
  familiarityAdvisoryApplies,
  isCounterbalanced,
  pairIndexOf,
  validationSequence,
  type ValidationOutcome,
} from "@/core/validation";

/**
 * The validation test (doc 17 §17.2–§17.3), against the properties §17.10 requires.
 *
 * The fixtures are synthetic but the analysis is the real one: matched block pairs, a paired
 * bootstrap over blocks and trials, a composite from the same objective the calibration
 * optimised, and a verdict read from that composite alone.
 */

const PROTOCOL = CALIBRATION_MODEL_V2.params.validation;

interface TrialSpec {
  readonly blockIndex: number;
  readonly arm: number;
  readonly index: number;
  readonly acquisition: number;
  readonly accuracy: number;
  readonly overshoot: number;
}

function trial(spec: TrialSpec): ObservedTrial {
  return {
    testKey: "flick",
    candidateIndex: spec.arm,
    roundIndex: 0,
    blockIndex: spec.blockIndex,
    trialIndex: spec.index,
    validity: "valid",
    isPractice: false,
    scopeKey: "hipfire",
    variant: null,
    metrics: {
      adjustedAcquisitionTime: spec.acquisition,
      firstShotAccuracy: spec.accuracy,
      overshootRate: spec.overshoot,
      flickErrorNorm: 0.5,
    },
  };
}

/**
 * Eight blocks in ABBA BAAB order, `perTrial` trials each. `advantage` is how much better arm
 * B is, in the units of each metric; `noise` is a deterministic wobble so the bootstrap has
 * something to resample.
 */
function session(options: {
  readonly advantage: number;
  readonly noise?: number;
  readonly blocks?: number;
  readonly perTrial?: number;
}): readonly ObservedTrial[] {
  const blocks = options.blocks ?? 8;
  const perTrial = options.perTrial ?? 6;
  const noise = options.noise ?? 0;
  const sequence = ["A", "B", "B", "A", "B", "A", "A", "B"] as const;
  const trials: ObservedTrial[] = [];

  for (let block = 0; block < blocks; block += 1) {
    const arm = sequence[block % sequence.length] === "A" ? 0 : 1;
    const better = arm === VALIDATION_ARMS.candidate ? options.advantage : 0;
    for (let index = 0; index < perTrial; index += 1) {
      // Deterministic, arm-independent wobble: the same pattern in both arms, so a paired
      // comparison sees the advantage and not the wobble.
      const wobble = noise * Math.sin(block * 2.7 + index * 1.3);
      trials.push(
        trial({
          blockIndex: 2 + block,
          arm,
          index,
          acquisition: 500 - better * 40 + wobble * 40,
          accuracy: Math.min(1, Math.max(0, 0.6 + better * 0.15 + wobble * 0.15)),
          overshoot: Math.min(1, Math.max(0, 0.3 - better * 0.08 + wobble * 0.08)),
        }),
      );
    }
  }
  return trials;
}

const analyse = (trials: readonly ObservedTrial[], seed = "validation-test"): ValidationOutcome =>
  analyseValidation({
    trials,
    scoring: SCORING_MODEL_V2.params,
    level: PROTOCOL.intervalLevel,
    resamples: 400,
    minimumPairs: PROTOCOL.minimumPairs,
    seed,
  });

describe("the block sequence — doc 17 §17.2", () => {
  it("is ABBA or BAAB in every quartet, and balanced overall", () => {
    for (const blocks of [4, 8, 12]) {
      const sequence = validationSequence(blocks, deriveRng("seq", "test", blocks));
      expect(sequence).toHaveLength(blocks);
      expect(isCounterbalanced(sequence)).toBe(true);
      expect(sequence.filter((arm) => arm === "A")).toHaveLength(blocks / 2);
      // ABBA cancels a linear trend exactly: the two arms sit at the same mean position.
      const positionOf = (arm: "A" | "B") =>
        sequence.reduce((sum, value, index) => sum + (value === arm ? index : 0), 0) / (blocks / 2);
      expect(positionOf("A")).toBeCloseTo(positionOf("B"), 9);
    }
  });

  it("refuses a block count that cannot be counterbalanced", () => {
    expect(() => validationSequence(6, deriveRng("seq", "test"))).toThrow(/multiple of four/);
    expect(() => validationSequence(0, deriveRng("seq", "test"))).toThrow(/multiple of four/);
    expect(isCounterbalanced(["A", "B", "A", "B"])).toBe(false);
    expect(isCounterbalanced([])).toBe(false);
  });

  it("pairs adjacent blocks", () => {
    expect([0, 1, 2, 3, 4, 5].map(pairIndexOf)).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it("is reproducible from the seed", () => {
    const a = validationSequence(8, deriveRng("same", "test"));
    const b = validationSequence(8, deriveRng("same", "test"));
    expect(b).toEqual(a);
  });
});

describe("the verdict — doc 17 §17.3, SENS-BR-016", () => {
  it("reports `improved` when arm B is genuinely better", () => {
    const outcome = analyse(session({ advantage: 1, noise: 0.15 }));
    expect(outcome.kind).toBe("analysed");
    if (outcome.kind !== "analysed") return;
    expect(outcome.verdict).toBe("improved");
    expect(outcome.composite.ciLow).toBeGreaterThan(0);
    expect(outcome.pairs).toBe(4);
    expect(outcome.blocks).toBe(8);
  });

  it("reports `worse` when arm A is better", () => {
    const outcome = analyse(session({ advantage: -1, noise: 0.15 }));
    expect(outcome.kind).toBe("analysed");
    if (outcome.kind !== "analysed") return;
    expect(outcome.verdict).toBe("worse");
    expect(outcome.composite.ciHigh).toBeLessThan(0);
  });

  it("reports `no_measurable_difference` for identical arms", () => {
    const outcome = analyse(session({ advantage: 0, noise: 0.3 }));
    expect(outcome.kind).toBe("analysed");
    if (outcome.kind !== "analysed") return;
    expect(outcome.verdict).toBe("no_measurable_difference");
    expect(outcome.composite.ciLow).toBeLessThanOrEqual(0);
    expect(outcome.composite.ciHigh).toBeGreaterThanOrEqual(0);
  });

  it("is deterministic for a seed, and every reported metric carries an interval", () => {
    const trials = session({ advantage: 1, noise: 0.15 });
    expect(analyse(trials)).toEqual(analyse(trials));

    const outcome = analyse(trials);
    if (outcome.kind !== "analysed") throw new Error("expected an analysis");
    expect(outcome.metrics.length).toBeGreaterThanOrEqual(3);
    for (const metric of outcome.metrics) {
      expect(metric.ciLow).toBeLessThanOrEqual(metric.ciHigh);
      // Significance is derived from the interval, never asserted independently.
      expect(metric.significant).toBe(metric.ciLow > 0 || metric.ciHigh < 0);
      expect(metric.pairs).toBeGreaterThanOrEqual(PROTOCOL.minimumPairs);
    }
  });

  it("aligns direction so a faster acquisition reads as favouring the candidate", () => {
    const outcome = analyse(session({ advantage: 1, noise: 0.15 }));
    if (outcome.kind !== "analysed") throw new Error("expected an analysis");
    const acquisition = outcome.metrics.find((m) => m.key === "adjustedAcquisitionTime");
    expect(acquisition?.direction).toBe("lower_better");
    expect(acquisition?.delta).toBeLessThan(0);
    expect(acquisition?.favoursCandidate).toBe(true);

    const accuracy = outcome.metrics.find((m) => m.key === "firstShotAccuracy");
    expect(accuracy?.delta).toBeGreaterThan(0);
    expect(accuracy?.favoursCandidate).toBe(true);
  });

  it("declines to analyse fewer than the minimum block pairs", () => {
    const outcome = analyse(session({ advantage: 1, noise: 0.1, blocks: 2 }));
    expect(outcome.kind).toBe("insufficient");
    if (outcome.kind !== "insufficient") return;
    expect(outcome.pairs).toBe(1);
    expect(outcome.required).toBe(PROTOCOL.minimumPairs);
  });

  it("never lets one significant metric decide the headline — the no-cherry-picking rule", () => {
    // Accuracy is lifted in arm B by a wide margin; everything else is identical. The
    // composite pools all of it and cannot separate the arms, so the verdict must not follow
    // the one metric that can.
    const trials: ObservedTrial[] = [];
    const sequence = ["A", "B", "B", "A", "B", "A", "A", "B"] as const;
    for (let block = 0; block < 8; block += 1) {
      const arm = sequence[block] === "A" ? 0 : 1;
      for (let index = 0; index < 6; index += 1) {
        const wobble = Math.sin(block * 2.7 + index * 1.3);
        trials.push(
          trial({
            blockIndex: 2 + block,
            arm,
            index,
            // Slow when B, fast when A — cancels the accuracy gain in the composite.
            acquisition: 500 + (arm === 1 ? 60 : 0) + wobble * 20,
            accuracy: arm === 1 ? 0.95 : 0.35,
            overshoot: 0.3 + wobble * 0.05,
          }),
        );
      }
    }
    const outcome = analyse(trials);
    if (outcome.kind !== "analysed") throw new Error("expected an analysis");
    const accuracy = outcome.metrics.find((m) => m.key === "firstShotAccuracy");
    expect(accuracy?.significant).toBe(true);
    expect(accuracy?.favoursCandidate).toBe(true);
    expect(outcome.verdict).toBe("no_measurable_difference");
  });
});

describe("the familiarity advisory — doc 17 §17.6", () => {
  it("applies only beyond the documented log2 distance", () => {
    const threshold = CALIBRATION_MODEL_V2.params.familiarityAdvisoryLogDelta;
    const base = 10_000;
    expect(familiarityAdvisoryApplies(base, base * 2 ** (threshold * 1.1), threshold)).toBe(true);
    expect(familiarityAdvisoryApplies(base, base * 2 ** (threshold * 0.9), threshold)).toBe(false);
    // Symmetric: a change in either direction costs the same adaptation.
    expect(familiarityAdvisoryApplies(base, base / 2 ** (threshold * 1.1), threshold)).toBe(true);
  });
});
