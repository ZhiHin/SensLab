import "server-only";
import type { ScopeKey } from "@/core/types/vocabulary";
import { gameAdapterRegistry, type ScopeDefinition } from "@/game-adapters";

/**
 * The exposure rule for Scope Calibration (doc 09 §9.14, FR-062).
 *
 * "Only scopes that the selected game actually has are offered." SensLab never presents an
 * 8× calibration for a game without one — and it never presents *any* scope for a game whose
 * scope roster has not been verified, because an unverified roster is a guess about what the
 * game's menu contains.
 *
 * This lives in the service layer rather than the engine because the engine must not learn
 * that a game exists (doc 12 §12.1). The plan it gates (`createScopeCalibrationPlan`) takes a
 * scope key and nothing else.
 *
 * As of Phase 6 every launch adapter is unverified, so this returns nothing for every game.
 * That is the correct output, not a gap: the feature is complete and its gate is closed.
 */

export interface OfferedScope {
  readonly scopeKey: Exclude<ScopeKey, "hipfire">;
  readonly displayName: ScopeDefinition["displayName"];
  readonly magnification: number | null;
}

export function scopesOfferedForGame(
  gameId: string,
  gameVersionLabel?: string,
): readonly OfferedScope[] {
  const adapter = gameAdapterRegistry.resolve(gameId, gameVersionLabel);
  if (adapter === null) return [];

  return adapter.scopes
    .filter(
      (scope): scope is ScopeDefinition & { scopeKey: Exclude<ScopeKey, "hipfire"> } =>
        scope.scopeKey !== "hipfire" &&
        scope.verification.status !== "unverified" &&
        // A scope whose optics are unknown cannot be simulated faithfully enough to calibrate.
        scope.optics !== null,
    )
    .map((scope) => ({
      scopeKey: scope.scopeKey,
      displayName: scope.displayName,
      magnification: scope.magnification ?? null,
    }));
}

/** True when Scope Calibration can be offered at all for this game. */
export function scopeCalibrationAvailable(gameId: string, gameVersionLabel?: string): boolean {
  return scopesOfferedForGame(gameId, gameVersionLabel).length > 0;
}
