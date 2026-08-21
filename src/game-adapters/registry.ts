import type { VerificationStatus } from "../core/types/vocabulary";
import type { GameAdapter } from "./types";

/**
 * The adapter registry (doc 12 §12.4).
 *
 * Resolution is by `(gameId, gameVersionLabel)`. A historical recommendation always pins the
 * version it was generated with, so re-rendering an old result uses the adapter that produced
 * it — and "recompute with the current model" stays an explicit, visible user action rather
 * than a silent change to a number the user already wrote into their game.
 */

export class AdapterRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdapterRegistrationError";
  }
}

export interface AdapterSummary {
  readonly gameId: string;
  readonly gameVersionLabel: string;
  readonly adapterVersion: string;
  readonly displayName: string;
  readonly region: string;
  readonly status: VerificationStatus;
  readonly isCurrent: boolean;
  /** Register entries still outstanding for this adapter, if any. */
  readonly openRegisterEntries: readonly string[];
}

interface Registration {
  readonly adapter: GameAdapter;
  readonly isCurrent: boolean;
}

const key = (gameId: string, versionLabel: string): string => `${gameId}@${versionLabel}`;

export class AdapterRegistry {
  private readonly byKey = new Map<string, Registration>();
  private readonly currentByGame = new Map<string, string>();

  /**
   * Registers an adapter.
   *
   * `isCurrent` marks the version resolved when a caller does not pin one; exactly one
   * version per game may hold it, mirroring the partial unique index on `game_versions`.
   */
  register(adapter: GameAdapter, options: { readonly isCurrent: boolean }): void {
    const { gameId, gameVersionLabel } = adapter.identity;
    const registrationKey = key(gameId, gameVersionLabel);

    if (this.byKey.has(registrationKey)) {
      throw new AdapterRegistrationError(`adapter ${registrationKey} is already registered`);
    }

    this.assertVerificationIntegrity(adapter);

    if (options.isCurrent) {
      const existing = this.currentByGame.get(gameId);
      if (existing !== undefined) {
        throw new AdapterRegistrationError(
          `game ${gameId} already has a current version (${existing}); ${gameVersionLabel} cannot also be current`,
        );
      }
      this.currentByGame.set(gameId, gameVersionLabel);
    }

    this.byKey.set(registrationKey, { adapter, isCurrent: options.isCurrent });
  }

  /**
   * A scope may only claim `verified` or `needs_recheck` if it carries recorded evidence.
   *
   * This is the structural half of the verification gate. The behavioural half lives inside
   * each adapter's conversion functions; this check makes it impossible to register an
   * adapter that *claims* verification it cannot substantiate.
   */
  private assertVerificationIntegrity(adapter: GameAdapter): void {
    for (const scope of adapter.scopes) {
      const { status, evidence } = scope.verification;
      if ((status === "verified" || status === "needs_recheck") && evidence === undefined) {
        throw new AdapterRegistrationError(
          `${adapter.identity.gameId}@${adapter.identity.gameVersionLabel} scope "${scope.scopeKey}" ` +
            `claims status "${status}" without verification evidence`,
        );
      }
      if (status === "unverified" && evidence !== undefined) {
        throw new AdapterRegistrationError(
          `${adapter.identity.gameId}@${adapter.identity.gameVersionLabel} scope "${scope.scopeKey}" ` +
            `is marked unverified but carries evidence; resolve the contradiction before registering`,
        );
      }
    }
  }

  /** Resolves a specific version, or the current one when `versionLabel` is omitted. */
  resolve(gameId: string, versionLabel?: string): GameAdapter | null {
    const label = versionLabel ?? this.currentByGame.get(gameId);
    if (label === undefined) return null;
    return this.byKey.get(key(gameId, label))?.adapter ?? null;
  }

  has(gameId: string, versionLabel?: string): boolean {
    return this.resolve(gameId, versionLabel) !== null;
  }

  /** Every registered adapter, newest-agnostic, ordered by game id then version label. */
  list(): readonly AdapterSummary[] {
    return [...this.byKey.values()]
      .map(({ adapter, isCurrent }) => this.summarise(adapter, isCurrent))
      .sort((a, b) =>
        a.gameId === b.gameId
          ? a.gameVersionLabel.localeCompare(b.gameVersionLabel)
          : a.gameId.localeCompare(b.gameId),
      );
  }

  /** Only the current version of each game — what the game selector renders. */
  listCurrent(): readonly AdapterSummary[] {
    return this.list().filter((summary) => summary.isCurrent);
  }

  private summarise(adapter: GameAdapter, isCurrent: boolean): AdapterSummary {
    // The adapter is the authority on what is still outstanding: an adapter that has never
    // been verified does not know its scope roster, so inferring from scopes alone would
    // report "nothing outstanding" for exactly the games with the most outstanding work.
    const openEntries = new Set<string>(adapter.openRegisterEntries());

    return {
      gameId: adapter.identity.gameId,
      gameVersionLabel: adapter.identity.gameVersionLabel,
      adapterVersion: adapter.identity.adapterVersion,
      displayName: adapter.identity.displayName.en,
      region: adapter.identity.region,
      status: adapter.verificationStatus(),
      isCurrent,
      openRegisterEntries: [...openEntries].sort(),
    };
  }

  /** Test/boot support: the number of registrations. */
  get size(): number {
    return this.byKey.size;
  }
}
