import { describe, expect, it } from "vitest";
import { deriveRng } from "@/core/random";
import { countsPer360 } from "@/core/types/brand";
import { isCounterbalanced, pairIndexOf, validationSequence } from "@/core/validation";
import { createPairedBlocksPlan, createScreeningPlan } from "@/test-engine/plan";
import { getTestDefinition } from "@/test-engine/tests";
import type { CandidateAssignment, SessionPlan } from "@/test-engine/contracts";

/**
 * The paired-block and screening plans (doc 17 §17.2, §17.7).
 *
 * What matters here is not that a plan is produced but that the design survives being turned
 * into one: pairs stay adjacent, paired blocks share their stimuli, and nothing the client
 * receives names a sensitivity.
 */

const TESTS = ["flick", "micro", "tracking"]
  .map((key) => getTestDefinition(key))
  .filter((definition) => definition !== undefined);

const arm = (candidateIndex: number, counts: number, blindLabel: string): CandidateAssignment => ({
  candidateIndex,
  countsPer360: countsPer360(counts),
  blindLabel,
});

const ARMS = { A: arm(0, 8000, "K"), B: arm(1, 11000, "M") };

function pairedPlan(overrides: Partial<Parameters<typeof createPairedBlocksPlan>[0]> = {}) {
  return createPairedBlocksPlan({
    sessionId: "00000000-0000-7000-8000-0000000paired",
    seed: "paired-seed",
    mode: "validation",
    arms: ARMS,
    sequence: validationSequence(8, deriveRng("paired-seed", "sequence")),
    tests: TESTS,
    trialsPerBlock: { flick: 6, micro: 6, tracking: 2 },
    baselineCountsPer360: 8000,
    aspectRatio: 16 / 9,
    maxImpliedCountsPerSecond: 4_000_000,
    practice: true,
    firstBlockIndex: 2,
    presentationOffset: 0,
    ...overrides,
  });
}

const scored = (plan: SessionPlan) => plan.rounds.filter((round) => !round.isPractice);

describe("the paired-blocks plan — doc 17 §17.2", () => {
  it("runs practice first, then one block per sequence position, pairs adjacent", () => {
    const plan = pairedPlan();
    const practice = plan.rounds.filter((round) => round.isPractice);
    expect(practice.length).toBeGreaterThan(0);
    expect(practice.every((round) => round.blockIndex === 0 && round.candidateIndex === null)).toBe(
      true,
    );

    const blocks = [...new Set(scored(plan).map((round) => round.blockIndex))];
    expect(blocks).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    // Adjacent blocks form a pair, and every pair holds one block of each arm.
    for (let pair = 1; pair <= 4; pair += 1) {
      const inPair = scored(plan).filter((round) => pairIndexOf(round.blockIndex) === pair);
      expect(new Set(inPair.map((round) => round.candidateIndex)).size).toBe(2);
    }
    const armOf = (block: number) =>
      scored(plan).find((round) => round.blockIndex === block)?.candidateIndex === 0 ? "A" : "B";
    expect(isCounterbalanced(blocks.map(armOf))).toBe(true);
  });

  it("matches stimuli within a pair and varies them between pairs", () => {
    const plan = pairedPlan();
    const seedsFor = (block: number) =>
      scored(plan)
        .filter((round) => round.blockIndex === block)
        .map((round) => `${round.testKey}:${round.stimulusSeed}`)
        .sort();
    expect(seedsFor(2)).toEqual(seedsFor(3));
    expect(seedsFor(4)).toEqual(seedsFor(5));
    expect(seedsFor(2)).not.toEqual(seedsFor(4));
  });

  it("uses the protocol's trial counts and varies test order between blocks", () => {
    const plan = pairedPlan();
    const flick = scored(plan).filter((round) => round.testKey === "flick");
    expect(flick.every((round) => round.trialCount === 6)).toBe(true);
    const tracking = scored(plan).filter((round) => round.testKey === "tracking");
    expect(tracking.every((round) => round.trialCount === 2)).toBe(true);

    const openers = [2, 3, 4].map(
      (block) => scored(plan).find((round) => round.blockIndex === block)?.testKey,
    );
    expect(openers[0]).not.toBe(openers[1]);
    expect(openers[1]).not.toBe(openers[2]);
  });

  it("falls back to a test's own trial count when the protocol does not name it", () => {
    const plan = pairedPlan({ trialsPerBlock: {} });
    const flick = scored(plan).find((round) => round.testKey === "flick");
    expect(flick?.trialCount).toBe(getTestDefinition("flick")?.trialCount("validation"));
  });

  it("carries only what the engine needs: two blinded candidates and no sensitivity", () => {
    const plan = pairedPlan();
    expect(plan.candidates).toEqual([ARMS.A, ARMS.B]);
    expect(plan.mode).toBe("validation");
    expect(JSON.stringify(plan.rounds)).not.toContain("8000");
    expect(plan.rounds.map((round) => round.presentationOrder)).toEqual(
      plan.rounds.map((_, index) => index),
    );
  });

  it("continues the presentation numbering and can skip practice for a later stage", () => {
    const plan = pairedPlan({
      practice: false,
      firstBlockIndex: 10,
      presentationOffset: 40,
      sequence: validationSequence(4, deriveRng("duel", "sequence")),
    });
    expect(plan.rounds.every((round) => !round.isPractice)).toBe(true);
    expect(plan.rounds[0]?.presentationOrder).toBe(40);
    expect([...new Set(plan.rounds.map((round) => round.blockIndex))]).toEqual([10, 11, 12, 13]);
  });

  it("is reproducible from the seed", () => {
    expect(pairedPlan()).toEqual(pairedPlan());
  });

  it("refuses a layout the pairing rule cannot survive", () => {
    expect(() => pairedPlan({ firstBlockIndex: 3 })).toThrow(/even/);
    expect(() => pairedPlan({ firstBlockIndex: 0 })).toThrow(/block 0 free/);
    expect(() => pairedPlan({ sequence: [] })).toThrow(/needs a sequence/);
    expect(() => pairedPlan({ tests: [] })).toThrow(/needs tests/);
  });
});

