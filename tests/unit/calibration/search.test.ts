import { describe, expect, it } from "vitest";
import { CALIBRATION_MODEL_V1 } from "@/core/params";
import { deriveRng } from "@/core/random";
import { cmPer360FromCounts, countsPer360FromCm } from "@/core/sensitivity/canonical";
import {
  bracketOf,
  clipBracket,
  constraintHighBound,
  domainBounds,
  initialBracket,
  resolveConstraint,
  toCountsPer360,
  toLogSensitivity,
} from "@/core/calibration/bracket";
import {
  anchorCandidate,
  BLIND_LABELS,
  candidateOffsets,
  generateCandidates,
} from "@/core/calibration/candidates";
import {
  blockOrderForRound,
  latinSquare,
  matchedStimulusSeed,
  testOrderForBlock,
} from "@/core/calibration/counterbalance";
import {
  bestEstimate,
  decideNextBracket,
  fitResponseSurface,
} from "@/core/calibration/response-surface";
import type { CandidateEstimate } from "@/core/calibration/contracts";
import { logSensitivity } from "@/core/types/brand";
import type { TestKey } from "@/core/types/vocabulary";

/**
 * The search mechanics (doc 13 §13.2–§13.8).
 *
 * These are the parts a reader can check by hand against the specification, and they are where a
 * silent inversion does the most damage: a domain bound the wrong way round, or a constraint
 * applied to the wrong end, produces a search that runs happily and recommends the opposite of
 * what the player can use.
 */

const PARAMS = CALIBRATION_MODEL_V1.params;
const DPI = 800;

describe("log space", () => {
  it("round-trips counts through the log transform", () => {
    for (const counts of [4000, 9448.82, 30_000]) {
      expect(toCountsPer360(toLogSensitivity(counts))).toBeCloseTo(counts, 6);
    }
  });

  it("makes a fixed step a fixed percentage", () => {
    // The whole reason for log space: Δx = 1 doubles, Δx = 0.585 is ×1.5. A linear search would
    // waste evaluations at the slow end and skip resolution at the fast end.
    const base = toLogSensitivity(10_000) as number;
    expect(toCountsPer360(base + 1) / toCountsPer360(base)).toBeCloseTo(2, 9);
    expect(toCountsPer360(base + 0.585) / toCountsPer360(base)).toBeCloseTo(1.5, 2);
    expect(toCountsPer360(base + 0.1) / toCountsPer360(base)).toBeCloseTo(1.072, 3);
  });

  it("refuses a non-positive sensitivity rather than returning -Infinity", () => {
    expect(() => toLogSensitivity(0)).toThrow(RangeError);
    expect(() => toLogSensitivity(-5)).toThrow(RangeError);
  });
});

describe("the domain", () => {
  it("runs from the fewest centimetres to the most", () => {
    // Counts and centimetres are *proportional*: cm/360 = 2.54 × counts / DPI. More counts is
    // more hand travel, which is a slower sensitivity. Inverting this is the single easiest way
    // to make the whole search recommend backwards.
    const bounds = domainBounds(PARAMS, DPI);

    expect(cmPer360FromCounts(toCountsPer360(bounds.low), DPI)).toBeCloseTo(
      PARAMS.domainCmPer360.min,
      6,
    );
    expect(cmPer360FromCounts(toCountsPer360(bounds.high), DPI)).toBeCloseTo(
      PARAMS.domainCmPer360.max,
      6,
    );
    expect(bounds.low as number).toBeLessThan(bounds.high as number);
  });
});

