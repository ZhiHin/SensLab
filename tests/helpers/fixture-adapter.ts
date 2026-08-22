import { cmPer360FromCounts, countsPer360FromDegreesPerCount } from "@/core/sensitivity/canonical";
import type { GameAdapter, VerificationEvidence, VerificationMeasurement } from "@/game-adapters";
import { createVerifiedAdapter, type VerifiedScopeSpec } from "@/game-adapters";
import type { TableAnchor } from "@/game-adapters";

/**
 * A **test-only** verified adapter.
 *
 * It exists to exercise the verified half of the adapter contract: the model forms, the
 * quantisation, the scoped conversion, the gate, and the construction checks. Its constants
 * are openly fictional and are not, and must never be presented as, a claim about any real
 * game. No production code imports this file; an architecture test asserts that, and a second
 * one asserts that no launch adapter cites the fixture's register entries.
 *
 * Note what it is *not*: a reimplementation. Since Phase 5 the fixture is built by
 * `createVerifiedAdapter`, the same function a real adapter would use, so the conformance
 * suite is testing production code rather than a parallel copy that could quietly diverge
 * from it.
 *
 * The real adapters arrive one closed register entry at a time. As of Phase 5 there are none.
 */

/** Fictional. Chosen so that a setting of 1 gives a round 18,000 counts per 360. */
export const FIXTURE_YAW_DEG_PER_COUNT = 0.02;

const fixtureCounts = (settingValue: number): number =>
  countsPer360FromDegreesPerCount(settingValue * FIXTURE_YAW_DEG_PER_COUNT);

/**
 * "Measurements" generated from the model itself.
 *
 * Legitimate for a fixture whose game does not exist, and *only* for that: a real adapter's
 * measurements come from the procedure in doc 08 §8.5, and generating them from the model
 * would defeat the one check that compares a model against reality. The distinction is
 * enforced socially rather than mechanically, so it is stated plainly here.
 */
function fictionalMeasurement(
  settingValue: number,
  dpi: number,
  scopeKey: VerificationMeasurement["scopeKey"] = "hipfire",
): VerificationMeasurement {
  return {
    scopeKey,
    settingValue,
    dpi,
    measuredCmPer360: cmPer360FromCounts(fixtureCounts(settingValue), dpi),
    method: "fictional — generated from the fixture model, not measured",
  };
}

const EVIDENCE: VerificationEvidence = {
  verifiedAt: "2026-01-01T00:00:00.000Z",
  verifiedAgainstBuild: "fixture-build-1",
  sourceRefs: ["fixture://tests/helpers/fixture-adapter.ts"],
  signedOffBy: ["fixture-a", "fixture-b"],
  // Two widely separated settings, as doc 08 §8.5 step 2 requires of a real campaign.
  measurements: [fictionalMeasurement(0.5, 800), fictionalMeasurement(6, 800)],
};

const HIPFIRE: VerifiedScopeSpec = {
  scopeKey: "hipfire",
  displayName: { en: "Hipfire" },
  settingLabel: { en: "Sensitivity" },
  settingKey: "sensitivity",
  model: { form: "linear_yaw", yawDegPerCountAtSettingOne: FIXTURE_YAW_DEG_PER_COUNT },
  settingRange: { min: 0.1, max: 10, step: 0.01, decimals: 2 },
  adsModel: "raw_multiplier",
  fovAxis: "horizontal",
  verification: { status: "verified", evidence: EVIDENCE, registerEntry: "EV-FIXTURE" },
};

const ADS: VerifiedScopeSpec = {
  ...HIPFIRE,
  scopeKey: "ads",
  displayName: { en: "ADS" },
  settingLabel: { en: "ADS Sensitivity" },
  settingKey: "ads_sensitivity",
  magnification: 2,
  optics: { kind: "tangent_magnification", magnification: 2 },
  verification: { status: "unverified", registerEntry: "EV-FIXTURE-ADS" },
};

