import { describe, expect, it } from "vitest";
import { SCORING_MODEL_V2 } from "@/core/params";
import { computeObjective, scorableTrials, type ObservedTrial } from "@/core/scoring";
import { countsPer360 } from "@/core/types/brand";
import type { CandidateAssignment } from "@/test-engine/contracts";
import { createScopeCalibrationPlan } from "@/test-engine/plan";
import { adsTest, flickTest } from "@/test-engine/tests";
import { runBattery } from "../../helpers/battery-runner";

/**
 * Scope Calibration (doc 09 §9.14, doc 13 §13.12): the same engine over a different parameter.
 */

const CANDIDATES: readonly CandidateAssignment[] = [
  { candidateIndex: 0, countsPer360: countsPer360(14000), blindLabel: "A" },
  { candidateIndex: 1, countsPer360: countsPer360(18000), blindLabel: "B" },
  { candidateIndex: 2, countsPer360: countsPer360(22000), blindLabel: "C" },
];

const plan = (
  roundIndex: number,
  extra: Partial<Parameters<typeof createScopeCalibrationPlan>[0]> = {},
) =>
  createScopeCalibrationPlan({
    sessionId: "00000000-0000-7000-8000-0000000scope",
    seed: "scope-seed",
    mode: "standard",
    definition: adsTest,
    scopeKey: "x4",
    hipfireCountsPer360: countsPer360(9448.82),
    candidates: CANDIDATES,
    roundIndex,
    aspectRatio: 16 / 9,
    maxImpliedCountsPerSecond: 4_000_000,
    ...extra,
  });

describe("the scope calibration plan", () => {
  it("runs one ADS round per candidate under the scope, hipfire held at the baseline", () => {
    const built = plan(0);
    expect(built.searchParameter).toBe("scope");
    expect(built.baselineCountsPer360).toBe(9448.82);
    expect(built.candidates).toEqual(CANDIDATES);

    const measured = built.rounds.filter((round) => !round.isPractice);
    expect(measured).toHaveLength(3);
    expect(new Set(measured.map((round) => round.candidateIndex))).toEqual(new Set([0, 1, 2]));
    for (const round of built.rounds) {
      expect(round.testKey).toBe("ads");
      expect(round.scopeKey).toBe("x4");
    }
  });

  it("gives every candidate the same stimulus seed — matched stimuli", () => {
    const seeds = new Set(
      plan(0)
        .rounds.filter((round) => !round.isPractice)
        .map((round) => round.stimulusSeed),
    );
    expect(seeds.size).toBe(1);
  });

  it("counterbalances candidate order across rounds", () => {
    const order = (roundIndex: number) =>
      plan(roundIndex, { includePractice: false }).rounds.map((round) => round.candidateIndex);
    const first = order(0);
    const second = order(1);
    expect([...first].sort()).toEqual([0, 1, 2]);
    expect([...second].sort()).toEqual([0, 1, 2]);
    expect(second).not.toEqual(first);
  });

  it("includes a practice round only in the first round", () => {
    expect(plan(0).rounds[0]?.isPractice).toBe(true);
    expect(plan(1).rounds.some((round) => round.isPractice)).toBe(false);
  });

  it("refuses any test but ADS, and refuses an empty candidate list", () => {
    expect(() => plan(0, { definition: flickTest })).toThrow(/runs the ADS test/);
    expect(() => plan(0, { candidates: [] })).toThrow(/needs candidates/);
  });

  it("runs through the engine with the round sensitivity on the scoped segment", () => {
    // Under `scope`, every trial is scoped (no hipfire controls) and each candidate's round
    // completes. The derived-from-hipfire path is the ordinary session's; this is the other.
    const built = plan(0, { includePractice: false, mode: "quick" });
    const outcome = runBattery(adsTest, { plan: built, scopeKey: "x4" });
    expect(outcome.aggregates).toHaveLength(3);
    for (const round of outcome.aggregates) {
      expect(round.trials.every((trial) => trial.variant === "ads")).toBe(true);
      expect(round.trials.filter((t) => t.validity !== "invalid").length).toBeGreaterThan(0);
    }
  });
});

describe("the scope track in the objective", () => {
  const trial = (overrides: Partial<ObservedTrial>): ObservedTrial => ({
    testKey: "ads",
    candidateIndex: 0,
    roundIndex: 0,
    blockIndex: 0,
    trialIndex: 0,
    validity: "valid",
    isPractice: false,
    scopeKey: "x4",
    variant: "ads",
    metrics: { adjustedAcquisitionTime: 500, firstShotAccuracy: 1 },
    ...overrides,
  });

  it("keeps scopes apart and drops hipfire controls from a scoped track", () => {
    const trials = [
      trial({ trialIndex: 0 }),
      trial({ trialIndex: 1, variant: "hipfire" }),
      trial({ trialIndex: 2, scopeKey: "hipfire", testKey: "flick", variant: null }),
      trial({ trialIndex: 3, scopeKey: "x2" }),
    ];
    expect(scorableTrials(trials, "x4").map((t) => t.trialIndex)).toEqual([0]);
    expect(scorableTrials(trials, "hipfire").map((t) => t.trialIndex)).toEqual([2]);
    expect(scorableTrials(trials, "x2").map((t) => t.trialIndex)).toEqual([3]);
  });

  it("excludes a truncated slide from scoring while the trial itself is retained", () => {
    const trials = [
      trial({
        testKey: "slide-tracking",
        scopeKey: "hipfire",
        variant: null,
        metrics: { peakSpeedTrackingError: 1, pathTruncated: 1 },
      }),
      trial({
        testKey: "slide-tracking",
        scopeKey: "hipfire",
        variant: null,
        trialIndex: 1,
        metrics: { peakSpeedTrackingError: 1, pathTruncated: 0 },
      }),
    ];
    expect(scorableTrials(trials).map((t) => t.trialIndex)).toEqual([1]);
    expect(trials).toHaveLength(2);
  });

  it("computes the objective on the requested track only", () => {
    const trials: ObservedTrial[] = [];
    for (let i = 0; i < 12; i += 1) {
      trials.push(
        trial({
          trialIndex: i,
          candidateIndex: i % 3,
          metrics: { adjustedAcquisitionTime: 400 + i * 10, firstShotAccuracy: i % 2 },
        }),
      );
      trials.push(
        trial({
          trialIndex: 100 + i,
          candidateIndex: i % 3,
          scopeKey: "hipfire",
          testKey: "flick",
          variant: null,
          metrics: { adjustedAcquisitionTime: 900 + i * 10, firstShotAccuracy: 1 },
        }),
      );
    }
    const scoped = computeObjective(trials, {
      parameters: SCORING_MODEL_V2.params,
      scopeKey: "x4",
    });
    const hipfire = computeObjective(trials, { parameters: SCORING_MODEL_V2.params });
    expect(scoped.trials).toHaveLength(12);
    expect(hipfire.trials).toHaveLength(12);
    // The scales are per track: the hipfire flick trials centre around 950 ms and must not
    // pull the scoped ADS trials' centre towards them.
    const scopedScale = scoped.scales.find((s) => s.metricKey === "adjustedAcquisitionTime");
    const hipfireScale = hipfire.scales.find((s) => s.metricKey === "adjustedAcquisitionTime");
    expect(scopedScale?.centre).toBeCloseTo(-455, 0);
    expect(hipfireScale?.centre).toBeCloseTo(-955, 0);
  });
});
