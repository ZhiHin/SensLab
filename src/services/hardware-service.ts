import "server-only";
import type { DpiSource, Grip, OsFamily } from "@/core/types/vocabulary";
import { hardwareRepo } from "@/repositories";
import type { Actor } from "@/repositories/actor";
import { withTransaction } from "@/repositories/transaction";
import { ValidationError, notFound } from "@/lib/errors";

/**
 * Hardware profiles (FR-094, FR-095, SCR-043, `SENS-BR-018`, `SENS-BR-035`).
 *
 * ## A profile is context, never a rewrite
 *
 * A session snapshots the hardware it ran at, immutably. Editing a profile afterwards changes
 * what the *next* session will run at and nothing about what an old one measured — the history
 * screen reads the snapshot, not the profile. That is why the profile is soft-deleted rather
 * than removed: a session still points at it, and a name is what makes an old row legible.
 *
 * ## Defaults
 *
 * At most one default per user, enforced by a partial unique index and by clearing the flag
 * before setting it. A user's first profile becomes the default because a lone profile that is
 * not the default would be a pointless second click.
 */

export interface HardwareProfileView {
  readonly id: string;
  readonly name: string;
  readonly dpi: number;
  readonly dpiSource: DpiSource;
  readonly pollingRateHz: number | null;
  readonly mouseModel: string | null;
  readonly grip: Grip | null;
  readonly mousepadWidthMm: number | null;
  readonly mousepadHeightMm: number | null;
  readonly monitorWidthPx: number | null;
  readonly monitorHeightPx: number | null;
  readonly refreshRateHz: number | null;
  readonly osFamily: OsFamily | null;
  readonly windowsPointerSpeed: number | null;
  readonly enhancePointerPrecision: boolean | null;
  readonly isDefault: boolean;
  readonly updatedAt: string;
}

export type HardwareProfileInput = hardwareRepo.HardwareProfileInput;

function toView(
  row: Awaited<ReturnType<typeof hardwareRepo.getHardwareProfile>>,
): HardwareProfileView {
  if (row === null) throw notFound("hardware profile");
  return {
    id: row.id,
    name: row.name,
    dpi: row.dpi,
    dpiSource: row.dpiSource,
    pollingRateHz: row.pollingRateHz,
    mouseModel: row.mouseModel,
    grip: row.grip,
    mousepadWidthMm: row.mousepadWidthMm,
    mousepadHeightMm: row.mousepadHeightMm,
    monitorWidthPx: row.monitorWidthPx,
    monitorHeightPx: row.monitorHeightPx,
    refreshRateHz: row.refreshRateHz,
    osFamily: row.osFamily,
    windowsPointerSpeed: row.windowsPointerSpeed,
    enhancePointerPrecision: row.enhancePointerPrecision,
    isDefault: row.isDefault,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listProfiles(actor: Actor): Promise<readonly HardwareProfileView[]> {
  const rows = await hardwareRepo.listHardwareProfiles(actor);
  return rows.map((row) => toView(row));
}

export async function getProfile(
  actor: Actor,
  profileId: string,
): Promise<HardwareProfileView | null> {
  const row = await hardwareRepo.getHardwareProfile(actor, profileId);
  return row === null ? null : toView(row);
}

/** The profile a new calibration should prefill from: the default, else the most recent. */
export async function defaultProfile(actor: Actor): Promise<HardwareProfileView | null> {
  const rows = await hardwareRepo.listHardwareProfiles(actor);
  const first = rows[0];
  return first === undefined ? null : toView(first);
}

function validate(input: Partial<HardwareProfileInput>): void {
  const problems: { path: string; message: string }[] = [];
  if (input.name !== undefined && input.name.trim().length === 0) {
    problems.push({ path: "name", message: "give the profile a name" });
  }
  if (input.dpi !== undefined && !(input.dpi >= 100 && input.dpi <= 32_000)) {
    problems.push({ path: "dpi", message: "must be between 100 and 32000" });
  }
  if (
    input.windowsPointerSpeed !== undefined &&
    input.windowsPointerSpeed !== null &&
    !(input.windowsPointerSpeed >= 1 && input.windowsPointerSpeed <= 11)
  ) {
    problems.push({ path: "windowsPointerSpeed", message: "Windows pointer speed is 1 to 11" });
  }
  if (problems.length > 0) throw new ValidationError(problems);
}

export async function createProfile(
  actor: Actor,
  input: HardwareProfileInput,
): Promise<HardwareProfileView> {
  validate(input);
  const existing = await hardwareRepo.listHardwareProfiles(actor);
  const row = await withTransaction((tx) =>
    hardwareRepo.createHardwareProfile(
      actor,
      // The first profile is the default: a single profile that is not the default would be a
      // setting with no alternative.
      { ...input, isDefault: input.isDefault ?? existing.length === 0 },
      tx,
    ),
  );
  return toView(row);
}

export async function updateProfile(
  actor: Actor,
  profileId: string,
  input: Partial<HardwareProfileInput>,
): Promise<HardwareProfileView> {
  validate(input);
  const row = await withTransaction((tx) =>
    hardwareRepo.updateHardwareProfile(actor, profileId, input, tx),
  );
  return toView(row);
}

export async function setDefaultProfile(actor: Actor, profileId: string): Promise<void> {
  await withTransaction((tx) =>
    hardwareRepo.updateHardwareProfile(actor, profileId, { isDefault: true }, tx),
  );
}

/**
 * Soft-deletes a profile.
 *
 * The last profile can be deleted: a user who sold their mouse should not have to keep a row
 * describing it. Sessions keep their snapshot, so nothing they measured becomes unreadable.
 */
export async function deleteProfile(actor: Actor, profileId: string): Promise<void> {
  await withTransaction((tx) => hardwareRepo.softDeleteHardwareProfile(actor, profileId, tx));
}
