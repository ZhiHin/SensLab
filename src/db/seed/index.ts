import { sql } from "drizzle-orm";
import { AIM_PROFILE_RULES_V1 } from "@/core/params/aim-profile-rules-v1";
import { CALIBRATION_MODEL_V1 } from "@/core/params/calibration-model-v1";
import { METRIC_DEFINITIONS } from "@/core/metrics/registry";
import { TEST_KEYS } from "@/core/types/vocabulary";
import type { TestCategory, TestKey } from "@/core/types/vocabulary";
import { LAUNCH_ADAPTERS } from "@/game-adapters/launch-games";
import { canonicalJson } from "@/lib/canonical-json";
import { newId, sha256 } from "@/lib/crypto";
import { allParameterSetDigests } from "@/lib/parameter-registry";
import type { Database } from "../client";
import {
  aimProfiles,
  algorithmVersions,
  gameVersions,
  games,
  metricDefinitions,
  testDefinitions,
} from "../schema";

/**
 * Deterministic, idempotent seed data (doc 21 §21.9).
 *
 * Re-running must be a no-op, so every insert is an upsert keyed on the natural key. That
 * matters because the seed runs in CI on every integration run and on every developer's
 * machine after every migration.
 *
 * The most important thing in this file is what it does *not* do: the five launch games are
 * seeded with `verification_status = 'unverified'` and **no sensitivity models at all**. That
 * is the honest state — SensLab has not performed its own verification for any of them
 * (doc 36: fifteen open items, zero verified). Verification flips them, deliberately and
 * traceably, and until it does the product behaves correctly by refusing to emit a number.
 */

export interface SeedSummary {
  readonly metricDefinitions: number;
  readonly algorithmVersions: number;
  readonly aimProfiles: number;
  readonly testDefinitions: number;
  readonly games: number;
  readonly gameVersions: number;
}

const TEST_CATEGORY_BY_KEY: Readonly<Record<TestKey, TestCategory>> = {
  reaction: "baseline",
  flick: "scored",
  micro: "scored",
  tracking: "scored",
  switching: "scored",
  precision: "scored",
  comfort360: "constraint",
};

const TEST_DISPLAY_NAME: Readonly<Record<TestKey, string>> = {
  reaction: "Reaction",
  flick: "Flick",
  micro: "Micro Adjustment",
  tracking: "Tracking",
  switching: "Target Switching",
  precision: "Precision",
  comfort360: "360 Comfort",
};

/** The engine version these declarations require. Bumped when the contract changes. */
const ENGINE_MIN_VERSION = "1.0.0";

export async function seedMetricDefinitions(db: Database): Promise<number> {
  for (const definition of METRIC_DEFINITIONS) {
    await db
      .insert(metricDefinitions)
      .values({
        key: definition.key,
        displayName: definition.displayName,
        unit: definition.unit,
        direction: definition.direction,
        aggregation: definition.aggregation,
        description: definition.description,
        isDecisionMetric: definition.isDecisionMetric,
        version: definition.version,
      })
      .onConflictDoUpdate({
        target: metricDefinitions.key,
        set: {
          displayName: definition.displayName,
          unit: definition.unit,
          direction: definition.direction,
          aggregation: definition.aggregation,
          description: definition.description,
          isDecisionMetric: definition.isDecisionMetric,
          version: definition.version,
        },
      });
  }
  return METRIC_DEFINITIONS.length;
}

/**
 * Seeds the released parameter sets.
 *
 * Insert-only by trigger (`SENS-BR-029`), so this uses `onConflictDoNothing`: re-running the
 * seed must never attempt to update a released row, and if the values in code have diverged
 * from the database the boot-time integrity check is what reports it — loudly — rather than
 * the seed quietly papering over it.
 */
export async function seedAlgorithmVersions(db: Database): Promise<number> {
  const digests = allParameterSetDigests();
  for (const digest of digests) {
    await db
      .insert(algorithmVersions)
      .values({
        id: newId(),
        kind: digest.kind,
        versionLabel: digest.version,
        params: digest.params,
        paramsHash: digest.hash,
        releasedAt: new Date(digest.releasedAt),
        notes: digest.notes,
      })
      .onConflictDoNothing({
        target: [algorithmVersions.kind, algorithmVersions.versionLabel],
      });
  }
  return digests.length;
}

export async function seedAimProfiles(db: Database): Promise<number> {
  const keys = Object.keys(AIM_PROFILE_RULES_V1.params.displayNames)
    .map((composite) => composite.split(":")[0] ?? "")
    .filter((key) => key.length > 0);
  const unique = [...new Set(keys)];

  for (const key of unique) {
    const displayName = AIM_PROFILE_RULES_V1.params.displayNames[`${key}:mid`] ?? key;
    await db
      .insert(aimProfiles)
      .values({
        key,
        displayNameLocalized: { en: displayName },
        descriptionLocalized: {},
        ruleVersion: AIM_PROFILE_RULES_V1.version,
      })
      .onConflictDoUpdate({
        target: aimProfiles.key,
        set: {
          displayNameLocalized: { en: displayName },
          ruleVersion: AIM_PROFILE_RULES_V1.version,
        },
      });
  }
  return unique.length;
}

