# SensLab

A browser-based gaming mouse sensitivity **calibration** platform.

SensLab is not a sensitivity converter. It measures how a player actually aims across several
candidate sensitivities, identifies the physical range where that specific player performs
best, and translates the result into settings for the games they play.

> Stop copying someone else's settings. Find the sensitivity your hands actually perform best
> with.

---

## Status

**Phase 10 — UI/UX Polish and Responsive Experience.** The project follows a phased plan defined in
[`docs/phase-0/`](docs/phase-0/). What exists today is the foundation — architecture, database,
authentication, the pure-domain maths, CI — the engine that runs an aim session, all thirteen
aim tests doc 09 specifies with every metric doc 10 defines, the statistical engine that turns
those measurements into a response curve and a recommendation, the complete machinery for
turning that recommendation into a game setting, and — new in Phase 7 — the end-to-end loop a
player actually runs: `/calibrate` starts a blinded session, the server plans each round and
decides when to stop, and `/results/[id]` shows the recommendation as an **object, not a
number**, and — new in Phase 8 — the product **checks its own answer**: a blinded,
counterbalanced head-to-head against the sensitivity the player came in with, and a blinded
refinement inside the uncertainty around the recommendation.

**The calibration is deterministic statistics, not AI** (`SENS-BR-002`). It is a noisy
one-dimensional derivative-free search with a drift model, and it **refuses to invent a peak**:
a flat or indistinguishable response returns a range and says why (`SENS-BR-017`).

**It looks like an instrument, and it is honest about where it cannot run.** The register is a
calibration laboratory — near-black, hairline structure, uppercase micro-labels, tabular
numerals, exactly two accent hues, no card grid. Calibration is offered only where the
measurement can be honest: the gate is capability-based (fine pointer, hover, viewport, Pointer
Lock), so a tablet with a mouse passes and a phone is told plainly why it cannot, with every
reading surface still working on it (`SENS-BR-023`, FR-100).

**Results accumulate into a history that refuses to flatter you.** Sessions are attributed to
a hardware profile, and a comparison between two of them calls a change meaningful only when
the two high-performance ranges do not overlap — a stricter rule than a formal test, because a
fabricated progress narrative is the most tempting dishonesty a product like this has
available. A comparison whose sessions used different hardware, a different mode or a
different algorithm version is flagged and says specifically what differed (`SENS-BR-019`).

**SensLab is willing to report that its answer lost.** Validation is a confirmatory two-arm
test after an exploratory search, so the winner's curse does not go unchecked. The headline
verdict comes from the composite the calibration optimised and nothing else (`SENS-BR-016`);
every reported metric carries its interval, and a metric that could not be separated sits in
the same list at the same weight. If the recommendation loses, the page says so, keeps the
player's original as the standing value, reduces the confidence index by the documented
factor, and gives the two plausible causes equal weight.

**A result is a recommendation with its evidence attached.** The canonical value in counts
and cm/360, a high-performance range (the credible interval) and a wider comfort range (the
plateau the minimum detectable effect cannot separate), a seven-component **confidence index**
that is a diagnostic and never a probability (doc 15), six dimension scores against a
provisional reference with an **Aim DNA** profile classified by fixed rules and explained from
the measured numbers (`SENS-BR-036`), and the **response curve** with its bootstrap band. All of
it is persisted with the parameter-set versions that produced it, so it can be reproduced
exactly later (`SENS-BR-030`).

**The full test battery is built.** The six post-MVP tests — Wide Flick, Strafe Tracking, Slide
Tracking, Speed, Recoil Control and ADS — run through the same engine as the MVP seven, with
three engine extensions: piecewise analytic motion, a generated camera disturbance, and a
per-trial view change. Recoil patterns are **original and generated**; the ADS scope is
**SensLab's own simulation**. Scope Calibration is the calibration engine on a different
parameter (doc 13 §13.12) and is offered only for games with a verified scope roster — today,
none. Scoring moved to `scoring_model_v2`; v1 stays compiled for the results it produced.

