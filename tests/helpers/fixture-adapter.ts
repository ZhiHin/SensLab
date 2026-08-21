import { countsPer360, type CountsPer360 } from "@/core/types/brand";
import { err, ok } from "@/core/types/result";
import type { ScopeKey, VerificationStatus } from "@/core/types/vocabulary";
import {
  cmPer360FromCounts,
  countsPer360FromDegreesPerCount,
  degreesPerCount,
} from "@/core/sensitivity/canonical";
import type {
  CanonicalisationOutcome,
  ConversionContext,
  ConversionFailure,
  ConversionOutcome,
  GameAdapter,
  ScopeDefinition,
  SettingValidation,
  VerificationEvidence,
} from "@/game-adapters/types";

/**
 * A **test-only** verified adapter.
 *
 * It exists to prove that the adapter contract, the registry and the verification gate work
 * end to end. Its yaw constant is openly fictional — it is not, and must never be presented
 * as, a claim about any real game. No production code imports this file; an architecture
 * test asserts that.
 *
 * The real adapters arrive in Phase 5, one register entry at a time.
 */

export const FIXTURE_YAW_DEG_PER_COUNT = 0.02;

const EVIDENCE: VerificationEvidence = {
  verifiedAt: "2026-01-01T00:00:00.000Z",
  verifiedAgainstBuild: "fixture-build-1",
  sourceRefs: ["fixture://tests/helpers/fixture-adapter.ts"],
  signedOffBy: ["fixture-a", "fixture-b"],
};

const HIPFIRE: ScopeDefinition = {
  scopeKey: "hipfire",
  displayName: { en: "Hipfire" },
  settingLabel: { en: "Sensitivity" },
  hasSeparateSetting: false,
  modelForm: "linear_yaw",
  settingRange: { min: 0.1, max: 10, step: 0.01, decimals: 2 },
  adsModel: "raw_multiplier",
  fovAxis: "horizontal",
  verification: { status: "verified", evidence: EVIDENCE, registerEntry: "EV-FIXTURE" },
};

const ADS: ScopeDefinition = {
  ...HIPFIRE,
  scopeKey: "ads",
  displayName: { en: "ADS" },
  settingLabel: { en: "ADS Sensitivity" },
  verification: { status: "unverified", registerEntry: "EV-FIXTURE-ADS" },
};

export interface FixtureAdapterOptions {
  readonly gameId?: string;
  readonly gameVersionLabel?: string;
  readonly adapterVersion?: string;
  readonly includeUnverifiedAdsScope?: boolean;
}