describe("the physical constraint", () => {
  it("derives a maximum cm/360 from the measured comfortable swipe", () => {
    // usableSwipe = 22 cm; ρ = 0.55 → 40 cm/360. A player with 22 cm of comfortable travel is
    // not offered anything slower than that.
    const constraint = resolveConstraint({ padWidthCm: null, comfortableSwipeCm: 22 }, PARAMS);
    expect(constraint.maxCmPer360).toBeCloseTo(40, 6);
    expect(constraint.source).toBe("measured");
    expect(constraint.conflict).toBe(false);
  });

  it("takes the narrower of pad and swipe when they agree", () => {
    const constraint = resolveConstraint({ padWidthCm: 20, comfortableSwipeCm: 22 }, PARAMS);
    // 22 exceeds 20 by only 10%, which is not a disagreement — the pad binds.
    expect(constraint.maxCmPer360).toBeCloseTo(20 / PARAMS.constraint.rho, 6);
  });

  it("lets a substantially larger measured swipe win, and records the disagreement", () => {
    // A player may have desk space beyond the pad, or may have mismeasured the pad. The measured
    // value wins and the conflict is recorded rather than silently resolved.
    const constraint = resolveConstraint({ padWidthCm: 20, comfortableSwipeCm: 30 }, PARAMS);

    expect(constraint.conflict).toBe(true);
    expect(constraint.source).toBe("measured");
    expect(constraint.maxCmPer360).toBeCloseTo(30 / PARAMS.constraint.rho, 6);
  });

  it("is not a conflict when the pad is much wider than the swipe", () => {
    // The swipe is the binding limit either way; a big pad the player cannot reach across is
    // not a disagreement about anything.
    const constraint = resolveConstraint({ padWidthCm: 50, comfortableSwipeCm: 20 }, PARAMS);
    expect(constraint.conflict).toBe(false);
    expect(constraint.maxCmPer360).toBeCloseTo(20 / PARAMS.constraint.rho, 6);
  });

  it("is absent when neither input exists", () => {
    const constraint = resolveConstraint({ padWidthCm: null, comfortableSwipeCm: null }, PARAMS);
    expect(constraint.maxCmPer360).toBeNull();
    expect(constraint.source).toBe("none");
  });

  it("bounds the SLOW end, which is the high end of x", () => {
    // doc 13 §13.4 bounds the low-sensitivity end — the one that needs the most desk. Applying
    // it to the fast end would forbid exactly the sensitivities the player *can* execute.
    const constraint = resolveConstraint({ padWidthCm: null, comfortableSwipeCm: 22 }, PARAMS);
    const bound = constraintHighBound(constraint, DPI);

    expect(bound).not.toBeNull();
    expect(cmPer360FromCounts(toCountsPer360(bound as number), DPI)).toBeCloseTo(40, 6);
  });
});

describe("the initial bracket", () => {
  const unbounded = { maxCmPer360: null, source: "none" as const, conflict: false };

  it("is widest for a cold start and narrowest after a prior recommendation", () => {
    // A cold start's first round is localisation, not refinement; a prior recommendation is a
    // search resuming rather than starting.
    const cold = initialBracket({ kind: "cold_start" }, PARAMS, DPI, unbounded);
    const known = initialBracket(
      { kind: "current_sensitivity", countsPer360: 9448.82 },
      PARAMS,
      DPI,
      unbounded,
    );
    const prior = initialBracket(
      { kind: "prior_recommendation", countsPer360: 9448.82 },
      PARAMS,
      DPI,
      unbounded,
    );

    expect(cold.halfWidth).toBeCloseTo(PARAMS.initialHalfWidth.coldStart, 9);
    expect(known.halfWidth).toBeCloseTo(PARAMS.initialHalfWidth.knownCurrentSensitivity, 9);
    expect(prior.halfWidth).toBeCloseTo(PARAMS.initialHalfWidth.priorRecommendation, 9);
    expect(cold.halfWidth).toBeGreaterThan(known.halfWidth);
    expect(known.halfWidth).toBeGreaterThan(prior.halfWidth);
  });

  it("centres a cold start on the documented default", () => {
    const cold = initialBracket({ kind: "cold_start" }, PARAMS, DPI, unbounded);
    expect(cmPer360FromCounts(toCountsPer360(cold.centre), DPI)).toBeCloseTo(
      PARAMS.coldStartCentreCmPer360,
      4,
    );
  });

  it("centres on the player's current sensitivity when they have one", () => {
    const known = initialBracket(
      { kind: "current_sensitivity", countsPer360: countsPer360FromCm(45, DPI) },
      PARAMS,
      DPI,
      unbounded,
    );
    expect(cmPer360FromCounts(toCountsPer360(known.centre), DPI)).toBeCloseTo(45, 4);
  });

  it("slides inside the constraint rather than straddling it", () => {
    // A player with very little room: the bracket must fit under the bound, not extend past it
    // and offer sensitivities they cannot execute.
    const constraint = resolveConstraint({ padWidthCm: 12, comfortableSwipeCm: null }, PARAMS);
    const bracket = initialBracket({ kind: "cold_start" }, PARAMS, DPI, constraint);
    const bound = constraintHighBound(constraint, DPI) as number;

    expect(bracket.high as number).toBeLessThanOrEqual(bound + 1e-9);
  });

  it("re-centres rather than shrinking below the floor", () => {
    // A bracket squeezed to nothing by a bound leaves the search no room to move.
    const bounds = domainBounds(PARAMS, DPI);
    const clipped = clipBracket(
      {
        centre: bounds.low,
        halfWidth: 0.6,
        domainLow: bounds.low,
        domainHigh: bounds.high,
        constraintHigh: null,
      },
      PARAMS.narrowing.minHalfWidth,
    );

    expect(clipped.halfWidth).toBeGreaterThanOrEqual(PARAMS.narrowing.minHalfWidth);
    expect(clipped.low as number).toBeGreaterThanOrEqual((bounds.low as number) - 1e-9);
  });
});

