# 05 — Functional Requirements

Related: [07-business-rules.md](07-business-rules.md) · [24-screen-inventory.md](24-screen-inventory.md) · [33-requirement-traceability.md](33-requirement-traceability.md)

**ID format:** `SENS-FR-###`. IDs are permanent and never reused. A withdrawn requirement is
marked `WITHDRAWN` in place.

**Priority:** `MVP` · `POST` (post-MVP) · `FUT` (future). Only `MVP` items are in the Phase 1–11
plan.

Acceptance criteria are given for every `MVP` requirement. `POST`/`FUT` items carry intent and
the extension point only.

---

## 5.1 Entry and information (FR-001 – FR-009)

| ID | Pri | Requirement |
|---|---|---|
| SENS-FR-001 | MVP | The landing page shall present the product proposition and a primary CTA that starts a calibration without requiring an account. |
| SENS-FR-002 | MVP | The landing page shall present a scroll-driven narrative across five acts (REACT, FLICK, TRACK, CONTROL, OPTIMIZE), each with a live canvas demonstration of the corresponding measurement. |
| SENS-FR-003 | MVP | The landing background shall respond subtly to pointer movement, and shall disable that response under `prefers-reduced-motion` and on touch devices. |
| SENS-FR-004 | MVP | A methodology page shall document, in user-facing language, what is measured, how the search works, how confidence is derived, and what the browser cannot guarantee. |
| SENS-FR-005 | MVP | The methodology page shall list, per supported game, the current adapter verification state. |
| SENS-FR-006 | MVP | The application shall expose the active algorithm versions (scoring, calibration, confidence, adapters) on every result. |
| SENS-FR-007 | POST | A public shareable result page shall be available at an unguessable URL, with the owner able to revoke it. |
| SENS-FR-008 | FUT | A blog/changelog surface shall record adapter and algorithm version changes. |
| SENS-FR-009 | MVP | Legal surfaces (privacy policy, terms) shall be reachable from every page footer. |

**Acceptance criteria**
- **001** From a cold session with no cookies, clicking the primary CTA reaches SCR-010 with no auth prompt in between.
- **002** Each act mounts its canvas demo only when in view and unmounts when out of view; total landing JS on a 4× CPU throttle stays within the budget in `SENS-NFR-002`.
- **003** With `prefers-reduced-motion: reduce`, no pointer-driven transform is applied; a static composition is rendered.
- **004** The page names the exact statistical procedure used (response-surface fit, bootstrap CI) and links to the confidence breakdown definition.
- **005** Each game row renders one of `verified` / `partially verified` / `unverified`, sourced from the adapter registry, not hardcoded copy.
- **006** A result page renders four version identifiers; changing any version in the registry changes the rendered value without a code change.

---

## 5.2 Game selection (FR-010 – FR-017)

| ID | Pri | Requirement |
|---|---|---|
| SENS-FR-010 | MVP | The user shall select a primary game from the supported roster before hardware setup. |
| SENS-FR-011 | MVP | Game selection shall affect only the default output adapter and default dimension weight profile; it shall not alter the test battery, target parameters, or search algorithm. |
| SENS-FR-012 | MVP | The UI shall state, at the point of selection, that the calibration itself is game-independent. |
| SENS-FR-013 | MVP | A "I play several / not listed" option shall be available and shall produce a cm/360-only result with no game conversion block. |
| SENS-FR-014 | MVP | Each game tile shall display its adapter verification state. |
| SENS-FR-015 | MVP | Delta Force Global and 三角洲行动 shall be selectable as distinct games with distinct adapters and distinct verification state. |
| SENS-FR-016 | MVP | The selected game shall be changeable at any later point without re-running the calibration. |
| SENS-FR-017 | POST | Users shall be able to mark multiple games as "mine" and receive settings for all of them by default. |

**Acceptance criteria**
- **010** Attempting to reach SCR-011 without a selection redirects to SCR-010.
- **011** A unit test asserts that the generated session plan (test list, trial counts, target parameters, candidate set) is byte-identical for two sessions differing only in `game_version_id`.
- **012** Copy is present and is not inside a collapsed disclosure.
- **013** Choosing it produces a recommendation whose `recommendation_game_settings` set is empty and whose result page omits the conversion block rather than rendering an empty one.
- **014** State is read from the adapter registry.
- **015** The two games have separate rows in `games`, separate `game_versions`, and separate entries in the verification register.
- **016** Changing the output game re-projects the stored `recommended_cm360`; no new `test_session` is created.

