# 18 — System Architecture

Related: [19-test-engine-architecture.md](19-test-engine-architecture.md) · [20-data-model.md](20-data-model.md) · [23-security-and-privacy.md](23-security-and-privacy.md) · [32-decision-log.md](32-decision-log.md)

---

## 18.1 Shape of the system

A single Next.js application, one PostgreSQL database, one object store for optional telemetry.
No microservices, no message queue, no separate API server at MVP — the workload does not justify
them and each would add a failure mode.

```
                    +---------------------------- browser ----------------------------+
                    |                                                                 |
                    |  (marketing) routes      (app) routes         (lab) route        |
                    |  RSC, mostly static      RSC + forms          CLIENT-ONLY shell  |
                    |                                |                    |            |
                    |                                |          +---------v---------+  |
                    |                                |          |   TEST ENGINE     |  |
                    |                                |          |  canvas + rAF     |  |
                    |                                |          |  pointer lock     |  |
                    |                                |          |  ring buffers     |  |
                    |                                |          |  NO React state   |  |
                    |                                |          +---------+---------+  |
                    |                                |                    | round      |
                    |                                |                    | aggregates |
                    +--------------------------------+--------------------+------------+
                                     |                                    |
                        Server Actions (mutations)            Route Handler (ingest, beacon)
                                     |                                    |
                    +----------------v------------------------------------v------------+
                    |                        NEXT.JS SERVER                            |
                    |   app/ route layer  -> services -> repositories -> Drizzle       |
                    |                            |                                     |
                    |                            +--> core/ (pure TS domain)           |
                    |                            +--> game-adapters/ (pure TS)         |
                    +------------------------------+-----------------------------------+
                                                   |
                             +---------------------+---------------------+
                             |                                           |
                       PostgreSQL                              Object storage
                    (all operational data)              (optional raw telemetry only)
```

---

## 18.2 Layers and their responsibilities

| Layer | Contains | May depend on | Must not |
|---|---|---|---|
| `app/` | Routes, layouts, pages, Server Actions, route handlers | `features/`, `lib/`, schemas | Contain business logic or SQL |
| `features/` | Feature-scoped React components, hooks, view models | `core/`, `lib/`, `components/` | Contain SQL, know about other features' internals |
| `components/` | Design-system primitives | `lib/` only | Know about domain concepts |
| `services/` | Use-case orchestration, transactions, authorisation | `core/`, `repositories/`, `game-adapters/` | Import React or Next |
| `repositories/` | All SQL, all Drizzle queries, ownership filtering | `db/`, `core/types` | Contain business rules |
| `core/` | **Pure domain**: statistics, scoring, calibration, sensitivity maths, metrics | nothing outside `core/` and stdlib | Import React, Next, Drizzle, `game-adapters`, or perform I/O |
| `game-adapters/` | Per-game conversion modules and the registry | `core/sensitivity`, `zod` | Import anything else, perform I/O |
| `test-engine/` | Canvas runtime, input, timing, target system, metric collection | `core/` | Import React (except one thin mount adapter), perform network I/O |
| `db/` | Schema definitions, migrations, connection | Drizzle | Contain queries |
| `lib/` | Cross-cutting utilities, env parsing, logging, i18n | — | Contain domain logic |

**The two rules that matter most:**

1. `core/` and `game-adapters/` are pure, dependency-free TypeScript. They can be unit-tested
   without a browser, a database, or a framework, and they are where every consequential
   decision in this product is made.
2. `core/` must never import `game-adapters/` (doc 12 §12.1).

---

## 18.3 Directory structure

```
src/
  app/
    (marketing)/
      page.tsx                     SCR-001 landing
      how-it-works/page.tsx        SCR-002 methodology
    (app)/
      layout.tsx                   app chrome, header, footer
      calibrate/
        game/page.tsx              SCR-010
        hardware/page.tsx          SCR-011
        environment/page.tsx       SCR-012
        intro/page.tsx             SCR-013
      results/[recommendationId]/
        page.tsx                   SCR-031
        settings/page.tsx          SCR-032
      history/page.tsx             SCR-041
      history/compare/page.tsx     SCR-042
      hardware-profiles/page.tsx   SCR-043
      profile/page.tsx             SCR-044
      settings/page.tsx            SCR-045
      auth/...                     SCR-060..063
    (lab)/
      layout.tsx                   NO chrome, no nav, fullscreen
      run/[sessionId]/page.tsx     SCR-014..023 - one route, engine-driven stages
    api/
      sessions/[id]/rounds/route.ts    round aggregate ingest (POST, idempotent)
      sessions/[id]/events/route.ts    sendBeacon target for abandonment
      health/route.ts
  features/
    auth/  hardware/  games/  calibration/  results/  history/  settings/
  components/                      design system primitives
  services/
    session-service.ts  recommendation-service.ts  hardware-service.ts
    auth-service.ts     history-service.ts         conversion-service.ts
  repositories/
    session-repo.ts  trial-repo.ts  recommendation-repo.ts  user-repo.ts ...
  core/
    statistics/      median, MAD, bootstrap, Wilson, WLS, spline
    metrics/         metric registry, per-trial derivations
    scoring/         normalisation, dimensions, objective
    calibration/     bracket, candidates, drift model, response surface, stopping
    confidence/      the seven components and composition
    recommendation/  assembly, ranges, aim-profile classifier
    sensitivity/     cm360 <-> counts <-> deg, FOV, MDC family
    types/
  game-adapters/
    registry.ts
    cs2/  apex-legends/  pubg/  delta-force-global/  delta-force-cn/
  test-engine/
    engine.ts  session-controller.ts  trial-manager.ts
    input/  timing/  render/  targets/  telemetry/  quality/
    definitions/    declarative test definitions
  db/
    schema/  migrations/  client.ts  seed/
  hooks/  lib/  styles/
docs/
  phase-0/ ...
```