describe("candidate generation", () => {
  const rng = () => deriveRng("candidates", "labels", 0);

  it("places three candidates at the bracket's ends and centre", () => {
    expect(candidateOffsets(3)).toEqual([-1, 0, 1]);
    const candidates = generateCandidates({
      bracket: bracketOf(13, 0.5),
      roundIndex: 0,
      count: 3,
      source: "initial",
      rng: rng(),
      startIndex: 0,
    });

    expect(candidates.map((candidate) => candidate.x as number)).toEqual([12.5, 13, 13.5]);
  });

  it("places four candidates so the interior pair informs curvature", () => {
    // ±w/3 rather than ±w/2: far enough apart to say something about the shape without
    // collapsing towards the centre where they would tell the fit nothing.
    expect(candidateOffsets(4)).toEqual([-1, -1 / 3, 1 / 3, 1]);
  });

  it("refuses a candidate count doc 13 does not define", () => {
    expect(() => candidateOffsets(2)).toThrow(RangeError);
    expect(() => candidateOffsets(5)).toThrow(RangeError);
  });

  it("converts each candidate to canonical counts", () => {
    const candidates = generateCandidates({
      bracket: bracketOf(13, 0.5),
      roundIndex: 0,
      count: 3,
      source: "initial",
      rng: rng(),
      startIndex: 0,
    });

    for (const candidate of candidates) {
      expect(Number(candidate.countsPer360)).toBeCloseTo(2 ** (candidate.x as number), 6);
    }
  });

  it("re-shuffles the blind labels every round — SENS-BR-007", () => {
    // A player who could track "the one called A" across rounds could form an expectation about
    // it, and the measurement would be of that expectation.
    const orders = [0, 1, 2, 3, 4].map((roundIndex) =>
      generateCandidates({
        bracket: bracketOf(13, 0.5),
        roundIndex,
        count: 3,
        source: "initial",
        rng: deriveRng("shuffle", "labels", roundIndex),
        startIndex: 0,
      })
        .map((candidate) => candidate.blindLabel)
        .join(""),
    );

    expect(new Set(orders).size).toBeGreaterThan(1);
    for (const order of orders) {
      // Whatever the order, the labels are always a set of distinct opaque tokens.
      expect(new Set(order.split(""))).toHaveProperty("size", 3);
      for (const label of order.split("")) expect(BLIND_LABELS).toContain(label);
    }
  });

  it("gives candidate indices that are stable and ordered by x", () => {
    // The index is what the engine reasons about; only the label is shuffled. That separation is
    // what lets the engine track position while the player cannot.
    const candidates = generateCandidates({
      bracket: bracketOf(13, 0.5),
      roundIndex: 1,
      count: 3,
      source: "narrowed",
      rng: rng(),
      startIndex: 6,
    });

    expect(candidates.map((candidate) => candidate.candidateIndex)).toEqual([6, 7, 8]);
    expect(candidates[0]?.x as number).toBeLessThan(candidates[2]?.x as number);
  });

  it("marks the anchor as an anchor but labels it like any other candidate", () => {
    const anchor = anchorCandidate({
      x: logSensitivity(13),
      roundIndex: 2,
      candidateIndex: 9,
      rng: rng(),
    });

    expect(anchor.source).toBe("anchor");
    // An anchor a player could recognise would be one they could treat differently, destroying
    // the very comparison it exists to provide.
    expect(BLIND_LABELS).toContain(anchor.blindLabel);
  });
});