---

## 5.3 Hardware setup (FR-018 – FR-028)

| ID | Pri | Requirement |
|---|---|---|
| SENS-FR-018 | MVP | Mouse DPI shall be the only mandatory hardware input, and shall accept integer values in a validated range. |
| SENS-FR-019 | MVP | An "I don't know my DPI" path shall be provided, offering lookup guidance, an explicit common-default assumption, and a consistency-based estimate. |
| SENS-FR-020 | MVP | The system shall record the provenance of DPI as one of `known`, `assumed`, `estimated`. |
| SENS-FR-021 | MVP | When DPI provenance is not `known`, the result shall additionally be expressed in counts/360 and in relative terms, and the confidence index shall take the documented penalty. |
| SENS-FR-022 | MVP | Optional inputs (mouse model, polling rate, Windows pointer speed, Enhance Pointer Precision, OS, monitor resolution, refresh rate, aspect ratio, mousepad width/height, grip, current game, current hipfire sensitivity, current ADS sensitivity, current scope sensitivity) shall be collected behind a single optional disclosure. |
| SENS-FR-023 | MVP | No optional input shall block progression. |
| SENS-FR-024 | MVP | Inline explanations shall be available for DPI, polling rate, cm/360, Enhance Pointer Precision, and mousepad measurement. |
| SENS-FR-025 | MVP | When current game and current sensitivity are supplied and that game's adapter is verified, the system shall compute the user's current cm/360 and use it to centre the search bracket. |
| SENS-FR-026 | MVP | When mousepad width is supplied, it shall constrain the low-sensitivity end of the search range. |
| SENS-FR-027 | MVP | Registered users shall be able to select a saved hardware profile instead of re-entering data, and to save the current entry as a new profile. |
| SENS-FR-028 | MVP | The hardware state used by a session shall be snapshotted immutably onto the session at creation. |

**Acceptance criteria**
- **018** DPI accepts 100–32000; out-of-range and non-integer input is rejected client- and server-side by the same Zod schema.
- **019** All three helper branches are reachable and each records a distinct provenance.
- **020** Provenance is persisted on the session's hardware snapshot.
- **021** Result page shows counts/360 when provenance ≠ `known`; confidence breakdown lists the penalty as a named line item.
- **022** All 14 optional fields are present, none required, form submits with all blank.
- **023** E2E test: fill only DPI, reach SCR-012.
- **024** Each explanation is reachable by keyboard and announced to screen readers.
- **025** Unit test: CS2 sens 2.0 at 800 DPI yields the bracket centre equal to the adapter's computed cm/360 within floating-point tolerance.
- **026** A 30 cm pad width forbids candidates requiring > 30 cm per 360 unless the 360 Comfort Test contradicts it; see doc 13 §13.4.
- **027** Selecting a profile prefills every field; "save as profile" creates a row owned by the actor.
- **028** Editing the hardware profile afterwards does not change any historical session's snapshot.

---

## 5.4 Environment check (FR-029 – FR-035)

| ID | Pri | Requirement |
|---|---|---|
| SENS-FR-029 | MVP | The system shall detect Pointer Lock availability and whether `unadjustedMovement` was granted, and shall record both on the session environment. |
| SENS-FR-030 | MVP | If Pointer Lock is unavailable or denied, calibration shall be blocked with actionable guidance; no degraded non-locked calibration shall be offered. |
| SENS-FR-031 | MVP | The system shall run a frame-stability probe of at least 3 seconds and record measured frame interval statistics and estimated display refresh rate. |
| SENS-FR-032 | MVP | The system shall classify the environment as `pass`, `degraded`, or `blocked` and shall persist the classification and its reasons. |
| SENS-FR-033 | MVP | The system shall perform a DPI plausibility cross-check and warn on inconsistency without blocking. |
| SENS-FR-034 | MVP | The environment check shall record viewport size, screen size, device pixel ratio, browser and OS family, and test configuration version. |
| SENS-FR-035 | POST | The system shall detect likely mouse acceleration from the input stream itself and warn. |

