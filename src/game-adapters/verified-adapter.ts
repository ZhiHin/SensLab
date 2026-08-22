import { cmPer360FromCounts, countsPer360FromCm } from "../core/sensitivity/canonical";
import { countsPer360, type CountsPer360 } from "../core/types/brand";
import { err, ok } from "../core/types/result";
import type { ConversionMethod, ScopeKey, VerificationStatus } from "../core/types/vocabulary";
import type { MatchCriterion } from "../core/sensitivity/fov";
import {
  assertModelParams,
  assertSettingRange,
  countsForSetting,
  isOnStep,
  quantisationErrorPct,
  quantiseSetting,
  settingForCounts,
  type SensitivityModel,
} from "./model";
import { defaultCriterionForMagnification, scopedTargetCounts, type ScopeOptics } from "./scoped";
import { authorisesConstants, findRegisterEntry } from "./verification/register";
import type {
  AdapterIdentity,
  CanonicalisationOutcome,
  ConversionContext,
  ConversionFailure,
  ConversionOutcome,
  GameAdapter,
  LocalisedText,
  ScopeDefinition,
  ScopeVerification,
  SettingRange,
  SettingValidation,
  VerificationEvidence,
  VerificationMeasurement,
} from "./types";

/**
 * Builds an adapter for a game whose model has been measured (doc 12 §12.3).
 *
 * ## What this refuses to build
 *
 * Construction fails — loudly, at module load, before any test runs — when:
 *
 * 1. the scope claims `verified` but its register entry is still open (doc 36 is the
 *    authority, and it lives in code precisely so this check can exist);
 * 2. the evidence carries fewer than two measurements at distinct settings, because two
 *    points test a model form and one cannot (doc 08 §8.5 step 2);
 * 3. the declared model fails to reproduce its own measurements within ±0.5%, which doc 08
 *    §8.5 step 7 defines as meaning **the model form is wrong, not that the constants need
 *    nudging**.
 *
 * Check 3 is the one that matters. Every other test an adapter ships compares it against
 * itself: round-trips, boundaries, quantisation, monotonicity. A uniformly wrong constant
 * satisfies all of them. Only a comparison against the recorded readings catches it, so the
 * readings are not optional and the comparison is not a test that someone has to remember to
 * write — it is a precondition of the object existing.
 */

export class AdapterConstructionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdapterConstructionError";
  }
}

/** doc 08 §8.5 step 7. Anything worse means the form is wrong. */
export const MEASUREMENT_TOLERANCE_PCT = 0.5;

export interface VerifiedScopeSpec {
  readonly scopeKey: ScopeKey;
  readonly displayName: LocalisedText;
  /** The in-game label, per locale. Wrong here makes the number unusable (doc 08 §8.7). */
  readonly settingLabel: LocalisedText;
  /** The machine key for the emitted field, e.g. "sensitivity". */
  readonly settingKey: string;
  readonly magnification?: number;
  readonly hasSeparateSetting?: boolean;
  readonly model: SensitivityModel;
  readonly settingRange: SettingRange;
  readonly optics?: ScopeOptics;
  readonly adsModel: ScopeDefinition["adsModel"];
  readonly fovAxis?: ScopeDefinition["fovAxis"];
  readonly fovScaling?: string;
  readonly defaultCriterion?: MatchCriterion;
  readonly verification: ScopeVerification;
}

export interface VerifiedAdapterSpec {
  readonly identity: AdapterIdentity;
  readonly scopes: readonly VerifiedScopeSpec[];
  /** Register entries still open for this game — scopes not yet measured, for instance. */
  readonly openRegisterEntries?: readonly string[];
}

/* ------------------------------------------------------------------ construction checks */

