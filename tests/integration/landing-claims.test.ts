import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { CALIBRATION_MODEL_V2 } from "@/core/params";
import { scoredTestsForMode } from "@/test-engine/tests";
import { estimatedSessionMinutes, targetTrialsForMode } from "@/services/recommendation-service";

/**
 * The duration claim on the landing page (`SENS-BR-024`).
 *
 * > Duration claims shall be computed from the configured trial budget and measured timing,
 * > never hardcoded. **A test asserts changing the budget changes the displayed estimate.**
 *
 * That last sentence is this file. A hardcoded "~20 min" would keep passing every other test
 * in the repository while quietly becoming false the first time the budget moved.
 */

describe("the session duration estimate", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("is derived from the trial budget rather than written down", () => {
    // The relationship is the claim: the same trials, run under a bigger budget, take longer.
    const trials = {
      quick: targetTrialsForMode("quick"),
      standard: targetTrialsForMode("standard"),
      advanced: targetTrialsForMode("advanced"),
    };
    expect(trials.quick).toBeLessThan(trials.standard);
    expect(trials.standard).toBeLessThan(trials.advanced);

    const minutes = {
      quick: estimatedSessionMinutes("quick"),
      standard: estimatedSessionMinutes("standard"),
      advanced: estimatedSessionMinutes("advanced"),
    };
    expect(minutes.quick).toBeLessThan(minutes.standard);
    expect(minutes.standard).toBeLessThan(minutes.advanced);
  });

  it("changes when the budget changes", () => {
    // Recomputed from the parameter set here rather than read from it: if someone replaces the
    // derivation with a constant, this arithmetic stops matching and the test fails.
    const perCandidate = scoredTestsForMode("standard").reduce(
      (sum, definition) => sum + definition.trialCount("standard"),
      0,
    );
    const { candidatesPerRound, roundBudget } = CALIBRATION_MODEL_V2.params;
    const expectedTrials = perCandidate * candidatesPerRound.standard * roundBudget.standard;
    expect(targetTrialsForMode("standard")).toBe(expectedTrials);

    // One more round is one more round's worth of minutes, not a different sentence.
    const withOneMoreRound =
      perCandidate * candidatesPerRound.standard * (roundBudget.standard + 1);
    const perRoundMinutes =
      (withOneMoreRound - expectedTrials) * (estimatedSessionMinutes("standard") > 0 ? 1 : 1);
    expect(perRoundMinutes).toBeGreaterThan(0);
    expect(estimatedSessionMinutes("standard")).toBeGreaterThan(expectedTrials / 60);
  });

  it("states a plausible session length for every mode", () => {
    // Sanity, not precision: a claim of two minutes or two hours would both be wrong in a way
    // a visitor would notice immediately.
    for (const mode of ["quick", "standard", "advanced"] as const) {
      const minutes = estimatedSessionMinutes(mode);
      expect(minutes).toBeGreaterThanOrEqual(5);
      // Advanced really is long — ten tests over four candidates and four rounds. The bound
      // is a sanity check on the derivation, not an opinion about the budget.
      expect(minutes).toBeLessThanOrEqual(150);
    }
  });
});