**The game conversion machinery is complete and ships zero constants.** Both model forms, the
quantisation, the ADS/scope family, the verification gate, the re-check mechanism and the
settings surface are built and tested against fictional fixtures. No real game can be
converted, because no entry in the verification register has been closed — and the code is
now built so that a constant **cannot** be shipped without closing one (`SENS-BR-013`).

| Phase  | Scope                                          | State                                                               |
| ------ | ---------------------------------------------- | ------------------------------------------------------------------- |
| 0      | Product and engineering specification          | Complete — [`docs/phase-0/`](docs/phase-0/)                         |
| 1      | Application foundation                         | Complete — [report](docs/implementation/phase-1-completion.md)      |
| 2      | Aim test engine (Canvas, pointer lock, timing) | Complete — [report](docs/implementation/phase-2-completion.md)      |
| 3      | The MVP aim tests and their metrics            | Complete — [report](docs/implementation/phase-3-completion.md)      |
| 4      | Calibration and statistical engine             | Complete — [report](docs/implementation/phase-4-completion.md)      |
| 5      | Verified game adapters                         | Complete — [report](docs/implementation/phase-5-completion.md)      |
| 6      | Advanced aim tests                             | Complete — [report](docs/implementation/phase-6-completion.md)      |
| 7      | Results and Aim DNA                            | Complete — [report](docs/implementation/phase-7-completion.md)      |
| 8      | Validation and fine-tuning                     | Complete — [report](docs/implementation/phase-8-completion.md)      |
| 9      | Accounts, history, hardware profiles           | Complete — [report](docs/implementation/phase-9-completion.md)      |
| **10** | **UI/UX polish and the landing experience**    | **Complete** — [report](docs/implementation/phase-10-completion.md) |
| 11     | Hardening and release readiness                | Not started                                                         |

