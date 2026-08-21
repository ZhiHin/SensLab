import "server-only";
import { gameAdapterRegistry } from "@/game-adapters";
import type { VerificationStatus } from "@/core/types/vocabulary";
import { gameRepo } from "@/repositories";

/**
 * Game listings for the selector (FR-005, FR-014).
 *
 * The verification state rendered on a game tile is read from the adapter registry, never
 * from hardcoded copy — so a game whose register entry closes starts showing as verified
 * because the adapter changed, not because someone remembered to edit a badge.
 */

export interface GameOption {
  readonly slug: string;
  readonly displayName: string;
  readonly displayNameLocalized: Readonly<Record<string, string>>;
  readonly region: string;
  readonly verificationStatus: VerificationStatus;
  /** Open external-verification register entries, e.g. ["EV-001"]. */
  readonly openRegisterEntries: readonly string[];
  /** True when the adapter can emit at least one converted setting. */
  readonly canConvert: boolean;
  readonly lastVerifiedAgainstBuild: string | null;
  readonly lastVerifiedAt: string | null;
}

export async function listGameOptions(): Promise<readonly GameOption[]> {
  const listings = await gameRepo.listGamesWithCurrentVersion();
  const summaries = new Map(
    gameAdapterRegistry.listCurrent().map((summary) => [summary.gameId, summary]),
  );

  return listings.map((listing) => {
    const summary = summaries.get(listing.slug);
    const status: VerificationStatus =
      summary?.status ?? listing.verificationStatus ?? "unverified";

    return {
      slug: listing.slug,
      displayName: listing.displayName,
      displayNameLocalized: listing.displayNameLocalized,
      region: listing.region,
      verificationStatus: status,
      openRegisterEntries: summary?.openRegisterEntries ?? [],
      canConvert: status === "verified" || status === "partial" || status === "needs_recheck",
      lastVerifiedAgainstBuild: listing.verifiedAgainstBuild,
      lastVerifiedAt: listing.verifiedAt?.toISOString() ?? null,
    };
  });
}