describe("the screening plan — doc 17 §17.7 phase 1", () => {
  const CANDIDATES = [0, 1, 2, 3, 4].map((index) =>
    arm(index, 8000 + index * 500, "KMPRT"[index] ?? "?"),
  );

  function screeningPlan(order: readonly number[] = [3, 0, 4, 1, 2]) {
    return createScreeningPlan({
      sessionId: "00000000-0000-7000-8000-00000screen",
      seed: "screen-seed",
      mode: "fine_tune",
      candidates: CANDIDATES,
      order,
      tests: TESTS.slice(0, 2),
      trialsPerBlock: { flick: 10, micro: 10 },
      baselineCountsPer360: 9000,
      aspectRatio: 16 / 9,
      maxImpliedCountsPerSecond: 4_000_000,
      presentationOffset: 0,
    });
  }

  it("gives every candidate one block, in the order it was given, after practice", () => {
    const plan = screeningPlan();
    expect(plan.rounds.filter((round) => round.isPractice).length).toBeGreaterThan(0);
    const blocks = scored(plan).map((round) => round.blockIndex);
    expect([...new Set(blocks)]).toEqual([1, 2, 3, 4, 5]);
    const firstOfBlock = [1, 2, 3, 4, 5].map(
      (block) => scored(plan).find((round) => round.blockIndex === block)?.candidateIndex,
    );
    expect(firstOfBlock).toEqual([3, 0, 4, 1, 2]);
  });

  it("matches stimuli across candidates, as a calibration round does", () => {
    const plan = screeningPlan();
    const flickSeeds = new Set(
      scored(plan)
        .filter((round) => round.testKey === "flick")
        .map((round) => round.stimulusSeed),
    );
    expect(flickSeeds.size).toBe(1);
  });

  it("refuses an order that is not a permutation of the candidates", () => {
    expect(() => screeningPlan([0, 0, 1, 2, 3])).toThrow(/permutation/);
    expect(() =>
      createScreeningPlan({
        sessionId: "s",
        seed: "x",
        mode: "fine_tune",
        candidates: [],
        order: [],
        tests: TESTS.slice(0, 2),
        trialsPerBlock: {},
        baselineCountsPer360: 9000,
        aspectRatio: 1,
        maxImpliedCountsPerSecond: 1,
        presentationOffset: 0,
      }),
    ).toThrow(/needs candidates/);
  });
});
