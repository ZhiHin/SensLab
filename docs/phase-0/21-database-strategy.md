# 21 — Database Strategy

Related: [20-data-model.md](20-data-model.md) · [23-security-and-privacy.md](23-security-and-privacy.md) · [22-telemetry-strategy.md](22-telemetry-strategy.md)

---

## 21.1 Platform

PostgreSQL 16+ (or the current stable major at Phase 1). Reasons recorded in ADR-002 and
ADR-003; briefly: relational integrity is load-bearing in this schema, the workload is
write-bursty and read-simple, `jsonb` covers the few genuinely schemaless fields, and it is
operable by one person.

Extensions used: `citext` (case-insensitive email), `pgcrypto` (`gen_random_uuid()` as a
fallback; UUIDs are normally generated application-side for v7 ordering).

---

## 21.2 Migrations

- **Drizzle Kit** generates SQL migrations from the schema definitions; the generated SQL is
  reviewed and committed, never applied blind.
- Migrations are **forward-only** in production. A mistake is corrected by a new migration.
  Down-migrations exist only for local development.
- **Expand → migrate → contract** for any change touching a populated table:
  1. Add the new column/table (nullable, defaulted).
  2. Backfill in batches.
  3. Deploy code that writes both / reads new.
  4. A later migration adds the constraint and drops the old column.
- **No long locks.** `CREATE INDEX CONCURRENTLY`, `ADD CONSTRAINT ... NOT VALID` followed by
  `VALIDATE CONSTRAINT`, and `SET lock_timeout` on every migration session.
- Every migration is run against a restored copy of production-shaped data in CI before it
  can merge (once such data exists; before that, against a seeded volume fixture).

**Special rule for `algorithm_versions`:** rows are insert-only, enforced by a trigger
(`SENS-BR-029`). A "change" to a released model is a new row and a new `version_label`, never an
`UPDATE`. The trigger permits updates only to `deprecated_at` and `notes`.

---

## 21.3 Roles and least privilege

| Role | Grants | Used by |
|---|---|---|
| `senslab_app` | `SELECT, INSERT, UPDATE, DELETE` on application tables; `USAGE` on sequences. **No DDL.** | The Next.js runtime |
| `senslab_migrator` | Full DDL on the `public` schema | The migration job only, in a separate deploy step |
| `senslab_readonly` | `SELECT` on non-PII views | Analytics, dashboards, support |
| `senslab_owner` | Owns objects | Never used for connections |

- No connection ever uses a superuser.
- `senslab_app` has no `DROP`, no `TRUNCATE`, no `CREATE`.
- `senslab_readonly` sees views, not base tables, with email and hashes excluded.

**Row-level security:** not enabled at MVP. Rationale (ADR-013): with pooled connections and a
single application role, RLS requires per-request `SET LOCAL` of a session variable and careful
pool handling. The equivalent protection is achieved deterministically in the repository layer
(every query filters by actor, enforced by signature and by an automated cross-tenant test suite),
and that mechanism is testable without database configuration. RLS is reconsidered if a second
consumer (a desktop app, an analytics service) ever gets direct database access — at which point
it becomes clearly worth the cost.

---

## 21.4 Connections and pooling

- Server-side connection pool sized to the deployment's concurrency, with `statement_timeout`
  (default 10 s) and `idle_in_transaction_session_timeout` (30 s) set at the role level.
- The ingest route handler uses short transactions only; a round write is a single transaction
  containing the round, its trials and its metrics (`SENS-NFR-020`).
- No transaction spans a network call to anything else.

---

## 21.5 DBeaver operability

The schema is designed to be legible in a GUI client, which is a real constraint, not a
courtesy:

- Real foreign keys everywhere, so DBeaver's ER diagram is accurate and navigable.
- Enum types rather than magic integers, so raw rows are readable.
- `COMMENT ON TABLE` / `COMMENT ON COLUMN` for every table and every non-obvious column,
  generated from the schema definitions — the documentation lives in the database.
- Aggregates (`round_metrics`, `candidate_scores`, `recommendations`) are readable without
  joining trial-level data, so support and debugging rarely need a complex query.
- Read-only support views: `v_session_overview`, `v_recommendation_summary`,
  `v_session_quality` — each a single flat row per session, designed for someone diagnosing a
  user report.

---

## 21.6 Data volume and growth

Per completed **Standard** session:

| Table | Rows | Est. bytes |
|---|---|---|
| `test_sessions` | 1 | ~3 KB (mostly the environment + hardware JSONB) |
| `calibration_candidates` | ~10 | ~2 KB |
| `calibration_rounds` | 3 | ~2 KB |
| `test_rounds` | ~50 | ~10 KB |
| `test_trials` | ~450 | ~90 KB |
| `trial_metrics` | ~4,000 | ~120 KB |
| `round_metrics` | ~450 | ~30 KB |
| `candidate_scores` | ~60 | ~5 KB |
| `recommendations` (+ children) | 1 + ~20 | ~25 KB (response curve JSONB dominates) |
| **Total** | **~5,000 rows** | **~290 KB** |

Slightly above the `SENS-NFR-021` target of 250 KB; the overage is the `response_curve` and
`environment` JSONB. Mitigation if it matters: the response curve is derivable and could be
recomputed rather than stored. **Decision: keep it stored.** Rendering the result page must not
require re-running the fit, and 25 KB per session is a good trade for a fast, always-available
result view. `SENS-NFR-021` is amended to 300 KB and the reason recorded here.

Projection:

| Completed sessions | Trial rows | Metric rows | Approx. size |
|---|---|---|---|
| 10,000 | 4.5 M | 40 M | ~3 GB |
| 100,000 | 45 M | 400 M | ~29 GB |
| 1,000,000 | 450 M | 4 B | ~290 GB |

**Partitioning trigger:** when `trial_metrics` exceeds ~200 M rows or the table exceeds ~50 GB,
partition `test_trials` and `trial_metrics` by `created_at` (monthly range). This is designed for
now and implemented then — the schema already has the partition key, and no query filters across
all trials, so partitioning is additive rather than disruptive. Documented as a Phase-11+ task
with a monitoring alert at 60% of the trigger.

**The cheaper lever first:** trial-level data is only needed to *recompute* a recommendation
(`SENS-BR-030`). A tiered policy — trial rows for registered users retained hot for 12 months,
then archived to compressed object storage with the recompute path reading from the archive —
would cut the hot dataset by an order of magnitude. Recorded as the preferred first response to
growth, ahead of partitioning.

---

## 21.7 Backups and recovery

| Aspect | Policy |
|---|---|
| Backups | Automated daily full + continuous WAL archiving (managed-platform PITR) |
| Retention | 30 days point-in-time |
| RPO | ≤ 5 minutes |
| RTO | ≤ 2 hours |
| Restore test | Quarterly, to a scratch instance, with a scripted verification query set. A backup that has never been restored is not a backup. |
| Object storage (telemetry) | Versioning off, lifecycle rules on; loss is acceptable — it is regenerable research data, never operational data |

---

## 21.8 Environments

| Environment | Data | Notes |
|---|---|---|
| Local | Docker Postgres, seeded fixtures | `pnpm db:seed` populates games, adapters, algorithm versions, metric definitions and a synthetic completed session |
| CI | Ephemeral Postgres per run | Migrations run from empty every time; integration tests use transactional rollback per test |
| Preview | Shared instance, synthetic data only | Never a copy of production |
| Production | Managed Postgres, private networking, TLS required | |

**No production data is ever copied to a non-production environment.** Debugging a user's session
uses an anonymised export produced by a support tool that strips identity while preserving the
measurement data — which is possible precisely because measurement data contains no PII.

---

## 21.9 Seed data

Seeds are code-reviewed and idempotent:

1. `metric_definitions` — the metric registry from doc 10.
2. `test_definitions` — the seven MVP tests.
3. `algorithm_versions` — `scoring_model_v1`, `calibration_model_v1`, `confidence_model_v1`,
   `aim_profile_rules_v1`, `reference_dist_provisional_v1`, each with its parameter set and hash.
4. `aim_profiles` — the eight profile keys with localised names.
5. `games` + `game_versions` + `game_scopes` + `game_sensitivity_models` — the five launch games,
   **all with `verification_status = 'unverified'` until verification is completed**.

Point 5 matters: the seed ships the games as unverified. Verification flips them, deliberately
and traceably, and the product behaves correctly in the meantime (doc 04 §4.4.11).

---

## 21.10 Monitoring

| Signal | Alert |
|---|---|
| Connection pool saturation | > 80% for 5 min |
| p95 query latency by statement class | Above the `SENS-NFR-013` budget |
| Replication/WAL lag | Above platform threshold |
| Table and index bloat | Weekly report; `autovacuum` tuning on `test_trials`/`trial_metrics` |
| Growth against the partitioning trigger | Weekly |
| Failed migrations | Immediate |
| Retention job outcomes | Daily summary — a silently failing retention job is a privacy incident |

`autovacuum` needs explicit attention on `trial_metrics`: it is append-heavy with bulk deletes
from retention sweeps, which is the classic bloat pattern. Per-table `autovacuum_vacuum_scale_factor`
is lowered for it in the initial configuration.