export function createFixtureAdapter(options: FixtureAdapterOptions = {}): GameAdapter {
  const gameId = options.gameId ?? "fixture-game";
  const gameVersionLabel = options.gameVersionLabel ?? "1.0";
  const adapterVersion = options.adapterVersion ?? "1.0.0";
  const scopes: ScopeDefinition[] = [HIPFIRE];
  if (options.includeUnverifiedAdsScope ?? true) scopes.push(ADS);

  const scopeFor = (scopeKey: ScopeKey): ScopeDefinition | undefined =>
    scopes.find((scope) => scope.scopeKey === scopeKey);

  const fail = (
    code: ConversionFailure["code"],
    scopeKey: ScopeKey,
    detail: string,
    registerEntry?: string,
  ): ConversionFailure => ({
    code,
    gameId,
    gameVersionLabel,
    scopeKey,
    ...(registerEntry === undefined ? {} : { registerEntry }),
    detail,
  });

  const quantise = (value: number, step: number, decimals: number): number =>
    Number((Math.round(value / step) * step).toFixed(decimals));

  return {
    identity: {
      gameId,
      gameVersionLabel,
      adapterVersion,
      displayName: { en: "Fixture Game" },
      region: "global",
    },
    scopes,

    verificationStatus(): VerificationStatus {
      const statuses = scopes.map((scope) => scope.verification.status);
      if (statuses.every((status) => status === "verified")) return "verified";
      if (statuses.some((status) => status === "verified")) return "partial";
      return "unverified";
    },

    scopeVerification(scopeKey) {
      return scopeFor(scopeKey)?.verification ?? null;
    },

    openRegisterEntries(): readonly string[] {
      return [
        ...new Set(
          scopes
            .filter((scope) => scope.verification.status !== "verified")
            .map((scope) => scope.verification.registerEntry),
        ),
      ].sort();
    },

    toCanonical(settingValue: number, context: ConversionContext): CanonicalisationOutcome {
      const scope = scopeFor(context.scopeKey);
      if (scope === undefined) {
        return err(fail("UNSUPPORTED_SCOPE", context.scopeKey, "scope not offered by this game"));
      }
      if (scope.verification.status === "unverified") {
        return err(
          fail(
            "EXTERNAL_VERIFICATION_REQUIRED",
            context.scopeKey,
            "scope is not verified",
            scope.verification.registerEntry,
          ),
        );
      }
      const range = scope.settingRange;
      if (range !== null && (settingValue < range.min || settingValue > range.max)) {
        return err(
          fail("SETTING_OUT_OF_RANGE", context.scopeKey, `outside [${range.min}, ${range.max}]`),
        );
      }

      const counts = countsPer360FromDegreesPerCount(settingValue * FIXTURE_YAW_DEG_PER_COUNT);
      return ok({
        countsPer360: counts,
        cmPer360: cmPer360FromCounts(counts, context.dpi),
        adapterVersion,
        gameVersionLabel,
      });
    },

    fromCanonical(counts: CountsPer360 | number, context: ConversionContext): ConversionOutcome {
      const scope = scopeFor(context.scopeKey);
      if (scope === undefined) {
        return err(fail("UNSUPPORTED_SCOPE", context.scopeKey, "scope not offered by this game"));
      }
      if (scope.verification.status === "unverified") {
        return err(
          fail(
            "EXTERNAL_VERIFICATION_REQUIRED",
            context.scopeKey,
            "scope is not verified",
            scope.verification.registerEntry,
          ),
        );
      }

      const range = scope.settingRange ?? { min: 0.1, max: 10, step: 0.01, decimals: 2 };
      const ideal = degreesPerCount(counts) / FIXTURE_YAW_DEG_PER_COUNT;
      const clampedValue = Math.min(Math.max(ideal, range.min), range.max);
      const clamped = clampedValue !== ideal;
      const value = quantise(clampedValue, range.step, range.decimals);

      const achieved = countsPer360FromDegreesPerCount(value * FIXTURE_YAW_DEG_PER_COUNT);

      return ok({
        settings: [
          {
            key: "sensitivity",
            label: scope.settingLabel,
            idealValue: ideal,
            value,
            clamped,
          },
        ],
        achievedCountsPer360: countsPer360(achieved),
        achievedCmPer360: cmPer360FromCounts(achieved, context.dpi),
        quantisationErrorPct: ((achieved - Number(counts)) / Number(counts)) * 100,
        conversionMethod: "direct",
        conversionCoefficient: null,
        adapterVersion,
        gameVersionLabel,
        verification: scope.verification.status,
      });
    },

    validate(settingValue: number, scopeKey: ScopeKey): SettingValidation {
      const scope = scopeFor(scopeKey);
      if (scope === undefined) return { valid: false, reason: "unsupported_scope" };
      if (scope.verification.status === "unverified") return { valid: false, reason: "unverified" };
      const range = scope.settingRange;
      if (range === null) return { valid: false, reason: "unverified" };
      if (settingValue < range.min) return { valid: false, reason: "below_min", range };
      if (settingValue > range.max) return { valid: false, reason: "above_max", range };
      const steps = settingValue / range.step;
      if (Math.abs(steps - Math.round(steps)) > 1e-9) {
        return { valid: false, reason: "not_on_step", range };
      }
      return { valid: true, range };
    },
  };
}
