import { and, asc, eq } from "drizzle-orm";
import { gameVersions, games } from "@/db/schema";
import type { GameRegion, GameStatus, VerificationStatus } from "@/core/types/vocabulary";
import { executor, type Executor } from "./transaction";

/**
 * Game and adapter-version lookups.
 *
 * Reference data; no actor. What these queries feed is the game selector, which must show each
 * game's honest verification state (FR-014) rather than a hardcoded badge.
 */

export interface GameListing {
  readonly gameId: string;
  readonly slug: string;
  readonly displayName: string;
  readonly displayNameLocalized: Readonly<Record<string, string>>;
  readonly region: GameRegion;
  readonly status: GameStatus;
  readonly sortOrder: number;
  readonly currentVersionId: string | null;
  readonly currentVersionLabel: string | null;
  readonly verificationStatus: VerificationStatus | null;
  readonly adapterModuleVersion: string | null;
  readonly verifiedAgainstBuild: string | null;
  readonly verifiedAt: Date | null;
}

export async function listGamesWithCurrentVersion(tx?: Executor): Promise<readonly GameListing[]> {
  const db = executor(tx);
  const rows = await db
    .select({
      gameId: games.id,
      slug: games.slug,
      displayName: games.displayName,
      displayNameLocalized: games.displayNameLocalized,
      region: games.region,
      status: games.status,
      sortOrder: games.sortOrder,
      currentVersionId: gameVersions.id,
      currentVersionLabel: gameVersions.versionLabel,
      verificationStatus: gameVersions.verificationStatus,
      adapterModuleVersion: gameVersions.adapterModuleVersion,
      verifiedAgainstBuild: gameVersions.verifiedAgainstBuild,
      verifiedAt: gameVersions.verifiedAt,
    })
    .from(games)
    .leftJoin(
      gameVersions,
      and(eq(gameVersions.gameId, games.id), eq(gameVersions.isCurrent, true)),
    )
    .orderBy(asc(games.sortOrder), asc(games.slug));

  return rows.map((row) => ({
    ...row,
    displayNameLocalized: (row.displayNameLocalized ?? {}) as Readonly<Record<string, string>>,
  }));
}

export async function findGameVersionBySlug(
  slug: string,
  tx?: Executor,
): Promise<{ readonly gameVersionId: string; readonly versionLabel: string } | null> {
  const db = executor(tx);
  const rows = await db
    .select({ gameVersionId: gameVersions.id, versionLabel: gameVersions.versionLabel })
    .from(games)
    .innerJoin(
      gameVersions,
      and(eq(gameVersions.gameId, games.id), eq(gameVersions.isCurrent, true)),
    )
    .where(eq(games.slug, slug))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Records a verification downgrade against a game version (doc 08 §8.6).
 *
 * Downgrade only. The database is the record of what the product told users, and a status
 * that could be raised here would be verification granted without the evidence and sign-off
 * that doc 36 §36.7 requires — that path is a new `game_versions` row, not an update.
 *
 * `verified_at` and `verified_against_build` are deliberately left in place: the
 * `game_versions_verified_has_evidence` constraint requires them while the status is
 * `needs_recheck`, and they are exactly what the UI has to disclose in that state.
 */
export async function downgradeVersionVerification(
  gameVersionId: string,
  status: Extract<VerificationStatus, "needs_recheck" | "unverified">,
  tx?: Executor,
): Promise<void> {
  const db = executor(tx);
  await db
    .update(gameVersions)
    .set({
      verificationStatus: status,
      // Dropping to `unverified` means the evidence no longer supports serving values, so
      // the columns that assert it are cleared along with the status.
      ...(status === "unverified" ? { verifiedAt: null, verifiedAgainstBuild: null } : {}),
    })
    .where(eq(gameVersions.id, gameVersionId));
}
