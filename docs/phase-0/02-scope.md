# 02 — Scope

Related: [01-product-vision.md](01-product-vision.md) · [05-functional-requirements.md](05-functional-requirements.md) · [34-phase-1-backlog.md](34-phase-1-backlog.md)

This document is the scope contract. If something is not listed under **MVP**, it is not built
in the MVP, regardless of how small it looks. Scope changes require a decision-log entry.

---

## 2.1 The MVP definition of done

> A guest with a mouse and a browser can complete a blinded adaptive calibration and receive a
> defensible, explained, converted sensitivity recommendation — and can keep it by making an
> account.

Anything that does not serve that sentence is deferred.

---

## 2.2 MVP

### 2.2.1 Onboarding and setup

| Item | Note |
|---|---|
| Landing page with scroll narrative | Doc 25 §25.1 |
| Game selection (5 launch games) | Selection drives output conversion, **not** the test engine |
| Hardware setup — DPI required, everything else optional | Doc 05, FR-018; see `SENS-BR-004` |
| Optional current game + current sensitivity (used as starting bracket only) | `SENS-BR-002` |
| Optional mousepad dimensions (used to bound the low-sensitivity search) | Doc 13 §13.4 |
| Environment check (pointer lock, unadjusted movement, frame stability, refresh rate) | Doc 30 §30.4 |
| DPI plausibility cross-check with warning | Doc 11 §11.9 |

### 2.2.2 Test engine

| Item | Note |
|---|---|
| Canvas 2D renderer with simulated first-person angular camera | ADR-005, ADR-006 |
| Pointer Lock with `unadjustedMovement` requested and degradation path | Doc 19 §19.4 |
| Seeded deterministic PRNG for all randomisation | Doc 19 §19.8 |
| Trial / round / block / session lifecycle with pause, resume, abort | Doc 19 §19.3 |
| Practice mode (unscored) | `SENS-BR-011` |
| Frame-quality monitor with per-trial degradation flags | Doc 30 §30.5 |
| Ring-buffered telemetry, zero React re-render on input | `SENS-NFR-004` |

### 2.2.3 Aim tests — MVP set (5 scored + 1 baseline + 1 constraint)

| Test | Role in MVP |
|---|---|
| Reaction Test | Baseline only. Never influences the sensitivity estimate (`SENS-BR-006`) |
| Flick Test | Primary Speed + Precision signal |
| Micro Adjustment Test | Primary Control signal; the main "too high" detector |
| Tracking Test | Primary Tracking signal |
| Target Switching Test | Speed + Control under repeated re-acquisition |
| Precision Test | Precision signal at small angular size |
| 360 Comfort Test | Not scored — produces a **hard constraint** on the search range |

### 2.2.4 Calibration

| Item | Note |
|---|---|
| Adaptive multi-round candidate search in log-sensitivity space | Doc 13 |
| Blinded candidates; randomised, counterbalanced presentation | `SENS-BR-007`, `SENS-BR-008` |
| Learning/fatigue trend modelled as a nuisance term and regressed out | Doc 13 §13.7 |
| Quadratic response-surface fit with a bracketing fallback | Doc 13 §13.8 |
| Documented stopping conditions | Doc 13 §13.10 |
| Three session modes — Quick / Standard / Advanced | Durations computed, never hardcoded (`SENS-BR-024`) |

### 2.2.5 Scoring, recommendation, results

| Item | Note |
|---|---|
| Robust within-player normalisation | Doc 14 §14.3 |
| Six skill dimensions: Flick, Precision, Tracking, Speed, Control, Consistency | Doc 14 §14.5 |
| Versioned scoring model `scoring_model_v1` | `SENS-BR-020` |
| Recommended cm/360 + high-performance range + confidence index | Doc 16 |
| Aim profile classification with a generated, rule-derived explanation | Doc 16 §16.5 |
| **Response curve** visualisation (the evidence chart) | Doc 25 §25.9 |
| **Aim DNA** visualisation | Doc 25 §25.9 |
| Strengths / improvement areas, non-punitive framing | `SENS-UX-018` |

### 2.2.6 Game conversion

| Item | Note |
|---|---|
| Versioned game adapter layer | Doc 12 |
| Hipfire conversion for every launch game whose constants are **verified** | `SENS-BR-013` |
| ADS/scope conversion where the game's model is verified | Doc 11 §11.6 |
| "Convert result to another game" without re-running calibration | `SENS-FR-078` |
| Copy-to-clipboard per setting and as a block | `SENS-FR-081` |
| Explicit "unverified — not shown" state for any adapter not yet confirmed | `SENS-BR-014` |

### 2.2.7 Validation and fine-tuning

| Item | Note |
|---|---|
| Blind A/B validation: original vs recommended | Doc 17 §17.2 |
| Paired bootstrap CIs; "no measurable difference" is a first-class verdict | `SENS-BR-016` |
| Confidence reduction and re-calibration offer when the recommendation loses | Doc 17 §17.5 |
| Blind fine-tune pass around the recommendation | Doc 17 §17.7 |

### 2.2.8 Accounts, persistence, history

| Item | Note |
|---|---|
| Guest calibration with no account | `SENS-BR-001` |
| Email + password auth, email verification, password reset | Doc 23 §23.3 |
| Guest → account session claim (server-side, cookie-proved) | Doc 23 §23.6 |
| Named hardware profiles (multiple mice / multiple DPI) | Doc 20 §20.6 |
| Session history list | `SENS-FR-090` |
| Two-session comparison | `SENS-FR-093` |
| Account deletion + data export | `SENS-SEC-020`, `SENS-SEC-021` |

