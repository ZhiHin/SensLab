# 34 — Phase 1 Backlog

Related: [18-system-architecture.md](18-system-architecture.md) · [20-data-model.md](20-data-model.md) · [29-testing-strategy.md](29-testing-strategy.md)

---

## 34.1 Phase 1 goal and boundary

**Goal:** a running, deployable, tested foundation — project, architecture, database,
authentication, the two pure-domain interfaces (game adapters and the test engine), and CI —
with **no aim tests and no calibration algorithm implemented**.

**Phase 1 is done when** a developer can clone the repository, run one command, get a working
application with a real database, sign up, create a hardware profile, create an empty session,
and see every CI gate pass — and when the boundaries that make the rest of the project possible
are mechanically enforced.

**Explicitly out of scope for Phase 1:** the canvas renderer, pointer lock, any aim test, the
calibration engine, scoring, confidence, recommendations, results pages, and any real game
adapter constants.

---

## 34.2 Backlog

Estimates are in ideal engineering days for one experienced developer. `[D]` marks items on the
critical path.

### Epic A — Project foundation (≈ 4 d)

| # | Item | Est | Notes |
|---|---|---|---|
| A1 `[D]` | Initialise Next.js (App Router) + TypeScript strict | 0.5 | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| A2 `[D]` | Directory structure per doc 18 §18.3 with placeholder modules | 0.5 | Structure exists before code fills it |
| A3 `[D]` | ESLint + Prettier + boundary zone rules | 1.0 | `import/no-restricted-paths` for `core/`, `game-adapters/`, `test-engine/`, `repositories/` |
| A4 | Tailwind + design tokens as CSS custom properties | 1.0 | Tokens only; no components yet |
| A5 `[D]` | Environment variable schema, validated at startup | 0.5 | Startup failure on missing/invalid |
| A6 | Route groups `(marketing)`, `(app)`, `(lab)` with layouts | 0.5 | `(lab)` layout with no chrome, no streaming |

**Exit:** `pnpm build`, `pnpm lint`, `tsc --noEmit` clean. A test proves `core/` cannot import
`game-adapters/`.

### Epic B — Database (≈ 6 d)

| # | Item | Est | Notes |
|---|---|---|---|
| B1 `[D]` | Drizzle schema for every table in doc 20 | 2.5 | Including enums, CHECKs, partial indexes |
| B2 `[D]` | Initial migration, reviewed SQL | 0.5 | |
| B3 | `COMMENT ON` generation for tables and columns | 0.5 | doc 21 §21.5 |
| B4 `[D]` | Local Postgres via Docker + connection module | 0.5 | |
| B5 `[D]` | Seeds: metric definitions, test definitions, algorithm versions, aim profiles, five games as **unverified** | 1.5 | doc 21 §21.9 |
| B6 | `algorithm_versions` immutability trigger | 0.5 | `SENS-BR-029` |
| B7 | Support views (`v_session_overview`, `v_recommendation_summary`, `v_session_quality`) | 0.5 | |
| B8 | Database roles and grants script | 0.5 | `senslab_app` has no DDL |

**Exit:** migrations run from empty in CI; seeds are idempotent; the DBeaver ER diagram is
navigable; a constraint-violation test suite passes.

### Epic C — Data access and services skeleton (≈ 4 d)

| # | Item | Est | Notes |
|---|---|---|---|
| C1 `[D]` | `ActorContext` type and resolution from the session cookie | 0.5 | |
| C2 `[D]` | Repository layer conventions + user, hardware, session repositories | 2.0 | Every function takes `Actor` first |
| C3 `[D]` | Generated cross-tenant authorisation test harness | 1.0 | Enumerates owned resources; new endpoints are covered automatically |
| C4 | Error taxonomy and typed error responses | 0.5 | 404-not-403 for unowned resources |

**Exit:** cross-tenant suite passes; a signature test asserts every exported repository function
accepts `Actor`.

### Epic D — Authentication (≈ 6 d)