**Deviation from the suggested structure in the brief**, with rationale:

| Suggested | Used | Why |
|---|---|---|
| `features/tests/` | `test-engine/` (top level) | The engine is not a React feature. Making it a sibling of `core/` makes its independence from React structural rather than aspirational, and lets it be tested headlessly. |
| `calibration-engine/`, `scoring/` as top-level siblings | folded into `core/` | They share statistics, types and the versioned parameter set. Splitting them across top-level directories would either duplicate the shared layer or create a circular relationship. One `core/` with clear submodules expresses "pure domain" better than three sibling directories. |
| — | `services/` + `repositories/` added | The brief's layout has no home for authorisation, transactions or SQL. Without these, that logic lands in Server Actions, which is exactly the "massive route files" the brief forbids. |
| `types/` top level | `core/types/` | Domain types belong with the domain; feature-local types stay local. |

---

## 18.4 Where each technology is used

| Concern | Choice | Rationale |
|---|---|---|
| Page rendering | React Server Components by default | Result and history pages are data-heavy and read-mostly; RSC removes a client fetch waterfall |
| The lab route | Client component shell, engine outside React | Measurement fidelity (`SENS-NFR-004`) |
| Mutations (CRUD, auth, profile, session lifecycle) | **Server Actions** | Colocated, typed, progressive-enhancement friendly, built-in origin checking |
| Round aggregate ingest | **Route Handler** | Needs idempotency keys, explicit status codes, retry semantics, and `navigator.sendBeacon` compatibility on unload — none of which Server Actions serve well |
| Abandonment/exit signal | Route Handler + `sendBeacon` | Must survive page unload |
| Validation | **Zod**, one schema per boundary, shared client/server | `SENS-NFR-029` |
| Data access | **Drizzle** | Typed SQL that stays SQL; migrations are readable; no hidden N+1 (ADR-003) |
| Styling | **Tailwind** + CSS custom properties for tokens | Tokens in CSS variables so the canvas can read the same palette |
| Animation | **Motion (Framer Motion)** for UI; **none** inside the lab route | `SENS-BR-021` |
| Charts | Custom SVG/Canvas in `features/results` | The response curve and Aim DNA are bespoke (doc 25) |
| i18n | Message catalogues + `next-intl`-style routing | en, zh-Hans at MVP |
| Background work | Scheduled job runner (retention sweeps, session expiry) | Small enough for a cron-triggered route or a platform scheduler; no queue at MVP |

---

## 18.5 Enforced boundaries

Architecture that is only documented is not architecture. Each rule below has a mechanism.

| Rule | Mechanism |
|---|---|
| `core/` imports nothing outside `core/` | ESLint `import/no-restricted-paths` zone + a CI test that walks the import graph |
| `core/` never imports `game-adapters/` | Same |
| `test-engine/` never imports React (except `mount.tsx`) | ESLint zone with a single-file exception |
| No game constants outside `game-adapters/` | Grep check in CI with a reviewed allowlist |
| No SQL outside `repositories/` | ESLint restriction on importing `db/` |
| Every repository function takes an `ActorContext` | Type-level: repository functions accept `Actor` as their first parameter; a test asserts the signature for every exported function |
| No `Date.now()` in `test-engine/` | ESLint `no-restricted-globals` |
| No `any` | `@typescript-eslint/no-explicit-any` as error |

---

## 18.6 The session lifecycle across the stack

```
1. POST (server action) createSession(gameVersionId, hardware, mode)
     - server generates seed, snapshots hardware, records environment
     - returns sessionId + the full SESSION PLAN (candidates are server-generated,
       blind labels assigned server-side, real cm/360 values sent to the client
       because the engine needs them - see s18.7)
2. Client navigates to (lab)/run/[sessionId]
3. Engine runs practice -> baseline -> rounds
4. After each round: POST /api/sessions/:id/rounds
     - body: round aggregates + trial rows + quality summary
     - header: Idempotency-Key = `${sessionId}:${presentationOrder}`
     - server validates with Zod, writes in one transaction
5. Between rounds the client requests the next round's candidates
     - the ADAPTIVE step runs SERVER-SIDE (s18.7)
6. On completion: POST completeSession
     - server recomputes scoring + calibration + confidence from stored trials
     - writes recommendation + derived game settings
7. Client navigates to /results/[recommendationId]
```

