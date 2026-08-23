import type { DimensionKey } from "../types/vocabulary";
import type { DimensionOutcome } from "./dimensions";
import type { NotableDimension, ProfileClassification, StrengthsAndAreas } from "./profile";

/**
 * Generated, structured explanations (doc 16 §16.5, §16.6, `SENS-BR-036`).
 *
 * Every sentence is built from measured numbers and the rule that fired. The rules for the
 * text are fixed:
 *
 *  - always name the specific dimensions and their values;
 *  - always state the rule that fired, in plain language;
 *  - never characterise the player as a person — describe what the measurement showed;
 *  - never use a weakness as a punchline;
 *  - never compare to other users while the reference is provisional.
 *
 * The output is structured rather than a string so it can be localised later without the
 * classifier changing (doc 20 §20.10: `aim_profile_explanation` is JSONB for this reason).
 */

export interface ExplanationSentence {
  readonly key: string;
  /** English rendering. */
  readonly text: string;
  /** The measured values the sentence cites, for localisation and for the breakdown UI. */
  readonly cites: Readonly<Record<string, number | string>>;
}

export interface AimProfileExplanation {
  readonly profileKey: ProfileClassification["key"];
  readonly rule: number;
  readonly band: ProfileClassification["band"];
  readonly sentences: readonly ExplanationSentence[];
}

const DIMENSION_LABEL: Readonly<Record<DimensionKey, string>> = {
  flick: "Flick",
  precision: "Precision",
  tracking: "Tracking",
  speed: "Speed",
  control: "Control",
  consistency: "Consistency",
};

export function dimensionLabel(key: DimensionKey): string {
  return DIMENSION_LABEL[key];
}

const round = (value: number): number => Math.round(value);

function named(evidence: readonly { dimension: DimensionKey; score: number }[]): string {
  return evidence.map((e) => `${DIMENSION_LABEL[e.dimension]} (${round(e.score)})`).join(" and ");
}

function bandPhrase(band: ProfileClassification["band"], cmPer360: number | null): string {
  const where = band === "high" ? "high" : band === "low" ? "low" : "mid";
  return cmPer360 === null
    ? `Your comfort range sits in the ${where} band.`
    : `Your recommended sensitivity sits in the ${where} band at ${cmPer360.toFixed(1)} cm/360.`;
}

export function explainProfile(
  profile: ProfileClassification,
  dimensions: readonly DimensionOutcome[],
  cmPer360: number | null,
): AimProfileExplanation {
  const sentences: ExplanationSentence[] = [];
  const scored = dimensions.filter((d) => d.sufficient);
  // The classifier names every dimension a rule keyed on in `evidence`, in the order the rule
  // reasons about them, so the text reads the same table it cites: no re-derivation here.
  const cites = (): Record<string, number> =>
    Object.fromEntries(profile.evidence.map((e) => [e.dimension, round(e.score)]));
  const at = (index: number): string => named(profile.evidence.slice(index, index + 1));
  const scoreOf = (key: DimensionKey): number =>
    round(profile.evidence.find((e) => e.dimension === key)?.score ?? Number.NaN);

  switch (profile.rule) {
    case 0:
      sentences.push({
        key: "provisional",
        text: `Only ${scored.length} of the six dimensions had enough trials to score, so no profile is assigned yet. A Standard or Advanced session measures all six.`,
        cites: { scoredDimensions: scored.length },
      });
      break;
    case 1:
      sentences.push({
        key: "balanced.flat",
        text: `No dimension stood out: your highest was ${at(0)} and your lowest ${at(1)}, and everything sat within noise of your own average.`,
        cites: cites(),
      });
      break;
    case 2:
      sentences.push({
        key: "tracking-focused",
        text: `${at(0)} was your strongest dimension by a clear margin over ${at(1)}. That pattern means you hold a moving target better than you acquire a still one.`,
        cites: cites(),
      });
      break;
    case 3:
      sentences.push({
        key: "precision-focused",
        text: `${named(profile.evidence.slice(0, 2))} were your two strongest dimensions, and Speed (${scoreOf("speed")}) was your lowest. That pattern means you place shots accurately and correct rarely, but you take longer to get there.`,
        cites: cites(),
      });
      break;
    case 4:
      sentences.push({
        key: "fast-flick",
        text: `${named(profile.evidence.slice(0, 2))} were your two strongest dimensions, and Precision (${scoreOf("precision")}) was your lowest. That pattern means you reach targets quickly and your first shot lands less often than your movement would suggest.`,
        cites: cites(),
      });
      break;
    case 5:
      sentences.push({
        key: "low-sensitivity-control",
        text: `${at(0)} was your strongest dimension, and your sensitivity sits in the low band. That pattern means economy of movement is what this sensitivity is buying you.`,
        cites: cites(),
      });
      break;
    case 6:
      sentences.push({
        key: "high-mobility",
        text: `${at(0)} was your strongest dimension, and your sensitivity sits in the high band. That pattern means fast engagement is what this sensitivity is buying you.`,
        cites: cites(),
      });
      break;
    case 7:
      sentences.push({
        key: "hybrid",
        text: `${named(profile.evidence)} both stood well above your own average, with nothing standing below it. That is two separate strengths rather than one pattern.`,
        cites: cites(),
      });
      break;
    default:
      sentences.push({
        key: "balanced.fallback",
        text: `${at(0)} led and ${at(1)} trailed, but no combination matched a named pattern, so the profile is balanced.`,
        cites: cites(),
      });
  }

  sentences.push({
    key: "band",
    text: bandPhrase(profile.band, cmPer360),
    cites: cmPer360 === null ? { band: profile.band } : { band: profile.band, cmPer360 },
  });

  return { profileKey: profile.key, rule: profile.rule, band: profile.band, sentences };
}