function assertRegisterAuthorises(gameId: string, scope: VerifiedScopeSpec): void {
  const { status, registerEntry } = scope.verification;
  if (status === "unverified") return;

  if (findRegisterEntry(registerEntry) === null) {
    throw new AdapterConstructionError(
      `${gameId} scope "${scope.scopeKey}" cites register entry "${registerEntry}", which does not exist`,
    );
  }
  if (!authorisesConstants(registerEntry)) {
    throw new AdapterConstructionError(
      `${gameId} scope "${scope.scopeKey}" claims status "${status}" but register entry ` +
        `"${registerEntry}" is not closed; close it with evidence before shipping constants`,
    );
  }
}

function measurementsFor(
  evidence: VerificationEvidence,
  scopeKey: ScopeKey,
): readonly VerificationMeasurement[] {
  return evidence.measurements.filter((measurement) => measurement.scopeKey === scopeKey);
}

/**
 * Replays the recorded readings through the declared model.
 *
 * The comparison is done in cm/360 because that is the unit that was measured; converting the
 * model's prediction outward rather than the measurement inward keeps the residual expressed
 * in the same terms as the acceptance threshold in doc 08 §8.5.
 */
function assertModelReproducesMeasurements(gameId: string, scope: VerifiedScopeSpec): void {
  const evidence = scope.verification.evidence;
  if (evidence === undefined) {
    throw new AdapterConstructionError(
      `${gameId} scope "${scope.scopeKey}" claims status "${scope.verification.status}" without evidence`,
    );
  }

  const measurements = measurementsFor(evidence, scope.scopeKey);
  const distinctSettings = new Set(measurements.map((measurement) => measurement.settingValue));
  if (distinctSettings.size < 2) {
    throw new AdapterConstructionError(
      `${gameId} scope "${scope.scopeKey}" has ${distinctSettings.size} distinct measured ` +
        `setting(s); two widely separated points are required to test the model form (doc 08 §8.5)`,
    );
  }

  for (const measurement of measurements) {
    const predicted = countsForSetting(scope.model, measurement.settingValue);
    if (!predicted.ok) {
      throw new AdapterConstructionError(
        `${gameId} scope "${scope.scopeKey}": the model cannot evaluate its own measured ` +
          `setting ${measurement.settingValue} (${predicted.error.detail})`,
      );
    }
    const predictedCm = cmPer360FromCounts(predicted.value, measurement.dpi);
    const residualPct =
      (Math.abs(predictedCm - measurement.measuredCmPer360) / measurement.measuredCmPer360) * 100;

    if (residualPct > MEASUREMENT_TOLERANCE_PCT) {
      throw new AdapterConstructionError(
        `${gameId} scope "${scope.scopeKey}": the declared model predicts ` +
          `${predictedCm.toFixed(4)} cm/360 at setting ${measurement.settingValue}, but ` +
          `${measurement.measuredCmPer360} cm/360 was measured — a ${residualPct.toFixed(2)}% ` +
          `residual against a ${MEASUREMENT_TOLERANCE_PCT}% tolerance. The model form is wrong.`,
      );
    }
  }
}

/* ------------------------------------------------------------------ the adapter */

