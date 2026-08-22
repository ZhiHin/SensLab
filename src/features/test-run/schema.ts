import { z } from "zod";
import { METRIC_KEYS } from "@/core/metrics";
import {
  INVALID_REASONS,
  SCOPE_KEYS,
  SESSION_MODES,
  TEST_KEYS,
  TRIAL_VALIDITIES,
} from "@/core/types/vocabulary";

/**
 * Validation for everything a browser submits (doc 23 §23.6).
 *
 * ## What this can and cannot do
 *
 * SensLab measures in the browser, so the server cannot independently verify that a reported
 * acquisition time is what the player's hand actually did. Pretending otherwise would be worse
 * than admitting it. What the server *can* do — and must — is refuse anything structurally
 * impossible: an unknown metric key, a validity that contradicts its reason code, a negative
 * duration, a proportion above one. That turns "a client could send anything" into "a client
 * could send a plausible lie", which is a much smaller surface and the honest limit of
 * client-side measurement.
 *
 * The anti-manipulation checks that *can* be made — physically impossible velocities — run in
 * the engine at capture time, where the sample stream still exists (doc 23 §23.10).
 */

const finite = z.number().finite();
const nonNegative = finite.min(0);

const trialQuality = z.object({
  cleanFrameFraction: finite.min(0).max(1),
  hitchCount: z.number().int().min(0),
  bufferOverflow: z.boolean(),
});

export const trialRecordSchema = z
  .object({
    trialIndex: z.number().int().min(0).max(1000),
    isPractice: z.boolean(),
    validity: z.enum(TRIAL_VALIDITIES),
    invalidReason: z.enum(INVALID_REASONS).nullable(),
    isReplacement: z.boolean(),
    startOffsetMs: nonNegative,
    durationMs: nonNegative,
    hit: z.boolean().nullable(),
    shots: z.number().int().min(0).max(500),
    targetAngularRadiusDeg: finite.positive().nullable(),
    targetDistanceDeg: nonNegative.nullable(),
    targetDirectionDeg: finite.min(0).max(360).nullable(),
    stimulusSeed: z.string().min(1).max(200),
    variant: z.string().min(1).max(64).nullable(),
    qualityFlags: z.array(z.string().min(1).max(64)).max(32),
    quality: trialQuality,
    // Only registered metrics may be stored. An unknown key would fail the foreign key at the
    // database anyway; rejecting it here turns a 500 into a clear rejection.
    //
    // `partialRecord`, not `record`: with an enum key, Zod's `record` is *exhaustive* and
    // demands every metric in the registry. Trial metrics are sparse by design — a tracking
    // metric is meaningless on a flick trial — so an exhaustive record would reject every real
    // upload.
    metrics: z.partialRecord(z.enum(METRIC_KEYS as [string, ...string[]]), finite),
  })
  .refine((trial) => (trial.validity === "invalid") === (trial.invalidReason !== null), {
    message: "an invalid reason must be present exactly when the trial is invalid",
    path: ["invalidReason"],
  });

const roundMetricSchema = z.object({
  value: finite,
  validTrials: z.number().int().min(0),
  invalidTrials: z.number().int().min(0),
  degradedTrials: z.number().int().min(0),
  robustStandardDeviation: finite.nullable(),
  intervalLow: finite.nullable(),
  intervalHigh: finite.nullable(),
});

export const roundAggregateSchema = z.object({
  presentationOrder: z.number().int().min(0).max(500),
  blockIndex: z.number().int().min(0).max(500),
  roundIndex: z.number().int().min(0).max(500),
  candidateIndex: z.number().int().min(0).max(64).nullable(),
  testKey: z.enum(TEST_KEYS),
  scopeKey: z.enum(SCOPE_KEYS),
  isPractice: z.boolean(),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime(),
  trials: z.array(trialRecordSchema).max(500),
  roundMetrics: z.partialRecord(z.enum(METRIC_KEYS as [string, ...string[]]), roundMetricSchema),
  qualitySummary: z.object({
    lateFrameRatio: finite.min(0).max(1),
    hitchCount: z.number().int().min(0),
    lockLossCount: z.number().int().min(0),
  }),
});

export const startRunSchema = z.object({
  testKey: z.enum(TEST_KEYS),
  mode: z.enum(SESSION_MODES),
  countsPer360: finite.positive(),
  aspectRatio: finite.positive(),
  maxImpliedCountsPerSecond: finite.positive(),
  environment: z.record(z.string(), z.unknown()).default({}),
});

export type StartRunPayload = z.infer<typeof startRunSchema>;
export type RoundAggregatePayload = z.infer<typeof roundAggregateSchema>;
