import "server-only";
import {
  gameAdapterRegistry,
  openRegisterEntries,
  summariseRegister,
  type AdapterSummary,
  type RecheckTrigger,
  type RegisterEntry,
} from "@/game-adapters";
import { gameRepo } from "@/repositories";
import { createLogger } from "@/lib/logger";

/**
 * Keeping verification honest over time (doc 08 §8.6, doc 12 §12.7).
 *
 * A constant measured against one build is a claim about that build. Games patch, so the
 * claim decays, and the product has to notice on its own rather than waiting for a user to
 * report that a number stopped feeling right.
 *
 * The check runs the registry's own re-check evaluation and then **persists** the result, so
 * the adapter and the database move together. That matters because the boot check compares
 * them and refuses to start when they disagree — a downgrade applied only in memory would
 * turn into a failed boot on the next deploy.
 */

const log = createLogger({ base: { component: "verification" } });

export interface RecheckReport {
  readonly checkedAt: string;
  readonly downgraded: readonly AdapterSummary[];
  readonly persisted: number;
  /** Adapters whose downgrade could not be recorded because no version row exists. */
  readonly unpersisted: readonly string[];
}

export interface RecheckOptions {
  readonly now?: Date;
  /** Triggers reported per game since the last check (doc 08 §8.6). */
  readonly triggersByGame?: ReadonlyMap<string, readonly RecheckTrigger[]>;
  readonly windowDays?: number;
}

export async function runVerificationRecheck(options: RecheckOptions = {}): Promise<RecheckReport> {
  const now = options.now ?? new Date();

  const downgraded = gameAdapterRegistry.runRecheck({
    now,
    ...(options.triggersByGame === undefined ? {} : { triggersByGame: options.triggersByGame }),
    ...(options.windowDays === undefined ? {} : { windowDays: options.windowDays }),
  });

  const unpersisted: string[] = [];
  let persisted = 0;

  for (const summary of downgraded) {
    const version = await gameRepo.findGameVersionBySlug(summary.gameId);
    if (version === null) {
      unpersisted.push(summary.gameId);
      continue;
    }
    // `partial` is an adapter-level roll-up; what is stored is the state that governs whether
    // values are served, and only the two downgraded states are storable here.
    const status = summary.status === "unverified" ? "unverified" : "needs_recheck";
    await gameRepo.downgradeVersionVerification(version.gameVersionId, status);
    persisted += 1;
  }

  if (downgraded.length > 0) {
    log.warn("verification downgraded", {
      games: downgraded.map((summary) => summary.gameId),
      persisted,
      unpersisted,
    });
  }

  return { checkedAt: now.toISOString(), downgraded, persisted, unpersisted };
}

export interface VerificationTransparency {
  readonly summary: ReturnType<typeof summariseRegister>;
  readonly open: readonly RegisterEntry[];
  readonly adapters: readonly AdapterSummary[];
}

/**
 * What the public verification page renders (doc 24 SCR-002).
 *
 * Everything here is read from the register and the registry rather than written as copy, so
 * the page cannot say "verified" while the code refuses to convert. The two most common ways
 * a claim like this goes stale are a hardcoded badge and a hand-maintained table; this is
 * neither.
 */
export function verificationTransparency(): VerificationTransparency {
  return {
    summary: summariseRegister(),
    open: [...openRegisterEntries()].sort((a, b) =>
      a.priority === b.priority ? a.id.localeCompare(b.id) : a.priority - b.priority,
    ),
    adapters: gameAdapterRegistry.listCurrent(),
  };
}
