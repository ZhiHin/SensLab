import { z } from "zod";
import { DPI_SOURCES, GRIPS, OS_FAMILIES } from "@/core/types/vocabulary";

/**
 * Hardware profile boundary contracts (FR-094).
 *
 * Everything except the name and the DPI is optional, because a profile that demanded a
 * monitor refresh rate before it would save would be a form the player abandons — and the
 * measurement needs the DPI alone (`SENS-BR-004`).
 */

const optionalInt = (min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).nullable().default(null);

export const hardwareProfileSchema = z.object({
  name: z.string().trim().min(1).max(64),
  dpi: z.coerce.number().int().min(100).max(32_000),
  dpiSource: z.enum(DPI_SOURCES).default("known"),
  pollingRateHz: optionalInt(50, 8_000),
  mouseModel: z.string().trim().max(80).nullable().default(null),
  grip: z.enum(GRIPS).nullable().default(null),
  mousepadWidthMm: optionalInt(50, 2_000),
  mousepadHeightMm: optionalInt(50, 2_000),
  monitorWidthPx: optionalInt(320, 16_000),
  monitorHeightPx: optionalInt(240, 16_000),
  refreshRateHz: optionalInt(24, 1_000),
  osFamily: z.enum(OS_FAMILIES).nullable().default(null),
  windowsPointerSpeed: optionalInt(1, 11),
  enhancePointerPrecision: z.boolean().nullable().default(null),
});

export const profileIdSchema = z.object({ profileId: z.uuid() });

export const updateProfileSchema = hardwareProfileSchema.partial().extend({
  profileId: z.uuid(),
});

export type HardwareProfilePayload = z.infer<typeof hardwareProfileSchema>;