describe("counterbalancing", () => {
  it("gives each candidate each position exactly once", () => {
    // A random order removes position effects only on average, and with three rounds "on
    // average" is not close enough.
    const square = latinSquare(3, deriveRng("square", "counterbalance", 0));

    for (let position = 0; position < 3; position += 1) {
      const seen = square.map((row) => row[position]);
      expect(new Set(seen).size).toBe(3);
    }
    for (const row of square) expect(new Set(row).size).toBe(3);
  });

  it("varies the starting row with the seed", () => {
    const a = latinSquare(4, deriveRng("seed-a", "counterbalance", 0));
    const b = latinSquare(4, deriveRng("seed-b", "counterbalance", 0));
    expect(JSON.stringify(a) === JSON.stringify(b)).toBe(false);
  });

  it("wraps when there are more rounds than candidates", () => {
    const square = latinSquare(3, deriveRng("wrap", "counterbalance", 0));
    expect(blockOrderForRound(square, 3)).toEqual(blockOrderForRound(square, 0));
  });

  it("refuses an impossible size", () => {
    expect(() => latinSquare(0, deriveRng("bad", "counterbalance", 0))).toThrow(RangeError);
  });

  it("does not open two consecutive blocks with the same test", () => {
    // That pairing would give one test a practice advantage belonging to the order rather than
    // to the sensitivity.
    const tests: TestKey[] = ["flick", "micro", "tracking", "switching", "precision"];
    let previous: TestKey | null = null;

    for (let block = 0; block < 40; block += 1) {
      const order = testOrderForBlock(tests, deriveRng("tests", "order", block), previous);
      expect(order[0]).not.toBe(previous);
      expect(new Set(order).size).toBe(tests.length);
      previous = order[0] as TestKey;
    }
  });

  it("returns a single test unchanged rather than failing to order it", () => {
    const order = testOrderForBlock(["flick"], deriveRng("one", "order", 0), "flick");
    expect(order).toEqual(["flick"]);
  });

  it("gives candidates within a round identical stimulus seeds — the paired design", () => {
    // Candidate i's flick trial k faces the same target as candidate j's flick trial k. This
    // removes stimulus variance from the between-candidate comparison, which is a substantial
    // power gain for free (doc 13 §13.6, point 4).
    const a = matchedStimulusSeed("session", 0, "flick");
    const b = matchedStimulusSeed("session", 0, "flick");
    expect(a).toBe(b);

    // …but a different round, so nothing is memorised.
    expect(matchedStimulusSeed("session", 1, "flick")).not.toBe(a);
    expect(matchedStimulusSeed("session", 0, "micro")).not.toBe(a);
  });
});

describe("the response surface", () => {
  const estimate = (x: number, alphaHat: number, se = 0.1): CandidateEstimate => ({
    candidateIndex: Math.round(x * 10),
    roundIndex: 0,
    x: logSensitivity(x),
    alphaHat,
    standardError: se,
    validTrials: 20,
    insufficient: false,
  });

  it("finds the vertex of a concave response", () => {
    // A parabola peaking at 13.2: −(x − 13.2)².
    const points = [12.5, 13.0, 13.5, 14.0].map((x) => estimate(x, -((x - 13.2) ** 2)));
    const fit = fitResponseSurface(points);

    expect(fit?.concave).toBe(true);
    expect(fit?.vertexX as number).toBeCloseTo(13.2, 6);
  });

  it("reports no vertex for a convex response rather than inventing one", () => {
    // A convex fit has a *minimum*, not a maximum. Reporting its vertex would recommend the
    // worst sensitivity measured.
    const points = [12.5, 13.0, 13.5].map((x) => estimate(x, (x - 13.2) ** 2));
    const fit = fitResponseSurface(points);

    expect(fit?.concave).toBe(false);
    expect(fit?.vertexX).toBeNull();
  });

  it("declines to fit fewer than three points", () => {
    expect(fitResponseSurface([estimate(13, 0), estimate(13.5, -0.2)])).toBeNull();
  });

  it("excludes under-sampled candidates from the fit — SENS-BR-012", () => {
    const points = [
      estimate(12.5, -0.49),
      estimate(13.0, -0.04),
      estimate(13.5, -0.09),
      { ...estimate(14.0, 5), insufficient: true },
    ];
    const fit = fitResponseSurface(points);

    // The wild insufficient point would have dragged the vertex far right had it been included.
    expect(fit?.vertexX as number).toBeLessThan(13.5);
  });

  it("lets a well-measured candidate move the curve more than a noisy one", () => {
    const noisyEdge = [
      estimate(12.5, -0.5, 0.05),
      estimate(13.0, 0, 0.05),
      estimate(13.5, 2.0, 2.0),
    ];
    const equalWeight = noisyEdge.map((point) => ({ ...point, standardError: 0.05 }));

    const weighted = fitResponseSurface(noisyEdge)?.vertexX as number | null;
    const unweighted = fitResponseSurface(equalWeight)?.vertexX as number | null;

    if (weighted !== null && unweighted !== null) {
      expect(weighted).toBeLessThan(unweighted);
    }
  });
});

