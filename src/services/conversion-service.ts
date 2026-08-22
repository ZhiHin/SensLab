import "server-only";
import { cmPer360FromCounts, inchesPer360 } from "@/core/sensitivity/canonical";
import { describeSensitivity } from "@/core/sensitivity/domain";
import type { MatchCriterion } from "@/core/sensitivity/fov";
import type { ScopeKey, VerificationStatus } from "@/core/types/vocabulary";
import {
  DEFAULT_QUANTISATION_WARNING_PCT,
  gameAdapterRegistry,
  suggestDpiForScope,
  type ConversionFailure,
  type ConversionSuccess,
  type DpiSuggestion,
  type LocalisedText,
} from "@/game-adapters";

/**
 * Turning a calibrated canonical sensitivity into game settings (doc 12, doc 11 §11.4).
 *
 * ## The canonical targets are always present
 *
 * Whether or not a game can be converted, this returns the player's cm/360, counts/360,
 * inches/360 and degrees/cm. That is not a consolation prize: `counts_per_360` is the
 * measured result and the thing that stays true when a game patches, when a DPI turns out to
 * be wrong, or when a register entry is still open (`SENS-BR-025`). A game number is a
 * *convenience derived from it*, and the surface is built so that the honest state — targets
 * present, settings absent, reason named — is a first-class layout rather than an error page.
 *
 * ## Conversion happens on the server
 *
 * The adapter never reaches the browser. A client that could run the conversion could also
 * be persuaded to run a different one, and the emitted number is something a player will
 * type into their game and trust (`SENS-BR-034`).
 */

export interface ConversionRequest {
  readonly gameId: string;
  /** Pin a specific adapter version. Historical results always do (doc 12 §12.4). */
  readonly gameVersionLabel?: string;
  readonly scopeKey: ScopeKey;
  readonly countsPer360: number;
  readonly dpi: number;
  readonly criterion?: MatchCriterion;
  readonly hipfireHalfFovDegrees?: number;
}

export interface CanonicalTargets {
  readonly countsPer360: number;
  readonly cmPer360: number;
  readonly inchesPer360: number;
  readonly degreesPerCm: number;
}

export interface ScopeSummary {
  readonly scopeKey: ScopeKey;
  readonly displayName: LocalisedText;
  readonly settingLabel: LocalisedText;
  readonly status: VerificationStatus;
  readonly registerEntry: string;
}

export interface GameSettingsView {
  /** Always populated. The measurement does not depend on any game. */
  readonly canonical: CanonicalTargets;
  readonly game: {
    readonly gameId: string;
    readonly displayName: LocalisedText;
    readonly gameVersionLabel: string;
    readonly adapterVersion: string;
    readonly status: VerificationStatus;
    readonly openRegisterEntries: readonly string[];
    readonly scopes: readonly ScopeSummary[];
  } | null;
  /** The converted settings, when the scope is verified. */
  readonly settings: ConversionSuccess | null;
  /** Why there is no number, when there is none. */
  readonly refusal: ConversionFailure | null;
  /**
   * Set when the game's grid is too coarse to land near the target (doc 11 §11.4 step 5).
   * The user is told what their DPI would have to be, not asked to accept the error silently.
   */
  readonly dpiSuggestion: DpiSuggestion | null;
  readonly quantisationWarningPct: number;
}

export function canonicalTargets(countsPer360: number, dpi: number): CanonicalTargets {
  const view = describeSensitivity(countsPer360, dpi);
  return {
    countsPer360: view.countsPer360,
    cmPer360: view.cmPer360,
    inchesPer360: inchesPer360(view.cmPer360),
    degreesPerCm: view.degreesPerCm,
  };
}

export function convertForGame(request: ConversionRequest): GameSettingsView {
  const canonical = canonicalTargets(request.countsPer360, request.dpi);
  const adapter = gameAdapterRegistry.resolve(request.gameId, request.gameVersionLabel);

  if (adapter === null) {
    // An unknown game is not a refusal to convert — there is nothing to refuse. The canonical
    // targets still stand, which is exactly the "I play something not listed" case (FR-014).
    return {
      canonical,
      game: null,
      settings: null,
      refusal: null,
      dpiSuggestion: null,
      quantisationWarningPct: DEFAULT_QUANTISATION_WARNING_PCT,
    };
  }

  const game = {
    gameId: adapter.identity.gameId,
    displayName: adapter.identity.displayName,
    gameVersionLabel: adapter.identity.gameVersionLabel,
    adapterVersion: adapter.identity.adapterVersion,
    status: adapter.verificationStatus(),
    openRegisterEntries: adapter.openRegisterEntries(),
    scopes: adapter.scopes.map((scope) => ({
      scopeKey: scope.scopeKey,
      displayName: scope.displayName,
      settingLabel: scope.settingLabel,
      status: scope.verification.status,
      registerEntry: scope.verification.registerEntry,
    })),
  };

  const outcome = adapter.fromCanonical(request.countsPer360, {
    dpi: request.dpi,
    scopeKey: request.scopeKey,
    ...(request.criterion === undefined ? {} : { criterion: request.criterion }),
    ...(request.hipfireHalfFovDegrees === undefined
      ? {}
      : { hipfireHalfFovDegrees: request.hipfireHalfFovDegrees }),
  });

  if (!outcome.ok) {
    return {
      canonical,
      game,
      settings: null,
      refusal: outcome.error,
      dpiSuggestion: null,
      quantisationWarningPct: DEFAULT_QUANTISATION_WARNING_PCT,
    };
  }

  const coarse = Math.abs(outcome.value.quantisationErrorPct) > DEFAULT_QUANTISATION_WARNING_PCT;

  return {
    canonical,
    game,
    settings: outcome.value,
    refusal: null,
    dpiSuggestion: coarse
      ? suggestDpiForScope(adapter, request.scopeKey, request.countsPer360, request.dpi)
      : null,
    quantisationWarningPct: DEFAULT_QUANTISATION_WARNING_PCT,
  };
}

/**
 * The cm/360 a player's *current* game setting implies, for the DPI plausibility check
 * (doc 11 §11.9.3).
 *
 * Available only for a verified adapter, which is why the plausibility check is documented as
 * "whenever enough information exists" rather than as something the product always has.
 */
export function impliedCmPer360(
  gameId: string,
  scopeKey: ScopeKey,
  settingValue: number,
  dpi: number,
  gameVersionLabel?: string,
): number | null {
  const adapter = gameAdapterRegistry.resolve(gameId, gameVersionLabel);
  if (adapter === null) return null;
  const outcome = adapter.toCanonical(settingValue, { dpi, scopeKey });
  return outcome.ok ? cmPer360FromCounts(outcome.value.countsPer360, dpi) : null;
}
