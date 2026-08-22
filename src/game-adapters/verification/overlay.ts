import { err } from "../../core/types/result";
import type { CountsPer360 } from "../../core/types/brand";
import type { ScopeKey, VerificationStatus } from "../../core/types/vocabulary";
import type {
  CanonicalisationOutcome,
  ConversionContext,
  ConversionFailure,
  ConversionOutcome,
  GameAdapter,
  ScopeDefinition,
  ScopeVerification,
  SettingValidation,
} from "../types";
import { isDowngrade, type VerificationOverlay } from "./staleness";

/**
 * Applies a verification downgrade to an adapter (doc 08 §8.6, doc 12 §12.7).
 *
 * The result is a new adapter — the original is untouched, because adapter parameters are
 * immutable and a released parameter set is never edited (`SENS-BR-029`). The wrapper is
 * where the *policy* lives; the original stays a faithful record of what was measured.
 *
 * ## Why a wrapper rather than a flag the UI reads
 *
 * The same reasoning as the verification gate itself. A "this game is stale, do not show its
 * numbers" flag has to be honoured by every current and future caller. A wrapper whose
 * `fromCanonical` refuses cannot be forgotten by a new screen, an export, or an API route.
 *
 * A downgrade for a confirmed mismatch therefore does not merely annotate the result — it
 * stops the number existing.
 */

export class VerificationOverlayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VerificationOverlayError";
  }
}

function overlaidVerification(
  scope: ScopeDefinition,
  overlay: VerificationOverlay,
): ScopeVerification {
  const next = overlay.statusByScope.get(scope.scopeKey);
  if (next === undefined) return scope.verification;

  if (!isDowngrade(scope.verification.status, next)) {
    throw new VerificationOverlayError(
      `overlay would move scope "${scope.scopeKey}" from "${scope.verification.status}" to ` +
        `"${next}"; an overlay may only downgrade — re-verification is a new adapter version`,
    );
  }

  // The evidence is kept on `needs_recheck` because that status exists precisely so the UI
  // can say when it was last verified and against which build. It is dropped on a downgrade
  // to `unverified`, where claiming evidence would contradict the status and the registry
  // would reject the adapter.
  return next === "unverified"
    ? { status: next, registerEntry: scope.verification.registerEntry }
    : { ...scope.verification, status: next };
}

export function withVerificationOverlay(
  adapter: GameAdapter,
  overlay: VerificationOverlay,
): GameAdapter {
  const scopes: readonly ScopeDefinition[] = adapter.scopes.map((scope) => ({
    ...scope,
    verification: overlaidVerification(scope, overlay),
  }));

  const byScope = new Map(scopes.map((scope) => [scope.scopeKey, scope]));

  const blocked = (scopeKey: ScopeKey): ConversionFailure | null => {
    const scope = byScope.get(scopeKey);
    if (scope === undefined) return null;
    if (scope.verification.status !== "unverified") return null;
    return {
      code: "EXTERNAL_VERIFICATION_REQUIRED",
      gameId: adapter.identity.gameId,
      gameVersionLabel: adapter.identity.gameVersionLabel,
      scopeKey,
      registerEntry: scope.verification.registerEntry,
      detail: `verification was withdrawn: ${overlay.reason}`,
    };
  };

  return {
    identity: adapter.identity,
    scopes,

    verificationStatus(): VerificationStatus {
      const statuses = scopes.map((scope) => scope.verification.status);
      if (statuses.length === 0) return "unverified";
      if (statuses.every((status) => status === "verified")) return "verified";
      if (statuses.every((status) => status === "unverified")) return "unverified";
      if (statuses.some((status) => status === "needs_recheck")) {
        return statuses.some((status) => status === "unverified") ? "partial" : "needs_recheck";
      }
      return "partial";
    },

    scopeVerification(scopeKey: ScopeKey): ScopeVerification | null {
      return byScope.get(scopeKey)?.verification ?? null;
    },

    openRegisterEntries(): readonly string[] {
      const fromScopes = scopes
        .filter((scope) => scope.verification.status !== "verified")
        .map((scope) => scope.verification.registerEntry);
      return [...new Set([...adapter.openRegisterEntries(), ...fromScopes])].sort();
    },

    toCanonical(settingValue: number, context: ConversionContext): CanonicalisationOutcome {
      const refusal = blocked(context.scopeKey);
      if (refusal !== null) return err(refusal);
      return adapter.toCanonical(settingValue, context);
    },

    fromCanonical(counts: CountsPer360 | number, context: ConversionContext): ConversionOutcome {
      const refusal = blocked(context.scopeKey);
      if (refusal !== null) return err(refusal);

      const outcome = adapter.fromCanonical(counts, context);
      if (!outcome.ok) return outcome;

      // The inner adapter reports the status it was built with. The overlay is the current
      // truth, so the result carries the overlaid status and, on `needs_recheck`, the date
      // the UI has to disclose.
      const scope = byScope.get(context.scopeKey);
      const status = scope?.verification.status ?? outcome.value.verification;
      const verifiedAt = scope?.verification.evidence?.verifiedAt;

      return {
        ok: true,
        value: {
          ...outcome.value,
          verification: status,
          ...(status === "needs_recheck" && verifiedAt !== undefined
            ? { lastVerifiedAt: verifiedAt }
            : {}),
        },
      };
    },

    validate(settingValue: number, scopeKey: ScopeKey): SettingValidation {
      if (blocked(scopeKey) !== null) return { valid: false, reason: "unverified" };
      return adapter.validate(settingValue, scopeKey);
    },
  };
}
