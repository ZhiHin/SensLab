import { describe, expect, it } from "vitest";
import {
  AIM_PROFILE_RULES_V1,
  REFERENCE_DIST_PROVISIONAL_V2,
  SCORING_MODEL_V2,
} from "@/core/params";
import {
  MIN_TRIALS_PER_DIMENSION,
  PRIMARY_METRIC_BY_TEST,
  classifyAimProfile,
  computeDimensionScores,
  dimensionLabel,
  explainProfile,
  explainStrengths,
  sensitivityBand,
  strengthsAndAreas,
  withShape,
  type DimensionOutcome,
} from "@/core/recommendation";
import type { ObservedTrial } from "@/core/scoring";
import { DIMENSION_KEYS, type DimensionKey } from "@/core/types/vocabulary";
import { ALL_TESTS } from "@/test-engine/tests";

/**
 * The aim-profile classifier (doc 16 §16.5) — the fixture table covers every rule including
 * the fallthrough — plus the strengths/areas rules (§16.6) and the explanation contract.
 */

const PARAMS = AIM_PROFILE_RULES_V1.params;

/** Builds six dimensions from scores; shape is derived exactly as production does it. */
function dims(scores: Partial<Record<DimensionKey, number>>, insufficient: DimensionKey[] = []) {
  const base: DimensionOutcome[] = DIMENSION_KEYS.map((dimension) => ({
    dimension,
    score: scores[dimension] ?? 50,
    shape: 0,
    provisional: true,
    sampleCount: 20,
    contributions: [],
    sufficient: !insufficient.includes(dimension),
  }));
  return withShape(base, PARAMS.shapeSpreadFloor);
}

describe("sensitivity bands", () => {
  it("uses the documented thresholds as labels", () => {
    expect(sensitivityBand(15, PARAMS)).toBe("high");
    expect(sensitivityBand(20, PARAMS)).toBe("mid");
    expect(sensitivityBand(40, PARAMS)).toBe("mid");
    expect(sensitivityBand(41, PARAMS)).toBe("low");
  });
});

describe("the classifier — one fixture per rule", () => {
  it("rule 0: provisional with fewer than four sufficient dimensions", () => {
    const profile = classifyAimProfile(dims({}, ["flick", "speed", "control"]), 30, PARAMS);
    expect(profile.key).toBe("provisional");
    expect(profile.rule).toBe(0);
  });

  it("rule 1: balanced when nothing stands out", () => {
    const profile = classifyAimProfile(
      dims({ flick: 51, precision: 50, tracking: 49 }),
      30,
      PARAMS,
    );
    expect(profile.key).toBe("balanced");
    expect(profile.rule).toBe(1);
    expect(profile.displayName).toBe("Balanced");
  });

  it("rule 2: tracking-focused when tracking leads by the margin", () => {
    const profile = classifyAimProfile(
      dims({ tracking: 80, flick: 60, precision: 55, speed: 52, control: 50, consistency: 48 }),
      30,
      PARAMS,
    );
    expect(profile.key).toBe("tracking-focused");
    expect(profile.rule).toBe(2);
    expect(profile.evidence[0]?.dimension).toBe("tracking");
  });

  it("rule 3: precision-focused with precision and control on top and speed lowest", () => {
    const profile = classifyAimProfile(
      dims({ precision: 82, control: 79, flick: 66, tracking: 64, consistency: 63, speed: 55 }),
      31.2,
      PARAMS,
    );
    expect(profile.key).toBe("precision-focused");
    expect(profile.rule).toBe(3);
    expect(profile.displayName).toBe("Balanced Precision");
  });

  it("rule 4: fast-flick with flick and speed on top and precision lowest", () => {
    const profile = classifyAimProfile(
      dims({ flick: 84, speed: 80, tracking: 66, control: 65, consistency: 62, precision: 50 }),
      18,
      PARAMS,
    );
    expect(profile.key).toBe("fast-flick");
    expect(profile.rule).toBe(4);
  });

  it("rule 5: low-sensitivity control when control leads in the low band", () => {
    const profile = classifyAimProfile(
      dims({ control: 80, tracking: 66, flick: 64, precision: 63, speed: 62, consistency: 60 }),
      45,
      PARAMS,
    );
    expect(profile.key).toBe("low-sensitivity-control");
    expect(profile.rule).toBe(5);
    expect(profile.displayName).toBe("Low-Sensitivity Control");
  });

  it("rule 6: high-mobility when speed leads in the high band", () => {
    const profile = classifyAimProfile(
      dims({ speed: 80, tracking: 66, flick: 64, precision: 63, control: 62, consistency: 60 }),
      15,
      PARAMS,
    );
    expect(profile.key).toBe("high-mobility");
    expect(profile.rule).toBe(6);
  });

  it("rule 7: hybrid with two non-adjacent strengths and no weakness", () => {
    // Flick (position 0) and Control (position 4) both above; the rest level. With six
    // dimensions, two leaders necessarily push four below the mean, so the rule is only
    // reachable where the spread floor (3.0) dominates the player's own spread — a modest
    // lead over a flat field, which is exactly the "two strengths, no weakness" doc 16 means.
    const profile = classifyAimProfile(
      dims({ flick: 72, control: 72, precision: 69, tracking: 69, speed: 69, consistency: 69 }),
      30,
      PARAMS,
    );
    expect(profile.key).toBe("hybrid");
    expect(profile.rule).toBe(7);
  });

  it("rule 8: balanced fallback when a pattern stands out but matches no rule", () => {
    // Consistency alone stands out; none of rules 2–7 fire.
    const profile = classifyAimProfile(
      dims({ consistency: 80, flick: 62, precision: 61, tracking: 60, speed: 59, control: 58 }),
      30,
      PARAMS,
    );
    expect(profile.key).toBe("balanced");
    expect(profile.rule).toBe(8);
  });

  it("never depends on absolute level — the same shape at any skill gives the same profile", () => {
    const novice = classifyAimProfile(
      dims({ precision: 42, control: 40, flick: 30, tracking: 29, consistency: 28, speed: 20 }),
      30,
      PARAMS,
    );
    const expert = classifyAimProfile(
      dims({ precision: 92, control: 90, flick: 80, tracking: 79, consistency: 78, speed: 70 }),
      30,
      PARAMS,
    );
    expect(novice.key).toBe(expert.key);
    expect(novice.key).toBe("precision-focused");
  });

  it("is deterministic", () => {
    const a = classifyAimProfile(dims({ tracking: 80, flick: 60 }), 30, PARAMS);
    const b = classifyAimProfile(dims({ tracking: 80, flick: 60 }), 30, PARAMS);
    expect(a).toEqual(b);
  });
});

