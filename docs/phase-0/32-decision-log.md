# 32 — Decision Log

Related: [18-system-architecture.md](18-system-architecture.md) · [31-risk-register.md](31-risk-register.md)

Architecture Decision Records. Format: **Context → Decision → Alternatives → Consequences**.
Status is `Accepted` unless stated. A decision is changed by superseding it with a new ADR, not by
editing the old one.

---

## ADR-001 — Next.js App Router as the application framework

**Context.** SensLab has a marketing surface that must be fast and indexable, data-heavy read
pages, ordinary CRUD, and one deeply client-side real-time surface. It is built by a very small
team and must not require separate frontend and backend deployments.

**Decision.** Next.js (latest stable) with the App Router, React Server Components by default,
Server Actions for mutations, Route Handlers where request semantics matter.

**Alternatives.** Remix (similar fit, smaller ecosystem for this stack); Vite SPA + separate API
(more moving parts, worse landing performance); Astro + islands (excellent for marketing, poor
fit for the authenticated app).

**Consequences.** One deploy unit. RSC removes fetch waterfalls on results and history. The lab
route must deliberately opt out of streaming and dynamic import (doc 18 §18.8) — an unusual
requirement that has to be defended in review. Server Actions' CSRF guarantees must be verified
for the chosen version (`EV-013`) rather than assumed.

---

## ADR-002 — PostgreSQL as the primary datastore

**Context.** The schema is highly relational (sessions → rounds → trials → metrics, plus games,
versions, adapters, algorithm versions). Integrity matters more than write throughput. A single
operator must be able to run it.

**Decision.** PostgreSQL, with real foreign keys, CHECK constraints and enum types.

