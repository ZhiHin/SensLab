import { beforeAll, describe, expect, it } from "vitest";
import { deriveRng } from "@/core/random";
import type { CalibrationResult } from "@/core/calibration";
import type { PlayerShape } from "../../helpers/synthetic-player";
import { simulate } from "../../helpers/simulate-calibration";

/**
 * Statistical properties of the calibration, verified by simulation rather than by fixture.
 *
 * ## Why this exists alongside `recovery.test.ts`
 *
 * That suite pins one player per property, which proves the property *can* hold. It cannot
 * distinguish a property that holds from a seed that happened to be kind — and the difference
 * matters most for the claims the product makes loudest: that the interval means something,
 * that a flat player never gets a peak, that the same trials give the same answer.
 *
 * These run a **population** of randomised players through the real engine and assert over the
 * distribution. The failure mode they catch is a change that degrades the estimator for most
 * inputs while the pinned example still passes.
 *
 * ## One simulation pass, many properties
 *
 * Each session runs the whole engine and costs a few hundred milliseconds, so the population
 * is built once in `beforeAll` and every property reads it. Re-simulating per test would make
 * this the slowest file in the repository for no additional coverage.
 *
 * ## Reading a failure
 *
 * Counts, never bare booleans: "21/31 intervals covered the truth" is a diagnosis and
 * "expected true to be false" is not.
 */

interface Run {
  readonly seed: string;
  readonly shape: PlayerShape;
  readonly result: CalibrationResult;
}

/** Draws a player from a plausible region rather than a single point. */
function randomPlayer(
  seed: string,
  options: { flat?: boolean; noisy?: boolean } = {},
): PlayerShape {
  const rng = deriveRng(seed, "player-shape");
  return {
    // Roughly 20–45 cm/360 at 800 DPI: the band real players occupy.
    optimumX: rng.nextRange(12.6, 13.8),
    // A "noisy" player is one whose *variance is the limiter* (doc 04 §4.4.9), which means a
    // shallow curve as well as a wide spread. Pairing high noise with a strong peak would
    // describe a player whose sensitivity effect is large and easily found — the opposite of
    // the population this is meant to represent, and it is what an earlier revision of this
    // file did.
    curvature:
      options.flat === true
        ? 0
        : options.noisy === true
          ? rng.nextRange(0.1, 0.3)
          : rng.nextRange(0.8, 2.0),
    noiseSd: options.noisy === true ? rng.nextRange(1.2, 2.0) : rng.nextRange(0.25, 0.5),
    ...(rng.next() < 0.4 ? { driftTotal: rng.nextRange(-0.4, 0.6) } : {}),
  };
}

const RUNS = 32;
const seeds = Array.from({ length: RUNS }, (_, index) => `property-${index}`);
/** The flat population is doubled: its property is a *rate*, and a rate needs resolution. */
const flatSeeds = Array.from({ length: RUNS * 2 }, (_, index) => `property-flat-${index}`);

