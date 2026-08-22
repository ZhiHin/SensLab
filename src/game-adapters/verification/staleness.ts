import type { ScopeKey, VerificationStatus } from "../../core/types/vocabulary";
import type { GameAdapter } from "../types";

/**
 * Re-verification triggers (doc 08 §8.6).
 *
 * A `verified` status is not permanent. Games patch, settings menus move, and a constant
 * measured against one build is a claim about that build and nothing else. The mechanism
 * here is what turns that from a policy sentence into something the code actually does.
 *
 * ## Why a confirmed mismatch is different from the rest
 *
 * A stale timer, a game update or a menu change all mean *we should look again* — the number
 * was right when it was measured and is probably still close. A confirmed mismatch means the
 * number is wrong now. So the first three downgrade to `needs_recheck`, where the adapter
 * keeps serving values behind a "last verified against build X on date Y" disclosure, and the
 * last drops straight to `unverified`, where it serves nothing at all.
 */

export type RecheckTrigger =
  "game_update" | "settings_menu_change" | "confirmed_mismatch" | "staleness";

/**
 * `ASSUMPTION` (doc 08 §8.6) — a starting policy, tunable once the patch cadences of the
 * launch games have been observed. Half a Gregorian year, in days.
 */
export const STALENESS_WINDOW_DAYS = 183;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function daysSince(isoInstant: string, now: Date): number {
  const then = Date.parse(isoInstant);
  if (Number.isNaN(then)) {
    throw new RangeError(`not an ISO-8601 instant: ${isoInstant}`);
  }
  return (now.getTime() - then) / MS_PER_DAY;
}

export function isStale(
  verifiedAt: string,
  now: Date,
  windowDays: number = STALENESS_WINDOW_DAYS,
): boolean {
  return daysSince(verifiedAt, now) > windowDays;
}

/** Downgrade ordering. An overlay may only move a scope down this ladder, never up. */
const RANK: Readonly<Record<VerificationStatus, number>> = {
  verified: 3,
  needs_recheck: 2,
  partial: 1,
  unverified: 0,
};

export function isDowngrade(from: VerificationStatus, to: VerificationStatus): boolean {
  return RANK[to] < RANK[from];
}

export interface VerificationOverlay {
  readonly statusByScope: ReadonlyMap<ScopeKey, VerificationStatus>;
  readonly triggers: readonly RecheckTrigger[];
  readonly reason: string;
  /** ISO-8601 instant at which the overlay was applied. */
  readonly appliedAt: string;
}

export interface RecheckInput {
  readonly now: Date;
  /** Triggers reported for this adapter since it was verified. */
  readonly triggers?: readonly RecheckTrigger[];
  readonly windowDays?: number;
}

/**
 * Decides what an adapter's scopes should now be, given the time and any reported triggers.
 *
 * Returns `null` when nothing changes, so the caller can tell "checked, still fine" from
 * "checked, downgraded" without comparing objects. An already-`unverified` scope is left
 * alone: there is nothing below it.
 */
export function evaluateRecheck(
  adapter: GameAdapter,
  input: RecheckInput,
): VerificationOverlay | null {
  const triggers = input.triggers ?? [];
  const mismatch = triggers.includes("confirmed_mismatch");
  // A patch or a menu change is a fact about the whole build, so it reaches every scope.
  // Staleness is a fact about one measurement, so it is evaluated per scope.
  const buildWide = triggers.some(
    (trigger) => trigger === "game_update" || trigger === "settings_menu_change",
  );

  const statusByScope = new Map<ScopeKey, VerificationStatus>();
  const fired = new Set<RecheckTrigger>(triggers.filter((trigger) => trigger !== "staleness"));

  for (const scope of adapter.scopes) {
    const current = scope.verification.status;
    if (current === "unverified") continue;

    if (mismatch) {
      statusByScope.set(scope.scopeKey, "unverified");
      continue;
    }

    const stale =
      scope.verification.evidence !== undefined &&
      isStale(scope.verification.evidence.verifiedAt, input.now, input.windowDays);

    if (stale) fired.add("staleness");

    if ((stale || buildWide) && current === "verified") {
      statusByScope.set(scope.scopeKey, "needs_recheck");
    }
  }

  if (statusByScope.size === 0) return null;

  return {
    statusByScope,
    triggers: [...fired].sort(),
    reason: mismatch
      ? "a confirmed mismatch was reported; values stop being served immediately"
      : "re-verification is due; values continue with a last-verified disclosure",
    appliedAt: input.now.toISOString(),
  };
}
