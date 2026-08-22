import { cmPer360FromCounts } from "../core/sensitivity/canonical";
import type { ScopeKey } from "../core/types/vocabulary";
import {
  countsForSetting,
  quantiseToStep,
  settingForCounts,
  suggestDpiForGrid,
  type DpiSuggestion,
} from "./model";
import type { GameAdapter } from "./types";

/**
 * Advice a conversion can offer beyond the number itself (doc 11 §11.4 step 5).
 *
 * When a game's grid is coarse enough that no achievable setting lands near the target, the
 * useful response is not a footnote about rounding — it is "at 850 DPI, 1.45 is exact". This
 * lives inside `game-adapters` because it needs the scope's model to answer, and the model is
 * not something callers outside this layer should be reaching into.
 */

export interface DpiAdviceOptions {
  /** How far the suggested DPI may sit from the current one, as a fraction. */
  readonly maxRelativeDpiChange?: number;
  /** How many grid steps either side of the ideal to consider. */
  readonly neighbourhood?: number;
}

/**
 * Suggests a DPI at which one of this scope's achievable settings hits the target exactly.
 *
 * Returns `null` whenever there is nothing useful to say — an unverified scope, a target
 * outside the model, or no candidate close enough to the current DPI to count as a tweak.
 */
export function suggestDpiForScope(
  adapter: GameAdapter,
  scopeKey: ScopeKey,
  requestedCounts: number,
  currentDpi: number,
  options: DpiAdviceOptions = {},
): DpiSuggestion | null {
  const scope = adapter.scopes.find((candidate) => candidate.scopeKey === scopeKey);
  if (scope === undefined) return null;
  if (scope.verification.status === "unverified") return null;

  const { model, settingRange } = scope;
  if (model === null || settingRange === null) return null;

  const ideal = settingForCounts(model, requestedCounts);
  if (!ideal.ok) return null;

  const span = options.neighbourhood ?? 2;
  const centre = quantiseToStep(ideal.value, settingRange);
  const candidates: { settingValue: number; counts: number }[] = [];

  for (let offset = -span; offset <= span; offset += 1) {
    const settingValue = quantiseToStep(centre + offset * settingRange.step, settingRange);
    if (settingValue < settingRange.min || settingValue > settingRange.max) continue;
    const counts = countsForSetting(model, settingValue);
    if (!counts.ok) continue;
    candidates.push({ settingValue, counts: counts.value });
  }

  return suggestDpiForGrid({
    targetCmPer360: cmPer360FromCounts(requestedCounts, currentDpi),
    currentDpi,
    candidates,
    ...(options.maxRelativeDpiChange === undefined
      ? {}
      : { maxRelativeDpiChange: options.maxRelativeDpiChange }),
  });
}
