import { describe, expect, it } from "vitest";
import type { SessionMode } from "@/core/types/vocabulary";
import {
  comfort360Test,
  flickTest,
  microTest,
  MVP_TESTS,
  precisionTest,
  reactionTest,
  switchingTest,
  trackingTest,
} from "@/test-engine/tests";

/**
 * Sample budgets per mode (doc 09 §9.1–§9.7, §9.16).
 *
 * These numbers are not arbitrary and they are not tuning knobs. Each is the sample size doc 09
 * derived for that test to produce a usable estimate, and a candidate that fails to reach its
 * minimum is excluded from the fit rather than estimated from too little data
 * (`SENS-BR-012`). Pinning them here means a change to a budget has to be a deliberate change
 * to the specification, not a quiet edit.
 */

const MODES = ["quick", "standard", "advanced"] as const;

describe("declared trial counts match doc 09", () => {
  const expected: Readonly<Record<string, Readonly<Record<(typeof MODES)[number], number>>>> = {
    flick: { quick: 8, standard: 12, advanced: 18 },
    micro: { quick: 8, standard: 12, advanced: 18 },
    tracking: { quick: 3, standard: 5, advanced: 8 },
    switching: { quick: 1, standard: 2, advanced: 3 },
    precision: { quick: 6, standard: 10, advanced: 14 },
  };

  for (const [key, counts] of Object.entries(expected)) {
    it(`gives ${key} its declared budget in every mode`, () => {
      const definition = MVP_TESTS.find((test) => test.key === key);
      expect(definition).toBeDefined();

      for (const mode of MODES) {
        expect(definition?.trialCount(mode), `${key} in ${mode}`).toBe(counts[mode]);
      }
    });
  }

  it("runs the sensitivity-independent tests once per session, not per mode", () => {
    // Reaction and comfort measure something that cannot vary with sensitivity, so scaling
    // their sample size with session length would spend the trial budget on a comparison that
    // cannot differ.
    for (const mode of MODES) {
      expect(reactionTest.trialCount(mode)).toBe(8);
      expect(comfort360Test.trialCount(mode)).toBe(9);
    }
  });

  it("never asks for more valid trials than it runs", () => {
    // A minimum above the trial count would make every round short by construction, and every
    // candidate `insufficient`.
    for (const definition of MVP_TESTS) {
      for (const mode of MODES) {
        expect(
          definition.minValidTrials(mode),
          `${definition.key} in ${mode} demands more valid trials than it runs`,
        ).toBeLessThanOrEqual(definition.trialCount(mode));
      }
    }
  });

  it("gives every test a practice round — SENS-BR-011", () => {
    // Practice is never scored and never aggregated. Its purpose is that a player's first
    // contact with a task is not also their first measured trial.
    for (const definition of MVP_TESTS) {
      for (const mode of MODES) {
        expect(definition.practiceTrialCount(mode)).toBeGreaterThan(0);
      }
    }
  });

  it("keeps practice shorter than the measured round", () => {
    for (const definition of MVP_TESTS) {
      expect(
        definition.practiceTrialCount("standard"),
        `${definition.key} practises for as long as it measures`,
      ).toBeLessThanOrEqual(definition.trialCount("standard"));
    }
  });
});

describe("timing budgets", () => {
  it("gives each test the timeout doc 09 declares", () => {
    expect(flickTest.timeoutMs).toBe(5000);
    expect(microTest.timeoutMs).toBe(4000);
    expect(precisionTest.timeoutMs).toBe(6000);
    expect(switchingTest.timeoutMs).toBe(12_000);
    expect(reactionTest.timeoutMs).toBe(1200);
    expect(comfort360Test.timeoutMs).toBe(15_000);
    // For a duration test the timeout *is* the measured duration.
    expect(trackingTest.timeoutMs).toBe(5000);
  });

  it("uses the shared 250–600 ms inter-trial interval for the aiming tests", () => {
    // Randomised to prevent rhythmic anticipation, and to give the metrics a clean baseline
    // segment for detecting pre-movement (doc 09 §9.0.3).
    for (const definition of [flickTest, microTest, trackingTest, switchingTest, precisionTest]) {
      expect(definition.interTrialIntervalMs).toEqual({ min: 250, max: 600 });
    }
  });

  it("gives reaction a much wider blank interval, so the onset cannot be anticipated", () => {
    expect(reactionTest.interTrialIntervalMs.min).toBe(800);
    expect(reactionTest.interTrialIntervalMs.max).toBe(2600);
    const spread = reactionTest.interTrialIntervalMs.max - reactionTest.interTrialIntervalMs.min;
    expect(spread).toBeGreaterThan(1500);
  });
});

describe("session shape", () => {
  it("keeps a quick session's aiming trials to a workable number", () => {
    // doc 09 §9.16 budgets Quick as the short battery. This is a sanity bound rather than an
    // exact figure: it fails loudly if a future edit quietly triples the shortest session.
    const total = MVP_TESTS.reduce(
      (sum, definition) => sum + definition.trialCount("quick" as SessionMode),
      0,
    );
    expect(total).toBeLessThanOrEqual(50);
    expect(total).toBeGreaterThan(20);
  });
});
