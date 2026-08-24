import { config } from "dotenv";

config({ path: [".env.test", ".env.local", ".env"], quiet: true });

/**
 * E2E fixtures: a known account with a recommendation for each verdict, one of them validated.
 *
 * Runs from the Playwright global setup with a tsconfig that shims `server-only`, the same
 * way the integration suite does. Everything is produced by the real loop — the synthetic
 * battery player through the real engine, the real server decisions — so the browser tests
 * assert against results the product actually generates.
 *
 * ## Why the seed is searched rather than pinned
 *
 * A verdict is a property of the *data*, not of the seed: change the player, the roster or a
 * parameter set and a seed that produced a peak may stop doing so. Pinning one made every
 * such change break the fixtures with a mystifying error. The script instead walks a fixed
 * list of seeds and keeps the first that produces the verdict it needs — deterministic for a
 * given build, and self-repairing when the measurement changes underneath it.
 */

export const E2E_EMAIL = "e2e-results@senslab.test";
export const E2E_PASSWORD = "correct-horse-battery-staple";

const SEEDS = [1_000_003n, 1_000_004n, 1_000_005n, 1_000_006n, 1_000_007n, 3_000_009n, 3_000_010n];

/** The synthetic player's optimum in cm/360, and the sensitivity they claim to use. */
const OPTIMUM_CM = 25;
const CURRENT_CM = 38;
const DPI = 800;

async function main(): Promise<void> {
  const { closeDb } = await import("../src/db/client");
  const { userRepo } = await import("../src/repositories");
  const { hashPassword } = await import("../src/lib/password");
  const { asUser } = await import("../tests/helpers/db");
  const { runPlan } = await import("../tests/helpers/battery-runner");
  const { startCalibrationSession, submitCalibrationRound, abandonCalibrationSession } =
    await import("../src/services/calibration-session-service");
  const { startValidation, submitValidation, validationOfferFor } =
    await import("../src/services/validation-service");

  const centre = Math.log2((DPI * OPTIMUM_CM) / 2.54);
  const skillFor = (countsPer360: number, slope: number): number =>
    Math.max(0.3, 1 - Math.abs(Math.log2(countsPer360) - centre) * slope);

  try {
    const existing = await userRepo.findActiveUserByEmail(E2E_EMAIL);
    const userId =
      existing?.user.id ??
      (
        await userRepo.createUser({
          email: E2E_EMAIL,
          passwordHash: await hashPassword(E2E_PASSWORD),
        })
      ).userId;
    const actor = asUser(userId);

    /** Runs one quick calibration to completion and returns what it decided. */
    async function calibrate(
      seed: bigint,
      slope: number,
    ): Promise<{ id: string; verdict: string; sessionId: string }> {
      let step = await startCalibrationSession(actor, {
        mode: "quick",
        dpi: DPI,
        dpiSource: "known",
        currentCmPer360: CURRENT_CM,
        padWidthCm: 45,
        gameId: "cs2",
        aspectRatio: 16 / 9,
        environment: { unadjustedMovementEffective: true },
        seed,
      });
      const sessionId = step.sessionId;
      for (let guard = 0; guard < 6; guard += 1) {
        const skill = new Map(
          step.plan.candidates.map((candidate) => [
            candidate.candidateIndex,
            skillFor(candidate.countsPer360 as number, slope),
          ]),
        );
        const run = runPlan(step.plan, { skillByCandidate: skill, maxStepDeg: 2.5 });
        const progress = await submitCalibrationRound(actor, {
          sessionId: step.sessionId,
          roundIndex: step.roundIndex,
          aggregates: run.aggregates,
          qualityFlags: [],
          aspectRatio: 16 / 9,
        });
        if (progress.kind === "finished") {
          return { id: progress.recommendationId, verdict: progress.verdict, sessionId };
        }
        step = progress.step;
      }
      await abandonCalibrationSession(actor, sessionId);
      throw new Error(`seed ${seed} did not finish within the round budget`);
    }

    /** The first seed whose calibration satisfies `accept`. Unwanted sessions are abandoned. */
    async function find(
      label: string,
      slope: number,
      accept: (result: { id: string; verdict: string }) => Promise<boolean> | boolean,
    ): Promise<string> {
      for (const seed of SEEDS) {
        const result = await calibrate(seed, slope);
        if (await accept(result)) {
          console.log(`[e2e-fixtures] ${label}: seed ${seed} → ${result.verdict}`);
          return result.id;
        }
      }
      throw new Error(`no seed produced a usable fixture for ${label}`);
    }

    const out: Record<string, string> = {};

    // A peak the player can validate: their stated sensitivity has to sit outside the
    // interval, or doc 17 §17.2 says there is nothing to compare.
    out["peak_found"] = await find("peak_found", 0.9, async (result) => {
      if (result.verdict !== "peak_found") return false;
      const offer = await validationOfferFor(actor, result.id);
      return offer?.offered === true;
    });

    // A genuinely flat player: a shallow slope leaves the candidates inseparable.
    out["indistinguishable"] = await find(
      "indistinguishable",
      0.05,
      (result) => result.verdict === "indistinguishable",
    );

    // And one validated result, so the comparison page has something to render.
    const validated = await find("validated", 0.9, async (result) => {
      if (result.verdict !== "peak_found") return false;
      const offer = await validationOfferFor(actor, result.id);
      return offer?.offered === true;
    });
    const step = await startValidation(actor, {
      recommendationId: validated,
      aspectRatio: 16 / 9,
      environment: {},
    });
    const run = runPlan(step.plan, {
      // Arm B is the recommendation and this player is better at it — an `improved` verdict.
      skillByCandidate: new Map([
        [0, 0.55],
        [1, 1],
      ]),
      maxStepDeg: 2.5,
    });
    const outcome = await submitValidation(actor, {
      sessionId: step.sessionId,
      aggregates: run.aggregates,
      qualityFlags: [],
    });
    if (outcome.kind !== "finished") {
      throw new Error(`validation fixture was not analysed: ${JSON.stringify(outcome)}`);
    }
    out["validated"] = validated;
    console.log(`[e2e-fixtures] validated: ${outcome.verdict}`);

    // Handed to the specs through a file the config points at.
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync("test-results", { recursive: true });
    writeFileSync(
      "test-results/e2e-fixtures.json",
      JSON.stringify(
        {
          email: E2E_EMAIL,
          password: E2E_PASSWORD,
          recommendations: out,
          validationVerdict: outcome.verdict,
        },
        null,
        2,
      ),
    );
    console.log("[e2e-fixtures] ready:", out);
  } finally {
    await closeDb();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