/** Structural equality that survives the 64-bit seed a result carries. */
function stable(result: CalibrationResult): string {
  return JSON.stringify(result, (_key, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value,
  );
}

const peaked: Run[] = [];
const flat: Run[] = [];
const noisy: Run[] = [];

beforeAll(() => {
  for (const seed of seeds) {
    const shape = randomPlayer(seed);
    peaked.push({ seed, shape, result: simulate({ shape, seed }) });
  }
  for (const seed of flatSeeds) {
    const shape = randomPlayer(seed, { flat: true });
    flat.push({ seed, shape, result: simulate({ shape, seed }) });
  }
  for (const seed of seeds.slice(0, 16)) {
    const shape = randomPlayer(seed, { noisy: true });
    noisy.push({ seed, shape, result: simulate({ shape, seed }) });
  }
}, 180_000);

const median = (values: readonly number[]): number =>
  values.length === 0
    ? Number.POSITIVE_INFINITY
    : ([...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ??
      Number.POSITIVE_INFINITY);

describe("reproducibility over a population — SENS-BR-030, SENS-BR-031", () => {
  it("gives identical results for the same seed, for every player", () => {
    // Determinism is what makes a stored recommendation explainable a year later. One
    // counter-example breaks that promise, so this asserts on all of them.
    const mismatches = peaked
      .filter(
        (run) => stable(simulate({ shape: run.shape, seed: run.seed })) !== stable(run.result),
      )
      .map((run) => run.seed);
    expect(mismatches).toEqual([]);
  }, 120_000);
});

describe("interval coverage — the claim the confidence index rests on", () => {
  it("contains the true optimum about as often as its level says", () => {
    // A 90% credible interval that covered the truth half the time would make every confidence
    // number downstream a fiction. The bootstrap is approximate and the sample is small, so the
    // bar sits below the nominal level — far enough above chance that a broken interval cannot
    // pass, and stated as a measured rate rather than a claim of exact calibration (§9 of the
    // Phase 11 report).
    const withPeak = peaked.filter(
      (run) => run.result.verdict === "peak_found" && run.result.credibleInterval !== null,
    );
    expect(
      withPeak.length,
      "no peak in any run — the population is wrong, not the interval",
    ).toBeGreaterThan(RUNS * 0.3);

    const misses = withPeak.filter((run) => {
      const interval = run.result.credibleInterval;
      return (
        interval === null || run.shape.optimumX < interval.low || run.shape.optimumX > interval.high
      );
    });
    const covered = withPeak.length - misses.length;
    expect(
      covered / withPeak.length,
      `coverage ${covered}/${withPeak.length}; missed ${misses
        .slice(0, 4)
        .map((run) => run.seed)
        .join(", ")}`,
    ).toBeGreaterThanOrEqual(0.6);
  });

  it("recovers the optimum close enough for the estimate to be worth stating", () => {
    const errors = peaked
      .filter((run) => run.result.verdict === "peak_found" && run.result.xStar !== null)
      .map((run) => Math.abs((run.result.xStar as number) - run.shape.optimumX));
    expect(errors.length).toBeGreaterThan(0);
    // Half a log2 unit is ~41% in sensitivity; a median error above that would mean the search
    // is not finding anything.
    const centre = median(errors);
    expect(
      centre,
      `median |x̂ − x*| = ${centre.toFixed(3)} over ${errors.length} peaks`,
    ).toBeLessThan(0.5);
  });
});

describe("refusing to invent a peak — SENS-BR-017", () => {
  it("keeps fabricated peaks on a flat player down to the rate the level allows", () => {
    // The most important negative property in the product — and it is a **rate**, not a
    // guarantee. `SENS-BR-017` requires that when no candidate is statistically
    // distinguishable the system reports a range instead of a point; it does not, and cannot,
    // promise that a flat player never clears a test at a finite significance level. Doc 13
    // §13.9 sets that level at 90% two-sided *deliberately* — "a decision procedure with a
    // symmetric cost of error" — which nominally admits one flat session in twenty.
    //
    // Measured here, and reproduced at n=100 in the note on `calibration_model_v3`:
    //
    //   v2 rule (any candidate pair separates)   27 / 100
    //   v3 rule (curvature interval excludes 0)  11 / 100
    //
    // The residue above the nominal 5% is post-selection: the bracket narrows toward whatever
    // looked humped and the verdict is then tested on that same data. Removing it needs a
    // design change — sample splitting or a held-out confirmation round — not a tighter
    // threshold, and it is recorded as a known limitation rather than tuned away.
    //
    // The bound below is a regression guard on that measurement, not a target to tune towards.
    const invented = flat.filter((run) => run.result.verdict === "peak_found");
    const rate = invented.length / flat.length;
    expect(
      rate,
      `${invented.length}/${flat.length} flat players were given a peak: ` +
        invented
          .slice(0, 5)
          .map((run) => `${run.seed} → x* ${String(run.result.xStar)}`)
          .join(", "),
    ).toBeLessThanOrEqual(0.25);
  });

  it("still gives a flat player a usable range every time", () => {
    // "We could not separate these" is information; withholding the range as well would leave
    // the player with nothing at all.
    const missing = flat
      .filter((run) => !(run.result.comfortRange.highCm360 > run.result.comfortRange.lowCm360))
      .map((run) => run.seed);
    expect(missing).toEqual([]);
  });

  it("mostly declines for a player too noisy to separate", () => {
    // Variance, not sensitivity, is this player's limiter (doc 04 §4.4.9). A real peak does not
    // vanish under noise, so a few may survive — but the population must not read as confidently
    // peaked.
    const peaks = noisy.filter((run) => run.result.verdict === "peak_found");
    expect(
      peaks.length,
      `${peaks.length}/${noisy.length} noisy players produced a peak`,
    ).toBeLessThanOrEqual(Math.ceil(noisy.length * 0.4));
  });
});

describe("the search's own invariants", () => {
  it("always stops inside the round budget, with a reason", () => {
    const problems = peaked.flatMap((run) => {
      const issues: string[] = [];
      if (run.result.rounds.length > 3)
        issues.push(`${run.seed}: ${run.result.rounds.length} rounds`);
      if (typeof run.result.stopReason !== "string" || run.result.stopReason.length === 0) {
        issues.push(`${run.seed}: no stop reason`);
      }
      return issues;
    });
    expect(problems).toEqual([]);
  });

  it("reports a finite minimum detectable effect for every run", () => {
    // The MDE is what a flat verdict *means*; a NaN there would turn "we could not detect a
    // difference this small" into a blank.
    const bad = [...peaked, ...flat]
      .filter((run) => !Number.isFinite(run.result.minimumDetectableEffect))
      .map((run) => run.seed);
    expect(bad).toEqual([]);
  });

  it("keeps both ranges nested whenever a peak is reported — doc 16 §16.3", () => {
    const toCm = (x: number): number => (2.54 * 2 ** x) / 800;
    const violations = peaked.flatMap((run) => {
      const interval = run.result.credibleInterval;
      if (run.result.verdict !== "peak_found" || interval === null) return [];
      const issues: string[] = [];
      if (run.result.comfortRange.lowCm360 > toCm(interval.low) + 1e-9) {
        issues.push(`${run.seed}: comfort low above interval low`);
      }
      if (run.result.comfortRange.highCm360 < toCm(interval.high) - 1e-9) {
        issues.push(`${run.seed}: comfort high below interval high`);
      }
      return issues;
    });
    expect(violations).toEqual([]);
  });

  it("narrows the detectable effect as the sample grows", () => {
    // More trials must buy more resolution, or the trial budget is not buying anything.
    let improved = 0;
    let compared = 0;
    for (const run of peaked.slice(0, 10)) {
      const small = simulate({ shape: run.shape, seed: run.seed, trialsPerCandidate: 8 });
      const large = simulate({ shape: run.shape, seed: run.seed, trialsPerCandidate: 32 });
      if (
        !Number.isFinite(small.minimumDetectableEffect) ||
        !Number.isFinite(large.minimumDetectableEffect)
      ) {
        continue;
      }
      compared += 1;
      if (large.minimumDetectableEffect < small.minimumDetectableEffect) improved += 1;
    }
    expect(compared).toBeGreaterThan(5);
    expect(
      improved / compared,
      `${improved}/${compared} shrank with more trials`,
    ).toBeGreaterThanOrEqual(0.7);
  }, 120_000);
});

describe("drift and the anchor — doc 13 §13.5, §13.7", () => {
  it("recovers a drifting player about as well as a steady one", () => {
    // If drift were not removed, a rising session would read as a preference for whichever
    // candidate ran last, and counterbalancing alone cannot remove that.
    const errorsFor = (drift: number): number[] =>
      peaked.slice(0, 12).flatMap((run) => {
        const shape: PlayerShape = { ...run.shape, driftTotal: drift };
        const result = simulate({ shape, seed: run.seed });
        return result.verdict === "peak_found" && result.xStar !== null
          ? [Math.abs((result.xStar as number) - shape.optimumX)]
          : [];
      });

    const steady = median(errorsFor(0));
    const drifting = median(errorsFor(0.8));
    expect(steady).toBeLessThan(0.5);
    // Drift may cost accuracy; it must not double the error.
    expect(drifting, `steady ${steady.toFixed(3)} vs drifting ${drifting.toFixed(3)}`).toBeLessThan(
      steady * 2 + 0.25,
    );
  }, 120_000);

  it("reports the drift it removed, so the confidence index can price it", () => {
    const missing = peaked
      .filter((run) => !Number.isFinite(run.result.drift.deltaFirstToLast))
      .map((run) => run.seed);
    expect(missing).toEqual([]);
  });
});