/* ------------------------------------------------------------------ strengths and areas */

export interface NotableExplanation extends NotableDimension {
  readonly label: string;
  readonly text: string;
}

export interface StrengthsExplanation {
  readonly strengths: readonly NotableExplanation[];
  readonly improvementAreas: readonly NotableExplanation[];
  readonly flatStatement: string | null;
}

const STRENGTH_TEXT: Readonly<Record<DimensionKey, string>> = {
  flick: "Your ballistic flicks landed close and fast relative to your other dimensions.",
  precision:
    "Your first shots landed on target more often than your other dimensions would predict.",
  tracking: "You held moving targets with less error than your other dimensions would predict.",
  speed: "You resolved engagements quickly relative to your other dimensions.",
  control: "You overshot and corrected less than your other dimensions would predict.",
  consistency: "Your trial-to-trial variance was low relative to your other dimensions.",
};

const AREA_TEXT: Readonly<Record<DimensionKey, string>> = {
  flick:
    "Your flicks landed further from centre or took longer than your other dimensions — at this sensitivity, large movements cost you more than small ones.",
  precision:
    "Your first shots missed more often than your other dimensions would predict — the final placement, not the movement, is where trials were lost.",
  tracking:
    "Your error while following a moving target was higher than your other dimensions would predict.",
  speed:
    "Engagements took longer to resolve than your other dimensions would predict — accuracy was there, but it was slow to arrive.",
  control:
    "You overshot and corrected more than your other dimensions would predict — the classic signature of a sensitivity at the fast edge of what you can control.",
  consistency:
    "Your trial-to-trial variance was your limiter: individual trials were good, but not repeatably.",
};

export function explainStrengths(result: StrengthsAndAreas): StrengthsExplanation {
  const describe =
    (table: Readonly<Record<DimensionKey, string>>) =>
    (item: NotableDimension): NotableExplanation => ({
      ...item,
      label: DIMENSION_LABEL[item.dimension],
      text: `${DIMENSION_LABEL[item.dimension]} (${round(item.score)}) — ${table[item.dimension]}`,
    });

  return {
    strengths: result.strengths.map(describe(STRENGTH_TEXT)),
    improvementAreas: result.improvementAreas.map(describe(AREA_TEXT)),
    flatStatement: result.flat
      ? "Your six dimensions were within noise of each other — you don't have a stand-out strength or weakness at this sensitivity."
      : null,
  };
}
