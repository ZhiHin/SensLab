import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { hardwareRepo, sessionRepo, userRepo } from "@/repositories";
import { hashPassword } from "@/lib/password";
import { newId } from "@/lib/crypto";
import {
  asUser,
  currentAlgorithmVersionIds,
  makeEnvironmentFingerprint,
  makeHardwareSnapshot,
  db,
  expectDbFailure,
  resetVolatileTables,
  testSeed,
} from "@tests/helpers/db";

/**
 * Database-level invariants (doc 20, doc 21).
 *
 * These assert the guarantees that live in the *schema* rather than in application code.
 * That distinction matters: a constraint enforced only in TypeScript is bypassed by a script,
 * a migration, or a future endpoint, whereas a CHECK constraint is bypassed by nobody.
 */

async function makeUser(email: string): Promise<string> {
  const { userId } = await userRepo.createUser({
    email,
    passwordHash: await hashPassword("correct-horse-battery"),
  });
  return userId;
}

describe("check constraints", () => {
  beforeEach(async () => {
    await resetVolatileTables();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("rejects a DPI outside the plausible range", async () => {
    const alice = asUser(await makeUser("dpi@example.test"));
    await expectDbFailure(
      hardwareRepo.createHardwareProfile(alice, { name: "x", dpi: 50, dpiSource: "known" }),
      /hardware_profiles_dpi_range/,
    );
    await expectDbFailure(
      hardwareRepo.createHardwareProfile(alice, { name: "x", dpi: 99_999, dpiSource: "known" }),
      /hardware_profiles_dpi_range/,
    );
  });

  it("rejects an out-of-range Windows pointer speed", async () => {
    const alice = asUser(await makeUser("pointer@example.test"));
    await expectDbFailure(
      hardwareRepo.createHardwareProfile(alice, {
        name: "x",
        dpi: 800,
        dpiSource: "known",
        windowsPointerSpeed: 12,
      }),
      /pointer_speed_range/,
    );
  });

  it("requires a hardware profile to have exactly one owner", async () => {
    await expectDbFailure(
      db().execute(
        sql`insert into hardware_profiles (id, name, dpi, dpi_source)
            values (${newId()}, 'orphan', 800, 'known')`,
      ),
      /single_owner/,
    );
  });

  it("allows only one default hardware profile per user", async () => {
    const alice = asUser(await makeUser("default@example.test"));
    const first = await hardwareRepo.createHardwareProfile(alice, {
      name: "First",
      dpi: 800,
      dpiSource: "known",
      isDefault: true,
    });
    const second = await hardwareRepo.createHardwareProfile(alice, {
      name: "Second",
      dpi: 1600,
      dpiSource: "known",
      isDefault: true,
    });

    const profiles = await hardwareRepo.listHardwareProfiles(alice);
    const defaults = profiles.filter((profile) => profile.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.id).toBe(second.id);
    expect(first.id).not.toBe(second.id);
  });

  it("requires a calibration session to have exactly one owner", async () => {
    const versions = await currentAlgorithmVersionIds();
    await expectDbFailure(
      db().execute(
        sql`insert into test_sessions
              (id, hardware_snapshot, mode, status, environment, environment_class, seed,
               scoring_version_id, calibration_version_id, confidence_version_id)
            values (${newId()}, '{}'::jsonb, 'standard', 'created', '{}'::jsonb, 'pass', 1,
               ${versions.scoringVersionId}, ${versions.calibrationVersionId},
               ${versions.confidenceVersionId})`,
      ),
      /single_owner/,
    );
  });

  it("requires an invalid trial to carry a reason, and a valid one not to — SENS-BR-009", async () => {
    const alice = asUser(await makeUser("trials@example.test"));
    const versions = await currentAlgorithmVersionIds();
    const session = await sessionRepo.createTestSession(alice, {
      hardwareProfileId: null,
      hardwareSnapshot: makeHardwareSnapshot(),
      primaryGameVersionId: null,
      mode: "standard",
      environment: makeEnvironmentFingerprint(),
      environmentClass: "pass",
      seed: testSeed(),
      ...versions,
    });

    const definition = await db().execute(
      sql`select id from test_definitions where key = 'flick' and version = 1`,
    );
    const definitionId = (definition as unknown as { id: string }[])[0]?.id;
    expect(definitionId).toBeDefined();

    const roundId = newId();
    await db().execute(
      sql`insert into test_rounds
            (id, session_id, test_definition_id, block_index, presentation_order, is_practice, status)
          values (${roundId}, ${session.id}, ${definitionId}, 0, 0, false, 'completed')`,
    );

    // Invalid without a reason.
    await expectDbFailure(
      db().execute(
        sql`insert into test_trials
              (id, round_id, trial_index, validity, start_offset_ms, duration_ms,
               stimulus_seed, clean_frame_fraction)
            values (${newId()}, ${roundId}, 0, 'invalid', 0, 100, 's', 1.0)`,
      ),
      /invalid_reason_iff_invalid/,
    );

    // Valid *with* a reason.
    await expectDbFailure(
      db().execute(
        sql`insert into test_trials
              (id, round_id, trial_index, validity, invalid_reason, start_offset_ms, duration_ms,
               stimulus_seed, clean_frame_fraction)
            values (${newId()}, ${roundId}, 1, 'valid', 'timeout', 0, 100, 's', 1.0)`,
      ),
      /invalid_reason_iff_invalid/,
    );

    // Both consistent forms are accepted.
    await db().execute(
      sql`insert into test_trials
            (id, round_id, trial_index, validity, start_offset_ms, duration_ms,
             stimulus_seed, clean_frame_fraction)
          values (${newId()}, ${roundId}, 2, 'valid', 0, 100, 's', 1.0)`,
    );
    await db().execute(
      sql`insert into test_trials
            (id, round_id, trial_index, validity, invalid_reason, start_offset_ms, duration_ms,
             stimulus_seed, clean_frame_fraction)
          values (${newId()}, ${roundId}, 3, 'invalid', 'focus_lost', 0, 100, 's', 1.0)`,
    );
  });

  it("rejects a metric key that is not in the registry", async () => {
    const alice = asUser(await makeUser("metrics@example.test"));
    const versions = await currentAlgorithmVersionIds();
    const session = await sessionRepo.createTestSession(alice, {
      hardwareProfileId: null,
      hardwareSnapshot: makeHardwareSnapshot(),
      primaryGameVersionId: null,
      mode: "quick",
      environment: makeEnvironmentFingerprint(),
      environmentClass: "pass",
      seed: testSeed(),
      ...versions,
    });

    const definition = await db().execute(
      sql`select id from test_definitions where key = 'flick' and version = 1`,
    );
    const definitionId = (definition as unknown as { id: string }[])[0]?.id;
    const roundId = newId();
    await db().execute(
      sql`insert into test_rounds
            (id, session_id, test_definition_id, block_index, presentation_order, is_practice, status)
          values (${roundId}, ${session.id}, ${definitionId}, 0, 0, false, 'completed')`,
    );

    await expectDbFailure(
      db().execute(
        sql`insert into round_metrics
              (round_id, metric_key, value, valid_trials, invalid_trials, degraded_trials)
            values (${roundId}, 'notARealMetric', 1.0, 5, 0, 0)`,
      ),
      /metric_key/,
    );
  });

  it("keeps the comfort range ordered and the confidence index in range", async () => {
    const alice = asUser(await makeUser("recommendation@example.test"));
    const versions = await currentAlgorithmVersionIds();
    const session = await sessionRepo.createTestSession(alice, {
      hardwareProfileId: null,
      hardwareSnapshot: makeHardwareSnapshot(),
      primaryGameVersionId: null,
      mode: "standard",
      environment: makeEnvironmentFingerprint(),
      environmentClass: "pass",
      seed: testSeed(),
      ...versions,
    });

    const insert = (comfortLow: number, comfortHigh: number, confidence: number) =>
      db().execute(
        sql`insert into recommendations
              (id, session_id, verdict, comfort_range_low_cm360, comfort_range_high_cm360,
               constraint_source, confidence_index, confidence_breakdown, settings_reliability,
               response_curve, scoring_version_id, calibration_version_id, confidence_version_id)
            values (${newId()}, ${session.id}, 'indistinguishable', ${comfortLow}, ${comfortHigh},
               'none', ${confidence}, '{}'::jsonb, 'normal', '{}'::jsonb,
               ${versions.scoringVersionId}, ${versions.calibrationVersionId},
               ${versions.confidenceVersionId})`,
      );

    await expectDbFailure(insert(40, 20, 30), /comfort_range_ordered/);
    await expectDbFailure(insert(20, 40, 150), /confidence_range/);
    await insert(27.5, 35, 34);
  });

  it("refuses a peak_found recommendation with no recommended value — SENS-BR-017", async () => {
    const alice = asUser(await makeUser("peak@example.test"));
    const versions = await currentAlgorithmVersionIds();
    const session = await sessionRepo.createTestSession(alice, {
      hardwareProfileId: null,
      hardwareSnapshot: makeHardwareSnapshot(),
      primaryGameVersionId: null,
      mode: "standard",
      environment: makeEnvironmentFingerprint(),
      environmentClass: "pass",
      seed: testSeed(),
      ...versions,
    });

    await expectDbFailure(
      db().execute(
        sql`insert into recommendations
              (id, session_id, verdict, comfort_range_low_cm360, comfort_range_high_cm360,
               constraint_source, confidence_index, confidence_breakdown, settings_reliability,
               response_curve, scoring_version_id, calibration_version_id, confidence_version_id)
            values (${newId()}, ${session.id}, 'peak_found', 27.5, 35,
               'none', 79, '{}'::jsonb, 'normal', '{}'::jsonb,
               ${versions.scoringVersionId}, ${versions.calibrationVersionId},
               ${versions.confidenceVersionId})`,
      ),
      /peak_has_value/,
    );
  });
});

describe("algorithm version immutability — SENS-BR-029 / SENS-BR-020", () => {
  it("refuses to change released parameters", async () => {
    await expectDbFailure(
      db().execute(sql`update algorithm_versions set params = '{}'::jsonb where kind = 'scoring'`),
      /immutable once released/,
    );
  });

  it("refuses to change the recorded hash", async () => {
    await expectDbFailure(
      db().execute(
        sql`update algorithm_versions set params_hash = '\\x00'::bytea where kind = 'scoring'`,
      ),
      /immutable once released/,
    );
  });

  it("refuses deletion, so historical results stay explainable", async () => {
    await expectDbFailure(
      db().execute(sql`delete from algorithm_versions where kind = 'scoring'`),
      /never deleted/,
    );
  });

  it("still allows a version to be annotated or deprecated", async () => {
    await db().execute(
      sql`update algorithm_versions set notes = notes || '' where kind = 'scoring'`,
    );
  });
});

describe("least-privilege runtime role — SENS-SEC-015", () => {
  it("cannot create a table", async () => {
    await expectDbFailure(
      db().execute(sql`create table should_not_exist (id int)`),
      /permission denied/i,
    );
  });

  it("cannot truncate", async () => {
    await expectDbFailure(db().execute(sql`truncate table analytics_events`), /permission denied/i);
  });

  it("cannot drop a table", async () => {
    await expectDbFailure(db().execute(sql`drop table users`), /must be owner|permission/i);
  });

  it("can still read and write ordinary data", async () => {
    const userId = await makeUser("privileges@example.test");
    expect(await userRepo.findUserById(userId)).not.toBeNull();
  });
});

describe("support views", () => {
  it("exposes one flat row per session for diagnosis", async () => {
    await resetVolatileTables();
    const alice = asUser(await makeUser("views@example.test"));
    const versions = await currentAlgorithmVersionIds();
    await sessionRepo.createTestSession(alice, {
      hardwareProfileId: null,
      hardwareSnapshot: makeHardwareSnapshot({ dpi: 1600 }),
      primaryGameVersionId: null,
      mode: "standard",
      environment: makeEnvironmentFingerprint(),
      environmentClass: "pass",
      seed: testSeed(),
      ...versions,
    });

    const rows = (await db().execute(
      sql`select dpi, dpi_source, round_count, trial_count from v_session_overview`,
    )) as unknown as {
      dpi: number;
      dpi_source: string;
      round_count: string;
      trial_count: string;
    }[];

    expect(rows).toHaveLength(1);
    expect(rows[0]?.dpi).toBe(1600);
    expect(rows[0]?.dpi_source).toBe("known");
  });

  it("surfaces the raw-input state per session, which feeds EV-010", async () => {
    const rows = (await db().execute(
      sql`select raw_input_effective, browser from v_session_quality`,
    )) as unknown as { raw_input_effective: boolean; browser: string }[];
    expect(rows[0]?.raw_input_effective).toBe(true);
    expect(rows[0]?.browser).toBe("chrome");
  });
});

describe("indexes that deletes depend on", () => {
  afterAll(async () => {
    await closeDb();
  });

  it("gives every cascading foreign key an index to delete through", async () => {
    // Postgres enforces `on delete cascade` and `on delete set null` by running a query
    // against the *child* table once per parent row removed. Without an index on the
    // referencing column that query is a sequential scan, so deleting one account or expiring
    // one session scans whole tables — and the two operations that do this in bulk are the
    // ones that must not be slow: account deletion (`SENS-SEC-021`) and the retention sweep
    // (`SENS-BR-003`).
    //
    // Nothing in application code can catch this; it is a property of the schema, and it is
    // invisible until the tables are large, which is the worst time to discover it.
    const rows = await db().execute<{
      child: string;
      column_name: string;
      parent: string;
      on_delete: string;
    }>(sql`
      select c.conrelid::regclass::text as child,
             a.attname                  as column_name,
             c.confrelid::regclass::text as parent,
             case c.confdeltype when 'c' then 'cascade' else 'set null' end as on_delete
      from pg_constraint c
      join lateral unnest(c.conkey) with ordinality k(attnum, ord) on true
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
      where c.contype = 'f'
        and k.ord = 1
        and c.confdeltype in ('c', 'n')
        and not exists (
          select 1 from pg_index i
          where i.indrelid = c.conrelid and i.indkey[0] = k.attnum
        )
      order by 1, 2
    `);

    // `game_versions` is seeded reference data: rows are inserted by the seed and never
    // deleted, so the cascade cannot fire and an index would only cost writes. Every other
    // parent here is user data with a real delete path.
    const allowed = new Set(["game_versions"]);
    const offenders = rows
      .filter((row) => !allowed.has(row.parent))
      .map(
        (row) => `${row.child}.${row.column_name} -> ${row.parent} (on delete ${row.on_delete})`,
      );

    expect(
      offenders,
      "these deletes will sequentially scan the child table; add an index on the referencing column",
    ).toEqual([]);
  });
});
