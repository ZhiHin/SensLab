import type { VerificationStatus } from "../core/types/vocabulary";
import type { GameAdapter } from "./types";
import { authorisesConstants, findRegisterEntry } from "./verification/register";
import {
  evaluateRecheck,
  type RecheckInput,
  type RecheckTrigger,
  type VerificationOverlay,
} from "./verification/staleness";
import { withVerificationOverlay } from "./verification/overlay";

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
  /** Latest verification instant across the adapter's scopes; `null` when never verified. */
  readonly lastVerifiedAt: string | null;
  readonly verifiedAgainstBuild: string | null;
  /** Why the adapter was downgraded, when a re-check overlay has been applied. */
  readonly recheckReason: string | null;
}

interface Registration {
  readonly adapter: GameAdapter;
  readonly isCurrent: boolean;
  readonly overlay: VerificationOverlay | null;
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

    this.byKey.set(registrationKey, { adapter, isCurrent: options.isCurrent, overlay: null });
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
      const { status, evidence, registerEntry } = scope.verification;

      // The register is the authority on what SensLab has established (doc 36 §36.1). A scope
      // may not claim more than its governing entry does, and it may not cite an entry that
      // does not exist — which is what makes "a parameter change without a corresponding
      // register update is rejected" (`SENS-SEC-023`) a machine check rather than a habit.
      if (findRegisterEntry(registerEntry) === null) {
        throw new AdapterRegistrationError(
          `${adapter.identity.gameId}@${adapter.identity.gameVersionLabel} scope "${scope.scopeKey}" ` +
            `cites register entry "${registerEntry}", which is not in the verification register`,
        );
      }
      if (
        (status === "verified" || status === "needs_recheck") &&
        !authorisesConstants(registerEntry)
      ) {
        throw new AdapterRegistrationError(
          `${adapter.identity.gameId}@${adapter.identity.gameVersionLabel} scope "${scope.scopeKey}" ` +
            `claims status "${status}" but register entry "${registerEntry}" is still open`,
        );
      }

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
      .map(({ adapter, isCurrent, overlay }) => this.summarise(adapter, isCurrent, overlay))
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

  /**
   * Applies a verification downgrade in place (doc 08 §8.6, doc 12 §12.7).
   *
   * The stored registration is *replaced* with the overlaid adapter, so every later
   * `resolve` returns the downgraded one. There is deliberately no second resolution path
   * that returns the original: a downgrade that callers can opt out of is not a downgrade.
   */
  applyOverlay(gameId: string, versionLabel: string, overlay: VerificationOverlay): void {
    const registrationKey = key(gameId, versionLabel);
    const registration = this.byKey.get(registrationKey);
    if (registration === undefined) {
      throw new AdapterRegistrationError(`adapter ${registrationKey} is not registered`);
    }
    this.byKey.set(registrationKey, {
      adapter: withVerificationOverlay(registration.adapter, overlay),
      isCurrent: registration.isCurrent,
      overlay,
    });
  }

  /**
   * Evaluates every registration against the clock and any reported triggers, applying
   * whatever downgrades are due. Returns the adapters that changed.
   */
  runRecheck(
    input: RecheckInput & {
      readonly triggersByGame?: ReadonlyMap<string, readonly RecheckTrigger[]>;
    },
  ): readonly AdapterSummary[] {
    const changed: AdapterSummary[] = [];

    for (const [registrationKey, registration] of [...this.byKey.entries()]) {
      const { gameId, gameVersionLabel } = registration.adapter.identity;
      const triggers = input.triggersByGame?.get(gameId) ?? input.triggers ?? [];
      const overlay = evaluateRecheck(registration.adapter, {
        now: input.now,
        triggers,
        ...(input.windowDays === undefined ? {} : { windowDays: input.windowDays }),
      });
      if (overlay === null) continue;

      this.applyOverlay(gameId, gameVersionLabel, overlay);
      const updated = this.byKey.get(registrationKey) as Registration;
      changed.push(this.summarise(updated.adapter, updated.isCurrent, updated.overlay));
    }

    return changed;
  }

  private summarise(
    adapter: GameAdapter,
    isCurrent: boolean,
    overlay: VerificationOverlay | null = null,
  ): AdapterSummary {
    // The adapter is the authority on what is still outstanding: an adapter that has never
    // been verified does not know its scope roster, so inferring from scopes alone would
    // report "nothing outstanding" for exactly the games with the most outstanding work.
    const openEntries = new Set<string>(adapter.openRegisterEntries());

    // The most recent verification across scopes is what the "last verified" disclosure
    // shows: a partially verified game whose hipfire was checked yesterday should not read
    // as stale because a scope measured a year ago drags the date backwards.
    let lastVerifiedAt: string | null = null;
    let verifiedAgainstBuild: string | null = null;
    for (const scope of adapter.scopes) {
      const evidence = scope.verification.evidence;
      if (evidence === undefined) continue;
      if (lastVerifiedAt === null || evidence.verifiedAt > lastVerifiedAt) {
        lastVerifiedAt = evidence.verifiedAt;
        verifiedAgainstBuild = evidence.verifiedAgainstBuild;
      }
    }

    return {
      gameId: adapter.identity.gameId,
      gameVersionLabel: adapter.identity.gameVersionLabel,
      adapterVersion: adapter.identity.adapterVersion,
      displayName: adapter.identity.displayName.en,
      region: adapter.identity.region,
      status: adapter.verificationStatus(),
      isCurrent,
      openRegisterEntries: [...openEntries].sort(),
      lastVerifiedAt,
      verifiedAgainstBuild,
      recheckReason: overlay?.reason ?? null,
    };
  }

  /** Test/boot support: the number of registrations. */
  get size(): number {
    return this.byKey.size;
  }
}
