"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { toAppError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import {
  cancelAccountDeletion,
  changePassword,
  exportAccountData,
  requestAccountDeletion,
  updateDisplayName,
  type DeletionSchedule,
  type ExportResult,
} from "@/services/account-service";
import { getActor } from "@/services/session-context";

/**
 * Server actions for the account (FR-097, FR-098, SCR-044, SCR-045).
 *
 * The password and deletion actions re-authenticate inside the service. That check is not
 * duplicated here, because a guard that exists in two places is a guard that will eventually
 * disagree with itself — the service is the one that owns it (doc 23 §23.4).
 */

const log = createLogger({ base: { component: "account-actions" } });

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

const displayNameSchema = z.object({ displayName: z.string().max(64) });
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(12).max(200),
});
const confirmSchema = z.object({ currentPassword: z.string().min(1).max(200) });

export async function updateDisplayNameAction(input: unknown): Promise<ActionResult<null>> {
  return run("updateDisplayName", async () => {
    const { displayName } = displayNameSchema.parse(input);
    await updateDisplayName(await getActor(), displayName);
    revalidatePath("/profile");
    return null;
  });
}

export async function changePasswordAction(
  input: unknown,
): Promise<ActionResult<{ readonly revokedSessions: number }>> {
  return run("changePassword", async () =>
    changePassword(await getActor(), changePasswordSchema.parse(input)),
  );
}

export async function exportAccountAction(): Promise<ActionResult<ExportResult>> {
  return run("exportAccount", async () => exportAccountData(await getActor()));
}

export async function requestDeletionAction(
  input: unknown,
): Promise<ActionResult<DeletionSchedule>> {
  return run("requestDeletion", async () => {
    const { currentPassword } = confirmSchema.parse(input);
    const schedule = await requestAccountDeletion(await getActor(), currentPassword);
    revalidatePath("/settings");
    return schedule;
  });
}

export async function cancelDeletionAction(): Promise<ActionResult<null>> {
  return run("cancelDeletion", async () => {
    await cancelAccountDeletion(await getActor());
    revalidatePath("/settings");
    return null;
  });
}
