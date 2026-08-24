"use server";

import { revalidatePath } from "next/cache";
import { toAppError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { knownQualityFlags } from "@/features/session-run/flags";
import {
  preferenceSchema,
  startFromRecommendationSchema,
  submitStageSchema,
} from "@/features/validate/schema";
import { getActor } from "@/services/session-context";
import {
  abandonFineTune,
  recordPreference,
  startFineTune,
  submitFineTune,
  type FineTuneProgress,
  type FineTuneStep,
} from "@/services/fine-tune-service";

/**
 * Server actions for fine-tuning (doc 17 §17.7–§17.8, FR-089).
 *
 * The stage machine lives on the server: the client uploads what it measured and receives
 * either the next plan or the outcome. Which candidates duel, when the duel stops, and
 * whether anything supersedes the recommendation are never client decisions (`SENS-BR-034`).
 */

const log = createLogger({ base: { component: "fine-tune-actions" } });

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

export async function startFineTuneAction(input: unknown): Promise<ActionResult<FineTuneStep>> {
  return run("startFineTune", async () => {
    const payload = startFromRecommendationSchema.parse(input);
    const actor = await getActor();
    return startFineTune(actor, payload);
  });
}

export async function submitFineTuneAction(
  input: unknown,
): Promise<ActionResult<FineTuneProgress>> {
  return run("submitFineTune", async () => {
    const payload = submitStageSchema.parse(input);
    const actor = await getActor();
    const progress = await submitFineTune(actor, {
      sessionId: payload.sessionId,
      aggregates: payload.aggregates as never,
      qualityFlags: knownQualityFlags(payload.qualityFlags),
      aspectRatio: payload.aspectRatio,
    });
    if (progress.kind === "finished") revalidatePath(`/results/${progress.recommendationId}`);
    return progress;
  });
}

export async function abandonFineTuneAction(sessionId: string): Promise<ActionResult<null>> {
  return run("abandonFineTune", async () => {
    const actor = await getActor();
    await abandonFineTune(actor, sessionId);
    return null;
  });
}

export async function recordPreferenceAction(input: unknown): Promise<ActionResult<null>> {
  return run("recordPreference", async () => {
    const payload = preferenceSchema.parse(input);
    const actor = await getActor();
    await recordPreference(actor, payload);
    return null;
  });
}
