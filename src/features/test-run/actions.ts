"use server";

import { SESSION_QUALITY_FLAGS, type SessionQualityFlag } from "@/core/types/vocabulary";
import { toAppError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { guestActor, type Actor } from "@/repositories/actor";
import { issueGuestSession } from "@/services/auth-service";
import { getActor, setGuestCookie } from "@/services/session-context";
import {
  abandonTestRun,
  completeTestRun,
  startTestRun,
  submitRound,
} from "@/services/test-run-service";
import type { SessionPlan } from "@/test-engine/contracts";
import { roundAggregateSchema, startRunSchema } from "./schema";

/**
 * Server actions for a single-test run (doc 21 §21.2).
 *
 * Every one of these resolves the actor from the session cookie rather than trusting an id in
 * the payload. Ownership is enforced in SQL by the repository layer, so a caller cannot submit
 * a round into somebody else's session even with a valid session id (`SENS-BR-034`).
 *
 * Failures are returned as a discriminated result rather than thrown. A thrown server-action
 * error reaches the client as an opaque digest, which is useless to the surface that has to
 * decide whether to retry — and retrying is exactly what a dropped round upload needs to do.
 */

const log = createLogger({ base: { component: "test-run-actions" } });

export type ActionResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly code: string; readonly message: string };

async function run<T>(label: string, work: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await work() };
  } catch (error: unknown) {
    const appError = toAppError(error);
    log.error(`${label} failed`, { code: appError.code, message: appError.message });
    return { ok: false, code: appError.code, message: appError.publicMessage };
  }
}

/**
 * Resolves the actor, issuing a guest session for a first-time visitor.
 *
 * A session has to have an owner — ownership is enforced in SQL, and an anonymous actor matches
 * no rows by construction. Issuing a guest session here rather than demanding an account is the
 * point of guest sessions: a player can measure their aim before deciding whether to sign up,
 * and the session is claimed by their account later if they do.
 *
 * The token is set as an HttpOnly cookie and read from nowhere else (`SENS-BR-034`).
 */
async function ownerActor(): Promise<Actor> {
  const actor = await getActor();
  if (actor.kind !== "anonymous") return actor;

  const issued = await issueGuestSession();
  await setGuestCookie(issued.token);
  return guestActor(issued.guestSessionId);
}

export async function startRunAction(
  input: unknown,
): Promise<ActionResult<{ sessionId: string; plan: SessionPlan }>> {
  return run("startRun", async () => {
    const payload = startRunSchema.parse(input);
    const actor = await ownerActor();
    return startTestRun(actor, payload);
  });
}

export async function submitRoundAction(
  sessionId: string,
  aggregate: unknown,
): Promise<ActionResult<{ roundId: string; created: boolean }>> {
  return run("submitRound", async () => {
    const payload = roundAggregateSchema.parse(aggregate);
    const actor = await getActor();
    // Cast is safe: the schema mirrors the contract field for field, and the enums it validates
    // against are the same tuples the contract's types are derived from.
    const outcome = await submitRound(actor, sessionId, payload as never);
    return { roundId: outcome.roundId, created: outcome.created };
  });
}

export async function completeRunAction(
  sessionId: string,
  qualityFlags: readonly string[],
): Promise<ActionResult<null>> {
  return run("completeRun", async () => {
    const actor = await getActor();
    // Unknown flags are dropped rather than rejected: a flag the server does not recognise must
    // not be able to lose a whole completed session.
    const known = qualityFlags.filter((flag): flag is SessionQualityFlag =>
      (SESSION_QUALITY_FLAGS as readonly string[]).includes(flag),
    );
    await completeTestRun(actor, sessionId, known);
    return null;
  });
}

export async function abandonRunAction(sessionId: string): Promise<ActionResult<null>> {
  return run("abandonRun", async () => {
    const actor = await getActor();
    await abandonTestRun(actor, sessionId);
    return null;
  });
}
