import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import {
  recommendationDimensionScores,
  recommendationGameSettings,
  recommendations,
} from "@/db/schema";
import { userRepo } from "@/repositories";
import { hashPassword } from "@/lib/password";
import { DIMENSION_KEYS } from "@/core/types/vocabulary";
import {
  abandonCalibrationSession,
  startCalibrationSession,
  submitCalibrationRound,
  type CalibrationProgress,
  type CalibrationStep,
} from "@/services/calibration-session-service";
import {
  getRecommendation,
  outputGameOptions,
  settingsForRecommendation,
} from "@/services/recommendation-service";
import { asUser, db, resetVolatileTables } from "@tests/helpers/db";
import { runPlan } from "@tests/helpers/battery-runner";

/**
 * The whole product loop, end to end: start → rounds through the real engine → adaptive
 * replanning on the server → stop → recommendation row → the view the results page renders.
 *
 * The player is the synthetic battery player with a **per-candidate skill multiplier**, so the
 * session has a genuine optimum for the search to find. What is being proven is not that the
 * engine can find it — Phase 4's recovery suite does that — but that every layer connects:
 * the plan the server hands out runs, what the engine measured is what the server analyses,
 * and what it decides is what the page can show.
 */

async function makeUser(email: string): Promise<string> {
  const { userId } = await userRepo.createUser({
    email,
    passwordHash: await hashPassword("correct-horse-battery"),
  });
  return userId;
}

/** Skill peaks at the middle candidate of each round; far candidates are clumsier. */
function skillFor(step: CalibrationStep): ReadonlyMap<number, number> {
  const counts = step.plan.candidates.map((c) => c.countsPer360 as number);
  const centre = Math.log2(9448.82);
  return new Map(
    step.plan.candidates.map((candidate, i) => {
      const distance = Math.abs(Math.log2(counts[i] ?? centre) - centre);
      return [candidate.candidateIndex, Math.max(0.35, 1 - distance * 1.6)];
    }),
  );
}

async function runSession(
  actor: ReturnType<typeof asUser>,
  mode: "quick" | "standard",
): Promise<{ steps: CalibrationStep[]; outcome: CalibrationProgress }> {
  let step = await startCalibrationSession(actor, {
    mode,
    dpi: 800,
    dpiSource: "known",
    currentCmPer360: 30,
    padWidthCm: 45,
    gameId: "cs2",
    aspectRatio: 16 / 9,
    environment: { unadjustedMovementEffective: true },
  });
  const steps: CalibrationStep[] = [step];

  for (let guard = 0; guard < 6; guard += 1) {
    const run = runPlan(step.plan, { skillByCandidate: skillFor(step), maxStepDeg: 2.5 });
    const progress = await submitCalibrationRound(actor, {
      sessionId: step.sessionId,
      roundIndex: step.roundIndex,
      aggregates: run.aggregates,
      qualityFlags: [],
      aspectRatio: 16 / 9,
    });
    if (progress.kind === "finished") return { steps, outcome: progress };
    step = progress.step;
    steps.push(step);
  }
  throw new Error("the session did not stop within the round budget");
}