/**
 * Seeds the MVP aim-test declarations.
 *
 * The `config` payload carries the documented trial budget per mode. The engine that *runs*
 * these tests is Phase 2/3; what is being recorded here is the declaration the session
 * planner and the ingest validator need in order to know how many trials a round should have.
 */
export async function seedTestDefinitions(db: Database): Promise<number> {
  const minimums = CALIBRATION_MODEL_V1.params.minimumValidTrials;

  for (const key of TEST_KEYS) {
    const minimum = minimums[key];
    const config = {
      minValidTrials: minimum ?? { quick: 0, standard: 0, advanced: 0 },
      // Sensitivity-independent tests run once per session rather than once per candidate.
      perCandidate: key !== "reaction" && key !== "comfort360",
      scored: TEST_CATEGORY_BY_KEY[key] === "scored",
    };

    await db
      .insert(testDefinitions)
      .values({
        id: newId(),
        key,
        version: 1,
        displayName: TEST_DISPLAY_NAME[key],
        category: TEST_CATEGORY_BY_KEY[key],
        config,
        engineMinVersion: ENGINE_MIN_VERSION,
      })
      .onConflictDoUpdate({
        target: [testDefinitions.key, testDefinitions.version],
        set: {
          displayName: TEST_DISPLAY_NAME[key],
          category: TEST_CATEGORY_BY_KEY[key],
          config,
          engineMinVersion: ENGINE_MIN_VERSION,
        },
      });
  }
  return TEST_KEYS.length;
}

/**
 * Seeds the launch games and their (unverified) versions.
 *
 * Sourced from the adapter registry rather than restated here, so the database and the
 * compiled adapters cannot describe a different roster.
 */
export async function seedGames(db: Database): Promise<{ games: number; versions: number }> {
  let versionCount = 0;

  for (const [index, adapter] of LAUNCH_ADAPTERS.entries()) {
    const { identity } = adapter;

    const [gameRow] = await db
      .insert(games)
      .values({
        id: newId(),
        slug: identity.gameId,
        displayName: identity.displayName.en,
        displayNameLocalized: identity.displayName,
        region: identity.region,
        engineFamily: identity.engineFamily ?? null,
        status: "supported",
        sortOrder: index,
      })
      .onConflictDoUpdate({
        target: games.slug,
        set: {
          displayName: identity.displayName.en,
          displayNameLocalized: identity.displayName,
          region: identity.region,
          sortOrder: index,
          updatedAt: new Date(),
        },
      })
      .returning({ id: games.id });

    if (gameRow === undefined) continue;

    await db
      .insert(gameVersions)
      .values({
        id: newId(),
        gameId: gameRow.id,
        versionLabel: identity.gameVersionLabel,
        effectiveFrom: new Date().toISOString().slice(0, 10),
        isCurrent: true,
        // Unverified, with no evidence — which the check constraint requires to be consistent.
        verificationStatus: "unverified",
        verifiedAt: null,
        verifiedAgainstBuild: null,
        sourceRefs: [],
        adapterModuleVersion: identity.adapterVersion,
      })
      .onConflictDoUpdate({
        target: [gameVersions.gameId, gameVersions.versionLabel],
        set: { adapterModuleVersion: identity.adapterVersion },
      });

    versionCount += 1;
  }

  return { games: LAUNCH_ADAPTERS.length, versions: versionCount };
}

export async function seedAll(db: Database): Promise<SeedSummary> {
  const metrics = await seedMetricDefinitions(db);
  const algorithms = await seedAlgorithmVersions(db);
  const profiles = await seedAimProfiles(db);
  const tests = await seedTestDefinitions(db);
  const gameCounts = await seedGames(db);

  return {
    metricDefinitions: metrics,
    algorithmVersions: algorithms,
    aimProfiles: profiles,
    testDefinitions: tests,
    games: gameCounts.games,
    gameVersions: gameCounts.versions,
  };
}

/** Verifies that the seed produced the parameter hashes the code expects. */
export async function verifySeededParameterHashes(db: Database): Promise<readonly string[]> {
  const rows = await db
    .select({
      kind: algorithmVersions.kind,
      versionLabel: algorithmVersions.versionLabel,
      params: algorithmVersions.params,
      paramsHash: algorithmVersions.paramsHash,
    })
    .from(algorithmVersions)
    .where(sql`true`);

  const problems: string[] = [];
  for (const row of rows) {
    const recomputed = sha256(canonicalJson(row.params)).toString("hex");
    if (recomputed !== row.paramsHash.toString("hex")) {
      problems.push(`${row.kind}:${row.versionLabel} stored hash does not match stored params`);
    }
  }
  return problems;
}