export function createVerifiedAdapter(spec: VerifiedAdapterSpec): GameAdapter {
  const { identity } = spec;
  const label = `${identity.gameId}@${identity.gameVersionLabel}`;

  for (const scope of spec.scopes) {
    assertModelParams(scope.model);
    assertSettingRange(scope.settingRange);
    assertRegisterAuthorises(label, scope);
    if (scope.verification.status !== "unverified") {
      assertModelReproducesMeasurements(label, scope);
    }
  }

  const scopes: readonly ScopeDefinition[] = spec.scopes.map((scope) => ({
    scopeKey: scope.scopeKey,
    displayName: scope.displayName,
    settingLabel: scope.settingLabel,
    ...(scope.magnification === undefined ? {} : { magnification: scope.magnification }),
    hasSeparateSetting: scope.hasSeparateSetting ?? false,
    modelForm: scope.model.form,
    model: scope.model,
    settingRange: scope.settingRange,
    optics: scope.optics ?? null,
    adsModel: scope.adsModel,
    ...(scope.fovAxis === undefined ? {} : { fovAxis: scope.fovAxis }),
    ...(scope.fovScaling === undefined ? {} : { fovScaling: scope.fovScaling }),
    ...(scope.defaultCriterion === undefined ? {} : { defaultCriterion: scope.defaultCriterion }),
    verification: scope.verification,
  }));

  const specByScope = new Map(spec.scopes.map((scope) => [scope.scopeKey, scope]));
  const scopeFor = (scopeKey: ScopeKey): VerifiedScopeSpec | undefined => specByScope.get(scopeKey);

  const fail = (
    code: ConversionFailure["code"],
    scopeKey: ScopeKey,
    detail: string,
    registerEntry?: string,
  ): ConversionFailure => ({
    code,
    gameId: identity.gameId,
    gameVersionLabel: identity.gameVersionLabel,
    scopeKey,
    ...(registerEntry === undefined ? {} : { registerEntry }),
    detail,
  });

  /**
   * The gate, in one place, applied by every entry point.
   *
   * It lives inside the adapter rather than in the UI because a UI-level gate can be bypassed
   * by a new screen, a new route, an export, or a share card (doc 12 §12.6). A gate inside the
   * pure conversion function cannot be.
   */
  const gate = (scopeKey: ScopeKey): ConversionFailure | null => {
    const scope = scopeFor(scopeKey);
    if (scope === undefined) {
      return fail("UNSUPPORTED_SCOPE", scopeKey, "this game does not offer that scope");
    }
    if (scope.verification.status === "unverified") {
      return fail(
        "EXTERNAL_VERIFICATION_REQUIRED",
        scopeKey,
        "no verified sensitivity model exists for this scope",
        scope.verification.registerEntry,
      );
    }
    return null;
  };

  const lastVerified = (scope: VerifiedScopeSpec): { lastVerifiedAt?: string } =>
    scope.verification.status === "needs_recheck" && scope.verification.evidence !== undefined
      ? { lastVerifiedAt: scope.verification.evidence.verifiedAt }
      : {};

  return {
    identity,
    scopes,

    verificationStatus(): VerificationStatus {
      const statuses = scopes.map((scope) => scope.verification.status);
      if (statuses.length === 0) return "unverified";
      if (statuses.every((status) => status === "verified")) return "verified";
      if (statuses.every((status) => status === "unverified")) return "unverified";
      if (statuses.some((status) => status === "needs_recheck")) {
        return statuses.some((status) => status === "unverified") ? "partial" : "needs_recheck";
      }
      return "partial";
    },

    scopeVerification(scopeKey: ScopeKey): ScopeVerification | null {
      return scopeFor(scopeKey)?.verification ?? null;
    },

    openRegisterEntries(): readonly string[] {
      const declared = spec.openRegisterEntries ?? [];
      const fromScopes = spec.scopes
        .filter((scope) => scope.verification.status !== "verified")
        .map((scope) => scope.verification.registerEntry);
      return [...new Set([...declared, ...fromScopes])].sort();
    },

    toCanonical(settingValue: number, context: ConversionContext): CanonicalisationOutcome {
      const blocked = gate(context.scopeKey);
      if (blocked !== null) return err(blocked);
      const scope = scopeFor(context.scopeKey) as VerifiedScopeSpec;

      const range = scope.settingRange;
      if (settingValue < range.min || settingValue > range.max) {
        return err(
          fail(
            "SETTING_OUT_OF_RANGE",
            context.scopeKey,
            `setting ${settingValue} is outside [${range.min}, ${range.max}]`,
          ),
        );
      }

      const counts = countsForSetting(scope.model, settingValue);
      if (!counts.ok) {
        return err(fail(counts.error.code, context.scopeKey, counts.error.detail));
      }

      return ok({
        countsPer360: countsPer360(counts.value),
        cmPer360: cmPer360FromCounts(counts.value, context.dpi),
        adapterVersion: identity.adapterVersion,
        gameVersionLabel: identity.gameVersionLabel,
      });
    },

    fromCanonical(counts: CountsPer360 | number, context: ConversionContext): ConversionOutcome {
      const blocked = gate(context.scopeKey);
      if (blocked !== null) return err(blocked);
      const scope = scopeFor(context.scopeKey) as VerifiedScopeSpec;

      const requested = Number(counts);
      if (!Number.isFinite(requested) || requested <= 0) {
        return err(
          fail(
            "MISSING_CONTEXT",
            context.scopeKey,
            `counts/360 must be positive, got ${requested}`,
          ),
        );
      }

      // A scoped state is a *different* canonical target, derived from the hipfire one under
      // a named criterion. Resolving it first means quantisation happens against the scope's
      // own grid rather than the hipfire scope's.
      let target = requested;
      let conversionMethod: ConversionMethod = "direct";
      let conversionCoefficient: number | null = null;

      if (context.scopeKey !== "hipfire" && (context.canonicalBasis ?? "hipfire") === "hipfire") {
        const criterion =
          context.criterion ??
          scope.defaultCriterion ??
          defaultCriterionForMagnification(scope.magnification);

        const scoped = scopedTargetCounts({
          hipfireCounts: requested,
          adsModel: scope.adsModel,
          optics: scope.optics ?? null,
          ...(context.hipfireHalfFovDegrees === undefined
            ? {}
            : { hipfireHalfFovDegrees: context.hipfireHalfFovDegrees }),
          criterion,
        });

        if (!scoped.ok) {
          if (scoped.error.kind === "ads_model_unknown") {
            return err(
              fail(
                "EXTERNAL_VERIFICATION_REQUIRED",
                context.scopeKey,
                "this scope's ADS model is unverified, so no scoped value can be emitted",
                scope.verification.registerEntry,
              ),
            );
          }
          return err(fail("MISSING_CONTEXT", context.scopeKey, scoped.error.detail));
        }

        target = scoped.value.countsPer360;
        conversionMethod = scoped.value.conversionMethod;
        conversionCoefficient = scoped.value.conversionCoefficient;
      }

      const ideal = settingForCounts(scope.model, target);
      if (!ideal.ok) {
        return err(fail(ideal.error.code, context.scopeKey, ideal.error.detail));
      }

      const quantised = quantiseSetting(ideal.value, scope.settingRange);
      const achieved = countsForSetting(scope.model, quantised.value);
      if (!achieved.ok) {
        return err(fail(achieved.error.code, context.scopeKey, achieved.error.detail));
      }

      return ok({
        settings: [
          {
            key: scope.settingKey,
            label: scope.settingLabel,
            idealValue: quantised.idealValue,
            value: quantised.value,
            clamped: quantised.clamped,
          },
        ],
        achievedCountsPer360: countsPer360(achieved.value),
        achievedCmPer360: cmPer360FromCounts(achieved.value, context.dpi),
        quantisationErrorPct: quantisationErrorPct(achieved.value, target),
        conversionMethod,
        conversionCoefficient,
        adapterVersion: identity.adapterVersion,
        gameVersionLabel: identity.gameVersionLabel,
        verification: scope.verification.status,
        ...lastVerified(scope),
      });
    },

    validate(settingValue: number, scopeKey: ScopeKey): SettingValidation {
      const scope = scopeFor(scopeKey);
      if (scope === undefined) return { valid: false, reason: "unsupported_scope" };
      if (scope.verification.status === "unverified") return { valid: false, reason: "unverified" };

      const range = scope.settingRange;
      if (settingValue < range.min) return { valid: false, reason: "below_min", range };
      if (settingValue > range.max) return { valid: false, reason: "above_max", range };
      if (!isOnStep(settingValue, range)) return { valid: false, reason: "not_on_step", range };
      return { valid: true, range };
    },
  };
}

/** Counts/360 implied by one recorded reading. Used by the golden-vector conformance test. */
export function measurementCounts(measurement: VerificationMeasurement): CountsPer360 {
  return countsPer360FromCm(measurement.measuredCmPer360, measurement.dpi);
}