**Alternatives.** MongoDB (would make the relational integrity aspirational rather than enforced,
and this schema's correctness depends on it); SQLite (insufficient for concurrent ingest);
a time-series database for trial data (the trial volume is modest once raw telemetry is excluded,
and it would fragment the data model).

**Consequences.** Trial and metric tables grow large and will need partitioning eventually
(doc 21 §21.6). Constraints catch modelling errors at write time rather than in analysis. DBeaver
operability comes for free.

---

## ADR-003 — Drizzle ORM

**Context.** We need type-safe data access without hiding SQL, and readable, reviewable
migrations.

**Decision.** Drizzle, with all queries confined to a repository layer.

**Alternatives.** Prisma (heavier runtime, a separate schema language, historically awkward with
raw SQL and partial indexes); raw SQL with a query builder (loses type safety across the
boundary); Kysely (close second; Drizzle's schema-first migrations decided it).

**Consequences.** Generated SQL is reviewed before it is applied. Type inference flows into
`core/` types. Complex analytical queries can drop to raw SQL without leaving the toolchain.

---

## ADR-004 — `counts_per_360` is the canonical sensitivity unit; `cm/360` is its presentation

**Context.** The product must be game-independent, and DPI — the bridge between counts and
centimetres — is self-reported and often wrong or unknown.

**Decision.** Store `counts_per_360` as the authoritative value; derive and also store `cm/360`
using the session's DPI; present `cm/360` to users.

**Alternatives.** cm/360 as canonical (breaks when DPI is wrong or later corrected); a per-game
sensitivity as canonical (fails the entire product thesis); eDPI (meaningless across games).

**Consequences.** A user with unknown DPI still gets a fully valid physical result
(doc 11 §11.9.4). Correcting a DPI later re-expresses history correctly without re-running
anything. Confidence in the measurement and reliability of the converted setting can be reported
separately (doc 15 §15.5), which is more honest than one blended number. Costs one extra stored
column and a small amount of user education.

---

## ADR-005 — Canvas 2D, not WebGL, for the test renderer

**Context.** The lab route must hold a strict frame budget on modest hardware, with predictable
pacing and no stalls.

**Decision.** Canvas 2D with a restricted drawing set. WebGL/Three.js is introduced only when a
specific test demonstrably needs it.

**Alternatives.** WebGL (unnecessary at fewer than ten simple shapes, adds shader compilation
stalls, context-loss handling and far more code, in the component where risk is least
acceptable); DOM elements as targets (explicitly rejected by the brief and by latency).

**Consequences.** Draw cost is roughly an order of magnitude under budget (doc 30 §30.2). No 3D
depth cues; the Precision test's "distance" is simulated with size and surround treatment. If a
future test genuinely needs depth, this ADR is superseded rather than worked around.

---

## ADR-006 — The test world is angular, not pixel-based

**Context.** For cm/360 to be the real independent variable, a target's difficulty must be
defined by the *rotation* required to reach it, not by a pixel distance.

**Decision.** All targets are positioned in (yaw, pitch) and projected through a perspective
camera with a fixed, recorded FOV. Target sizes are angular radii in degrees.

**Alternatives.** Pixel-space targets (would make results depend on window size and resolution,
would make FOV meaningless, and would make ADS/scope tests impossible).

**Consequences.** The engine carries a small amount of 3D maths. Window resizing mid-session
changes the angular-to-pixel mapping and must pause and flag the session. ADS, FOV and scope work
become natural extensions rather than rewrites. This is the decision that makes the whole
product's maths coherent.

---

## ADR-007 — Game adapters are versioned modules with a hard verification gate

**Context.** Wrong conversion constants are a Critical risk (R-02), and game behaviour changes
with patches.

**Decision.** One adapter per `(game, version)`, registered in a registry, with the verification
status enforced **inside the pure conversion function**: an unverified scope throws rather than
returning a value.

**Alternatives.** A configuration table read by generic conversion code (cannot express
per-game model forms such as tables or piecewise functions); UI-level gating (bypassable by any
new screen, route, export or share card); shipping approximate values with a warning (every
rendered number gets copied regardless of adornment).

**Consequences.** Games can ship as calibratable-but-not-convertible, which requires a good
empty state and gets one (doc 25 §25.10). Historical results pin their adapter version and can be
explicitly re-derived after a correction. Adding a game touches no engine code — asserted by CI.

---

## ADR-008 — Delta Force Global and 三角洲行动 are separate games

**Context.** They are regionally operated, separately patched builds of a related title.

**Decision.** Two `games` rows, two adapters, two verification tracks, two version histories.
Neither adapter may delegate to the other (enforced by test).

**Alternatives.** One game with a region flag (would make an equality assumption that has not
been verified, in exactly the area — settings menus and sensitivity behaviour — where regional
builds most often diverge).

**Consequences.** Duplicated verification effort if they turn out to be identical. That cost is
accepted; if verification establishes equality on a build pair, it is recorded as a finding on
both entries, not as a structural merge.

---

## ADR-009 — Adaptive search in log space with a weighted response-surface fit

**Context.** Locating the maximum of a noisy, single-peaked function with expensive evaluations,
a nuisance time trend, and a real possibility of no detectable peak.

**Decision.** Search in `log2(counts_per_360)`; blocked, counterbalanced, blinded candidate
evaluation with paired stimuli; an additive drift model; a weighted quadratic fit pooled across
rounds; a documented decision table for narrowing/shifting; bootstrap intervals on the vertex.

**Alternatives.** Test three fixed sensitivities and pick the best (no interval, no peak
location, wastes the shape information); binary search on pairwise comparisons (more evaluations
for less information; comparisons are noisier than a fitted curve); Bayesian optimisation with a
Gaussian process (better in principle, but its behaviour is harder to explain to a user and
harder to test deterministically — and explainability is a product requirement here, not a
nicety).

**Consequences.** The engine is explainable, testable against synthetic ground truth, and
produces the response curve that is the product's signature evidence. Quadratic curvature is an
assumption about the response shape, mitigated by the concavity check and the bracketing
fallback. Revisit a GP-based approach once real variance data exists.

---

## ADR-010 — The adaptive step runs server-side

**Context.** The client must know the candidate values to render, but the *decision* about what to
test next determines the result.

**Decision.** Per-trial metric derivation and round aggregation on the client; normalisation,
drift modelling, candidate selection, scoring, confidence and the recommendation on the server.

**Alternatives.** Fully client-side (not reproducible, trivially manipulable, and improving the
algorithm would require every user to have a new build); fully server-side including metrics
(would require streaming raw telemetry, contradicting doc 22).

**Consequences.** A network round trip at each round boundary, hidden inside the interstitial
that exists for bias reasons anyway. Blinding is presentational rather than cryptographic — the
client holds the values it renders — which is acknowledged and accepted (doc 18 §18.7).

---

## ADR-011 — JSONB is permitted only for four specific purposes

**Context.** JSONB is convenient and corrosive. Relational business data stored as JSON loses
constraints, indexes, and the ability to answer questions.

**Decision.** JSONB is allowed for: declarative test configuration, immutable algorithm parameter
snapshots, environment/hardware fingerprints, and adapter source references. Everything else is
relational.

**Alternatives.** Liberal JSONB (fast to write, unqueryable, unconstrained); strict relational
everywhere (would force a schema migration for every test-definition tweak).

**Consequences.** Each permitted use is a fixed-shape payload that is written once, read whole,
and never joined or filtered — the only situation where JSONB is clearly correct. Every new JSONB
column requires justification against these four categories in review.

---

## ADR-012 — `trial_metrics` is a narrow keyed table, not a wide one

**Context.** ~12 metrics per trial, a metric set that grows with post-MVP tests, and metrics that
are meaningless for some test types.

**Decision.** `(trial_id, metric_key, value)` with a composite primary key and a foreign key to
`metric_definitions`.

**Alternatives.** A wide table with one column per metric (a migration per new metric, mostly
NULL, and post-MVP tests would double the column count); JSONB per trial (unqueryable, and it
would violate ADR-011).

**Consequences.** More rows — roughly 4,000 per session — and no per-metric type checking at the
database level. Mitigated by: the composite PK doubling as the covering index for the only access
pattern; the FK closing the vocabulary; bulk writes and bulk reads only; and the fact that the
common read path uses `round_metrics` and never touches this table. Revisit if research querying
by metric across users becomes a real workload.

---

## ADR-013 — No row-level security at MVP

**Context.** Ownership enforcement is critical (R-15). PostgreSQL RLS is the strongest available
mechanism.

**Decision.** Enforce ownership in the repository layer — every query filters by the actor in
SQL, every repository function takes an `ActorContext`, and a *generated* cross-tenant test suite
covers every owned resource and route. RLS is not enabled.

**Alternatives.** RLS (with pooled connections and one application role it requires per-request
`SET LOCAL` and careful pool discipline; a misconfiguration fails open in a way that is harder to
test than application code); both (the belt-and-braces option, at meaningful complexity cost for
a single-consumer application).

**Consequences.** Protection depends on a mechanism that is deterministic and testable without
database configuration, which suits a small team. Revisit immediately if any second consumer
(desktop app, analytics service, external integration) is granted direct database access — at
that point RLS clearly earns its cost. Status: **Accepted, with a named trigger for revisiting.**

---

## ADR-014 — The recommendation engine is deterministic and statistical; AI is never in the path

**Context.** An LLM could plausibly generate sensitivity advice, and the brief anticipates a
future AI coach.

**Decision.** The recommendation is produced entirely by deterministic, versioned, testable
statistical code. A future AI layer may **explain** measured data; it may never produce, alter,
or influence a recommendation, a score, a range, or a confidence value.

**Alternatives.** An AI-assisted recommendation (non-reproducible, non-auditable, cannot be
version-pinned, cannot be tested against ground truth, and would break `SENS-BR-030`); an AI
fallback when data is thin (the correct response to thin data is to say so, not to hallucinate a
number).

**Consequences.** Every result is reproducible and explainable forever. The future coach layer
has a clean, safe boundary: it reads a completed recommendation and generates prose, with the
numbers passed through verbatim. Costs the ability to make claims the data does not support —
which is the point.

---

## ADR-015 — Guest-first onboarding

**Context.** The first calibration is the product's entire value demonstration, and it takes
twenty minutes.

**Decision.** A guest can complete a full calibration and see a full result with no account.
Registration is offered afterwards, to *keep* the result.

**Alternatives.** Account-required (converts a measurement tool into a lead form and would gate
the value demonstration behind a signup); account-required only to see results (a dark pattern
that would poison the trust the product depends on).

**Consequences.** Requires server-side guest identity, a safe claim flow, and expiry
(doc 23 §23.6). Some results are never claimed and are purged after 7 days. The signup moment is
placed where the user has just received something valuable, which is the right place.

---

## ADR-016 — Opaque server-side sessions, not JWTs

**Context.** Password change and account deletion must revoke access immediately.

**Decision.** Opaque 256-bit tokens in `__Host-` prefixed HttpOnly cookies, stored hashed
server-side, with sliding expiry and an absolute cap.

**Alternatives.** JWT (stateless, but revocation requires a denylist — which is a session store
with extra steps and worse ergonomics); JWT with very short expiry plus refresh tokens
(complexity without benefit at this scale).

**Consequences.** One database read per authenticated request (cheap, indexed, and `last_seen_at`
is throttled to at most one write per hour). Immediate, correct revocation. Sessions are
listable and individually revocable, which is a good future feature for free.

---

## ADR-017 — Raw pointer telemetry is not persisted by default

**Context.** A session generates ~1.5 M pointer samples. It is a behavioural biometric.

**Decision.** Raw samples live in device memory only and are discarded. Retention requires
explicit, revocable, versioned consent, and then goes to object storage with a 30-day default —
never to PostgreSQL.

**Alternatives.** Store everything (petabyte-scale problem in year one, privacy exposure, and it
is not needed — every quantity the recommendation depends on is derived on the device);
downsample and store (corrupts path length, correction counting and jitter, the metrics that
matter most).

**Consequences.** Metrics cannot be retroactively recomputed from raw data with a future
algorithm — the one real cost, accepted. Recommendations *can* still be recomputed from stored
trial metrics (`SENS-BR-030`), which covers the auditability requirement.

---

## ADR-018 — Two normalisation contexts: within-session for decisions, reference for display

**Context.** The calibration compares a player to themselves. Display scores compare a player to
a population. SensLab has no population at MVP.

**Decision.** Keep them strictly separate. The recommendation, ranges, response curve, validation
and profile *shape* use within-session normalisation and are fully valid on day one. Absolute
0–100 scores use a documented provisional reference, are labelled provisional, and no percentiles
are shown until real data exists.

**Alternatives.** One normalisation for both (would make the recommendation depend on invented
reference values — the worst possible coupling); no absolute scores at all (loses a genuinely
useful and motivating output).

**Consequences.** The product can launch honestly with zero population data. Replacing the
reference distribution later is a clean, versioned event that changes display scores and changes
nothing about any recommendation.

---

## ADR-019 — Confidence is a bounded index with a hard ceiling, not a probability

**Context.** Users read a percentage as a probability. SensLab cannot yet justify one.

**Decision.** A weighted geometric mean of seven named quality components, scaled by a version
ceiling of 0.92, with verdict-specific caps, a full user-visible breakdown, and no floor. It is
called a "confidence index", never "X% chance". It becomes a probability only after calibration
against test–retest data.

**Alternatives.** A p-value (answers a question users are not asking); an unbounded percentage
(would imply calibration that does not exist); no confidence at all (users would assume
certainty, which is worse).

**Consequences.** A geometric mean means one bad component visibly drags the whole index down,
which is the correct behaviour for a quality score. The ceiling means SensLab never shows 95%,
which will look odd and is correct. The breakdown turns confidence into a diagnostic with
actionable advice.

---

## ADR-020 — The test engine lives outside React

**Context.** Measurement fidelity requires zero re-render, zero allocation and zero DOM work
during a trial.

**Decision.** A standalone, framework-free TypeScript module with its own canvas and rAF loop,
mounted by a single thin React file. Engine → React communication happens at stage boundaries
only. The HUD is drawn on the canvas.

**Alternatives.** A React component with refs (the boundary erodes; a stray state update in a
future change silently degrades measurements); React + a rendering library (adds an
unpredictable layer to the hard-real-time path).

**Consequences.** The engine is testable headlessly, which enables the synthetic-player harness —
the most valuable test in the project. The React boundary is one file and is easy to police. It
also makes a future desktop companion or a non-React embedding straightforward.

---

## ADR-021 — Dark-only interface; no light theme

**Context.** The product's core surface is a dark test environment, and the visual identity is
built on near-black with restrained accent lighting.

**Decision.** One dark theme. No light theme at MVP or planned.

**Alternatives.** Light + dark (doubles design and QA surface, and a light theme cannot contain
the test environment, which must stay dark for target contrast reasons — producing a jarring
switch mid-flow).

**Consequences.** Halves theming work. Users who prefer light interfaces are not served; accepted,
given the product's context and audience. Contrast requirements are met within the dark palette,
so this is not an accessibility shortcut (doc 26 §26.3).

---

## ADR-022 — Email and password authentication at MVP

**Context.** Accounts exist to keep results. The auth method should minimise friction at the
moment of signup, which happens *after* a twenty-minute investment.

**Decision.** Email + password with Argon2id, email verification, and password reset. OAuth and
magic links are architected for (`auth_identities` is provider-shaped) but not built.

**Alternatives.** Magic-link only (makes every sign-in depend on email deliverability and
context-switching, which is poor at the end of a long session); OAuth first (a third-party
dependency and a consent dialogue at the most fragile moment); passkeys (excellent, but
inconsistent support and unfamiliar recovery flows would cost more than they save at this stage).

**Consequences.** SensLab must handle password storage, reset and enumeration resistance
correctly — well-understood work with well-understood failure modes. Adding a provider later
requires no schema change.