describe("strengths and improvement areas — doc 16 §16.6", () => {
  it("lists up to three strengths and two areas, by shape", () => {
    const result = strengthsAndAreas(
      dims({ flick: 85, precision: 82, tracking: 80, speed: 78, control: 30, consistency: 25 }),
      PARAMS,
    );
    expect(result.strengths.length).toBeLessThanOrEqual(3);
    expect(result.improvementAreas.length).toBeLessThanOrEqual(2);
    expect(result.improvementAreas[0]?.dimension).toBe("consistency");
    expect(result.flat).toBe(false);
  });

  it("reports a flat profile honestly rather than manufacturing a strength", () => {
    const result = strengthsAndAreas(dims({ flick: 51, precision: 50 }), PARAMS);
    expect(result.flat).toBe(true);
    const explained = explainStrengths(result);
    expect(explained.flatStatement).toMatch(/within noise/);
    expect(explained.strengths).toHaveLength(0);
  });

  it("words every area with its measured value and never as a punchline", () => {
    const explained = explainStrengths(
      strengthsAndAreas(dims({ control: 25, consistency: 26, flick: 70, precision: 68 }), PARAMS),
    );
    for (const area of explained.improvementAreas) {
      expect(area.text).toMatch(/\(\d+\)/);
      expect(area.text).not.toMatch(/bad|poor|worst|terrible/i);
    }
  });
});