**Acceptance criteria**
- **029** Both booleans persisted; a browser without support produces `false`, not `null`.
- **030** With Pointer Lock stubbed unavailable, SCR-012 renders the blocked state and the "start" control is absent, not merely disabled.
- **031** Probe records mean, p95 and max frame interval plus dropped-frame ratio.
- **032** Classification thresholds come from a versioned config, not literals in components.
- **033** Cross-check logic is a pure function with unit tests for consistent, mildly inconsistent, and wildly inconsistent inputs.
- **034** All fields present in `test_sessions.environment` and non-null for completed sessions.

---

## 5.5 Introduction, practice, session control (FR-036 – FR-052)

| ID | Pri | Requirement |
|---|---|---|
| SENS-FR-036 | MVP | A practice stage shall precede scored testing, shall be unscored, and shall be extendable by the user beyond its minimum. |
| SENS-FR-037 | MVP | The introduction shall present an estimated duration computed from the configured trial budget and measured per-trial timing, expressed as a range. |
| SENS-FR-038 | MVP | Three session modes — Quick, Standard, Advanced — shall be selectable, differing in candidate count, round count, trial counts, and test coverage. |
| SENS-FR-039 | MVP | The introduction shall disclose that candidate sensitivities are blinded. |
| SENS-FR-040 | MVP | A motion-discomfort advisory shall be shown before the first pointer lock. |
| SENS-FR-041 | MVP | The active test HUD shall display only round, progress, and the pause hint. |
| SENS-FR-042 | MVP | No score, accuracy, streak, or candidate identity shall be displayed during scored testing. |
| SENS-FR-043 | MVP | ESC shall pause the session, release pointer lock, and present a pause overlay with resume, restart-round, and abort. |
| SENS-FR-044 | MVP | Resuming shall require re-acquiring pointer lock and shall present a countdown before the next trial. |
| SENS-FR-045 | MVP | Completed round aggregates shall be persisted locally and transmitted idempotently, so that a disconnection loses at most the in-progress round. |
| SENS-FR-046 | MVP | Loss of window focus or document visibility during a trial shall invalidate that trial and pause the session. |
| SENS-FR-047 | MVP | An abandoned session shall be resumable within 24 hours if the environment fingerprint matches; otherwise the user shall be offered a fresh start. |
| SENS-FR-048 | MVP | Sustained frame degradation shall raise a test-quality warning offering continue-with-reduced-confidence, switch-to-Quick, or abort. |
| SENS-FR-049 | MVP | A session shall be abortable at any point, and aborting shall never generate a recommendation. |
| SENS-FR-050 | MVP | Restarting a round shall discard that round's trials as `invalidated` and re-run it with a new seed. |
| SENS-FR-051 | POST | Scheduled rest breaks shall be offered in Advanced mode between rounds. |
| SENS-FR-052 | POST | The session shall be resumable across devices for registered users. |

**Acceptance criteria**
- **036** Practice cannot complete before 6 acquisitions; a "more practice" control repeats it.
- **037** Duration text is derived at runtime; a unit test asserts changing the trial budget changes the displayed range.
- **038** Each mode's plan is data, defined in the session-plan config, not branching code.
- **041/042** A DOM assertion in E2E confirms no element containing score-like text exists during a scored round.
- **043/044** Pause is reachable by ESC; resume re-locks and counts down from 3.
- **045** Killing the network after round 2 and restoring it replays round 2 exactly once (idempotency key `(session_id, presentation_order)`).
- **046** Dispatching `visibilitychange` mid-trial produces a trial with `validity = invalid`, `invalid_reason = focus_lost`.
- **048** Threshold-driven; the warning screen is reachable in a test harness by injecting synthetic frame times.
- **049** Aborted sessions have `status = abandoned` and no `recommendations` row.

---

## 5.6 Test engine and aim tests (FR-053 – FR-062)

| ID | Pri | Requirement |
|---|---|---|
| SENS-FR-053 | MVP | The test engine shall render a simulated first-person camera with a configurable horizontal FOV, and shall place all targets in angular coordinates. |
| SENS-FR-054 | MVP | Mouse counts shall be converted to view rotation using the active candidate's cm/360 and the session DPI, with no browser- or OS-applied scaling where `unadjustedMovement` is granted. |
| SENS-FR-055 | MVP | All randomisation shall derive from a stored seed such that a session's target sequence is exactly reproducible. |
| SENS-FR-056 | MVP | Target motion shall be an analytic function of elapsed time, not a per-frame integration. |
| SENS-FR-057 | MVP | The engine shall implement the MVP test set: Reaction, Flick, Micro Adjustment, Tracking, Target Switching, Precision, and 360 Comfort. |
| SENS-FR-058 | MVP | Each test shall be defined declaratively (targets, timing, scoring, validity rules) and shall share one lifecycle implementation. |
| SENS-FR-059 | MVP | The engine shall classify each trial as `valid`, `degraded`, or `invalid` with a reason code. |
| SENS-FR-060 | MVP | Procedurally invalid trials shall be replaced so that the per-round valid-sample target is met, up to a bounded number of replacements. |
| SENS-FR-061 | POST | The engine shall implement Wide Flick, Strafe Tracking, Slide Tracking, Speed, Recoil Control, ADS, and Scope Calibration tests. |
| SENS-FR-062 | POST | The engine shall support per-scope candidate calibration for games with verified scope models. |