| # | Item | Est | Notes |
|---|---|---|---|
| D1 `[D]` | Argon2id hashing with benchmarked parameters | 0.5 | Benchmark on the deploy target |
| D2 `[D]` | Registration + email verification | 1.5 | Single-use hashed tokens |
| D3 `[D]` | Sign-in, sign-out, opaque session cookies | 1.0 | `__Host-` prefix, hashed at rest |
| D4 | Password reset | 1.0 | Invalidates all sessions on use |
| D5 `[D]` | Guest session issuance + the claim flow | 1.0 | Cookie-only, transactional, idempotent |
| D6 | Rate limiting (Postgres fixed-window) on auth endpoints | 0.5 | |
| D7 | Enumeration resistance (uniform responses and timing) | 0.5 | |

**Exit:** integration tests for every flow, including timing-based enumeration resistance and the
guest-claim edge cases (expired, already claimed, body-supplied id rejected).

### Epic E — Core domain interfaces (≈ 5 d)

| # | Item | Est | Notes |
|---|---|---|---|
| E1 `[D]` | `core/statistics`: median, MAD, robust CV, Wilson, WLS, natural cubic spline, seeded bootstrap | 2.0 | Fully tested; used by everything later |
| E2 `[D]` | `core/sensitivity`: cm/360 ↔ counts ↔ degrees, FOV, the MDC family | 1.0 | Pure maths from doc 11, with the two analytic limits tested |
| E3 `[D]` | `core/types`: metric, trial, round, candidate, session-plan types | 0.5 | The vocabulary every later phase uses |
| E4 `[D]` | Game adapter **interface** + registry + verification gate | 1.0 | No real constants; one fixture adapter for tests |
| E5 `[D]` | Test-engine `TestDefinition` interface + plan types | 0.5 | No engine implementation |

**Exit:** `core/` is 100% pure (CI-enforced); statistics and sensitivity modules at ≥ 90% branch
coverage; the verification gate throws for the unverified fixture adapter.

### Epic F — Algorithm parameter infrastructure (≈ 2 d)

| # | Item | Est | Notes |
|---|---|---|---|
| F1 `[D]` | Versioned parameter-set loader with hash verification at boot | 1.0 | Mismatch = startup failure |
| F2 | v1 parameter sets committed as data (scoring, calibration, confidence, aim-profile, reference) | 1.0 | Values from docs 13–16; unimplemented consumers, but the data exists and is validated |

**Exit:** boot fails on a tampered parameter set; a test asserts the hash matches
`algorithm_versions`.

### Epic G — Session lifecycle skeleton (≈ 3 d)

| # | Item | Est | Notes |
|---|---|---|---|
| G1 `[D]` | `createSession` server action: seed, hardware snapshot, environment, version pinning | 1.0 | No plan generation yet — a stub plan |
| G2 `[D]` | Round ingest route handler with idempotency + Zod + semantic validation | 1.5 | Accepts synthetic rounds in Phase 1 |
| G3 | Abandonment sweeper + guest expiry jobs | 0.5 | |

**Exit:** a synthetic session can be created, three synthetic rounds ingested (replayed for
idempotency), and the session completed — all through the real code path.

### Epic H — CI and quality gates (≈ 4 d)

| # | Item | Est | Notes |
|---|---|---|---|
| H1 `[D]` | CI pipeline per doc 29 §29.9 | 1.5 | |
| H2 `[D]` | Ephemeral Postgres in CI + integration harness | 0.5 | |
| H3 | Coverage gate on `core/` and `game-adapters/` | 0.5 | |
| H4 | Structural checks: no game constants outside adapters, no `NEXT_PUBLIC_` secrets, no new lint suppressions | 1.0 | |
| H5 | Bundle size + Lighthouse budgets (placeholder pages) | 0.5 | |

**Exit:** every gate in doc 29 §29.9 exists and blocks; a deliberately-violating PR is rejected
by each one.

### Epic I — Minimal UI shell (≈ 4 d)

| # | Item | Est | Notes |
|---|---|---|---|
| I1 | Design-system primitives: button, input, panel, readout, label, status pill | 2.0 | Tokens applied; no product screens |
| I2 | App shell: header, footer, custom scrollbar, focus styles | 1.0 | |
| I3 | Auth screens (SCR-060–063) | 1.0 | Real, not placeholder — they are Phase 1 deliverables |

