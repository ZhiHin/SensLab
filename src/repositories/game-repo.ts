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
