import { config } from "dotenv";

config({ path: [".env.test", ".env.local", ".env"], quiet: true });

/**
 * E2E fixtures: a known account with a recommendation for each verdict.
 *
 * Runs from the Playwright global setup with a tsconfig that shims `server-only`, the same
 * way the integration suite does. The sessions are produced by the real loop — the synthetic
 * battery player through the real engine, the real server decisions — with pinned seeds whose
 * verdicts are known, so the browser tests can assert on a specific layout.
 *
 * Idempotent: re-running finds the account and reuses its recommendations.
 */

export const E2E_EMAIL = "e2e-results@senslab.test";
export const E2E_PASSWORD = "correct-horse-battery-staple";

/** Seeds whose quick-mode verdicts were established by the integration probe. */
const SEEDS = { peak_found: 1000003n, indistinguishable: 3000009n } as const;

async function main(): Promise<void> {
  const { closeDb } = await import("../src/db/client");
  const { userRepo, recommendationRepo } = await import("../src/repositories");
  const { hashPassword } = await import("../src/lib/password");
  const { asUser } = await import("../tests/helpers/db");
  const { runPlan } = await import("../tests/helpers/battery-runner");
  const { startCalibrationSession, submitCalibrationRound } =
    await import("../src/services/calibration-session-service");

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

    const out: Record<string, string> = {};
    for (const [verdict, seed] of Object.entries(SEEDS)) {
      let step = await startCalibrationSession(actor, {
        mode: "quick",
        dpi: 800,
        dpiSource: "known",
        currentCmPer360: 30,
        padWidthCm: 45,
        gameId: "cs2",
        aspectRatio: 16 / 9,
        environment: { unadjustedMovementEffective: true },
        seed,
      });
      const centre = Math.log2(9448.82);
      for (let guard = 0; guard < 6; guard += 1) {
        const skill = new Map(
          step.plan.candidates.map((c) => [
            c.candidateIndex,
            Math.max(0.35, 1 - Math.abs(Math.log2(c.countsPer360 as number) - centre) * 1.6),
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
          if (progress.verdict !== verdict) {
            throw new Error(`seed ${seed} produced ${progress.verdict}, expected ${verdict}`);
          }
          out[verdict] = progress.recommendationId;
          break;
        }
        step = progress.step;
      }
      const stored = await recommendationRepo.findRecommendation(actor, out[verdict] ?? "");
      if (stored === null) throw new Error(`fixture for ${verdict} was not stored`);
    }

    // Handed to the specs through a file the config points at.
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync("test-results", { recursive: true });
    writeFileSync(
      "test-results/e2e-fixtures.json",
      JSON.stringify({ email: E2E_EMAIL, password: E2E_PASSWORD, recommendations: out }, null, 2),
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