**There are no verified game conversions yet.** All five launch adapters are registered as
unverified and refuse to emit a number — see [Game verification](#game-verification).

---

## Getting started

### Requirements

- Node.js 20.11+ (22 recommended)
- Docker, for the local PostgreSQL instance
- npm 10+

### Setup

```bash
npm install

# Local PostgreSQL on port 5435 (5432/5433/5434 are commonly taken by other projects).
npm run db:up

cp .env.example .env.local
# Generate the two required secrets:
node -e "console.log('AUTH_SECRET=' + require('crypto').randomBytes(48).toString('base64url'))"
node -e "console.log('ABUSE_HASH_SALT=' + require('crypto').randomBytes(48).toString('base64url'))"
# Paste both into .env.local, replacing the placeholder values.

npm run db:migrate   # extensions, migrations, triggers, comments, support views
npm run db:roles     # least-privilege database roles
npm run db:seed      # metrics, algorithm versions, test definitions, games (all unverified)

npm run dev
```

Visit <http://localhost:3000>. The shell reads the game roster from the database and shows each
adapter's real verification state.

### Verify everything

```bash
npm run verify        # format, lint, typecheck, boundaries, secrets, unit + arch, build
npm run test:integration   # requires the database to be running
npm run test:e2e           # builds and starts the production server itself
```

---

## Scripts

| Script                                                 | What it does                                            |
| ------------------------------------------------------ | ------------------------------------------------------- |
| `npm run dev`                                          | Development server                                      |
| `npm run build` / `start`                              | Production build and server                             |
| `npm run lint` / `lint:fix`                            | ESLint, including the architecture boundary rules       |
| `npm run format` / `format:check`                      | Prettier                                                |
| `npm run typecheck`                                    | `tsc --noEmit` in strict mode                           |
| `npm test`                                             | Unit + architecture tests                               |
| `npm run test:unit` / `test:arch` / `test:integration` | Individual projects                                     |
| `npm run test:coverage`                                | Unit tests with the 90% branch gate on `core/`          |
| `npm run test:e2e`                                     | Playwright smoke suite against a production build       |
| `npm run check:boundaries`                             | Standalone architecture gate                            |
| `npm run check:secrets`                                | Scans source and built client chunks for leaked secrets |
| `npm run db:up` / `db:down`                            | Local PostgreSQL via Docker                             |
| `npm run db:generate`                                  | Generate a migration from the Drizzle schema            |
| `npm run db:migrate` / `db:roles` / `db:seed`          | Apply migrations, roles and seed data                   |
| `npm run db:studio`                                    | Drizzle Studio                                          |
| `npm run verify`                                       | The full local gate                                     |

---

## Architecture

Detailed in [`docs/phase-0/18-system-architecture.md`](docs/phase-0/18-system-architecture.md).
The short version:

```
src/
  app/              Next.js App Router. (marketing) (app) (lab) route groups + api/
  components/       Design-system primitives
  features/         Feature-scoped React, schemas and server actions
  services/         Use-case orchestration, transactions, authorisation
  repositories/     ALL SQL. Every function takes an ActorContext
  core/             PURE DOMAIN. No React, no Next, no database, no I/O
    statistics/     median, MAD, Wilson, weighted least squares, spline, bootstrap
    signal/         High-pass filter, zero-crossing rate, reversal counting
    sensitivity/    cm/360 <-> counts <-> degrees, FOV, the ADS matching family
    metrics/        The metric registry (doc 10)
    params/         Versioned algorithm parameter sets
    scoring/        Direction alignment, robust standardisation, the objective
    calibration/    Bracket, candidates, counterbalancing, drift, response surface
    types/  random/
  game-adapters/    The ONLY module that knows a game exists
  test-engine/      The aim engine. Runs outside React entirely
    timing/         Injected clock, frame-budget and hitch monitoring
    input/          Pointer lock, unadjustedMovement, coalesced samples
    render/         Angular camera, Canvas 2D renderer, the score-free HUD
    targets/        Seeded placement, analytic motion, hit resolution
    telemetry/      Pre-allocated ring buffers, the metric-derivation seam
    quality/        Environmental classification. Never touches a measurement
    tests/          The seven MVP test declarations. Data plus pure hooks
    metrics/        Every metric doc 10 defines, plus round aggregation
    plan/           Plans that run one test on its own
    mount.tsx       The ONLY React-aware file in the engine
  db/               Drizzle schema, migrations, SQL, seed
  lib/              env, errors, logger, crypto, email
```

### The boundaries that matter

Four rules, all **machine-enforced** by ESLint zones, an architecture test suite and a CI gate:

1. `core/` imports nothing else in `src/` and no framework. It is testable without a browser,
   a database, or Next.js.
2. `core/` never imports `game-adapters/`. The calibration engine cannot learn that a game
   exists.
3. `test-engine/` never imports React, `next/*`, or the DOM outside the three files whose
   subject is the browser ([ADR-020](docs/phase-0/32-decision-log.md)). `mount.tsx` is the
   single React boundary, and it hears from the engine at stage boundaries only — never per
   frame and never per trial.
4. All SQL lives in `repositories/`, and every repository function takes an actor so ownership
   is enforced in SQL rather than by a caller's good intentions.

Run `npm run check:boundaries` to verify.

### The canonical sensitivity model

`counts_per_360` — mouse counts for a full 360° turn — is the authoritative representation.
`cm/360` is a presentation derived from it using the session's DPI.

That ordering matters: DPI is self-reported and often wrong, so keeping counts canonical means
a recommendation stays valid when the DPI turns out to be wrong, and a corrected DPI
re-expresses history correctly without re-running anything. See
[`11-canonical-sensitivity-model.md`](docs/phase-0/11-canonical-sensitivity-model.md).

---

## Database

PostgreSQL 16, Drizzle ORM, 34 tables, 3 support views. Designed to be legible in a GUI client:
real foreign keys, enum types, CHECK constraints, and `COMMENT ON` for every table.

### Roles

| Role               | Privileges                                           | Used by                  |
| ------------------ | ---------------------------------------------------- | ------------------------ |
| `senslab_owner`    | Owns the objects                                     | Nothing connects as this |
| `senslab_migrator` | Full DDL                                             | The migration step only  |
| `senslab_app`      | SELECT/INSERT/UPDATE/DELETE. **No DDL, no TRUNCATE** | The application runtime  |
| `senslab_readonly` | SELECT on the support views only                     | Analytics and support    |

The integration suite runs as `senslab_app` deliberately: connecting as the owner would not
exercise the privileges production actually has.

### Migrations

Forward-only. `npm run db:migrate` applies three ordered, idempotent steps: extensions, the
generated Drizzle migrations, then the post-migration objects (immutability triggers, comments,
views). Never edit an applied migration — add a new one.

### DBeaver

1. **Database → New Database Connection → PostgreSQL**
2. Host `localhost`, Port `5435`, Database `senslab`
3. For schema browsing use `senslab_owner` / `senslab_dev_password`.
   To inspect what the application can actually see, connect as
   `senslab_app` / `senslab_app_password` instead — this is the more useful view when
   diagnosing a permissions question.
4. **Test Connection**, then **Finish**.

Useful once connected:

- The ER diagram (**Database Navigator → senslab → Schemas → public → ER Diagram**) is
  accurate, because every relationship is a real foreign key.
- Table and column comments carry the rule each column exists to enforce.
- The three support views give one flat row per session:
  `v_session_overview`, `v_recommendation_summary`, `v_session_quality`.

---

## Game verification

SensLab does not guess game constants.

A game is _supported for calibration_ the moment it appears in the selector — the calibration
is game-independent. It is _supported for conversion_ only once its sensitivity model has been
verified against an authoritative source **and** confirmed by measurement, with the evidence
recorded.

Until then the adapter returns `EXTERNAL_VERIFICATION_REQUIRED` and **no number is rendered
anywhere** — not greyed out, not approximate, not behind a disclaimer. An incorrect converted
value is worse than none, because it gets copied into a game and trusted.

Current state: **15 open verification items, 0 verified.** See
[`36-external-verification-register.md`](docs/phase-0/36-external-verification-register.md) and
[`08-supported-games.md`](docs/phase-0/08-supported-games.md) §8.5 for the procedure. The same
register lives in code at `src/game-adapters/verification/register.ts`, and a test asserts the
two agree.

**How a constant gets shipped.** Since Phase 5 the register is machine-enforced:

1. Perform the procedure in doc 08 §8.5 and record the raw readings — a cm/360 at a known DPI
   and a known setting, at two widely separated settings at least.
2. Close the register entry with evidence: build, date, two sign-offs, the readings.
3. Build the adapter with `createVerifiedAdapter`. It **refuses to construct** if the entry is
   still open, if fewer than two distinct settings were measured, or if the declared model does
   not reproduce the readings within ±0.5%.
4. Register it. The conformance suite (`tests/helpers/adapter-conformance.ts`) covers every
   registered adapter automatically — all eight test classes from doc 12 §12.8, including the
   golden-vector replay of the recorded measurements.

Verification decays: a scope older than six months, or hit by a reported game update, drops to
`needs_recheck` and serves values behind a "last verified" disclosure. A confirmed mismatch
drops it to `unverified` and it serves nothing. The overlay is applied inside the adapter, so
no surface can opt out. `/games` publishes the whole register.

---

## Testing

| Layer        | Tool                     | What it covers                                                             |
| ------------ | ------------------------ | -------------------------------------------------------------------------- |
| Unit         | Vitest                   | `core/`, `game-adapters/` and `test-engine/`. Gated at 90% branch coverage |
| Architecture | Vitest                   | Module boundaries, determinism, secret hygiene                             |
| Integration  | Vitest + real PostgreSQL | Ownership, constraints, triggers, ingest idempotency, auth                 |
| E2E          | Playwright               | Every screen, plus an axe scan, a responsive audit and the touch gate      |

Playwright serves the production build on port 3000 by default. If another app holds that port,
set `PLAYWRIGHT_PROD_PORT` (and `PLAYWRIGHT_DEV_PORT` for the `lab` project) — the config will
otherwise reuse whatever is listening there.

The results specs need real recommendations to look at. Playwright's global setup runs
`scripts/e2e-fixtures.ts` against the database: it creates a fixture account and drives real
calibration sessions with a synthetic player until it has one result of each kind it needs —
a peak worth validating, a flat session, and one that has been through the validation test —
then writes the ids to `test-results/e2e-fixtures.json`. The fixture account also gets a saved
hardware profile, so the history and profile screens have something real to render. The seed is **searched, not pinned**:
a verdict is a property of the data, so a change to the player or a parameter set would break
a pinned seed with a mystifying error. The database must be up for `npm run test:e2e`.

**Accessibility runs every time.** An axe scan (WCAG 2.1 A and AA) covers every page and every
result state, alongside keyboard, landmark, focus-indicator and canvas-description checks, and
a responsive pass asserts no surface scrolls the page sideways at any breakpoint. Doc 28 is
explicit that automated tooling catches perhaps half of what matters; the manual passes it
schedules are still scheduled.

Sign-in is rate limited per IP and per account (`SENS-SEC-011`). The suite signs in **once**,
in a `setup` project, and every spec that needs the account reuses that storage state; specs
that need a signed-out browser opt out with `test.use({ storageState: … })`.

The engine is tested through a **headless deterministic harness**: the real engine, driven by a
scripted clock and a scripted input source with a recording renderer. That is what makes it
possible to assert things a browser cannot be asked to do on demand — a frame delivered exactly
140 ms late, or the same physical input replayed at 60 Hz and 240 Hz to prove the hit decision
is identical (doc 19 §19.12).

Metrics are tested against **hand-written movement traces** whose answers are known by hand.
That is the only way to show a metric computes the formula doc 10 defines rather than a
plausible neighbour — and a plausible neighbour is exactly what a metric bug looks like, because
nothing crashes and every number stays in range.

The browser layer covers only what needs a browser: real pointer lock, a real canvas, a real
`requestAnimationFrame`. The shipping surfaces are at `/test`; `/lab/engine` is a
development-only harness that returns 404 in a production build.

The effort is deliberately concentrated in `core/`. A bug there produces a plausible,
confident, wrong number — nothing crashes and nothing looks broken — which is the failure mode
this product can least afford. Detailed in
[`29-testing-strategy.md`](docs/phase-0/29-testing-strategy.md).

---

## Phase workflow

Phases are executed one at a time. Each ends with a completion report under
[`docs/implementation/`](docs/implementation/) and a stop for review; the next phase begins
only on explicit approval.

Within a phase:

- Phase 0 is the source of truth. Where implementation reality conflicts with it, the conflict
  is investigated, documented and resolved — never silently contradicted.
- No work belonging to a later phase is started early.
- Deferred items are recorded in the completion report rather than half-built.

---

## Engineering rules

- TypeScript strict, with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. No
  `any`. No suppressed errors.
- No `Math.random()` anywhere in the domain — every draw is seeded and reproducible.
- No game constant outside `game-adapters/`.
- Algorithm parameters are versioned, immutable data, verified by hash at boot. Released sets
  are insert-only, enforced by a database trigger.
- Raw pointer telemetry is never persisted by default.
- Ownership is enforced server-side in SQL; a resource the actor does not own returns 404,
  never 403.

---

## Licence

Not yet determined.
