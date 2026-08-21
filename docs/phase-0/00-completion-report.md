# 00 — Phase 0 Completion Report

**Project:** SensLab — Personal Gaming Mouse Sensitivity Calibration Platform
**Phase:** 0 — Product Specification & Engineering Foundation
**Status:** **Complete**
**Application code produced:** **None**

---

## 1. Phase 0 status

**Complete.** All required deliverables exist, are internally consistent, and are detailed enough
for a senior engineer to begin Phase 1 without guessing a major product, mathematical, or
architectural decision.

No blocking contradictions remain. Fifteen items require external verification before the code
that depends on them can ship; all are catalogued with owners, methods and acceptance criteria in
[36-external-verification-register.md](36-external-verification-register.md). None of them block
Phase 1.

---

## 2. Files created

**38 documents, 577 KB, ~83,700 words**, all under `docs/phase-0/`.

| Group | Documents |
|---|---|
| Index and report | `README.md`, `00-completion-report.md` |
| Product | `01` vision · `02` scope · `03` personas · `04` user journeys |
| Requirements | `05` functional · `06` non-functional · `07` business rules |
| Domain and science | `08` supported games · `09` test catalogue · `10` measurement methodology · `11` canonical sensitivity model · `12` game adapter architecture · `13` calibration algorithm · `14` scoring model · `15` confidence model · `16` recommendation model · `17` validation & fine-tuning |
| Engineering | `18` system architecture · `19` test engine architecture · `20` data model · `21` database strategy · `22` telemetry strategy · `23` security & privacy |
| Design | `24` screen inventory · `25` wireframes · `26` design system · `27` motion & interaction · `28` responsive & accessibility |
| Quality and governance | `29` testing strategy · `30` performance strategy · `31` risk register · `32` decision log · `33` traceability · `34` Phase 1 backlog · `35` glossary · `36` external verification register |

**Nothing exists in the repository outside `docs/`.** No `package.json`, no dependencies, no
migrations, no source files, no components.

**Structural deviation:** two documents were added beyond the requested 35-file layout —
`35-glossary.md` and `36-external-verification-register.md`. Every requested file exists at its
requested number; nothing was merged, dropped, or stubbed. Rationale in `README.md`.

---

## 3. Requirements produced

| Namespace | Count | Location |
|---|---|---|
| `SENS-FR-###` functional | 108 (95 MVP, 10 post-MVP, 3 future) | doc 05 |
| `SENS-NFR-###` non-functional | 48 | doc 06 |
| `SENS-BR-###` business rules | 37 | doc 07 |
| `SENS-SEC-###` security | 25 | doc 23 |
| `SENS-UX-###` design/accessibility | 34 | docs 26–28 |
| `SCR-###` screens | 43 (37 MVP) | doc 24 |
| `ADR-###` decisions | 22 | doc 32 |
| `R-##` risks | 24 | doc 31 |
| `EV-###` verification items | 15 | doc 36 |

Every MVP functional requirement carries acceptance criteria. Every business rule names a concrete
enforcement mechanism and a test class. Full matrix in doc 33.

---

## 4. Major product decisions

1. **SensLab measures; it does not ask.** Self-report may seed and constrain the search but may
   never determine the output (`SENS-BR-002`). This is the product's whole differentiation, and it
   is enforced at the engine's input type, not by convention.
2. **The evidence is the product.** The signature result surface is the **response curve** — the
   player's own performance plotted against sensitivity with error bars, a fitted peak and an
   uncertainty band — not a large number. The number is a visible consequence of a visible curve.
3. **"We don't know" is a shipped feature.** A flat curve produces a comfort range and low
   confidence, not a fabricated point estimate. An unverified game produces no number at all —
   not a greyed-out one, not one with a disclaimer.
4. **Guest-first.** A full calibration and full result with no account; registration is offered
   afterwards, to keep the result.