describe("the generated explanation — SENS-BR-036", () => {
  it("cites the dimensions and values that fired the rule, and names the band", () => {
    const dimensions = dims({
      precision: 82,
      control: 79,
      flick: 66,
      tracking: 64,
      consistency: 63,
      speed: 55,
    });
    const profile = classifyAimProfile(dimensions, 31.2, PARAMS);
    const explanation = explainProfile(profile, dimensions, 31.2);
    const text = explanation.sentences.map((s) => s.text).join(" ");
    expect(text).toContain("Precision (82)");
    expect(text).toContain("Control (79)");
    expect(text).toContain("Speed (55)");
    expect(text).toContain("31.2 cm/360");
    expect(explanation.rule).toBe(3);
    expect(explanation.sentences.every((s) => Object.keys(s.cites).length > 0)).toBe(true);
  });

  it("describes the measurement, never the person", () => {
    for (const scores of [
      { tracking: 80, flick: 60 },
      { flick: 84, speed: 80, precision: 50 },
      { control: 80 },
      {},
    ]) {
      const dimensions = dims(scores);
      const profile = classifyAimProfile(dimensions, 30, PARAMS);
      const text = explainProfile(profile, dimensions, 30)
        .sentences.map((s) => s.text)
        .join(" ");
      expect(text).not.toMatch(/you are a|you're a/i);
    }
  });

  it("labels every dimension", () => {
    for (const key of DIMENSION_KEYS) expect(dimensionLabel(key).length).toBeGreaterThan(0);
  });
});

describe("dimension scores — doc 14 §14.4", () => {
  const trial = (
    testKey: ObservedTrial["testKey"],
    index: number,
    metrics: Record<string, number>,
  ): ObservedTrial => ({
    testKey,
    candidateIndex: index % 3,
    roundIndex: 0,
    blockIndex: index % 3,
    trialIndex: index,
    validity: "valid",
    isPractice: false,
    scopeKey: "hipfire",
    variant: null,
    metrics,
  });

  it("scores a reference-average player at the display centre", () => {
    const ref = new Map(
      REFERENCE_DIST_PROVISIONAL_V2.params.statistics.map((s) => [s.metricKey, s]),
    );
    const trials: ObservedTrial[] = [];
    for (let i = 0; i < 24; i += 1) {
      trials.push(
        trial("flick", i, {
          adjustedAcquisitionTime: ref.get("adjustedAcquisitionTime")?.mean ?? 0,
          flickErrorNorm: ref.get("flickErrorNorm")?.mean ?? 0,
          firstShotAccuracy: i % 2, // mean 0.5 ≈ reference 0.62, slightly below
          pathEfficiency: ref.get("pathEfficiency")?.mean ?? 0,
        }),
      );
    }
    const scores = computeDimensionScores({
      trials,
      scoring: SCORING_MODEL_V2.params,
      reference: REFERENCE_DIST_PROVISIONAL_V2.params,
    });
    const flick = scores.find((d) => d.dimension === "flick");
    expect(flick?.sufficient).toBe(true);
    expect(flick?.provisional).toBe(true);
    // Three of four contributions sit exactly at the reference mean; first-shot accuracy a
    // little under. The score lands just below 50.
    expect(flick?.score).toBeGreaterThan(40);
    expect(flick?.score).toBeLessThanOrEqual(50);
    // Tracking saw no trials at all.
    const tracking = scores.find((d) => d.dimension === "tracking");
    expect(tracking?.sufficient).toBe(false);
    expect(tracking?.sampleCount).toBe(0);
  });

  it("aligns direction so a faster acquisition scores higher", () => {
    const make = (ms: number) => {
      const trials: ObservedTrial[] = [];
      for (let i = 0; i < MIN_TRIALS_PER_DIMENSION + 2; i += 1) {
        trials.push(trial("flick", i, { adjustedAcquisitionTime: ms }));
      }
      return (
        computeDimensionScores({
          trials,
          scoring: SCORING_MODEL_V2.params,
          reference: REFERENCE_DIST_PROVISIONAL_V2.params,
        }).find((d) => d.dimension === "speed")?.score ?? Number.NaN
      );
    };
    expect(make(300)).toBeGreaterThan(make(700));
  });

  it("clamps to the display range", () => {
    const trials: ObservedTrial[] = [];
    // Fifty seconds per acquisition is hundreds of reference SDs out; the floor holds at 1.
    for (let i = 0; i < 12; i += 1)
      trials.push(trial("flick", i, { adjustedAcquisitionTime: 50_000 }));
    const speed = computeDimensionScores({
      trials,
      scoring: SCORING_MODEL_V2.params,
      reference: REFERENCE_DIST_PROVISIONAL_V2.params,
    }).find((d) => d.dimension === "speed");
    expect(speed?.score).toBe(1);
  });

  it("needs three finite primary values per test before it scores consistency", () => {
    // Eight flick trials, but only two carry the primary metric: the flick consistency term
    // has nothing robust to say and is left out rather than computed from a pair.
    const trials: ObservedTrial[] = [];
    for (let i = 0; i < 8; i += 1)
      trials.push(
        trial("flick", i, i < 2 ? { adjustedAcquisitionTime: 500 } : { flickErrorNorm: 0.8 }),
      );
    const consistency = computeDimensionScores({
      trials,
      scoring: SCORING_MODEL_V2.params,
      reference: REFERENCE_DIST_PROVISIONAL_V2.params,
    }).find((d) => d.dimension === "consistency");
    expect(consistency?.sufficient).toBe(false);
    expect(consistency?.contributions).toHaveLength(0);
    expect(consistency?.sampleCount).toBe(0);
  });

  it("declines a consistency value when the primary metric is centred on zero", () => {
    // A relative CV against a zero centre is undefined; the term is left out, not infinite.
    const trials: ObservedTrial[] = [];
    for (let i = 0; i < 12; i += 1)
      trials.push(trial("precision", i, { flickErrorNorm: 0, firstShotAccuracy: 1 }));
    const consistency = computeDimensionScores({
      trials,
      scoring: SCORING_MODEL_V2.params,
      reference: REFERENCE_DIST_PROVISIONAL_V2.params,
    }).find((d) => d.dimension === "consistency");
    expect(consistency?.sufficient).toBe(false);
    expect(consistency?.contributions).toHaveLength(0);
  });

  it("gives every dimension a zero shape when nothing scored", () => {
    const none = withShape(
      computeDimensionScores({
        trials: [],
        scoring: SCORING_MODEL_V2.params,
        reference: REFERENCE_DIST_PROVISIONAL_V2.params,
      }),
    );
    expect(none).toHaveLength(6);
    expect(none.every((d) => d.shape === 0 && !d.sufficient)).toBe(true);
  });

  it("derives shape from the player's own mean with a floored spread", () => {
    const shaped = dims({ flick: 60, precision: 40 });
    const flick = shaped.find((d) => d.dimension === "flick");
    const precision = shaped.find((d) => d.dimension === "precision");
    expect(flick?.shape ?? 0).toBeGreaterThan(0);
    expect(precision?.shape ?? 0).toBeLessThan(0);
    expect(shaped.reduce((sum, d) => sum + d.shape, 0)).toBeCloseTo(0, 9);
  });

  it("keeps its primary-metric table in step with the definitions", () => {
    for (const definition of ALL_TESTS) {
      if (definition.category !== "scored") continue;
      expect(PRIMARY_METRIC_BY_TEST[definition.key], definition.key).toBe(
        definition.primaryMetricKey,
      );
    }
  });
});

describe("every rule has an explanation that names its evidence", () => {
  const cases: {
    scores: Partial<Record<DimensionKey, number>>;
    cm: number;
    rule: number;
    expects: RegExp;
  }[] = [
    { scores: {}, cm: 30, rule: 0, expects: /of the six dimensions/ },
    { scores: { flick: 51 }, cm: 30, rule: 1, expects: /No dimension stood out/ },
    {
      scores: { tracking: 80, flick: 60, precision: 55, speed: 52, control: 50, consistency: 48 },
      cm: 30,
      rule: 2,
      expects: /Tracking \(80\)/,
    },
    {
      scores: { precision: 82, control: 79, flick: 66, tracking: 64, consistency: 63, speed: 55 },
      cm: 31.2,
      rule: 3,
      expects: /Precision \(82\) and Control \(79\)/,
    },
    {
      scores: { flick: 84, speed: 80, tracking: 66, control: 65, consistency: 62, precision: 50 },
      cm: 18,
      rule: 4,
      expects: /Precision \(50\) was your lowest/,
    },
    {
      scores: { control: 80, tracking: 66, flick: 64, precision: 63, speed: 62, consistency: 60 },
      cm: 45,
      rule: 5,
      expects: /Control \(80\)/,
    },
    {
      scores: { speed: 80, tracking: 66, flick: 64, precision: 63, control: 62, consistency: 60 },
      cm: 15,
      rule: 6,
      expects: /Speed \(80\)/,
    },
    {
      scores: { flick: 72, control: 72, precision: 69, tracking: 69, speed: 69, consistency: 69 },
      cm: 30,
      rule: 7,
      expects: /two separate strengths/,
    },
    {
      scores: { consistency: 80, flick: 62, precision: 61, tracking: 60, speed: 59, control: 58 },
      cm: 30,
      rule: 8,
      expects: /Consistency \(80\) led/,
    },
  ];

  for (const entry of cases) {
    it(`rule ${entry.rule}`, () => {
      const insufficient: DimensionKey[] = entry.rule === 0 ? ["flick", "speed", "control"] : [];
      const dimensions = dims(entry.scores, insufficient);
      const profile = classifyAimProfile(dimensions, entry.cm, PARAMS);
      expect(profile.rule).toBe(entry.rule);
      const text = explainProfile(profile, dimensions, entry.cm)
        .sentences.map((s) => s.text)
        .join(" ");
      expect(text).toMatch(entry.expects);
      expect(text).toMatch(/band/);
    });
  }

  it("names the comfort range band when there is no point recommendation", () => {
    const dimensions = dims({ flick: 51 });
    const profile = classifyAimProfile(dimensions, 30, PARAMS);
    const text = explainProfile(profile, dimensions, null)
      .sentences.map((s) => s.text)
      .join(" ");
    expect(text).toMatch(/comfort range sits in the mid band/);
  });

  it("describes every dimension as a strength and as an area", () => {
    for (const key of DIMENSION_KEYS) {
      const high = dims({ [key]: 90 });
      const low = dims({ [key]: 10 });
      const up = explainStrengths(strengthsAndAreas(high, PARAMS));
      const down = explainStrengths(strengthsAndAreas(low, PARAMS));
      expect(up.strengths.map((s) => s.dimension)).toContain(key);
      expect(down.improvementAreas.map((s) => s.dimension)).toContain(key);
      expect(up.strengths.find((s) => s.dimension === key)?.text).toContain("(90)");
    }
  });
});
