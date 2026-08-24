import { z } from "zod";
import { roundAggregateSchema } from "@/features/test-run/schema";

/**
 * Validation and fine-tune boundary contracts (doc 17, doc 23 §23.4).
 *
 * The browser may name the recommendation it wants to validate or refine, the session it is
 * uploading for, and what it measured. It may never name an arm, a candidate, a sequence, a
 * verdict — or, for a fine-tune, which candidate is "Recommended". Those are the server's.
 */

const finite = z.number().finite();

export const startFromRecommendationSchema = z.object({
  recommendationId: z.uuid(),
  aspectRatio: finite.positive(),
  environment: z.record(z.string(), z.unknown()).default({}),
});

export const submitStageSchema = z.object({
  sessionId: z.uuid(),
  aggregates: z.array(roundAggregateSchema).max(400),
  qualityFlags: z.array(z.string()).max(32),
  aspectRatio: finite.positive(),
});

export const decideValidationSchema = z.object({
  recommendationId: z.uuid(),
  choice: z.enum(["accept_recommended", "keep_original"]),
});

export const preferenceSchema = z.object({
  sessionId: z.uuid(),
  candidateId: z.uuid(),
});
