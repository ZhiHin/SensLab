import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { dpiSourceEnum, gripEnum, osFamilyEnum } from "./enums";
import { guestSessions, users } from "./identity";

/**
 * Hardware profiles (doc 20 §20.6).
 *
 * DPI is the only required field (`SENS-BR-004`) — everything else is optional because
 * friction at the first form is what loses the user before they ever see a result.
 *
 * `dpiSource` is not decoration. A DPI the user did not actually know changes what SensLab is
 * allowed to claim: the physical result stays fully valid, but the derived game numbers scale
 * with it, and the UI must say so (`SENS-BR-005`).
 *
 * `windowsPointerSpeed` and `enhancePointerPrecision` are collected as *context for warnings
 * and support*, never as multipliers in any calculation (doc 11 §11.8). Applying a folklore
 * multiplier table to "correct" a measurement would be worse than the problem it solves.
 */
export const hardwareProfiles = pgTable(
  "hardware_profiles",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    guestSessionId: uuid("guest_session_id").references(() => guestSessions.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    dpi: integer("dpi").notNull(),
    dpiSource: dpiSourceEnum("dpi_source").notNull().default("known"),
    pollingRateHz: integer("polling_rate_hz"),
    mouseModel: text("mouse_model"),
    grip: gripEnum("grip"),
    mousepadWidthMm: integer("mousepad_width_mm"),
    mousepadHeightMm: integer("mousepad_height_mm"),
    monitorWidthPx: integer("monitor_width_px"),
    monitorHeightPx: integer("monitor_height_px"),
    refreshRateHz: integer("refresh_rate_hz"),
    osFamily: osFamilyEnum("os_family"),
    windowsPointerSpeed: smallint("windows_pointer_speed"),
    enhancePointerPrecision: boolean("enhance_pointer_precision"),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    check("hardware_profiles_dpi_range", sql`${table.dpi} between 100 and 32000`),
    check(
      "hardware_profiles_polling_range",
      sql`${table.pollingRateHz} is null or ${table.pollingRateHz} between 125 and 8000`,
    ),
    check(
      "hardware_profiles_refresh_range",
      sql`${table.refreshRateHz} is null or ${table.refreshRateHz} between 24 and 1000`,
    ),
    check(
      "hardware_profiles_pointer_speed_range",
      sql`${table.windowsPointerSpeed} is null or ${table.windowsPointerSpeed} between 1 and 11`,
    ),
    check(
      "hardware_profiles_pad_dimensions",
      sql`(${table.mousepadWidthMm} is null or ${table.mousepadWidthMm} between 50 and 2000)
          and (${table.mousepadHeightMm} is null or ${table.mousepadHeightMm} between 50 and 2000)`,
    ),
    // Exactly one owner. A profile belongs to an account or to a guest session, never both
    // and never neither.
    check(
      "hardware_profiles_single_owner",
      sql`(${table.userId} is null) <> (${table.guestSessionId} is null)`,
    ),
    uniqueIndex("hardware_profiles_one_default_per_user")
      .on(table.userId)
      .where(sql`${table.isDefault} and ${table.deletedAt} is null`),
    index("hardware_profiles_user_idx").on(table.userId),
    index("hardware_profiles_guest_idx").on(table.guestSessionId),
  ],
);

export type HardwareProfileRow = typeof hardwareProfiles.$inferSelect;
export type NewHardwareProfileRow = typeof hardwareProfiles.$inferInsert;
