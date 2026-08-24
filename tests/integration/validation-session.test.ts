import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { recommendations, validationRuns } from "@/db/schema";
import { CONFIDENCE_MODEL_V1 } from "@/core/params";
import { userRepo } from "@/repositories";
import { hashPassword } from "@/lib/password";
import {
  startCalibrationSession,
  submitCalibrationRound,
  type CalibrationStep,
} from "@/services/calibration-session-service";
import { getRecommendation } from "@/services/recommendation-service";
import {
  decideValidation,
  getValidation,
  startValidation,
  submitValidation,
  validationOfferFor,
  type ValidationStep,
} from "@/services/validation-service";
import {
  getFineTune,
  recordPreference,
  startFineTune,
  submitFineTune,
  type FineTuneStep,
} from "@/services/fine-tune-service";
import { asUser, db, resetVolatileTables } from "@tests/helpers/db";
import { runPlan } from "@tests/helpers/battery-runner";

/**
 * Validation and fine-tuning through the real server loop (doc 17 §17.10).
 *
 * A synthetic player with a per-candidate skill runs the plans the server hands out. The
 * server does everything else: arms, sequence, pairing, analysis, verdict, the confidence
 * multiplier, what stands as the accepted value, and — for a fine-tune — the screening
 * ranking, the duel's early stop and the refinement by the engine.
 */

/** The synthetic player's true optimum: 25 cm/360 at 800 DPI. */
const OPTIMUM_COUNTS = (800 * 25) / 2.54;
/** What the player says they use — far enough from the optimum for validation to be offered. */
const CURRENT_CM = 38;

async function makeUser(email: string): Promise<string> {
  const { userId } = await userRepo.createUser({
    email,
    passwordHash: await hashPassword("correct-horse-battery"),
  });
  return userId;
}

function skillByDistance(step: { plan: CalibrationStep["plan"] }): ReadonlyMap<number, number> {
  const centre = Math.log2(OPTIMUM_COUNTS);
  return new Map(
    step.plan.candidates.map((candidate) => {
      const distance = Math.abs(Math.log2(candidate.countsPer360 as number) - centre);
      return [candidate.candidateIndex, Math.max(0.3, 1 - distance * 0.9)];
    }),
  );
}

/** A quick calibration that ends in a peak, with the player's stated current sens far from it. */
async function calibrate(actor: ReturnType<typeof asUser>): Promise<string> {
  let step = await startCalibrationSession(actor, {
    mode: "quick",
    dpi: 800,
    dpiSource: "known",
    currentCmPer360: CURRENT_CM,
    padWidthCm: null,
    gameId: null,
    aspectRatio: 16 / 9,
    environment: { unadjustedMovementEffective: true },
    seed: 1_000_003n,
  });
  for (let guard = 0; guard < 6; guard += 1) {
    const run = runPlan(step.plan, { skillByCandidate: skillByDistance(step), maxStepDeg: 2.5 });
    const progress = await submitCalibrationRound(actor, {
      sessionId: step.sessionId,
      roundIndex: step.roundIndex,
      aggregates: run.aggregates,
      qualityFlags: [],
      aspectRatio: 16 / 9,
    });
    if (progress.kind === "finished") {
      expect(progress.verdict).toBe("peak_found");
      return progress.recommendationId;
    }
    step = progress.step;
  }
  throw new Error("calibration did not finish");
}

async function validate(
  actor: ReturnType<typeof asUser>,
  recommendationId: string,
  skill: { readonly A: number; readonly B: number },
): Promise<{ step: ValidationStep; verdict: string }> {
  const step = await startValidation(actor, {
    recommendationId,
    aspectRatio: 16 / 9,
    environment: {},
    seed: 9_000_001n,
  });
  const run = runPlan(step.plan, {
    skillByCandidate: new Map([
      [0, skill.A],
      [1, skill.B],
    ]),
    maxStepDeg: 2.5,
  });
  const progress = await submitValidation(actor, {
    sessionId: step.sessionId,
    aggregates: run.aggregates,
    qualityFlags: [],
  });
  if (progress.kind !== "finished") throw new Error(`insufficient: ${JSON.stringify(progress)}`);
  return { step, verdict: progress.verdict };
}