**Exit:** auth screens pass axe and a keyboard walkthrough.

### Epic J — Verification groundwork (≈ 3 d, parallelisable)

| # | Item | Est | Notes |
|---|---|---|---|
| J1 `[D]` | **Begin CS2 verification (`EV-001`)** | 2.0 | Started in Phase 1, not Phase 5 (doc 31 §31.3) |
| J2 `[D]` | **Resolve `EV-010`: `unadjustedMovement` browser matrix** | 1.0 | Determines the support matrix and possibly onboarding copy |

**Exit:** register entries updated with real findings, even if the conclusion is "not yet
verified".

---

## 34.3 Summary and sequencing

| Epic | Days | Depends on |
|---|---|---|
| A Foundation | 4 | — |
| B Database | 6 | A |
| C Data access | 4 | B |
| D Authentication | 6 | C |
| E Core interfaces | 5 | A (parallel with B/C) |
| F Parameters | 2 | B, E |
| G Session skeleton | 3 | C, F |
| H CI | 4 | A (grows throughout) |
| I UI shell | 4 | A, D |
| J Verification | 3 | — (fully parallel) |
| **Total** | **≈ 41 ideal days** | |

Realistic calendar for one developer: **7–9 weeks**. For two, with E/J parallelised against
B/C/D: **4–5 weeks**.

**Critical path:** A → B → C → D → G, with E feeding F feeding G.

**Start immediately and in parallel:** J1 and J2. Both are blocking for later phases, neither
depends on any code, and both have long lead times because they involve external systems and
manual measurement.

---

## 34.4 Phase 1 exit criteria

- [ ] `pnpm install && pnpm db:up && pnpm db:migrate && pnpm db:seed && pnpm dev` produces a
      working application from a clean clone
- [ ] A user can register, verify, sign in, reset a password, and sign out
- [ ] A guest session is issued, and claiming it on registration works and is idempotent
- [ ] A hardware profile can be created, edited and set as default
- [ ] A session can be created with a hardware snapshot, environment, seed and pinned versions
- [ ] Synthetic rounds can be ingested idempotently and transactionally
- [ ] `core/` and `game-adapters/` are pure and boundary-enforced by CI
- [ ] The adapter registry loads, and the fixture adapter throws when unverified
- [ ] Parameter sets load with hash verification; boot fails on mismatch
- [ ] The generated cross-tenant authorisation suite passes
- [ ] Every constraint in doc 20 is exercised by a violating-insert test
- [ ] Coverage on `core/` ≥ 90% branch
- [ ] Every CI gate in doc 29 §29.9 exists and blocks
- [ ] Auth screens pass axe and a keyboard walkthrough
- [ ] `EV-010` resolved; `EV-001` in progress with findings recorded
- [ ] No `any`, no lint suppression, no `@ts-expect-error` without a linked issue
- [ ] **No aim test, calibration algorithm, or real game constant exists in the codebase**

The last item is a genuine exit criterion. Phase 1 is about making the later phases cheap and
safe; implementing them early would skip the boundary work that makes them cheap and safe.

---

## 34.5 Open decisions for Phase 1 kickoff

Small, non-blocking choices deliberately left to implementation:

| Decision | Options | Recommendation |
|---|---|---|
| Package manager | pnpm / npm / bun | pnpm — workspace-ready, strict resolution |
| Hosting | Vercel / Fly / Railway / self-hosted | Vercel for the app + a managed Postgres; the Node runtime is required for route handlers |
| Email delivery | Resend / Postmark / SES | Any; abstract behind one interface so it is swappable |
| Object storage | S3 / R2 | R2 — no egress fees, and telemetry is write-heavy, read-rare |
| UUID generation | `uuidv7` package / custom | A v7 library, for index locality |
| Argon2 binding | `@node-rs/argon2` / `argon2` | `@node-rs/argon2` — no native build step |
| Job scheduling | Platform cron / a cron route with a shared secret | Platform cron where available |
| i18n library | `next-intl` / custom catalogues | `next-intl` |

None of these change the architecture. Each should be recorded as a short ADR when chosen.
