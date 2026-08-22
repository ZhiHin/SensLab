import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { gameVersions, games } from "@/db/schema";
import { gameRepo } from "@/repositories";
import { runBootChecks } from "@/services/boot-service";
import { verificationTransparency } from "@/services/verification-service";
import { convertForGame, impliedCmPer360 } from "@/services/conversion-service";
import { LAUNCH_ADAPTERS, gameAdapterRegistry } from "@/game-adapters";
import { db } from "@tests/helpers/db";

/**
 * The adapter layer against the real database (doc 12 §12.4, doc 08 §8.6).
 *
 * What the unit suite cannot check is agreement between the *code* and the *stored* record of
 * what users were told. The boot check exists for exactly that, and it is the reason a
 * downgrade has to be persisted rather than applied only in memory.
 */

describe("the registry and the database agree", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("passes the boot consistency check", async () => {
    const result = await runBootChecks();
    expect(result.adapterProblems).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("has a row for every registered adapter, and an adapter for every row", async () => {
    const listings = await gameRepo.listGamesWithCurrentVersion();
    const registered = new Set(gameAdapterRegistry.listCurrent().map((summary) => summary.gameId));
    expect(listings.length).toBeGreaterThan(0);
    for (const listing of listings) {
      expect(registered.has(listing.slug), `${listing.slug} has no adapter`).toBe(true);
    }
    expect(registered.size).toBe(listings.length);
  });

  it("stores every launch game as unverified with no sensitivity model", async () => {
    // The honest seed state (doc 36: fifteen open items, zero verified). If a model row
    // appears without a register entry closing, this is where it shows up.
    const rows = await db()
      .select({
        slug: games.slug,
        status: gameVersions.verificationStatus,
        verifiedAt: gameVersions.verifiedAt,
      })
      .from(games)
      .innerJoin(gameVersions, eq(gameVersions.gameId, games.id));

    expect(rows.length).toBeGreaterThanOrEqual(LAUNCH_ADAPTERS.length);
    for (const row of rows) {
      expect(row.status, `${row.slug} verification status`).toBe("unverified");
      expect(row.verifiedAt).toBeNull();
    }
  });

  it("reports the same verification state in the register, the registry and the database", async () => {
    const transparency = verificationTransparency();
    const listings = await gameRepo.listGamesWithCurrentVersion();
    const byslug = new Map(listings.map((listing) => [listing.slug, listing]));

    expect(transparency.summary.verified).toBe(0);
    for (const adapter of transparency.adapters) {
      expect(byslug.get(adapter.gameId)?.verificationStatus).toBe(adapter.status);
    }
  });
});

describe("conversion through the service", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("returns the canonical targets for every launch game and no settings", async () => {
    for (const adapter of LAUNCH_ADAPTERS) {
      const view = convertForGame({
        gameId: adapter.identity.gameId,
        scopeKey: "hipfire",
        countsPer360: 9448.818897637796,
        dpi: 800,
      });

      // The measurement survives an open register entry intact. That is the whole design.
      expect(view.canonical.cmPer360).toBeCloseTo(30, 6);
      expect(view.canonical.countsPer360).toBeCloseTo(9448.8189, 3);
      expect(view.settings).toBeNull();
      expect(view.refusal?.code).toBe("EXTERNAL_VERIFICATION_REQUIRED");
      expect(view.game?.status).toBe("unverified");
      expect(view.game?.openRegisterEntries.length).toBeGreaterThan(0);
    }
  });

  it("still returns canonical targets for a game it has never heard of", () => {
    const view = convertForGame({
      gameId: "something-we-do-not-support",
      scopeKey: "hipfire",
      countsPer360: 9448.818897637796,
      dpi: 800,
    });
    expect(view.game).toBeNull();
    expect(view.refusal).toBeNull();
    expect(view.canonical.cmPer360).toBeCloseTo(30, 6);
  });

  it("declines to imply a cm/360 from an unverified game setting", () => {
    // doc 11 §11.9.3 offers the DPI plausibility cross-check only when a verified adapter can
    // supply the implied sensitivity. Without one there is no cross-check, not a guess.
    for (const adapter of LAUNCH_ADAPTERS) {
      expect(impliedCmPer360(adapter.identity.gameId, "hipfire", 2.0, 800)).toBeNull();
    }
  });
});
