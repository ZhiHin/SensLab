"use server";

import { SESSION_QUALITY_FLAGS, type SessionQualityFlag } from "@/core/types/vocabulary";
import { toAppError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { guestActor, type Actor } from "@/repositories/actor";
import { issueGuestSession } from "@/services/auth-service";
import {
  abandonCalibrationSession,
  startCalibrationSession,
  submitCalibrationRound,
  type CalibrationProgress,
  type CalibrationStep,
} from "@/services/calibration-session-service";
import { getActor, setGuestCookie } from "@/services/session-context";
import { startCalibrationSchema, submitCalibrationRoundSchema } from "./schema";

/**
 * Server actions for the calibration session (doc 21 §21.2, doc 23 §23.4).
 *
 * The actor comes from the cookie, never the payload; the plan comes from the server, never
 * the client. A first-time visitor gets a guest session so that they can calibrate before
 * deciding whether to sign up (`SENS-BR-001`).
 */

const log = createLogger({ base: { component: "calibrate-actions" } });

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

async function ownerActor(): Promise<Actor> {
  const actor = await getActor();
  if (actor.kind !== "anonymous") return actor;
  const issued = await issueGuestSession();
  await setGuestCookie(issued.token);
  return guestActor(issued.guestSessionId);
}

export async function startCalibrationAction(
  input: unknown,
): Promise<ActionResult<CalibrationStep>> {
  return run("startCalibration", async () => {
    const payload = startCalibrationSchema.parse(input);
    const actor = await ownerActor();
    return startCalibrationSession(actor, payload);
  });
}

export async function submitCalibrationRoundAction(
  input: unknown,
): Promise<ActionResult<CalibrationProgress>> {
  return run("submitCalibrationRound", async () => {
    const payload = submitCalibrationRoundSchema.parse(input);
    const actor = await getActor();
    const known = payload.qualityFlags.filter((flag): flag is SessionQualityFlag =>
      (SESSION_QUALITY_FLAGS as readonly string[]).includes(flag),
    );
    return submitCalibrationRound(actor, {
      sessionId: payload.sessionId,
      roundIndex: payload.roundIndex,
      // The schema mirrors the contract field for field.
      aggregates: payload.aggregates as never,
      qualityFlags: known,
      aspectRatio: payload.aspectRatio,
    });
  });
}

export async function abandonCalibrationAction(sessionId: string): Promise<ActionResult<null>> {
  return run("abandonCalibration", async () => {
    const actor = await getActor();
    await abandonCalibrationSession(actor, sessionId);
    return null;
  });
}