export interface FixtureAdapterOptions {
  readonly gameId?: string;
  readonly gameVersionLabel?: string;
  readonly adapterVersion?: string;
  readonly includeUnverifiedAdsScope?: boolean;
  /** Promotes the ADS scope to verified, for testing the scoped conversion path. */
  readonly verifiedAdsScope?: boolean;
  readonly adsModel?: VerifiedScopeSpec["adsModel"];
}

export function createFixtureAdapter(options: FixtureAdapterOptions = {}): GameAdapter {
  const scopes: VerifiedScopeSpec[] = [HIPFIRE];

  if (options.verifiedAdsScope === true) {
    scopes.push({
      ...ADS,
      ...(options.adsModel === undefined ? {} : { adsModel: options.adsModel }),
      verification: {
        status: "verified",
        // A verified scope needs measurements *of that scope*. Reusing hipfire's would be
        // claiming the ADS model was established by readings that never touched it — which
        // the construction check rejects, and rightly.
        evidence: {
          ...EVIDENCE,
          measurements: [
            fictionalMeasurement(0.5, 800, "ads"),
            fictionalMeasurement(6, 800, "ads"),
          ],
        },
        registerEntry: "EV-FIXTURE",
      },
    });
  } else if (options.includeUnverifiedAdsScope ?? true) {
    scopes.push(ADS);
  }

  return createVerifiedAdapter({
    identity: {
      gameId: options.gameId ?? "fixture-game",
      gameVersionLabel: options.gameVersionLabel ?? "1.0",
      adapterVersion: options.adapterVersion ?? "1.0.0",
      displayName: { en: "Fixture Game" },
      region: "global",
    },
    scopes,
  });
}

/* ------------------------------------------------------------------ a table-form fixture */

/**
 * Anchors for a fictional non-linear game.
 *
 * Deliberately not generated from a closed form: the point of Form B is that no closed form
 * is known, so anchors that secretly follow one would make the interpolation tests vacuous.
 * These are hand-chosen, strictly monotone, and unevenly spaced.
 */
export const FIXTURE_TABLE_ANCHORS: readonly TableAnchor[] = [
  { setting: 5, countsPer360: 42000 },
  { setting: 12, countsPer360: 19500 },
  { setting: 25, countsPer360: 10400 },
  { setting: 40, countsPer360: 7100 },
  { setting: 60, countsPer360: 5200 },
  { setting: 100, countsPer360: 3600 },
];

function tableMeasurement(anchor: TableAnchor, dpi: number): VerificationMeasurement {
  return {
    scopeKey: "hipfire",
    settingValue: anchor.setting,
    dpi,
    measuredCmPer360: cmPer360FromCounts(anchor.countsPer360, dpi),
    method: "fictional — the anchors are the measurements for a table model",
  };
}

export function createTableFixtureAdapter(): GameAdapter {
  return createVerifiedAdapter({
    identity: {
      gameId: "fixture-table-game",
      gameVersionLabel: "1.0",
      adapterVersion: "1.0.0",
      displayName: { en: "Fixture Table Game" },
      region: "global",
    },
    scopes: [
      {
        scopeKey: "hipfire",
        displayName: { en: "Hipfire" },
        settingLabel: { en: "General Sensitivity" },
        settingKey: "sensitivity",
        model: {
          form: "table",
          anchors: FIXTURE_TABLE_ANCHORS,
          interpolation: "monotone_cubic_loglog",
          extrapolation: "refuse",
        },
        settingRange: { min: 5, max: 100, step: 1, decimals: 0 },
        adsModel: "raw_multiplier",
        verification: {
          status: "verified",
          registerEntry: "EV-FIXTURE",
          evidence: {
            verifiedAt: "2026-01-01T00:00:00.000Z",
            verifiedAgainstBuild: "fixture-table-build-1",
            sourceRefs: ["fixture://tests/helpers/fixture-adapter.ts"],
            signedOffBy: ["fixture-a", "fixture-b"],
            measurements: FIXTURE_TABLE_ANCHORS.map((anchor) => tableMeasurement(anchor, 800)),
          },
        },
      },
    ],
  });
}