**Acceptance criteria**
- **053** A unit test asserts that a target placed at 30° yaw projects to the expected screen x for a given FOV, and that FOV changes move it correspondingly.
- **054** Given DPI 800 and a candidate of 30 cm/360, the engine's counts-per-360 equals `30 × 800 / 2.54 = 9448.8189…`, and feeding exactly that many counts produces exactly 360.0° of yaw within 1e-9 (doc 11 §11.3).
- **055** Replaying a stored seed reproduces an identical target sequence; asserted in the engine harness.
- **056** Target position at time *t* is computed from *t* alone; a test that skips frames produces identical positions at the same *t*.
- **057** All seven are present and reachable.
- **058** Adding a test requires a new definition file and no change to lifecycle code — asserted by a fixture test that runs a synthetic definition.
- **059** Each reason code has a unit test.
- **060** Replacement count is capped (default 25% of round size) and exceeding the cap flags the round.

---

## 5.7 Calibration engine (FR-063 – FR-072)

| ID | Pri | Requirement |
|---|---|---|
| SENS-FR-063 | MVP | The calibration engine shall operate in log-sensitivity space and shall be entirely game-independent. |
| SENS-FR-064 | MVP | The engine shall derive an initial bracket from the user's current cm/360 when available, and from a documented default otherwise. |
| SENS-FR-065 | MVP | The bracket shall be clipped by the physical constraint derived from mousepad width and the 360 Comfort Test. |
| SENS-FR-066 | MVP | Each round shall test at least three candidates, with presentation order counterbalanced and candidate identity concealed. |
| SENS-FR-067 | MVP | The engine shall model a session-wide learning/fatigue trend as a nuisance term and remove it before comparing candidates. |
| SENS-FR-068 | MVP | The engine shall fit a response surface over candidate scores and select the next bracket from the fit, with a documented fallback when the fit is not concave. |
| SENS-FR-069 | MVP | The engine shall stop on any of: convergence of bracket width, statistical indistinguishability of candidates, exhaustion of trial budget, or an environment/fatigue abort condition — and shall record which. |
| SENS-FR-070 | MVP | When no candidate is statistically distinguishable, the engine shall return a comfort range with low confidence rather than a point estimate, and the result UI shall present that as a valid outcome. |
| SENS-FR-071 | MVP | Candidate assignment, ordering, and all seeds shall be persisted so that any recommendation can be recomputed exactly. |
| SENS-FR-072 | POST | The engine shall support per-dimension optima (e.g. a tracking-optimal and a flick-optimal sensitivity) and report the trade-off. |

**Acceptance criteria**
- **063** `core/calibration` has zero imports from `game-adapters` — enforced by an ESLint boundary rule and a unit test.
- **064** Cold-start bracket equals the documented default in doc 13 §13.3.
- **065** Given a 28 cm pad, no generated candidate exceeds the derived limit.
- **066** Order across candidates over a session is balanced within ±1 occurrence per position.
- **067** Synthetic data with an injected linear drift recovers the drift coefficient within tolerance and returns unbiased candidate estimates.
- **068** Synthetic concave data recovers the true optimum within tolerance; synthetic monotone data triggers the bracketing fallback.
- **069** `calibration_rounds.decision` is populated for every round.
- **070** Synthetic flat data produces `verdict = indistinguishable`, a range, and confidence below the documented ceiling for that state.
- **071** Re-running the engine offline against stored trials reproduces the stored recommendation bit-for-bit.

---

## 5.8 Scoring, analysis, aim profile (FR-073 – FR-077)

