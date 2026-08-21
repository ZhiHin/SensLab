# 07 — Business Rules

Related: [05-functional-requirements.md](05-functional-requirements.md) · [13-calibration-algorithm.md](13-calibration-algorithm.md) · [33-requirement-traceability.md](33-requirement-traceability.md)

A business rule is an **invariant**. Requirements say what the system does; rules say what must
remain true no matter what any requirement, screen, or future feature does. Where a rule and a
feature conflict, the rule wins and the feature changes.

Every rule below is enforceable — the "enforced by" column names the concrete mechanism.

---

## 7.1 Access and identity

| ID | Rule | Rationale | Enforced by |
|---|---|---|---|
| SENS-BR-001 | A user shall never be required to create an account before completing their first calibration and viewing its result. | The product's claim is testable in one sitting; an account wall converts a measurement tool into a lead-generation form. | Route guards permit guest sessions; E2E guest journey in CI. |
| SENS-BR-002 | Self-reported information may constrain or seed the calibration, but shall never determine the recommended sensitivity. | The entire differentiation of SensLab (doc 01 §1.6). | The calibration engine's public API accepts only a bracket and constraints; no questionnaire value reaches the scoring path. Asserted by a unit test on the engine's input type. |
| SENS-BR-003 | Guest results expire. Unclaimed guest sessions and their derived data are purged after 7 days. | Storage hygiene and privacy minimisation. | Retention job + `guest_sessions.expires_at`. |
| SENS-BR-004 | Mouse DPI is the only mandatory hardware input. | Friction kills the funnel at the first form (persona P1). | Zod schema: all other hardware fields optional. |
| SENS-BR-005 | When DPI provenance is not `known`, the system shall present the result in DPI-independent units alongside cm/360 and shall apply the documented confidence penalty. | A converted game sensitivity is only as correct as the DPI it was derived from. | Confidence model input; result renderer branch; unit tests. |

---

## 7.2 Measurement integrity

| ID | Rule | Rationale | Enforced by |
|---|---|---|---|
| SENS-BR-006 | Reaction time shall never be an input to the sensitivity recommendation. | Reaction time is a property of the player, not of the sensitivity; including it would add variance and no signal. | `reaction_time` metrics are excluded from every dimension weight set; asserted by a test over the scoring parameter set. |
| SENS-BR-007 | During scored testing, the system shall not reveal which candidate is active, nor display any score, accuracy, streak, or comparative feedback. | Knowing the candidate biases effort and perception; knowing the score turns measurement into performance. | HUD component contains no score binding; E2E DOM assertion; candidate label stored only as an opaque blind label until the session completes. |
| SENS-BR-008 | Candidate presentation order shall be randomised and counterbalanced across a session. | Order effects (warm-up, fatigue, learning) are confounded with candidate identity otherwise. | Session planner generates a counterbalanced schedule from the seed; unit test asserts balance within ±1. |
| SENS-BR-009 | A trial shall never be discarded because its result is poor. Only procedurally invalid trials are excluded, and each exclusion carries a reason code. | Discarding bad performance manufactures a flattering, false result. | `validity` enum + `invalid_reason`; reasons are all procedural by construction; code review checklist; a test asserts no reason code references performance. |
| SENS-BR-010 | Environmental degradation shall be recorded and surfaced, never silently absorbed. | A recommendation from a stuttering session is not comparable to one from a clean session. | Per-trial `degraded` flag, session `quality_flags`, confidence penalty, result-page disclosure. |
| SENS-BR-011 | Practice trials shall never contribute to any score, metric aggregate, or candidate comparison. | First-contact learning is the largest single confound in a short session. | `is_practice` on rounds and trials; aggregation queries filter it; integration test. |
| SENS-BR-012 | The minimum valid sample size per candidate per test shall be met before that candidate is scored; if it cannot be met, the candidate is marked insufficient rather than estimated. | Small-sample noise masquerading as a difference is the primary failure mode of this product. | Scoring guard + `candidate_scores.n`; unit test. |

---

## 7.3 Game conversion