describe("the validation test", () => {
  beforeEach(async () => {
    await resetVolatileTables();
  });
  afterAll(async () => {
    await closeDb();
  });

  it("is offered against the stated current sensitivity, blinded with fresh labels", async () => {
    const actor = asUser(await makeUser("validate-offer@senslab.test"));
    const recommendationId = await calibrate(actor);
    const offer = await validationOfferFor(actor, recommendationId);
    expect(offer?.offered).toBe(true);
    expect(offer?.reason).toBe("offered");
    expect(offer?.baselineCm360).toBe(CURRENT_CM);

    const step = await startValidation(actor, {
      recommendationId,
      aspectRatio: 16 / 9,
      environment: {},
    });
    expect(step.blocks).toBe(4);
    // Two arms, labels from the validation alphabet, never the calibration's A–F.
    expect(step.plan.candidates).toHaveLength(2);
    for (const candidate of step.plan.candidates) {
      expect(["K", "M", "P", "R", "T", "V"]).toContain(candidate.blindLabel);
    }
    // Counterbalanced blocks: each quartet is ABBA or BAAB, pairs share stimulus seeds.
    const scored = step.plan.rounds.filter((r) => !r.isPractice);
    const blocks = [...new Set(scored.map((r) => r.blockIndex))];
    expect(blocks).toEqual([2, 3, 4, 5]);
    const armOf = (block: number) => scored.find((r) => r.blockIndex === block)?.candidateIndex;
    const quartet = blocks.map(armOf).join("");
    expect(["0110", "1001"]).toContain(quartet);
    const seedsFor = (block: number) =>
      scored
        .filter((r) => r.blockIndex === block)
        .map((r) => `${r.testKey}:${r.stimulusSeed}`)
        .sort();
    expect(seedsFor(2)).toEqual(seedsFor(3));
    expect(seedsFor(4)).toEqual(seedsFor(5));
    expect(seedsFor(2)).not.toEqual(seedsFor(4));
    // Once started, the offer is closed.
    expect((await validationOfferFor(actor, recommendationId))?.reason).toBe("offered");
  });

  it("reports `improved` with every metric carrying its interval, and raises confidence", async () => {
    const actor = asUser(await makeUser("validate-improved@senslab.test"));
    const recommendationId = await calibrate(actor);
    const before = await getRecommendation(actor, recommendationId);
    const { verdict } = await validate(actor, recommendationId, { A: 0.45, B: 1 });
    expect(verdict).toBe("improved");

    const view = await getValidation(actor, recommendationId);
    expect(view?.verdict).toBe("improved");
    expect(view?.composite.ciLow).toBeGreaterThan(0);
    expect(view?.metrics.length).toBeGreaterThanOrEqual(3);
    for (const metric of view?.metrics ?? []) {
      expect(metric.ciLow).toBeLessThanOrEqual(metric.ciHigh);
      expect(metric.significant).toBe(metric.ciLow > 0 || metric.ciHigh < 0);
    }
    const expected = Math.min(
      Math.round(
        (before?.confidence?.index ?? 0) *
          CONFIDENCE_MODEL_V1.params.validationMultipliers.improved,
      ),
      CONFIDENCE_MODEL_V1.params.verdictCaps.peakFound,
    );
    expect(view?.confidenceAfter).toBe(expected);
    expect(view?.confidenceBefore).toBe(before?.confidence?.index);
    // The choice is the player's, and nothing has been accepted until they make it.
    expect(view?.accepted).toBeNull();
    expect(view?.familiarityAdvisory).toBe(true);

    await decideValidation(actor, { recommendationId, choice: "keep_original" });
    expect((await getValidation(actor, recommendationId))?.accepted).toBe("original");
    expect((await validationOfferFor(actor, recommendationId))?.reason).toBe("already_validated");
  });

  it("reports `worse` plainly, retains the original and applies the 0.70 multiplier", async () => {
    const actor = asUser(await makeUser("validate-worse@senslab.test"));
    const recommendationId = await calibrate(actor);
    const before = await getRecommendation(actor, recommendationId);
    const { verdict } = await validate(actor, recommendationId, { A: 1, B: 0.45 });
    expect(verdict).toBe("worse");

    const view = await getValidation(actor, recommendationId);
    expect(view?.composite.ciHigh).toBeLessThan(0);
    expect(view?.accepted).toBe("original");
    expect(view?.confidenceAfter).toBe(
      Math.round(
        (before?.confidence?.index ?? 0) * CONFIDENCE_MODEL_V1.params.validationMultipliers.worse,
      ),
    );
    const [row] = await db()
      .select({
        accepted: recommendations.acceptedCounts360,
        index: recommendations.confidenceIndex,
      })
      .from(recommendations)
      .where(eq(recommendations.id, recommendationId));
    const [run] = await db()
      .select({ baseline: validationRuns.baselineCounts360 })
      .from(validationRuns)
      .where(eq(validationRuns.recommendationId, recommendationId));
    expect(row?.accepted).toBe(run?.baseline);
    expect(row?.index).toBe(view?.confidenceAfter);
    // The calibration's estimate is untouched: nothing is deleted.
    const after = await getRecommendation(actor, recommendationId);
    expect(after?.canonical.cmPer360).toBe(before?.canonical.cmPer360);
  });

  it("reports `no_measurable_difference` for identical arms", async () => {
    const actor = asUser(await makeUser("validate-same@senslab.test"));
    const recommendationId = await calibrate(actor);
    const { verdict } = await validate(actor, recommendationId, { A: 1, B: 1 });
    expect(verdict).toBe("no_measurable_difference");
    const view = await getValidation(actor, recommendationId);
    expect(view?.composite.ciLow).toBeLessThanOrEqual(0);
    expect(view?.composite.ciHigh).toBeGreaterThanOrEqual(0);
  });
});