describe("a calibration session from start to recommendation", () => {
  beforeEach(async () => {
    await resetVolatileTables();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("plans round 0 with the baseline tests, practice, and counterbalanced candidate blocks", async () => {
    const actor = asUser(await makeUser("planner@senslab.test"));
    const step = await startCalibrationSession(actor, {
      mode: "quick",
      dpi: 800,
      dpiSource: "known",
      currentCmPer360: 30,
      padWidthCm: null,
      gameId: null,
      aspectRatio: 16 / 9,
      environment: {},
    });

    expect(step.roundIndex).toBe(0);
    expect(step.roundBudget).toBe(2);
    const keys = step.plan.rounds.map((round) => round.testKey);
    expect(keys.slice(0, 2)).toEqual(["reaction", "comfort360"]);
    expect(
      step.plan.rounds
        .filter((r) => r.isPractice)
        .map((r) => r.testKey)
        .sort(),
    ).toEqual(["flick", "micro", "tracking"]);
    const scored = step.plan.rounds.filter((r) => !r.isPractice && r.candidateIndex !== null);
    expect(scored).toHaveLength(3 * 3);
    expect(new Set(scored.map((r) => r.candidateIndex)).size).toBe(3);
    // Matched stimuli: every candidate's flick block shares a seed.
    expect(
      new Set(scored.filter((r) => r.testKey === "flick").map((r) => r.stimulusSeed)).size,
    ).toBe(1);
    // The candidates are blinded: labels, not sensitivities, are what the client will show.
    expect(step.plan.candidates.every((c) => /^[A-Z]$/.test(c.blindLabel))).toBe(true);
  });

  it("runs a quick session to a stored recommendation the page can read", async () => {
    const actor = asUser(await makeUser("quick-session@senslab.test"));
    const { steps, outcome } = await runSession(actor, "quick");

    expect(outcome.kind).toBe("finished");
    if (outcome.kind !== "finished") return;
    expect(steps.length).toBeGreaterThanOrEqual(1);
    expect(steps.length).toBeLessThanOrEqual(2);

    const view = await getRecommendation(actor, outcome.recommendationId);
    expect(view).not.toBeNull();
    if (view === null) return;

    expect(["peak_found", "indistinguishable", "insufficient_data"]).toContain(view.verdict);
    expect(view.ranges.comfort.low).toBeLessThanOrEqual(view.ranges.comfort.high);
    expect(view.hardware.dpi).toBe(800);
    expect(view.hardware.currentCmPer360).toBe(30);
    expect(view.responseCurve?.candidates.length).toBeGreaterThanOrEqual(3);
    expect(view.responseCurve?.currentSens?.cm360).toBe(30);
    expect(view.versions.scoring).toBe("scoring_model_v2");

    // Six dimensions were scored, all provisional, and the profile explanation carries them.
    expect(view.profile.dimensions.map((d) => d.dimension).sort()).toEqual(
      [...DIMENSION_KEYS].sort(),
    );
    expect(view.profile.dimensions.every((d) => d.provisional)).toBe(true);
    expect(view.profile.explanation?.sentences.length).toBeGreaterThan(0);

    if (view.verdict !== "insufficient_data") {
      expect(view.confidence).not.toBeNull();
      expect(view.confidence?.components).toHaveLength(7);
      expect(view.confidence?.index).toBeLessThanOrEqual(92);
      if (view.verdict === "indistinguishable")
        expect(view.confidence?.index).toBeLessThanOrEqual(40);
    }

    // Every round's audit trail is in place and the session is complete.
    const rows = await db()
      .select({ id: recommendations.id, sessionId: recommendations.sessionId })
      .from(recommendations)
      .where(eq(recommendations.id, outcome.recommendationId));
    expect(rows).toHaveLength(1);
    const scores = await db()
      .select()
      .from(recommendationDimensionScores)
      .where(eq(recommendationDimensionScores.recommendationId, outcome.recommendationId));
    expect(scores).toHaveLength(6);
  }, 120_000);

  it("writes no game setting row, because no adapter is verified — SENS-BR-014", async () => {
    const actor = asUser(await makeUser("no-settings@senslab.test"));
    const { outcome } = await runSession(actor, "quick");
    if (outcome.kind !== "finished") throw new Error("expected a recommendation");

    const rows = await db()
      .select()
      .from(recommendationGameSettings)
      .where(eq(recommendationGameSettings.recommendationId, outcome.recommendationId));
    expect(rows).toHaveLength(0);

    // The settings view still gives the canonical targets and names the open entry.
    const view = await getRecommendation(actor, outcome.recommendationId);
    if (view === null) throw new Error("missing view");
    const settings = settingsForRecommendation(view, "cs2");
    expect(settings.settings).toBeNull();
    expect(settings.refusal?.code).toBe("EXTERNAL_VERIFICATION_REQUIRED");
    expect(settings.canonical.cmPer360).toBeGreaterThan(0);
    expect(outputGameOptions().map((g) => g.gameId)).toContain("cs2");
  }, 120_000);

  it("hides a recommendation from anyone but its owner", async () => {
    const owner = asUser(await makeUser("owner@senslab.test"));
    const stranger = asUser(await makeUser("stranger@senslab.test"));
    const { outcome } = await runSession(owner, "quick");
    if (outcome.kind !== "finished") throw new Error("expected a recommendation");

    expect(await getRecommendation(owner, outcome.recommendationId)).not.toBeNull();
    expect(await getRecommendation(stranger, outcome.recommendationId)).toBeNull();
  }, 120_000);

  it("keeps what was measured when a session is abandoned", async () => {
    const actor = asUser(await makeUser("abandon@senslab.test"));
    const step = await startCalibrationSession(actor, {
      mode: "quick",
      dpi: 800,
      dpiSource: "known",
      currentCmPer360: null,
      padWidthCm: null,
      gameId: null,
      aspectRatio: 16 / 9,
      environment: {},
    });
    await abandonCalibrationSession(actor, step.sessionId);
    expect(await getRecommendation(actor, step.sessionId)).toBeNull();
  });
});