---

## 18.7 Where the calibration actually runs — and why

**Decision: the adaptive step runs server-side; per-trial metric derivation runs client-side.**

| Stage | Where | Why |
|---|---|---|
| Per-frame/per-input capture | Client, in ring buffers | Must be; latency |
| Per-trial metric derivation | Client, between trials | High-frequency data never leaves the device (doc 22) |
| Round aggregation | Client, then sent | Bounded payload (`SENS-NFR-014`) |
| Normalisation, drift model, candidate effects, response surface, next candidates | **Server** | See below |
| Final scoring, confidence, recommendation | **Server** | Authoritative, reproducible, tamper-resistant |

Reasons the adaptive step is server-side:

1. **Reproducibility.** `SENS-BR-030` requires that any recommendation be recomputable from
   stored data. If the client decided the candidates, the decision would depend on a client build.
2. **Tamper resistance.** A client-side optimiser is trivially manipulable (doc 23 §23.10).
3. **Blinding.** Candidate→label mapping is generated and held server-side; the client receives
   only what it needs to render.
4. **Evolvability.** Improving the algorithm should not require every user to have a fresh build.

The honest cost: a **round boundary network round-trip** (~100–300 ms). It is hidden inside the
3–5 s inter-block interstitial, which exists for bias reasons anyway (doc 13 §13.6). If the
request fails, the client retries and, on repeated failure, pauses the session with an explicit
message rather than silently continuing with a stale plan.

**The client necessarily knows the candidate cm/360 values** — it must, to render the camera.
Blinding is therefore about the *presentation*, not about cryptographic secrecy: the values are
present in memory but never displayed, never labelled, and never associated with a score in the
client. A determined user could inspect them; that is acceptable, because a user who deliberately
unblinds themselves is only degrading their own measurement, and the alternative (streaming input
to the server for remote rendering) is impossible at this latency.

---

## 18.8 Rendering strategy per route group

| Group | Strategy | Notes |
|---|---|---|
| `(marketing)` | Static, revalidated | Canvas demos hydrate lazily on intersection |
| `(app)` read pages | RSC, dynamic, per-request auth | Results, history, comparison |
| `(app)` forms | RSC shell + client form islands + Server Actions | Hardware setup, profile, settings |
| `(lab)` | Client-only after the shell; **no streaming, no Suspense mid-session** | Everything preloaded before pointer lock (`SENS-NFR-011`) |
| `api/` | Node runtime | Needs Drizzle and a real Postgres driver |

The `(lab)` layout deliberately opts out of every optimisation that could introduce a mid-session
network fetch, font swap, or layout shift.

---

## 18.9 Error handling

| Class | Handling |
|---|---|
| Validation error (client) | Inline field errors from the same Zod schema |
| Validation error (server) | 422 with a typed error shape; never leaks internals |
| Authorisation failure | 404, not 403, for resources the actor does not own — does not reveal existence |
| Ingest conflict (duplicate idempotency key) | 200 with the existing resource; not an error |
| Ingest failure | Client retries with backoff, then pauses the session with a user-facing message |
| Engine invariant violation | Session marked `invalidated`, user told the session cannot produce a valid result, no recommendation generated |
| Unverified conversion requested | Typed `UnverifiedConversionError`, rendered as the verification state (doc 12 §12.6) |
| Unexpected server error | Correlated log with `session_id` + `trace_id`, generic user message |

**Principle:** the system never produces a recommendation it cannot stand behind. Failing loudly
and losing the session is always preferable to succeeding quietly with bad data.

---

## 18.10 Configuration and environment

- Environment variables parsed and validated once at startup through a Zod schema; a missing or
  malformed variable is a **startup failure**, not a runtime surprise.
- No secret is ever exposed under a `NEXT_PUBLIC_` prefix; a CI check greps for it.
- Versioned algorithm parameter sets are loaded at boot and hash-verified against
  `algorithm_versions` (doc 14 §14.9). A mismatch fails startup.
- Feature flags for post-MVP features are simple typed constants at MVP; a flag service is not
  justified yet.

---

## 18.11 What is deliberately absent

| Not built | Why | When it would be |
|---|---|---|
| Message queue | Nothing is asynchronous enough to need one | Batch re-scoring of historical sessions at scale |
| Redis | Rate limiting fits in Postgres at MVP volumes (doc 23 §23.8) | When rate-limit contention becomes measurable |
| Separate API service | One consumer, one deploy | A desktop companion app (Future) |
| WebGL/Three.js | Canvas 2D meets every MVP test's rendering need with lower complexity and more predictable frame timing | A 3D test environment with depth cues (ADR-005) |
| Web Workers for metrics | Metric derivation happens between trials, not during them; a worker adds transfer cost and complexity for no latency benefit | If a test requires in-trial heavy computation |
| Service worker / offline | The product needs the server between rounds anyway | Never, probably |
| State management library | Server state is RSC; engine state is outside React; the remainder is local | Not foreseen |
