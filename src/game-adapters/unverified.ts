import { err } from "../core/types/result";
import type { ScopeKey, VerificationStatus } from "../core/types/vocabulary";
import type {
  AdapterIdentity,
  CanonicalisationOutcome,
  ConversionContext,
  ConversionFailure,
  ConversionOutcome,
  GameAdapter,
  ScopeDefinition,
  ScopeVerification,
  SettingValidation,
} from "./types";

/**
 * An adapter for a game whose sensitivity model SensLab has not verified.
 *
 * This is not a stub or a placeholder — it is the correct, permanent implementation for the
 * unverified state, and it is what the five launch games use until their register entries
 * are closed (doc 36). It exists so that the product can be honest about a game rather than
 * silent about it: the game is selectable, calibration runs completely normally (the
 * calibration is game-independent), and the settings block shows the verification state and
 * the canonical targets instead of a number.
 *
 * Every conversion path returns `EXTERNAL_VERIFICATION_REQUIRED`. There is deliberately no
 * flag, option, or override that makes it return a value.
 */

export interface UnverifiedAdapterSpec {
  readonly identity: AdapterIdentity;
  /**
   * The register entry that governs this game, e.g. "EV-004". Required: an unverified
   * adapter must be able to say *what* is outstanding, not merely that something is.
   */
  readonly registerEntry: string;
  /**
   * Scopes we expect the game to expose once verified. Empty is the honest default when
   * even the scope roster is unknown — which is the case for every launch game at Phase 1.
   */
  readonly anticipatedScopes?: readonly ScopeKey[];
}

export function createUnverifiedAdapter(spec: UnverifiedAdapterSpec): GameAdapter {
  const { identity, registerEntry } = spec;

  const failure = (scopeKey: ScopeKey, detail: string): ConversionFailure => ({
    code: "EXTERNAL_VERIFICATION_REQUIRED",
    gameId: identity.gameId,
    gameVersionLabel: identity.gameVersionLabel,
    scopeKey,
    registerEntry,
    detail,
  });

  const detail =
    `No verified sensitivity model exists for ${identity.gameId} ` +
    `(${identity.gameVersionLabel}). Tracked as ${registerEntry}.`;

  const verification: ScopeVerification = { status: "unverified", registerEntry };

  // Anticipated scopes are declared without a model form or a setting range: we do not know
  // them, and inventing either would be exactly the guess this adapter exists to prevent.
  const scopes: readonly ScopeDefinition[] = (spec.anticipatedScopes ?? []).map((scopeKey) => ({
    scopeKey,
    displayName: { en: scopeKey },
    settingLabel: { en: scopeKey },
    hasSeparateSetting: false,
    modelForm: null,
    settingRange: null,
    adsModel: "unknown",
    verification,
  }));

  return {
    identity,
    scopes,

    verificationStatus(): VerificationStatus {
      return "unverified";
    },

    scopeVerification(scopeKey: ScopeKey): ScopeVerification | null {
      return scopes.some((scope) => scope.scopeKey === scopeKey) ? verification : null;
    },

    openRegisterEntries(): readonly string[] {
      return [registerEntry];
    },

    toCanonical(_settingValue: number, context: ConversionContext): CanonicalisationOutcome {
      return err(failure(context.scopeKey, detail));
    },

    fromCanonical(_counts: number, context: ConversionContext): ConversionOutcome {
      return err(failure(context.scopeKey, detail));
    },

    validate(_settingValue: number, _scopeKey: ScopeKey): SettingValidation {
      // We cannot validate a range we have not measured. Reporting "valid" would imply
      // knowledge we do not have; reporting a range would invent one.
      return { valid: false, reason: "unverified" };
    },
  };
}