5. **MVP is five scored aim tests, not fourteen.** Reaction (baseline only), Flick, Micro
   Adjustment, Tracking, Target Switching, Precision, plus 360 Comfort as a physical constraint.
   The other seven tests are fully specified so the schema and interfaces accommodate them, and
   are deliberately not built.
6. **Confidence is an index with a hard ceiling of 92**, composed of seven named, user-visible
   components. It becomes a probability only after calibration against test–retest data.
7. **Validation is a real experiment that SensLab can lose**, and the losing case is a designed
   screen with honest framing, not an edge case.
8. **The product will not present anyone else's sensitivity** as an input, default or suggestion.

---

## 5. Major architecture decisions

Full records in doc 32. The consequential ones:

| Decision | Why it matters |
|---|---|
| **`counts_per_360` is canonical; cm/360 is its presentation** (ADR-004) | The measurement survives a wrong or unknown DPI; a corrected DPI re-expresses history without re-running anything; measurement quality and settings reliability can be reported separately and honestly |
| **The test world is angular, not pixel-based** (ADR-006) | The single decision that makes cm/360 the real independent variable and makes FOV, ADS and scope work natural extensions rather than rewrites |
| **Game adapters are versioned modules with the verification gate inside the pure conversion function** (ADR-007) | A UI-level gate is bypassable by any future screen, route, export or share card. A gate inside the function is not |
| **Canvas 2D, not WebGL** (ADR-005) | ~10 simple shapes; predictable frame pacing and no shader stalls in the one component where risk is least acceptable |
| **The test engine lives outside React** (ADR-020) | Enables the headless synthetic-player harness, which is the highest-value test in the project |
| **The adaptive step runs server-side** (ADR-010) | Reproducibility, tamper resistance, and the ability to improve the algorithm without shipping a client build |
| **Two normalisation contexts** (ADR-018) | Lets the product launch honestly with zero population data: every decision uses within-session comparison; only cosmetic absolute scores use a provisional reference, labelled as such |
| **Deterministic statistics, never AI, in the recommendation path** (ADR-014) | Reproducible and explainable forever; a future AI coach explains measured data and can never produce it |
| **Raw pointer telemetry is not persisted by default** (ADR-017) | ~1.5 M samples per session, a behavioural biometric, and not needed — everything is derived on the device |
| **No RLS at MVP, with a named trigger to revisit** (ADR-013) | Ownership is enforced in a repository layer that is deterministic and testable without database configuration; RLS is adopted the moment a second consumer gets direct database access |

Module boundaries are **machine-enforced**, not documented: `core/` and `game-adapters/` are pure
TypeScript, `core/` cannot import `game-adapters/`, `test-engine/` cannot import React, no SQL
exists outside `repositories/`, and no game constant exists outside `game-adapters/`. Each has a
named CI mechanism (doc 18 §18.5).

---

## 6. Calibration design — the finalised approach

The problem is a **noisy, derivative-free, one-dimensional optimisation with a nuisance drift
term**, not a search. The design follows from that framing:

- Search in `x = log2(counts_per_360)`, because sensitivity is perceived multiplicatively.
- The initial bracket is centred on the user's current sensitivity when known, and clipped by a
  **physical constraint** derived from the 360 Comfort Test and declared mousepad width.
- Each round evaluates ≥ 3 blinded candidates in contiguous blocks, ordered by a **Latin square**
  so position effects cancel exactly, with **matched stimulus seeds across candidates** so the
  comparison is paired and stimulus variance is removed.
- A **final-round anchor candidate** re-tests the round-1 centre — a metrology check standard that
  gives a within-session test–retest estimate, pins the drift model, and can veto the result.
- Warm-up, learning and fatigue are modelled as an explicit nuisance term `g(b)` and regressed
  out before candidates are compared; `fatigueDrift` is reported to the user and prices into
  confidence.
