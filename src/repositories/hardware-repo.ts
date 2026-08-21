import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { hardwareProfiles, type HardwareProfileRow } from "@/db/schema";
import type { DpiSource, Grip, OsFamily } from "@/core/types/vocabulary";
import { newId } from "@/lib/crypto";
import { notFound } from "@/lib/errors";
import { canOwn, ownershipPredicate, type Actor } from "./actor";
import { executor, type Executor } from "./transaction";

/**
 * Hardware profile access.
 *
 * Every query composes {@link ownershipPredicate}, so a profile belonging to another actor is
 * simply not in the result set — and the caller receives a 404 rather than a 403, which does
 * not confirm that the row exists (doc 23 §23.4).
 */

export interface HardwareProfileInput {
  readonly name: string;
  readonly dpi: number;
  readonly dpiSource: DpiSource;
  readonly pollingRateHz?: number | null;
  readonly mouseModel?: string | null;
  readonly grip?: Grip | null;
  readonly mousepadWidthMm?: number | null;
  readonly mousepadHeightMm?: number | null;
  readonly monitorWidthPx?: number | null;
  readonly monitorHeightPx?: number | null;
  readonly refreshRateHz?: number | null;
  readonly osFamily?: OsFamily | null;
  readonly windowsPointerSpeed?: number | null;
  readonly enhancePointerPrecision?: boolean | null;
  readonly isDefault?: boolean;
}

function ownerColumns(actor: Actor): { userId: string | null; guestSessionId: string | null } {
  switch (actor.kind) {
    case "user":
      return { userId: actor.userId, guestSessionId: null };
    case "guest":
      return { userId: null, guestSessionId: actor.guestSessionId };
    case "anonymous":
      throw notFound("hardware profile");
  }
}

export async function createHardwareProfile(
  actor: Actor,
  input: HardwareProfileInput,
  tx?: Executor,
): Promise<HardwareProfileRow> {
  const db = executor(tx);
  const owner = ownerColumns(actor);
  const id = newId();

  if (input.isDefault === true && actor.kind === "user") {
    await clearDefaultFlag(actor, null, db);
  }

  const rows = await db
    .insert(hardwareProfiles)
    .values({
      id,
      userId: owner.userId,
      guestSessionId: owner.guestSessionId,
      name: input.name,
      dpi: input.dpi,
      dpiSource: input.dpiSource,
      pollingRateHz: input.pollingRateHz ?? null,
      mouseModel: input.mouseModel ?? null,
      grip: input.grip ?? null,
      mousepadWidthMm: input.mousepadWidthMm ?? null,
      mousepadHeightMm: input.mousepadHeightMm ?? null,
      monitorWidthPx: input.monitorWidthPx ?? null,
      monitorHeightPx: input.monitorHeightPx ?? null,
      refreshRateHz: input.refreshRateHz ?? null,
      osFamily: input.osFamily ?? null,
      windowsPointerSpeed: input.windowsPointerSpeed ?? null,
      enhancePointerPrecision: input.enhancePointerPrecision ?? null,
      isDefault: input.isDefault ?? false,
    })
    .returning();

  const row = rows[0];
  if (row === undefined) throw notFound("hardware profile");
  return row;
}

export async function listHardwareProfiles(
  actor: Actor,
  tx?: Executor,
): Promise<readonly HardwareProfileRow[]> {
  if (!canOwn(actor)) return [];
  const db = executor(tx);
  return db
    .select()
    .from(hardwareProfiles)
    .where(
      and(
        ownershipPredicate(actor, {
          userId: hardwareProfiles.userId,
          guestSessionId: hardwareProfiles.guestSessionId,
        }),
        isNull(hardwareProfiles.deletedAt),
      ),
    )
    .orderBy(desc(hardwareProfiles.isDefault), desc(hardwareProfiles.updatedAt));
}