| ID | Pri | Requirement |
|---|---|---|
| SENS-FR-073 | MVP | Raw metrics shall be normalised before combination; no score shall sum quantities of different units. |
| SENS-FR-074 | MVP | Six skill dimensions (Flick, Precision, Tracking, Speed, Control, Consistency) shall be computed from defined metric sets with documented weights. |
| SENS-FR-075 | MVP | The scoring model shall be versioned, and every stored result shall reference the version that produced it. |
| SENS-FR-076 | MVP | An aim profile shall be assigned by deterministic, documented rules over dimension scores and the recommended sensitivity band. |
| SENS-FR-077 | MVP | The aim profile shall be accompanied by a generated explanation citing the specific measured values that triggered the classification. |

**Acceptance criteria**
- **073** A lint-level review plus unit tests over the scoring pipeline confirm every combination happens post-normalisation; a property test asserts that scaling a metric's unit (e.g. ms → s) leaves dimension scores unchanged.
- **074** Weights live in the versioned parameter set; changing a weight changes output without a code change.
- **075** `recommendations.scoring_algorithm_version_id` is non-null; a v1 result remains renderable after v2 ships (integration test).
- **076** The classifier is a pure function with a fixture table covering every profile plus the insufficient-data case.
- **077** The explanation string contains at least one numeric value drawn from the session.

---

## 5.9 Results and game conversion (FR-078 – FR-085)

| ID | Pri | Requirement |
|---|---|---|
| SENS-FR-078 | MVP | The user shall be able to change the output game on the result page without re-running any test. |
| SENS-FR-079 | MVP | For a game whose sensitivity model is unverified, the system shall not display any converted sensitivity value; it shall display the verification state and the canonical targets (cm/360, counts/360) instead. |
| SENS-FR-080 | MVP | For verified games the system shall display DPI, hipfire sensitivity, and — where the model is verified — ADS and per-scope sensitivities and the relevant FOV field. |
| SENS-FR-081 | MVP | Every displayed setting shall be individually copyable, and the full block shall be copyable at once. |
| SENS-FR-082 | MVP | The result shall present recommended cm/360, high-performance range, confidence index, aim profile, response curve, Aim DNA, and per-dimension breakdown. |
| SENS-FR-083 | MVP | The response curve shall plot the player's own candidate scores with error bars, the fitted curve, and the credible band. |
| SENS-FR-084 | MVP | Strengths and improvement areas shall be derived from dimension scores and worded non-punitively. |
| SENS-FR-085 | MVP | Conversion method (360-distance or monitor-distance coefficient) shall be user-selectable per scope where more than one is defensible, with the default documented and explained. |

**Acceptance criteria**
- **078** Switching output game issues no write to `test_sessions` and produces settings derived from the stored cm/360.
- **079** E2E: selecting an unverified game shows the verification state and no numeric sensitivity field anywhere in the block.
- **080** Fields rendered are driven by the adapter's declared scope set, not by hardcoded per-game JSX.
- **081** Clipboard write is verified in E2E; a visible confirmation appears.
- **083** The chart renders from `calibration_candidates` + `candidate_scores`, not from a fixture.
- **085** Default per scope comes from adapter configuration; the explanation names the trade-off in one sentence.

---

## 5.10 Validation and fine-tuning (FR-086 – FR-089)

| ID | Pri | Requirement |
|---|---|---|
| SENS-FR-086 | MVP | A validation test shall compare the original and recommended sensitivities in blinded, counterbalanced paired blocks. |
| SENS-FR-087 | MVP | Validation shall report per-metric deltas with confidence intervals, and shall report "no measurable difference" when the interval includes zero. |
| SENS-FR-088 | MVP | If the recommended sensitivity performs worse, the system shall state so, reduce the confidence index, retain the original as the standing recommendation, and offer fine-tuning or re-calibration. |
| SENS-FR-089 | MVP | Fine-tuning shall present blinded candidates around the recommendation and refine the estimate using the same engine. |

**Acceptance criteria**
- **086** Block order is counterbalanced; candidate identity is absent from the DOM during the run.
- **087** Deltas carry bootstrap CIs; wording is generated from a verdict enum, never free-form.
- **088** Synthetic data where B is worse produces `verdict = worse`, a reduced confidence, and the original retained in `recommendations`.
- **089** Fine-tune sessions link to the parent via `parent_session_id` and produce a superseding recommendation with `superseded_by` set on the old one.

---

## 5.11 Accounts, hardware profiles, history (FR-090 – FR-099)

