import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CALIBRATION_MODEL_V1 } from "@/core/params";
import { deriveRng } from "@/core/random";
import { countsPer360FromCm } from "@/core/sensitivity/canonical";
import { bracketOf, toLogSensitivity } from "@/core/calibration/bracket";
import { anchorCandidate, generateCandidates } from "@/core/calibration/candidates";
import { runCalibration, type RoundInput } from "@/core/calibration/engine";
import type { CalibrationSpec } from "@/core/calibration/contracts";
import { logSensitivity } from "@/core/types/brand";
import { canonicalJson } from "@/lib/canonical-json";
import { CLEAR_PEAK, generateTrials } from "../../helpers/synthetic-player";

/**
 * The golden session (`SENS-NFR-019`, doc 13 §13.14).
 *
 * A fixed session, committed to the repository, asserted **bit for bit**.
 *
 * ## Why this exists when the recovery tests already pass
 *
 * The recovery tests assert the answer is *close enough*. This one asserts it is *identical* —
 * which is a different and stricter property, and the one `SENS-BR-030` actually promises: a
 * recommendation must be re-derivable from stored trials forever. A change that shifts an
 * estimate by 0.001 passes every tolerance test in the suite and silently breaks that promise;
 * this test is the only thing that catches it.
 *
 * It also catches **platform floating-point divergence**. The same fixture runs in CI on Linux
 * and on Windows, and a result that differs between them would mean two players with identical
 * data getting different recommendations.
 *
 * ## When it fails
 *
 * A failure here is not automatically a bug — an intentional change to the algorithm *should*
 * change the golden output. What it must never be is a surprise. Re-generate deliberately with
 * `UPDATE_GOLDEN=1`, read the diff, and record the change as a new algorithm version
 * (`SENS-BR-029`): released versions are immutable, so a changed result is a new version rather
 * than an edit to an old one.
 */

const GOLDEN_PATH = fileURLToPath(new URL("./golden-session.json", import.meta.url));
const PARAMS = CALIBRATION_MODEL_V1.params;
const DPI = 800;
const SEED = "golden-session-v1";

/** A fixed three-round Standard session with an anchor, run against a known player. */
function runGoldenSession() {
  const startCentre = 13.0;
  const roundBudget = 3;
  let bracket = bracketOf(startCentre, 0.5);

  const rounds: RoundInput[] = [];
  let nextCandidateIndex = 0;
  let block = 0;

  const spec: CalibrationSpec = {
    parameterName: "hipfire_counts_per_360",
    domainLow: toLogSensitivity(countsPer360FromCm(PARAMS.domainCmPer360.min, DPI)),
    domainHigh: toLogSensitivity(countsPer360FromCm(PARAMS.domainCmPer360.max, DPI)),
    constraint: { maxCmPer360: null, source: "none", conflict: false },
    initialCentre: logSensitivity(startCentre),
    initialHalfWidth: 0.5,
    candidatesPerRound: 3,
    roundBudget,
    mode: "standard",
    seed: 424242n,
    calibrationVersion: CALIBRATION_MODEL_V1.version,
  };

  for (let roundIndex = 0; roundIndex < roundBudget; roundIndex += 1) {
    const generated = generateCandidates({
      bracket,
      roundIndex,
      count: 3,
      source: roundIndex === 0 ? "initial" : "narrowed",
      rng: deriveRng(SEED, "labels", roundIndex),
      startIndex: nextCandidateIndex,
    });
    nextCandidateIndex += generated.length;

    const isFinal = roundIndex === roundBudget - 1;
    const candidates = isFinal
      ? [
          ...generated,
          anchorCandidate({
            x: logSensitivity(startCentre),
            roundIndex,
            candidateIndex: nextCandidateIndex,
            rng: deriveRng(SEED, "anchor", roundIndex),
          }),
        ]
      : generated;
    if (isFinal) nextCandidateIndex += 1;

    const blockOf = new Map<number, number>();
    for (const candidate of candidates) {
      blockOf.set(candidate.candidateIndex, block);
      block += 1;
    }

    rounds.push({
      roundIndex,
      bracket,
      candidates,
      trials: generateTrials({
        shape: CLEAR_PEAK,
        candidates: candidates.map((candidate) => ({
          candidateIndex: candidate.candidateIndex,
          x: candidate.x as number,
        })),
        trialsPerCandidate: 20,
        blockOf: (index) => blockOf.get(index) ?? 0,
        roundIndex,
        seed: SEED,
      }),
    });

    const partial = runCalibration({
      spec,
      params: PARAMS,
      rounds,
      minimumTrialsPerCandidate: 8,
      deviceDpi: DPI,
    });
    const last = partial.rounds[partial.rounds.length - 1];
    if (last?.nextBracket == null) break;
    bracket = last.nextBracket;
  }

  return runCalibration({
    spec,
    params: PARAMS,
    rounds,
    minimumTrialsPerCandidate: 8,
    deviceDpi: DPI,
  });
}

/** BigInt is not JSON-serialisable; the seed is recorded as a string. */
function serialisable(result: ReturnType<typeof runGoldenSession>): unknown {
  return JSON.parse(
    JSON.stringify(result, (_key, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
  );
}

/**
 * The golden fixture runs the **shipped** parameters, including all 2,000 bootstrap resamples.
 * That is deliberate: a fixture generated with a reduced resample count would pin a
 * configuration nobody runs. The cost is that a full session takes seconds, so these cases carry
 * their own timeout rather than the suite default.
 */
const GOLDEN_TIMEOUT_MS = 60_000;

describe("the golden session", () => {
  it(
    "reproduces the committed result bit for bit — SENS-NFR-019",
    () => {
      const actual = canonicalJson(serialisable(runGoldenSession()));

      if (process.env["UPDATE_GOLDEN"] === "1") {
        writeFileSync(GOLDEN_PATH, `${actual}\n`, "utf8");
      }

      const expected = readFileSync(GOLDEN_PATH, "utf8").trim();
      expect(actual).toBe(expected);
    },
    GOLDEN_TIMEOUT_MS,
  );

  it(
    "is a session that actually found something, so the fixture is worth pinning",
    () => {
      // A golden fixture of an empty or failed result would pass forever while asserting nothing.
      const result = runGoldenSession();

      expect(result.verdict).toBe("peak_found");
      expect(result.xStar).not.toBeNull();
      expect(result.rounds.length).toBeGreaterThanOrEqual(2);
      expect(result.anchorRetest).not.toBeNull();
      expect(result.candidates.some((candidate) => candidate.source === "anchor")).toBe(true);
    },
    GOLDEN_TIMEOUT_MS,
  );

  it(
    "re-derives the identical result from the same stored inputs — SENS-BR-030",
    () => {
      // The recompute guarantee: running the engine again over the same trials must reproduce the
      // stored recommendation exactly, or "explainable forever" is not true.
      expect(canonicalJson(serialisable(runGoldenSession()))).toBe(
        canonicalJson(serialisable(runGoldenSession())),
      );
    },
    GOLDEN_TIMEOUT_MS,
  );
});