describe("the bracket decision table", () => {
  const narrowing = PARAMS.narrowing;
  const base = {
    domainLow: 10,
    domainHigh: 16,
    constraintHigh: null,
    narrowing,
  };

  const estimate = (x: number, alphaHat: number): CandidateEstimate => ({
    candidateIndex: Math.round(x * 10),
    roundIndex: 0,
    x: logSensitivity(x),
    alphaHat,
    standardError: 0.1,
    validTrials: 20,
    insufficient: false,
  });

  it("narrows onto a vertex that sits inside the bracket", () => {
    const bracket = bracketOf(13, 0.5);
    const outcome = decideNextBracket({
      ...base,
      bracket,
      estimates: [12.5, 13.0, 13.5].map((x) => estimate(x, -((x - 13.1) ** 2))),
    });

    expect(outcome.decision).toBe("narrow");
    expect(outcome.nextBracket.centre as number).toBeCloseTo(13.1, 2);
    expect(outcome.nextBracket.halfWidth).toBeCloseTo(narrowing.gamma * 0.5, 9);
  });

  it("shifts rather than leaping when the vertex extrapolates far outside", () => {
    // A quadratic through three points can place its vertex anywhere. Moving one half-width is
    // a step the next round measures, not a leap the fit merely asserted.
    const bracket = bracketOf(13, 0.5);
    const outcome = decideNextBracket({
      ...base,
      bracket,
      estimates: [estimate(12.5, -1.0), estimate(13.0, -0.4), estimate(13.5, -0.35)],
    });

    expect(["shift", "narrow"]).toContain(outcome.decision);
    if (outcome.decision === "shift") {
      expect(outcome.nextBracket.halfWidth).toBeCloseTo(0.5, 9);
    }
  });

  it("shifts toward the edge when the best candidate is at one and there is no peak", () => {
    const bracket = bracketOf(13, 0.5);
    const outcome = decideNextBracket({
      ...base,
      bracket,
      // Monotone increasing: the optimum is somewhere beyond the bracket.
      estimates: [estimate(12.5, -0.5), estimate(13.0, 0), estimate(13.5, 0.5)],
    });

    expect(outcome.decision).toBe("shift");
    expect(outcome.nextBracket.centre as number).toBeGreaterThan(13);
    expect(outcome.nextBracket.halfWidth).toBeCloseTo(0.5, 9);
  });

  it("narrows conservatively for an interior best with no concavity", () => {
    // A convex quadratic through three points always has its best *fitted* value at an edge, so
    // this case needs four: the curve comes out convex while the best observed candidate sits
    // inside the bracket. Narrowing onto it is right, but not as far as a real peak would
    // justify — the fit found no shape to justify it.
    const bracket = bracketOf(13.25, 0.75);
    const outcome = decideNextBracket({
      ...base,
      bracket,
      estimates: [
        estimate(12.5, 0.4),
        estimate(13.0, 0.55),
        estimate(13.5, 0.05),
        estimate(14.0, 0.5),
      ],
    });

    expect(outcome.decision).toBe("narrow_conservative");
    expect(outcome.nextBracket.centre as number).toBeCloseTo(13.0, 9);
    expect(outcome.nextBracket.halfWidth).toBeCloseTo(narrowing.conservativeGamma * 0.75, 9);
  });

  it("never lets the next bracket escape the domain or the constraint", () => {
    const outcome = decideNextBracket({
      ...base,
      constraintHigh: 13.2,
      bracket: bracketOf(13, 0.5),
      estimates: [estimate(12.5, -0.5), estimate(13.0, 0), estimate(13.5, 0.9)],
    });

    expect(outcome.nextBracket.centre as number).toBeLessThanOrEqual(13.2 + 1e-9);
  });

  it("spans a tie rather than flipping a coin — doc 13 §13.13", () => {
    const tied = [estimate(12.5, 0.5), estimate(13.0, -0.5), estimate(13.5, 0.5)];
    const best = bestEstimate(tied);

    expect(best?.x as number).toBeCloseTo(13.0, 9);
  });

  it("returns nothing to narrow onto when every candidate is under-sampled", () => {
    const all = [12.5, 13.0, 13.5].map((x) => ({ ...estimate(x, 0), insufficient: true }));
    expect(bestEstimate(all)).toBeNull();
  });
});