| ID | Rule | Rationale | Enforced by |
|---|---|---|---|
| SENS-BR-013 | A game sensitivity value shall only be displayed when its adapter's conversion model is marked `verified` for that game version and that scope. | An incorrect converted number is worse than no number: the user will act on it. | Adapter registry `verification_status`; the renderer has no code path that displays a value from an unverified adapter. Unit test asserts the adapter throws rather than returning a value when unverified. |
| SENS-BR-014 | Unverified conversions shall not be shown "with a warning", greyed out, approximate, or behind a disclosure. They shall not be computed at all. | Any rendered number will be copied, regardless of adornment. | As above; E2E asserts absence, not disabled state. |
| SENS-BR-015 | Delta Force Global and 三角洲行动 are distinct games with independent adapters, independent versions, and independent verification state. | They are different builds and may differ in sensitivity behaviour; assuming equality is exactly the kind of guess this product forbids. | Separate `games` rows; a test asserts neither adapter delegates to the other. |
| SENS-BR-025 | The canonical stored value is physical (cm/360 and counts/360). A derived game sensitivity shall never be the sole persisted representation of a recommendation. | Game constants change with patches; a stored game number silently rots, a stored cm/360 does not. | `recommendations.recommended_cm360` NOT NULL; `recommendation_game_settings` is derived and regenerable. |
| SENS-BR-026 | Every displayed converted setting shall record the adapter version and conversion method used to produce it. | Reproducibility and post-hoc correction after a game patch. | Columns on `recommendation_game_settings`; NOT NULL. |

---

## 7.4 Recommendation honesty

| ID | Rule | Rationale | Enforced by |
|---|---|---|---|
| SENS-BR-016 | Improvement shall be claimed only when the measured effect's confidence interval excludes zero. Otherwise the verdict is "no measurable difference". | The single most tempting lie in this product. | Verdict is computed by a pure function returning an enum; UI copy is selected from that enum and cannot be authored per-case. |
| SENS-BR-017 | When no candidate is statistically distinguishable, the system shall report a comfort range and low confidence, and shall not fabricate a point recommendation. | A flat response curve is a real, common, informative outcome. | Calibration verdict enum `indistinguishable`; confidence ceiling for that state; a dedicated result variant. |
| SENS-BR-027 | The confidence value shall be computed from defined inputs and shall never be randomised, hardcoded, or floored to look reassuring. | Fake confidence destroys the product's only real asset. | Pure function with unit tests; a test asserts the function is a deterministic function of its inputs and that no constant floor above the documented minimum exists. |
| SENS-BR-028 | Confidence shall never be displayed above the documented ceiling for the current confidence-model version. | Until the model is empirically calibrated against test-retest data it is an index, not a probability. | Clamp in the confidence model; unit test at the boundary. |
| SENS-BR-022 | The product shall not claim that browser measurement reproduces any game engine's input behaviour. Every recommendation surface shall carry the browser-limitation caveat. | Truthfulness, and it is also the honest basis for the validation step. | Content review checklist; UI test asserting the caveat element's presence on result surfaces. |
| SENS-BR-023 | Calibration shall not be offered on input hardware for which the measurement is not meaningful (no pointer lock; touch-only input). | A degraded calibration produces a confident, wrong answer. | Capability gate; no fallback path exists in the router. |

---

## 7.5 Versioning and reproducibility

| ID | Rule | Rationale | Enforced by |
|---|---|---|---|
| SENS-BR-020 | Every stored recommendation shall reference the exact scoring, calibration, and confidence model versions that produced it, and shall remain explainable after those models change. | A result the user saw last month must still be interpretable next year. | NOT NULL FKs to `algorithm_versions`; renderer resolves copy and weights by version; integration test renders a v1 result under a v2 deployment. |
| SENS-BR-029 | Algorithm parameter sets shall be immutable once released. A change produces a new version, never an edit. | Otherwise historical results silently change meaning. | `algorithm_versions` rows are insert-only; a database rule/trigger and a migration policy forbid updates to released rows. |
| SENS-BR-030 | Any recommendation shall be recomputable from stored trial-level data plus its algorithm version. | Auditability; also the mechanism for retroactive correction. | Golden-session test recomputes and asserts equality. |
| SENS-BR-031 | Randomisation shall be seeded and the seed persisted. | Reproducibility of the exact stimulus sequence the player faced. | `test_sessions.seed`, `test_trials.seed`; engine harness replay test. |

---

## 7.6 Data handling

