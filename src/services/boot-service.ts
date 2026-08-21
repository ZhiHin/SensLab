import "server-only";
import { gameAdapterRegistry } from "@/game-adapters";
import { algorithmRepo, gameRepo } from "@/repositories";
import { findParameterMismatches, ParameterIntegrityError } from "@/lib/parameter-registry";
import { createLogger } from "@/lib/logger";

/**
 * Boot-time integrity checks.
 *
 * Two invariants are verified before the application is allowed to serve a request. Both fail
 * *loudly*, because both mean the running code and the stored data disagree about something a
 * user has already been told:
 *
 *  1. **Parameter sets match** (doc 14 §14.9). If the compiled weights differ from the ones
 *     recorded in `algorithm_versions`, every historical recommendation that references those
 *     versions has become unexplainable, and continuing would compound the problem.
 *  2. **The adapter registry matches the database** (doc 12 §12.4). A `game_versions` row for
 *     an adapter that does not exist — or an adapter with no row — is a startup error rather
 *     than a runtime surprise the first time a user selects that game.
 */

const log = createLogger({ base: { component: "boot" } });

export interface BootCheckResult {
  readonly ok: boolean;
  readonly parameterProblems: readonly string[];
  readonly adapterProblems: readonly string[];
}

export async function runBootChecks(): Promise<BootCheckResult> {
  const stored = await algorithmRepo.listStoredParameterVersions();
  const parameterProblems = findParameterMismatches(stored);
  const adapterProblems = await checkAdapterConsistency();

  const ok = parameterProblems.length === 0 && adapterProblems.length === 0;
  if (ok) {
    log.info("boot checks passed", {
      parameterSets: stored.length,
      adapters: gameAdapterRegistry.size,
    });
  } else {
    log.error("boot checks failed", { parameterProblems, adapterProblems });
  }

  return { ok, parameterProblems, adapterProblems };
}

async function checkAdapterConsistency(): Promise<readonly string[]> {
  const problems: string[] = [];
  const listings = await gameRepo.listGamesWithCurrentVersion();
  const seen = new Set<string>();

  for (const listing of listings) {
    seen.add(listing.slug);

    if (listing.currentVersionLabel === null) {
      problems.push(`game "${listing.slug}" has no current version row`);
      continue;
    }

    const adapter = gameAdapterRegistry.resolve(listing.slug, listing.currentVersionLabel);
    if (adapter === null) {
      problems.push(
        `game "${listing.slug}" version "${listing.currentVersionLabel}" has a database row but ` +
          `no registered adapter`,
      );
      continue;
    }

    if (adapter.identity.adapterVersion !== listing.adapterModuleVersion) {
      problems.push(
        `game "${listing.slug}" adapter version mismatch: database has ` +
          `"${listing.adapterModuleVersion}", code has "${adapter.identity.adapterVersion}"`,
      );
    }

    if (adapter.verificationStatus() !== listing.verificationStatus) {
      problems.push(
        `game "${listing.slug}" verification mismatch: database says ` +
          `"${listing.verificationStatus}", adapter says "${adapter.verificationStatus()}"`,
      );
    }
  }

  for (const summary of gameAdapterRegistry.listCurrent()) {
    if (!seen.has(summary.gameId)) {
      problems.push(`adapter "${summary.gameId}" is registered but has no games row`);
    }
  }

  return problems;
}

/** Throws on failure. Used by the health route and by the integration suite. */
export async function assertBootHealthy(): Promise<void> {
  const result = await runBootChecks();
  if (!result.ok) {
    throw new ParameterIntegrityError([...result.parameterProblems, ...result.adapterProblems]);
  }
}
