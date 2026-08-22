import "server-only";
import { CURRENT_VERSIONS } from "@/core/params";
import { newSeed } from "@/lib/crypto";
import { notFound, ValidationError } from "@/lib/errors";
import { countsPer360 } from "@/core/types/brand";
import type { SessionMode, SessionQualityFlag } from "@/core/types/vocabulary";
import { algorithmRepo, sessionRepo } from "@/repositories";
import { withTransaction } from "@/repositories/transaction";
import type { Actor } from "@/repositories/actor";
import type { RoundAggregate, SessionPlan } from "@/test-engine/contracts";
import { createSingleTestPlan } from "@/test-engine/plan/single-test";
import { getTestDefinition } from "@/test-engine/tests";

/**
 * Running one aim test and persisting what it produced (doc 05 FR-058, doc 20 §20.7).
 *
 * ## Why the plan is built on the server
 *
 * The seed, the sensitivity and the trial counts decide what the player is shown and what the
 * numbers mean. Letting the client choose them would let a player re-roll a favourable stimulus
 * sequence or quietly run twelve trials and report the best eight. The client receives a plan;
 * it does not author one.
 *
 * ## Why ingest is idempotent
 *
 * A round is submitted from a browser over a network that drops requests. The repository
 * conflicts on `(session_id, presentation_order)`, so a retried upload finds the round already
 * present and writes nothing — replaying the same payload three times produces one round
 * (`SENS-NFR-016`).
 *
 * ## What this is not
 *
 * There is no candidate generation, no counterbalancing and no recommendation here. A
 * single-test run compares nothing, so it produces no candidate and no result — that is Phase 4.
 */

export interface StartTestRunInput {
  readonly testKey: string;
  readonly mode: SessionMode;
  /** The sensitivity to run at, in counts per 360°. */
  readonly countsPer360: number;
  readonly aspectRatio: number;
  /** Physical plausibility bound derived from the player's DPI (doc 23 §23.10). */
  readonly maxImpliedCountsPerSecond: number;
  readonly environment: Readonly<Record<string, unknown>>;
  readonly hardwareSnapshot?: Readonly<Record<string, unknown>>;
}

export interface StartTestRunOutcome {
  readonly sessionId: string;
  readonly plan: SessionPlan;
}

/** Bounds a plausible sensitivity: below this a full turn takes metres of desk. */
const MIN_COUNTS_PER_360 = 500;
const MAX_COUNTS_PER_360 = 200_000;

export async function startTestRun(
  actor: Actor,
  input: StartTestRunInput,
): Promise<StartTestRunOutcome> {
  const definition = getTestDefinition(input.testKey);
  if (definition === undefined) throw notFound(`test "${input.testKey}"`);

  if (
    !Number.isFinite(input.countsPer360) ||
    input.countsPer360 < MIN_COUNTS_PER_360 ||
    input.countsPer360 > MAX_COUNTS_PER_360
  ) {
    throw new ValidationError([
      {
        path: "countsPer360",
        message: `must be between ${MIN_COUNTS_PER_360} and ${MAX_COUNTS_PER_360}`,
      },
    ]);
  }
  if (!Number.isFinite(input.aspectRatio) || input.aspectRatio <= 0) {
    throw new ValidationError([{ path: "aspectRatio", message: "must be positive" }]);
  }

  return withTransaction(async (tx) => {
    const versions = await algorithmRepo.resolveAlgorithmVersionIds(
      {
        scoring: CURRENT_VERSIONS.scoring,
        calibration: CURRENT_VERSIONS.calibration,
        confidence: CURRENT_VERSIONS.confidence,
      },
      tx,
    );

    const { scoring, calibration, confidence } = versions;
    if (scoring === undefined || calibration === undefined || confidence === undefined) {
      // Every session pins the exact algorithm versions that produced it (`SENS-BR-029`). A
      // session that could not name them is not reproducible, so it is refused rather than
      // created with nulls.
      throw notFound("algorithm versions");
    }

    const seed = newSeed();

    const session = await sessionRepo.createTestSession(
      actor,
      {
        hardwareProfileId: null,
        hardwareSnapshot: input.hardwareSnapshot ?? {},
        primaryGameVersionId: null,
        mode: input.mode,
        environment: input.environment,
        // The environment check that grades this properly is part of the session flow; a
        // single-test run records what it was told and grades it `pass`.
        environmentClass: "pass",
        seed,
        scoringVersionId: scoring,
        calibrationVersionId: calibration,
        confidenceVersionId: confidence,
      },
      tx,
    );

    const plan = createSingleTestPlan({
      sessionId: session.id,
      seed: seed.toString(),
      mode: input.mode,
      definition,
      countsPer360: countsPer360(input.countsPer360),
      aspectRatio: input.aspectRatio,
      maxImpliedCountsPerSecond: input.maxImpliedCountsPerSecond,
    });

    await sessionRepo.updateSessionStatus(actor, session.id, "in_progress", tx);

    return { sessionId: session.id, plan };
  });
}

export interface SubmitRoundOutcome {
  readonly roundId: string;
  readonly created: boolean;
  readonly trialsWritten: number;
  readonly metricsWritten: number;
}

/**
 * Persists one completed round.
 *
 * Written whole or not at all: a half-written round would leave a session whose trial counts
 * silently disagree with its aggregates (`SENS-NFR-020`).
 */
export async function submitRound(
  actor: Actor,
  sessionId: string,
  aggregate: RoundAggregate,
): Promise<SubmitRoundOutcome> {
  return withTransaction(async (tx) => {
    const outcome = await sessionRepo.ingestRoundAggregate(actor, sessionId, aggregate, tx);
    return {
      roundId: outcome.roundId,
      created: outcome.created,
      trialsWritten: outcome.trialsWritten,
      metricsWritten: outcome.metricsWritten,
    };
  });
}

/** Marks a run finished, and records any session-level quality flags the engine raised. */
export async function completeTestRun(
  actor: Actor,
  sessionId: string,
  qualityFlags: readonly SessionQualityFlag[],
): Promise<void> {
  await withTransaction(async (tx) => {
    // Flags are written before the status: a session that reads `completed` must already carry
    // everything known about how it went, or a reader could see a clean-looking finished
    // session for an instant.
    for (const flag of qualityFlags) {
      await sessionRepo.addSessionQualityFlag(sessionId, flag, null, tx);
    }
    await sessionRepo.updateSessionStatus(actor, sessionId, "completed", tx);
  });
}

/** Marks a run abandoned. Everything already ingested is kept and stays visible. */
export async function abandonTestRun(actor: Actor, sessionId: string): Promise<void> {
  await withTransaction(async (tx) => {
    await sessionRepo.updateSessionStatus(actor, sessionId, "abandoned", tx);
  });
}