| ID | Rule | Rationale | Enforced by |
|---|---|---|---|
| SENS-BR-032 | Raw per-event pointer telemetry shall not be persisted by default. | Volume, privacy, and it is not needed for the recommendation. | No table accepts it; ingest schema rejects arrays above the aggregate size limit. |
| SENS-BR-033 | Where raw telemetry is retained, it shall be consent-gated, separately stored from operational data, retention-bound, and revocable. | Privacy minimisation and honest research practice. | `research_consents` + `telemetry_batches` in object storage with lifecycle rules. |
| SENS-BR-034 | Ownership shall be determined server-side from the authenticated actor. Client-supplied owner identifiers shall never be trusted. | Basic authorisation correctness. | Repository layer requires an `ActorContext`; every query filters by actor in SQL; an automated test attempts cross-tenant access on every owned resource. |
| SENS-BR-035 | A session's hardware and environment context shall be snapshotted immutably at session creation. | Editing a profile must not rewrite history. | `test_sessions.hardware_snapshot` NOT NULL; no update path. |
| SENS-BR-018 | A calibration result belongs to exactly one hardware profile (or to an explicit ad-hoc snapshot for guests). | A recommendation is only valid for the hardware that produced it. | FK + snapshot; history grouped by profile. |
| SENS-BR-019 | Comparisons between sessions with materially different hardware or environment shall be flagged as not directly comparable. | Two numbers from different setups are not a trend. | Comparison service computes a comparability verdict; UI renders the flag. |

---

## 7.7 Experience

| ID | Rule | Rationale | Enforced by |
|---|---|---|---|
| SENS-BR-021 | No visual effect shall be permitted to affect measurement. Where a conflict exists, the effect is removed. | The product is a measuring instrument first. | Scored-test screens run a restricted renderer with a fixed effect allowlist; `SENS-NFR-002/003/004` gate CI. |
| SENS-BR-024 | Duration claims shall be computed from the configured trial budget and measured timing, never hardcoded. | Honesty, and the budget will change. | Duration is derived at runtime; a test asserts changing the budget changes the displayed estimate. |
| SENS-BR-036 | Weak performance shall be described factually and constructively; the product shall not shame, rank, or gamify poor results. | These are people's hands. Also, discouraged users stop measuring. | Copy is generated from a bounded vocabulary of framings; content review checklist. |
| SENS-BR-037 | No screen shall present another individual's sensitivity as an input, default, or suggestion. | Directly contradicts the product thesis (doc 03 §3.5). | Design review; no such data model exists at MVP. |

---

## 7.8 Rule conflict resolution order

When rules appear to conflict, resolve in this order:

1. **Measurement integrity** (§7.2) — a wrong measurement invalidates everything downstream.
2. **Honesty** (§7.3, §7.4) — a correct measurement communicated dishonestly is worse than none.
3. **Reproducibility** (§7.5) — results must survive their own algorithms.
4. **Data handling** (§7.6).
5. **Access** (§7.1).
6. **Experience** (§7.7).

Example resolution: `SENS-BR-001` (no account required) vs `SENS-BR-003` (guest data expires) —
no conflict; the guest completes and views, and expiry is disclosed. Example resolution:
`SENS-BR-021` (no effect may affect measurement) vs a motion design goal — measurement wins,
the effect is cut, and the design document records it.

---

## 7.9 Rule → requirement index

| Rule | Primary requirements |
|---|---|
| BR-001 | FR-091, FR-001 |
| BR-002 | FR-025, FR-063 |
| BR-003 | FR-091, SEC-018 |
| BR-004 | FR-018, FR-023 |
| BR-005 | FR-020, FR-021 |
| BR-006 | FR-057, FR-074 |
| BR-007 | FR-042, FR-066 |
| BR-008 | FR-066 |
| BR-009 | FR-059, FR-060 |
| BR-010 | FR-032, FR-048 |
| BR-011 | FR-036 |
| BR-012 | FR-070 |
| BR-013/014 | FR-079, FR-080 |
| BR-015 | FR-015 |
| BR-016 | FR-087, FR-088 |
| BR-017 | FR-070 |
| BR-018/019 | FR-095 |
| BR-020 | FR-006, FR-075 |
| BR-021 | NFR-002, NFR-004 |
| BR-022 | FR-004, NFR-043 |
| BR-023 | FR-030, FR-100 |
| BR-024 | FR-037 |
| BR-025/026 | FR-078, FR-080 |
| BR-027/028 | FR-082 |
| BR-029/030/031 | FR-071, NFR-015 |
| BR-032/033 | NFR-022, NFR-041 |
| BR-034 | SEC-005 |
| BR-035 | FR-028 |
| BR-036 | FR-084 |
| BR-037 | — (design constraint) |