| ID | Pri | Requirement |
|---|---|---|
| SENS-FR-090 | MVP | Registered users shall see a history list of their sessions with date, game, DPI, recommended cm/360, score, confidence, and aim profile. |
| SENS-FR-091 | MVP | Guests shall be able to complete a full calibration and view results without an account. |
| SENS-FR-092 | MVP | A guest shall be able to claim their completed session by registering or signing in, with the claim authorised server-side from the guest cookie. |
| SENS-FR-093 | MVP | Users shall be able to compare two sessions side by side, with a statistical statement about whether the change is meaningful. |
| SENS-FR-094 | MVP | Users shall be able to create, rename, edit, set-default, and soft-delete hardware profiles. |
| SENS-FR-095 | MVP | Sessions shall be attributed to a hardware profile, and comparisons across differing hardware shall be flagged. |
| SENS-FR-096 | MVP | Users shall be able to store per-game settings derived from a recommendation. |
| SENS-FR-097 | MVP | Users shall be able to register with email and password, verify their email, and reset a forgotten password. |
| SENS-FR-098 | MVP | Users shall be able to export their data and to delete their account. |
| SENS-FR-099 | POST | Google and Discord sign-in shall be supported. |

**Acceptance criteria**
- **090** List is paginated, ordered by `started_at desc`, and scoped to the actor in SQL.
- **092** The claim endpoint reads the guest token from an HttpOnly cookie; a request supplying an arbitrary `session_id` in the body is rejected.
- **093** Comparison states "meaningful" only when the recommendation intervals do not overlap, per doc 17 §17.9.
- **094** Soft delete preserves historical session snapshots.
- **095** A cross-hardware comparison renders the flag.
- **097** Verification and reset tokens are single-use, hashed at rest, and expire.
- **098** Export is machine-readable and complete; deletion schedules a documented purge.

---

## 5.12 Platform, sharing, settings, analytics (FR-100 – FR-108)

| ID | Pri | Requirement |
|---|---|---|
| SENS-FR-100 | MVP | On touch/mobile devices, calibration shall be gated with an explanatory screen and a hand-off to desktop; all read-only surfaces shall remain available. |
| SENS-FR-101 | MVP | The application shall respect `prefers-reduced-motion` throughout. |
| SENS-FR-102 | MVP | The application shall provide a custom scrollbar without breaking native scrolling, keyboard scrolling, or overlay-scrollbar platforms. |
| SENS-FR-103 | MVP | A settings screen shall allow unit preference (cm/in), motion preference override, locale, and consent management. |
| SENS-FR-104 | MVP | The application shall emit the defined product analytics events without transmitting raw pointer telemetry. |
| SENS-FR-105 | MVP | The application shall support English and Simplified Chinese for game-facing surfaces at minimum. |
| SENS-FR-106 | POST | Results shall be shareable as an image card. |
| SENS-FR-107 | FUT | An AI explanation layer shall be able to narrate a result without producing or altering it. |
| SENS-FR-108 | FUT | Sensitivity drift monitoring shall prompt periodic short re-checks. |

**Acceptance criteria**
- **100** Calibration routes on a touch-only device render SCR-050; history and results render normally.
- **101** Verified by an automated audit that fails if any animation runs under the reduced-motion media query outside an allowlist.
- **102** Keyboard PageUp/PageDown, scroll anchoring, and `scrollIntoView` behave natively; the custom scrollbar is styling only.
- **104** An automated check asserts the analytics payload schema contains no per-event pointer arrays.
- **105** All strings on game selection, hardware setup, results and game settings resolve in both locales.

---

## 5.13 Requirement counts

| Category | MVP | POST | FUT | Total |
|---|---|---|---|---|
| Entry / information | 7 | 1 | 1 | 9 |
| Game selection | 7 | 1 | 0 | 8 |
| Hardware setup | 11 | 0 | 0 | 11 |
| Environment check | 6 | 1 | 0 | 7 |
| Session control | 15 | 2 | 0 | 17 |
| Test engine | 8 | 2 | 0 | 10 |
| Calibration | 9 | 1 | 0 | 10 |
| Scoring | 5 | 0 | 0 | 5 |
| Results / conversion | 8 | 0 | 0 | 8 |
| Validation / fine-tune | 4 | 0 | 0 | 4 |
| Accounts / history | 9 | 1 | 0 | 10 |
| Platform / misc | 6 | 1 | 2 | 9 |
| **Total** | **95** | **10** | **3** | **108** |