### 2.2.9 Cross-cutting MVP

Design system and tokens · motion system with `prefers-reduced-motion` · custom scrollbar ·
responsive result/history/profile surfaces · mobile "desktop required" gate for tests ·
WCAG 2.2 AA posture outside active tests · Zod validation on every boundary · rate limiting on
auth and ingest · product analytics events · unit/integration/E2E suites · CI.

---

## 2.3 Post-MVP

Valuable, understood, deliberately sequenced after launch. These must not add architectural
constraints now beyond the extension points already specified.

| Item | Why deferred | Extension point already in place |
|---|---|---|
| Wide Flick, Strafe Tracking, Slide Tracking, Speed, Recoil, ADS, Scope Calibration tests | The MVP five already span the dimensions needed to locate the peak; these add resolution, not capability | `test_definitions` table + declarative `TestDefinition` (doc 19 §19.9) |
| Per-scope calibration (1×–8×) | Requires verified per-game scope models (doc 36) | `scope_key` present on rounds, settings and adapters from day one |
| Google / Discord OAuth | Email is enough to prove the account loop | `auth_identities` table is provider-shaped from day one (doc 20 §20.3) |
| Population percentiles and absolute skill scores | Needs consented data volume we do not have | Scoring model is versioned; `normalisation_mode` is an explicit parameter (doc 14 §14.4) |
| Empirically calibrated confidence (probability, not index) | Needs test–retest data | Confidence is versioned separately from scoring (doc 15 §15.7) |
| Sensitivity drift monitoring / re-check reminders | Needs a returning-user base | `parent_session_id` and session comparison exist |
| Shareable public result pages | Needs a privacy review of what is exposed | `recommendations` is already a standalone addressable entity |
| Mouse and mousepad catalogue | Free-text is adequate; a catalogue is a data-sourcing project | `hardware_profiles.mouse_model` is free text, `mice` table sketched |
| Raw telemetry retention for research | Consent + storage cost; not needed to ship | `telemetry_batches` + `research_consents` designed (doc 22) |
| Localisation beyond en + zh-Hans | zh-Hans is required by the 三角洲行动 audience; other locales are marketing-driven | `display_name_localized jsonb` + i18n-ready copy layer |
| Additional games (Valorant, OW2, R6, CoD, BF, Marvel Rivals, Fortnite) | Each is a verification project, not an engineering project | Adapter registry; zero engine changes required |

---

## 2.4 Future

Ideas that are explicitly allowed to influence *nothing* about MVP architecture beyond not being
actively precluded.

Leaderboards · training plans and daily exercises · coach mode · Aim Lab/KovaaK-style training
modes · pro player comparison database · Discord bot · Steam integration · desktop companion
app (real DPI detection, real config-file read/write) · community benchmarks · team/org accounts ·
AI coach explanation layer · WebGL/3D test environments · controller support.

**Rule:** No Future item may be cited to justify additional MVP complexity. If an architectural
choice is being made "for" a Future item, it needs an ADR (doc 32) proving it costs nothing now.

---

## 2.5 Explicit non-goals

These are not "later". They are things SensLab has decided not to be.

1. **Not an aim trainer.** No progression systems, no streaks, no XP, no daily quests.
2. **Not a cheat, macro, or input-modifying tool.** SensLab never writes to a game, never
   injects input, never asks for anything outside the browser sandbox.
3. **Not a claim of engine-accurate reproduction.** See `SENS-BR-022`.
4. **Not a social network.** Sharing a result is a link, not a feed.
5. **Not a raw-telemetry harvesting operation.** Default retention for raw pointer streams is
   *none*, and consent is opt-in and revocable (doc 22).
6. **Not an AI product.** The recommendation engine is deterministic and statistical.
   AI may explain results later; it may never produce them (ADR-014).
7. **Not a converter that guesses.** If a game's model is unverified, the conversion is not
   shown at all — not shown with a disclaimer, not shown greyed out with a number, **not shown**
   (`SENS-BR-014`).

---

## 2.6 Scope risks and the guardrails against them

| Creep vector | Guardrail |
|---|---|
| "Add one more test, it is cheap" | Every test costs trial budget, which costs the user's attention and directly raises abandonment. New tests require a trial-budget analysis (doc 09 §9.16) |
| "Add another game, it is just a constant" | A game is not a constant; it is a verification obligation with an owner and a re-check cadence (doc 36) |
| "Make the results page richer" | The results page has one job: make the recommendation believable. Additional charts must be below the fold and must not delay first paint of the response curve |
| "Users want to save more things" | Persistence surface is fixed at hardware profiles, sessions, recommendations and game settings for MVP |
| "Just store the raw mouse data, we might need it" | Prohibited by default (doc 22 §22.2). Storage is consent-gated and retention-bound |

---

## 2.7 Launch gate

MVP ships when, and only when, all of the following hold:

- `SENS-FR-*` items marked MVP are implemented and their acceptance criteria pass.
- At least **CS2** has a fully verified hipfire adapter (doc 36, `EV-001`). Games without
  verified adapters are hidden from the conversion output, not shipped broken.
- Guest calibration completes end-to-end on Chrome, Edge and Firefox on Windows and macOS.
- The response curve renders from real stored data, not a fixture.
- Unit coverage on `core/` (scoring, calibration, statistics, sensitivity, adapters) ≥ 90%
  branch (doc 29 §29.3).
- Security review checklist in doc 23 §23.12 is signed off.
- No `any`, no `@ts-expect-error` without a linked issue, no disabled ESLint rules added to make
  CI pass (`SENS-NFR-030`).