describe("fine-tuning", () => {
  beforeEach(async () => {
    await resetVolatileTables();
  });
  afterAll(async () => {
    await closeDb();
  });

  async function fineTune(
    actor: ReturnType<typeof asUser>,
    recommendationId: string,
    skillOf: (countsPer360: number) => number,
  ) {
    let step: FineTuneStep = await startFineTune(actor, {
      recommendationId,
      aspectRatio: 16 / 9,
      environment: {},
      seed: 9_500_001n,
    });
    const steps: FineTuneStep[] = [step];
    for (let guard = 0; guard < 6; guard += 1) {
      const skill = new Map(
        step.plan.candidates.map((c) => [c.candidateIndex, skillOf(c.countsPer360 as number)]),
      );
      const run = runPlan(step.plan, { skillByCandidate: skill, maxStepDeg: 2.5 });
      const progress = await submitFineTune(actor, {
        sessionId: step.sessionId,
        aggregates: run.aggregates,
        qualityFlags: [],
        aspectRatio: 16 / 9,
      });
      if (progress.kind === "finished") return { steps, outcome: progress };
      step = progress.step;
      steps.push(step);
    }
    throw new Error("fine-tune did not finish");
  }

  it("screens five blinded candidates, duels the top two, and reveals only afterwards", async () => {
    const actor = asUser(await makeUser("finetune@senslab.test"));
    const recommendationId = await calibrate(actor);
    const recommendation = await getRecommendation(actor, recommendationId);
    const recommendedCounts = recommendation?.canonical.countsPer360 ?? 0;

    // The player's true optimum is a little above the recommendation.
    const trueOptimum = Math.log2(recommendedCounts) + 0.12;
    const { steps, outcome } = await fineTune(actor, recommendationId, (counts) =>
      Math.max(0.35, 1 - Math.abs(Math.log2(counts) - trueOptimum) * 3),
    );

    const screening = steps[0];
    expect(screening?.stage).toBe("screening");
    expect(screening?.plan.candidates).toHaveLength(5);
    // Blinded: labels from the validation alphabet, one block per candidate, matched stimuli.
    const scored = screening?.plan.rounds.filter((r) => !r.isPractice) ?? [];
    expect(new Set(scored.map((r) => r.blockIndex)).size).toBe(5);
    expect(
      new Set(scored.filter((r) => r.testKey === "flick").map((r) => r.stimulusSeed)).size,
    ).toBe(1);
    expect(steps[1]?.stage).toBe("duel");
    expect(steps[1]?.plan.candidates).toHaveLength(2);
    expect(steps.length).toBeLessThanOrEqual(1 + 2);

    const view = await getFineTune(actor, outcome.sessionId);
    expect(view?.completed).toBe(true);
    expect(view?.candidates.map((c) => c.revealLabel).sort()).toEqual(
      ["Higher", "Lower", "Recommended", "Slightly higher", "Slightly lower"].sort(),
    );
    expect(view?.candidates.filter((c) => c.inDuel)).toHaveLength(2);
    expect(view?.duel.quartets).toBeGreaterThanOrEqual(1);
    expect(view?.heldUp).toBe(outcome.heldUp);
    if (!outcome.heldUp) {
      // A superseding row, linked both ways.
      const parent = await getRecommendation(actor, recommendationId);
      expect(parent?.supersededById).toBe(outcome.newRecommendationId);
      const child = await getRecommendation(actor, outcome.newRecommendationId ?? "");
      expect(child?.mode).toBe("fine_tune");
      expect(child?.verdict).toBe("peak_found");
    }
  });

  it("records a preference after the reveal without touching any recommendation value", async () => {
    const actor = asUser(await makeUser("finetune-pref@senslab.test"));
    const recommendationId = await calibrate(actor);
    const { outcome } = await fineTune(actor, recommendationId, () => 1);
    const before = await db().select().from(recommendations);

    const view = await getFineTune(actor, outcome.sessionId);
    const chosen = view?.candidates.find((c) => !c.inDuel) ?? view?.candidates[0];
    expect(chosen).toBeDefined();
    await recordPreference(actor, {
      sessionId: outcome.sessionId,
      candidateId: chosen?.candidateId ?? "",
    });

    const after = await db().select().from(recommendations);
    expect(after).toEqual(before);
    const reloaded = await getFineTune(actor, outcome.sessionId);
    expect(reloaded?.preference?.candidateId).toBe(chosen?.candidateId);
    expect(reloaded?.preference?.measuredBest).toBe(false);
  });
});
