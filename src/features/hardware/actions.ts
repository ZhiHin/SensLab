"use server";

import { revalidatePath } from "next/cache";
import { toAppError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { getActor } from "@/services/session-context";
import {
  createProfile,
  deleteProfile,
  setDefaultProfile,
  updateProfile,
  type HardwareProfileView,
} from "@/services/hardware-service";
import { hardwareProfileSchema, profileIdSchema, updateProfileSchema } from "./schema";

/**
 * Server actions for hardware profiles (FR-094, SCR-043).
 *
 * Every action takes the actor from the cookie and passes it to a repository call that
 * composes the ownership predicate — a profile id belonging to someone else resolves to
 * nothing, so there is no filtering step that could be forgotten (doc 23 §23.4).
 */

const log = createLogger({ base: { component: "hardware-actions" } });

export type ActionResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly code: string; readonly message: string };

async function run<T>(label: string, work: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await work();
    revalidatePath("/hardware-profiles");
    revalidatePath("/calibrate");
    return { ok: true, data };
  } catch (error: unknown) {
    const appError = toAppError(error);
    log.error(`${label} failed`, { code: appError.code, message: appError.message });
    return { ok: false, code: appError.code, message: appError.publicMessage };
  }
}

export async function createProfileAction(
  input: unknown,
): Promise<ActionResult<HardwareProfileView>> {
  return run("createProfile", async () =>
    createProfile(await getActor(), hardwareProfileSchema.parse(input)),
  );
}

export async function updateProfileAction(
  input: unknown,
): Promise<ActionResult<HardwareProfileView>> {
  return run("updateProfile", async () => {
    const { profileId, ...changes } = updateProfileSchema.parse(input);
    // `exactOptionalPropertyTypes` distinguishes "absent" from "explicitly undefined", and a
    // partial parse produces the latter; dropping the undefined keys keeps "leave this field
    // alone" and "set this field to null" different instructions.
    const present = Object.fromEntries(
      Object.entries(changes).filter(([, value]) => value !== undefined),
    );
    return updateProfile(await getActor(), profileId, present);
  });
}

export async function setDefaultProfileAction(input: unknown): Promise<ActionResult<null>> {
  return run("setDefaultProfile", async () => {
    const { profileId } = profileIdSchema.parse(input);
    await setDefaultProfile(await getActor(), profileId);
    return null;
  });
}

export async function deleteProfileAction(input: unknown): Promise<ActionResult<null>> {
  return run("deleteProfile", async () => {
    const { profileId } = profileIdSchema.parse(input);
    await deleteProfile(await getActor(), profileId);
    return null;
  });
}
