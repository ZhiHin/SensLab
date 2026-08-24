import { z } from "zod";
import { DPI_SOURCES, SESSION_MODES } from "@/core/types/vocabulary";
import { roundAggregateSchema } from "@/features/test-run/schema";

/**
 * The calibration session's boundary contracts.
 *
 * What the browser may say about the player: a DPI, where it came from, an optional current
 * sensitivity, an optional pad width, an optional game. What it may never say: a seed, a
 * candidate, a sensitivity to test, or a result. Those are the server's (doc 23 §23.4).
 */

const finite = z.number().finite();

export const startCalibrationSchema = z.object({
  mode: z
    .enum(SESSION_MODES)
    .refine((mode) => mode === "quick" || mode === "standard" || mode === "advanced", {
      message: "validation and fine-tune sessions are started from a result, not from here",
    }),
  dpi: finite.min(100).max(32_000),
  dpiSource: z.enum(DPI_SOURCES),
  currentCmPer360: finite.gt(0).lt(500).nullable(),
  padWidthCm: finite.gt(0).lt(300).nullable(),
  gameId: z.string().min(1).max(64).nullable(),
  hardwareProfileId: z.uuid().nullable().default(null),
  aspectRatio: finite.positive(),
  environment: z.record(z.string(), z.unknown()).default({}),
});

export const submitCalibrationRoundSchema = z.object({
  sessionId: z.uuid(),
  roundIndex: z.number().int().min(0).max(16),
  aggregates: z.array(roundAggregateSchema).max(200),
  qualityFlags: z.array(z.string()).max(32),
  aspectRatio: finite.positive(),
});

export type StartCalibrationPayload = z.infer<typeof startCalibrationSchema>;
