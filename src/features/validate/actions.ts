"use server";

import { revalidatePath } from "next/cache";
import { toAppError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { knownQualityFlags } from "@/features/session-run/flags";
import { getActor } from "@/services/session-context";
import {
  abandonValidation,
  decideValidation,
  startValidation,
  submitValidation,
  type ValidationProgress,
  type ValidationStep,
} from "@/services/validation-service";
import { decideValidationSchema, startFromRecommendationSchema, submitStageSchema } from "./schema";

/**
 * Server actions for the validation test (doc 17 §17.2–§17.5).
 *
 * No guest session is issued here: a validation starts from a result the actor already owns,
 * so an anonymous actor has nothing to validate and the lookup returns a 404.
 */

const log = createLogger({ base: { component: "validate-actions" } });

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

export async function startValidationAction(input: unknown): Promise<ActionResult<ValidationStep>> {
  return run("startValidation", async () => {
    const payload = startFromRecommendationSchema.parse(input);
    const actor = await getActor();
    return startValidation(actor, payload);
  });
}

export async function submitValidationAction(
  input: unknown,
): Promise<ActionResult<ValidationProgress>> {
  return run("submitValidation", async () => {
    const payload = submitStageSchema.parse(input);
    const actor = await getActor();
    const progress = await submitValidation(actor, {
      sessionId: payload.sessionId,
      aggregates: payload.aggregates as never,
      qualityFlags: knownQualityFlags(payload.qualityFlags),
    });
    if (progress.kind === "finished") revalidatePath(`/results/${progress.recommendationId}`);
    return progress;
  });
}

export async function abandonValidationAction(sessionId: string): Promise<ActionResult<null>> {
  return run("abandonValidation", async () => {
    const actor = await getActor();
    await abandonValidation(actor, sessionId);
    return null;
  });
}

export async function decideValidationAction(input: unknown): Promise<ActionResult<null>> {
  return run("decideValidation", async () => {
    const payload = decideValidationSchema.parse(input);
    const actor = await getActor();
    await decideValidation(actor, payload);
    revalidatePath(`/results/${payload.recommendationId}`);
    revalidatePath(`/results/${payload.recommendationId}/validation`);
    return null;
  });
}