- A **weighted quadratic response surface**, pooled across all completed rounds, locates the
  optimum; a documented decision table handles the non-concave and edge cases, and a seeded
  bootstrap over the entire pipeline produces the credible interval on the peak.
- Four stopping conditions, each recorded per round: converged, indistinguishable, budget
  exhausted, quality/fatigue abort.
- The engine optimises **a scalar parameter under a supplied objective** and knows nothing about
  sensitivity or games — which is why the post-MVP scope calibration reuses it unchanged.

Output is a full object: recommendation, a statistical **high-performance range**, a practical
**comfort range**, confidence with a seven-part breakdown, an aim profile with a generated
explanation citing measured values, and everything needed to redraw the response curve.

---

## 7. UI/UX direction

**A calibration laboratory, not a gaming website.** The reference points are oscilloscopes and
metrology reports: near-black surfaces, hairline structure, uppercase micro-labels on every
measured quantity, real tick scales, tabular numerals everywhere, and a fine static grain.

- **Two accent hues only.** Trace Cyan for live measurement; Filament (warm) reserved exclusively
  for the result itself. Scarcity is what makes the reveal land.
- **Explicit prohibitions:** no permanent sidebar, no card-grid default, no RGB/neon, no esports
  angles, no drop shadows, no XP/streaks/badges.
- **A hard motion split.** Rich motion everywhere except the lab route, which uses a physically
  separate restricted renderer with a fixed effect allowlist. Adding to it requires an ADR.
- **One dramatic moment**, the result reveal — skippable, reduced-motion aware, and **identical
  regardless of verdict**: SensLab does not celebrate good results and bury bad ones.
- Two bespoke visualisations: the **response curve** (log x-axis, candidate dots with error bars,
  fitted curve, credible band, the user's current sensitivity marked) and **Aim DNA** (a polar
  specimen plot encoding score by radius, consistency by band width, sample size by tick density —
  three quantities per axis where a radar chart carries one).
- 37 MVP screens specified; 13 wireframed; WCAG 2.2 AA outside active tests, with the lab's
  genuine accessibility limitation stated plainly rather than implied away.

---

## 8. Database design

PostgreSQL, Drizzle, 30 tables, designed to be legible in DBeaver — real foreign keys, enum
types, CHECK constraints, and `COMMENT ON` for every table and non-obvious column.

Improvements over the schema sketched in the brief (full table in doc 20 §20.13):

- `game_sensitivity_models` **+ `game_scopes`**, because verification status must be tracked per
  scope, not per game.
- `metric_definitions` + `trial_metrics` + `round_metrics` split, so the common read path never
  touches trial-level data.
- **`calibration_rounds`** — the search itself needs an audit trail, or a recommendation cannot be
  explained.
- **`session_quality_flags`** as a table, so degradation is queryable rather than buried in JSON.
- **`guest_sessions`** with a server-issued token, making the guest-claim flow safe.
- **`auth_identities`**, provider-shaped from day one at no cost.
- **`validation_runs`**, `validation_metric_deltas`, `subjective_preferences` — validation is a
  product feature, not a note on a recommendation.
- **`telemetry_batches`** + `research_consents` — consent is a row, not a boolean.
- `test_rounds.presentation_order UNIQUE` — the idempotency key that makes ingest safe.
- `test_sessions.hardware_snapshot` — editing a profile must never rewrite history.

JSONB is restricted to four justified purposes and prohibited elsewhere (ADR-011). Volume is
~290 KB and ~5,000 rows per completed Standard session, with a partitioning trigger, an
archival-first growth strategy, and retention rules per data class.

---

## 9. Highest-priority risks

Full register of 24 in doc 31.