export async function getHardwareProfile(
  actor: Actor,
  profileId: string,
  tx?: Executor,
): Promise<HardwareProfileRow | null> {
  if (!canOwn(actor)) return null;
  const db = executor(tx);
  const rows = await db
    .select()
    .from(hardwareProfiles)
    .where(
      and(
        eq(hardwareProfiles.id, profileId),
        ownershipPredicate(actor, {
          userId: hardwareProfiles.userId,
          guestSessionId: hardwareProfiles.guestSessionId,
        }),
        isNull(hardwareProfiles.deletedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function updateHardwareProfile(
  actor: Actor,
  profileId: string,
  input: Partial<HardwareProfileInput>,
  tx?: Executor,
): Promise<HardwareProfileRow> {
  const db = executor(tx);

  if (input.isDefault === true) await clearDefaultFlag(actor, profileId, db);

  const rows = await db
    .update(hardwareProfiles)
    .set({
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.dpi === undefined ? {} : { dpi: input.dpi }),
      ...(input.dpiSource === undefined ? {} : { dpiSource: input.dpiSource }),
      ...(input.pollingRateHz === undefined ? {} : { pollingRateHz: input.pollingRateHz }),
      ...(input.mouseModel === undefined ? {} : { mouseModel: input.mouseModel }),
      ...(input.grip === undefined ? {} : { grip: input.grip }),
      ...(input.mousepadWidthMm === undefined ? {} : { mousepadWidthMm: input.mousepadWidthMm }),
      ...(input.mousepadHeightMm === undefined ? {} : { mousepadHeightMm: input.mousepadHeightMm }),
      ...(input.monitorWidthPx === undefined ? {} : { monitorWidthPx: input.monitorWidthPx }),
      ...(input.monitorHeightPx === undefined ? {} : { monitorHeightPx: input.monitorHeightPx }),
      ...(input.refreshRateHz === undefined ? {} : { refreshRateHz: input.refreshRateHz }),
      ...(input.osFamily === undefined ? {} : { osFamily: input.osFamily }),
      ...(input.windowsPointerSpeed === undefined
        ? {}
        : { windowsPointerSpeed: input.windowsPointerSpeed }),
      ...(input.enhancePointerPrecision === undefined
        ? {}
        : { enhancePointerPrecision: input.enhancePointerPrecision }),
      ...(input.isDefault === undefined ? {} : { isDefault: input.isDefault }),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(hardwareProfiles.id, profileId),
        ownershipPredicate(actor, {
          userId: hardwareProfiles.userId,
          guestSessionId: hardwareProfiles.guestSessionId,
        }),
        isNull(hardwareProfiles.deletedAt),
      ),
    )
    .returning();

  const row = rows[0];
  if (row === undefined) throw notFound("hardware profile");
  return row;
}

/**
 * Soft delete.
 *
 * The row survives because historical sessions reference it, and because their immutable
 * hardware snapshots must remain interpretable alongside the profile they came from
 * (`SENS-BR-018`).
 */
export async function softDeleteHardwareProfile(
  actor: Actor,
  profileId: string,
  tx?: Executor,
): Promise<void> {
  const db = executor(tx);
  const rows = await db
    .update(hardwareProfiles)
    .set({ deletedAt: new Date(), isDefault: false, updatedAt: new Date() })
    .where(
      and(
        eq(hardwareProfiles.id, profileId),
        ownershipPredicate(actor, {
          userId: hardwareProfiles.userId,
          guestSessionId: hardwareProfiles.guestSessionId,
        }),
        isNull(hardwareProfiles.deletedAt),
      ),
    )
    .returning({ id: hardwareProfiles.id });

  if (rows[0] === undefined) throw notFound("hardware profile");
}

async function clearDefaultFlag(
  actor: Actor,
  exceptProfileId: string | null,
  db: Executor,
): Promise<void> {
  if (!canOwn(actor)) return;
  await db
    .update(hardwareProfiles)
    .set({ isDefault: false })
    .where(
      and(
        ownershipPredicate(actor, {
          userId: hardwareProfiles.userId,
          guestSessionId: hardwareProfiles.guestSessionId,
        }),
        eq(hardwareProfiles.isDefault, true),
        exceptProfileId === null ? undefined : ne(hardwareProfiles.id, exceptProfileId),
      ),
    );
}