| Risk | Severity | Core mitigation |
|---|---|---|
| **R-01** The recommendation is simply wrong | Critical | Synthetic-player harness with known ground truth; paired stimuli; drift model; anchor re-test; validation verdict mix monitored as a standing ground-truth signal |
| **R-02** Game conversion constants are wrong | Critical | Nothing unverified ships; golden vectors compare the model to measurements, not to itself; adapters throw rather than approximate |
| **R-09** Insufficient statistical power at the chosen trial budget | High | Explicit power calculation with stated assumptions; MDE computed per session; **must be re-derived from pilot data during Phases 2–4** |
| **R-04** Raw input unavailable on common browsers | High | `EV-010` resolved in Phase 1; detect, warn, penalise confidence, never attempt to invert an unknown acceleration curve |
| **R-08** Familiarity bias makes the recommendation lose validation | High | Designed for: honest loss reporting, the original retained, and a "try it for a week, then re-check" loop that turns the bias into a product feature |
| **R-16** Game patches silently invalidate a shipped adapter | High | Per-version adapters, re-check triggers, "last verified against build X" in the UI, canonical physical storage so corrections are re-derivations |
| **R-12** Overclaiming destroys credibility | High | Eight business rules, a confidence ceiling, "no measurable difference" as a first-class verdict, and a content-level NFR with a UI test |
| **R-17** Scope creep | High | An explicit scope contract, a launch gate, and a rule that no future item may justify MVP complexity without an ADR proving it is free |

---

## 10. External verification required

**Fifteen open items. Zero verified.** That is the correct state at the end of a documentation
phase: Phase 0 produced no measurements. Full detail, methods and acceptance criteria in doc 36.

**Game sensitivity models** — for each, the *model form* must be established before any constant:

- `EV-001` **CS2 hipfire model** — highest priority; gates the launch (only CS2 must be verified
  to ship). Start in Phase 1.
- `EV-002` Apex hipfire model — including whether its yaw constant matches CS2's, which must be
  **measured, not inferred from a shared engine lineage**.
- `EV-003` **PUBG model form** — flagged explicitly: implementing PUBG on an assumed linear yaw
  constant is the most likely way this project ships a silently wrong number. Requires ≥ 5
  measurement points, not 2.
- `EV-004` Delta Force Global — nothing assumed.
- `EV-005` 三角洲行动 — **independently** required; may not be closed by reference to `EV-004`
  (`SENS-BR-015`).
- `EV-006`–`EV-009` ADS/scope models per game, including the critical question of whether a game
  **already applies its own FOV scaling** to ADS sensitivity — the single most common source of
  error in sensitivity conversion.
- `EV-014` FOV axis and scaling conventions per game — gets hipfire right and silently corrupts
  every scoped value if wrong.
- `EV-015` Setting ranges, steps and precision per game and scope.

**Platform and methodology:**

- `EV-010` **`unadjustedMovement` browser/OS support matrix** — highest-priority non-game item.
  Determines the support matrix, the environment check, and a confidence penalty. Needs no
  application code; resolve in Phase 1.
- `EV-011` Third-party naming of FOV-matching criteria, so SensLab's labels do not mislead users
  comparing tools. SensLab's own maths is derived from first principles and does not depend on it.
- `EV-012` Windows pointer-speed multiplier table — **context only**; recorded specifically so
  nobody later "improves" the product by applying a folklore table to correct measurements.
- `EV-013` Server Actions CSRF guarantees for the chosen framework version — defence in depth;
  SensLab's own middleware origin check exists regardless.

---

## 11. Verification performed on this specification

Per the brief's §38 checklist:

| Check | Result |
|---|---|
| Requirements internally consistent | **Pass** — automated ID sweep confirms every referenced `SENS-FR/NFR/BR/SEC/UX`, `SCR`, `ADR` and `EV` identifier is defined |
| Test metrics map to actual aim tests | **Pass** — doc 09 §9.15; every metric in doc 10 is produced by at least one test |
| Scoring maps to collected metrics | **Pass** — every dimension in doc 14 is fed by ≥ 2 MVP aim tests; no dimension depends on a single test |
| Calibration can consume scoring output | **Pass** — doc 14 §14.7 defines the per-trial objective the drift model in doc 13 §13.7 requires |
| Recommendation can consume calibration output | **Pass** — doc 13 §13.11's `CalibrationResult` supplies every field doc 16 §16.1 needs |
| cm/360 model works with game adapters | **Pass** — doc 11 §11.2 model forms match doc 12 §12.5 adapter forms; ADS maths derived from first principles with both analytic limits verified |
| Database supports the proposed workflows | **Pass** — doc 33 traces every MVP requirement to its tables; doc 20 §20.10 derives every index from a named query |
| UI screens support the user journeys | **Pass** — doc 24 §24.8 maps every screen to a journey stage and requirement; every journey stage has a screen |
| Security model covers ownership | **Pass** — `SENS-BR-034` + doc 23 §23.4, with a *generated* cross-tenant suite so new endpoints are covered automatically |
| Testing covers critical business logic | **Pass** — doc 29 allocates 40% of effort to `core/`; every business rule has a named test class in doc 33 §33.4 |
| Architecture supports additional games | **Pass** — doc 12 §12.10's checklist touches no engine code, asserted by a CI check |
| Guest mode supported | **Pass** — `SENS-BR-001`, ADR-015, doc 23 §23.6 claim flow |
| Registered history supported | **Pass** — FR-090–096, doc 20 §20.7 |
| No application code accidentally created | **Pass** — `find` confirms `docs/` is the only entry in the repository root |

**Contradictions found and resolved during the final pass:**

1. Eight cross-references pointed at the wrong section number (drift → confidence, engine
   parameter-agnosticism, round-metric constraints, doc-13 subsections). Corrected.
2. `SENS-NFR-021` (per-session storage) was set at 250 KB but the modelled schema produces
   ~290 KB. Rather than silently exceeding it, the trade-off was examined (the overage is the
   stored `response_curve`, kept deliberately so the result page never re-runs the fit), the
   target was amended to 300 KB, and the reason recorded in both documents.
3. Doc 25's example strengths listed Tracking as the top dimension while the same mock-up showed
   a "Balanced Precision" profile — which doc 16's classifier rules would not produce. The
   example was corrected so the wireframe and the classifier agree.
4. Doc 15's worked examples were arithmetically recomputed; two of the three stated confidence
   values were wrong. Corrected, and the third example expanded to make the verdict cap's
   purpose explicit.
5. A functional-requirement count was off by one (FR-009 mis-bucketed). Corrected.
6. Doc 25 now carries an explicit note that all wireframe values — including a CS2 tile shown as
   `verified` — are illustrative placeholders, so no reader mistakes a layout mock for a
   verification claim.

---

## 12. Phase 1 readiness

**Phase 1 can safely begin.**

Nothing in `EV-###` blocks it: Phase 1 builds the foundation, the schema, authentication, the two
pure-domain interfaces and CI, and deliberately implements **no aim test, no calibration
algorithm, and no real game constant**.

Doc 34 provides an ordered backlog of 10 epics and 45 items, ≈ 41 ideal engineering days
(realistically 7–9 weeks solo, 4–5 weeks for two), with a critical path and 15 exit criteria.

Two items should start **immediately and in parallel** with everything else, because both are
blocking for later phases, neither depends on any code, and both have long external lead times:

- **J1 — begin CS2 verification (`EV-001`).** Phase 5 depends on it, and it gates the launch.
- **J2 — resolve `EV-010`** with a small probe page across the browser/OS matrix.

The one open question worth flagging to the product owner now, because it may change the plan: the
trial budget in doc 09 §9.16 rests on an assumed trial-level coefficient of variation. If real
pilot variance is materially higher, either sessions get longer or more sessions return
`indistinguishable`. That calculation should be redone with real data during Phases 2–4 (risk
R-09), and it is the single most valuable measurement the project can make early.

---

## 13. Next step

**Phase 0 complete. Stopping for your approval before Phase 1.**
