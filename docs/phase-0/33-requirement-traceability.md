# 33 — Requirement Traceability

Related: [05-functional-requirements.md](05-functional-requirements.md) · [07-business-rules.md](07-business-rules.md) · [24-screen-inventory.md](24-screen-inventory.md) · [34-phase-1-backlog.md](34-phase-1-backlog.md)

---

## 33.1 ID namespaces

| Prefix | Meaning | Defined in |
|---|---|---|
| `SENS-FR-###` | Functional requirement | 05 |
| `SENS-NFR-###` | Non-functional requirement | 06 |
| `SENS-BR-###` | Business rule (invariant) | 07 |
| `SENS-SEC-###` | Security requirement | 23 |
| `SENS-UX-###` | UX / design / accessibility requirement | 26, 27, 28 |
| `SCR-###` | Screen | 24 |
| `EV-###` | External verification item | 36 |
| `ADR-###` | Architecture decision | 32 |
| `R-##` | Risk | 31 |
| `T-##` | Test class | 29 |

**Stability rule:** IDs are permanent. A withdrawn item is marked `WITHDRAWN` in place and its ID
is never reused.

---

## 33.2 Test-class shorthand

| Code | Test class |
|---|---|
| `T-U` | Unit / property test in `core/` or `game-adapters/` |
| `T-E` | Engine harness (headless deterministic) |
| `T-S` | Synthetic-player end-to-end |
| `T-I` | Integration (database, services, authorisation) |
| `T-P` | Playwright browser integration / E2E |
| `T-A` | Accessibility audit |
| `T-F` | Performance / frame-budget gate |
| `T-C` | CI structural check (boundaries, greps, bundle, secrets) |

---

## 33.3 Master traceability matrix — MVP functional requirements

| Requirement | Business rules | Screens | Data | Tests | Phase |
|---|---|---|---|---|---|
| FR-001 landing CTA, no account | BR-001 | SCR-001 | — | T-P | 10 |
| FR-002 scroll narrative | — | SCR-001 | — | T-P, T-F | 10 |
| FR-003 pointer-reactive background | UX-023 | SCR-001 | — | T-A | 10 |
| FR-004 methodology page | BR-022 | SCR-002 | — | T-P | 10 |
| FR-005 per-game verification state | BR-013 | SCR-002, SCR-010 | `game_versions` | T-I | 5 |
| FR-006 algorithm versions on results | BR-020 | SCR-031 | `algorithm_versions` | T-I | 7 |
| FR-009 legal surfaces | — | SCR-003/004 | — | T-P | 10 |
| FR-010–012 game selection, engine-independence | BR-002 | SCR-010 | `games`, `game_versions` | T-U, T-I | 5 |
| FR-013 generic path | BR-025 | SCR-010, SCR-032 | `test_sessions.primary_game_version_id` NULL | T-P | 5 |
| FR-014 tile verification state | BR-013/014 | SCR-010 | `game_sensitivity_models` | T-I | 5 |
| FR-015 DF Global ≠ 三角洲行动 | BR-015 | SCR-010 | two `games` rows | T-U | 5 |
| FR-016 change output game later | BR-025 | SCR-032 | `recommendation_game_settings` | T-P | 7 |
| FR-018 DPI required, range-validated | BR-004 | SCR-011 | `hardware_profiles.dpi` | T-U, T-I | 1 |
| FR-019–021 unknown-DPI path, provenance, consequences | BR-005 | SCR-011, SCR-031, SCR-032 | `dpi_source` | T-U, T-P | 2 |
| FR-022–024 optional fields, non-blocking, explanations | BR-004 | SCR-011 | `hardware_profiles` | T-P, T-A | 1 |
| FR-025 current sens → bracket centre | BR-002 | SCR-011 | — | T-U | 4 |
| FR-026 pad width constrains search | — | SCR-011 | `mousepad_width_mm` | T-U | 4 |
| FR-027 saved hardware profiles | BR-018 | SCR-011, SCR-043 | `hardware_profiles` | T-I | 9 |
| FR-028 immutable hardware snapshot | BR-035 | — | `test_sessions.hardware_snapshot` | T-I | 1 |
| FR-029–030 pointer lock detection and hard block | BR-023 | SCR-012, SCR-051 | `environment` | T-E, T-P | 2 |
| FR-031–032 frame probe and classification | BR-010 | SCR-012 | `environment_class` | T-E, T-F | 2 |
| FR-033 DPI plausibility | BR-005 | SCR-012 | `session_quality_flags` | T-U | 4 |
| FR-034 environment fingerprint | NFR-033 | SCR-012 | `test_sessions.environment` | T-I | 2 |
| FR-036 practice, unscored, extendable | BR-011 | SCR-014 | `is_practice` | T-E, T-I | 2 |
| FR-037 computed duration | BR-024 | SCR-013 | — | T-U | 3 |
| FR-038 three modes | — | SCR-013 | `test_sessions.mode` | T-U | 4 |
| FR-039 blinding disclosed | BR-007 | SCR-013 | — | T-P | 4 |
| FR-040 motion advisory | UX-024 | SCR-013 | — | T-A | 2 |
| FR-041–042 minimal HUD, no score | BR-007 | SCR-017–021 | — | T-P | 3 |
| FR-043–044 pause, resume with countdown | UX-025 | SCR-022 | — | T-E, T-P | 2 |
| FR-045 local persistence + idempotent send | NFR-016/018 | — | `test_rounds.presentation_order` | T-I | 2 |
| FR-046 focus loss invalidates | BR-009 | SCR-022 | `invalid_reason` | T-E | 2 |
| FR-047 resume within 24 h | — | SCR-013 | `status`, `environment` | T-I | 9 |
| FR-048 quality warning | BR-010 | SCR-023 | `session_quality_flags` | T-E, T-F | 2 |
| FR-049–050 abort, restart round | BR-009 | SCR-022 | `status`, `invalidated` | T-I | 2 |
| FR-053–054 angular camera, exact count→angle | — | lab | — | T-U, T-E | 2 |
| FR-055 seeded reproducibility | BR-031 | lab | `seed`, `stimulus_seed` | T-E | 2 |
| FR-056 analytic target motion | — | lab | — | T-E | 2 |
| FR-057 MVP test set | BR-006 | SCR-015–021, SCR-024 | `test_definitions` | T-E | 3 |
| FR-058 declarative definitions | — | — | `test_definitions.config` | T-E | 3 |
| FR-059–060 validity classes, replacement | BR-009/012 | — | `validity`, `invalid_reason`, `is_replacement` | T-E, T-U | 3 |
| FR-063 log-space, game-independent engine | BR-002 | — | — | T-U, T-C | 4 |
| FR-064–065 bracket, constraint clipping | — | — | `calibration_rounds` | T-U | 4 |
| FR-066 ≥3 candidates, counterbalanced, blind | BR-007/008 | — | `calibration_candidates.blind_label` | T-U, T-P | 4 |
| FR-067 drift model | — | — | `calibration_rounds.drift_*` | T-U, T-S | 4 |
| FR-068 response-surface fit + fallback | — | — | `calibration_rounds.fit_*` | T-U, T-S | 4 |
| FR-069 stopping conditions recorded | — | — | `calibration_rounds.decision` | T-U | 4 |
| FR-070 indistinguishable verdict | BR-017 | SCR-031 | `recommendations.verdict` | T-U, T-S, T-P | 4 |
| FR-071 full reproducibility of the search | BR-030/031 | — | seeds + candidates | T-I | 4 |
| FR-073–074 normalisation, six dimensions | — | SCR-031 | `candidate_scores` | T-U | 4 |
| FR-075 versioned scoring | BR-020/029 | SCR-031 | `algorithm_versions` | T-I | 4 |
| FR-076–077 aim profile + explanation | — | SCR-031 | `aim_profiles`, `aim_profile_explanation` | T-U | 7 |
| FR-078 output-game switching | BR-025 | SCR-032 | `recommendation_game_settings` | T-P | 7 |
| FR-079 unverified → no number | BR-013/014 | SCR-032 | absence of a row | T-U, T-P | 5 |
| FR-080 settings fields data-driven | BR-026 | SCR-032 | `game_scopes` | T-I | 5 |
| FR-081 copy controls | — | SCR-032 | — | T-P, T-A | 7 |
| FR-082–083 result content, response curve | BR-027 | SCR-031 | `recommendations.response_curve` | T-P | 7 |
| FR-084 strengths / improvement areas | BR-036, UX-018 | SCR-031 | `recommendation_dimension_scores` | T-U | 7 |
| FR-085 conversion method selectable | — | SCR-032 | `conversion_method` | T-U, T-P | 5 |
| FR-086–087 blind paired validation + intervals | BR-016 | SCR-033 | `validation_runs`, `validation_metric_deltas` | T-U, T-S, T-P | 8 |
| FR-088 honest loss handling | BR-016 | SCR-033 | `accepted_counts_360`, `confidence_after` | T-U, T-I | 8 |
| FR-089 fine-tuning | BR-007 | SCR-034 | `parent_recommendation_id` | T-U, T-P | 8 |
| FR-090 history list | — | SCR-041 | `test_sessions`, `recommendations` | T-I, T-P | 9 |
| FR-091 guest completes and views | BR-001/003 | all | `guest_sessions` | T-P | 9 |
| FR-092 server-side guest claim | SEC-018, BR-034 | SCR-040, SCR-060 | `guest_sessions.claimed_by_user_id` | T-I | 9 |
| FR-093 session comparison | BR-019 | SCR-042 | — | T-U, T-P | 9 |
| FR-094–095 hardware profile CRUD, attribution | BR-018/019 | SCR-043 | `hardware_profiles` | T-I | 9 |
| FR-096 store per-game settings | — | SCR-032 | `user_game_settings` | T-I | 9 |
| FR-097 email auth | SEC-002/010/011 | SCR-060–063 | `auth_identities`, `auth_tokens` | T-I | 1, 9 |
| FR-098 export and deletion | SEC-020/021 | SCR-045 | all owned tables | T-I | 9 |
| FR-100 mobile gate | BR-023, UX-026 | SCR-050 | — | T-P | 10 |
| FR-101 reduced motion | UX-023 | all | — | T-A | 10 |
| FR-102 custom scrollbar | UX-012 | all | — | T-A, T-P | 10 |
| FR-103 settings screen | SEC-022 | SCR-045 | `user_profiles`, `research_consents` | T-I | 9 |
| FR-104 analytics without telemetry | BR-032 | — | `analytics_events` | T-C, T-I | 10 |
| FR-105 en + zh-Hans | — | all | `display_name_localized` | T-P | 10 |

---

## 33.4 Business rule → enforcement mechanism → test

| Rule | Mechanism | Test |
|---|---|---|
| BR-001 guest-first | Route guards permit guest sessions | T-P guest journey |
| BR-002 self-report never decides | Engine input type excludes questionnaire values | T-U engine signature |
| BR-003 guest expiry | `expires_at` + retention job | T-I retention |
| BR-004 DPI-only requirement | Zod schema | T-U, T-P |
| BR-005 DPI provenance consequences | Confidence + renderer branch | T-U, T-P |
| BR-006 reaction never decides sensitivity | Excluded from every weight set | T-U parameter-set assertion |
| BR-007 blinding | No score binding in HUD; server-held mapping | T-P DOM assertion |
| BR-008 counterbalancing | Latin-square generator | T-U balance assertion |
| BR-009 no performance-based exclusion | Reason codes are all procedural | T-U reason-code audit |
| BR-010 degradation surfaced | Flags + confidence + UI | T-E, T-I |
| BR-011 practice excluded | `is_practice` filters | T-I aggregation |
| BR-012 minimum sample | Scoring guard | T-U |
| BR-013/014 unverified never rendered | Adapter throws | T-U registry sweep, T-P absence |
| BR-015 separate games | No cross-delegation | T-U |
| BR-016 improvement only with a CI excluding zero | Verdict enum drives copy | T-U, T-S |
| BR-017 flat curve honesty | `indistinguishable` verdict + confidence cap | T-S, T-P |
| BR-018/019 hardware attribution and flags | Snapshot + comparability verdict | T-I |
| BR-020 version pinning | NOT NULL FKs | T-I v1-under-v2 |
| BR-021 no effect affects measurement | Restricted renderer | T-F, T-C |
| BR-022 no engine-reproduction claim | Caveat element | T-P |
| BR-023 no meaningless calibration | Capability gate, no fallback route | T-P |
| BR-024 computed durations | Runtime derivation | T-U |
| BR-025/026 canonical physical value + attribution | NOT NULL columns | T-I |
| BR-027/028 real confidence, hard ceiling | Pure function + clamp | T-U |
| BR-029 immutable parameter sets | Database trigger | T-I |
| BR-030 recomputability | Golden session | T-I |
| BR-031 seeded randomness | Stored seeds | T-E replay |
| BR-032/033 telemetry policy | No table; consent-gated storage | T-C, T-I |
| BR-034 server-side ownership | `ActorContext` + SQL filter | T-I generated cross-tenant suite |
| BR-035 immutable snapshot | No update path | T-I |
| BR-036 non-punitive copy | Bounded framing vocabulary | Content review + T-U |
| BR-037 no other person's sensitivity | No such data model | Design review |

---

## 33.5 Requirement → phase

| Phase | Delivers |
|---|---|
| 1 Foundation | FR-018, FR-022–024, FR-028, FR-097 (foundation), NFR-025–032, SEC-001–007, SEC-014–016, schema, adapter + engine interfaces, CI |
| 2 Aim Engine | FR-029–034, FR-036, FR-043–050, FR-053–056, NFR-001–008, UX-024/025 |
| 3 Core Tests | FR-037, FR-041–042, FR-057–060 |
| 4 Calibration | FR-025–026, FR-038–039, FR-063–075, BR-006–012, BR-017 |
| 5 Game Profiles | FR-005, FR-010–016, FR-079–080, FR-085, BR-013–015, EV-001–009 |
| 6 Advanced Tests | FR-061–062 (post-MVP tests) |
| 7 Results | FR-006, FR-076–078, FR-081–084, UX-013–019 |
| 8 Validation | FR-086–089, BR-016 |
| 9 Accounts | FR-027, FR-047, FR-090–098, FR-103, SEC-018–022 |
| 10 Polish | FR-001–004, FR-009, FR-100–102, FR-104–105, UX-001–012, UX-020–023, UX-026–034 |
| 11 Hardening | All `T-*` gates, SEC-023–025, doc 23 §23.12 checklist, doc 02 §2.7 launch gate |

---

## 33.6 Coverage check

| Check | Result |
|---|---|
| Every MVP FR has at least one screen or is explicitly infrastructural | Pass |
| Every MVP FR has at least one test class | Pass |
| Every business rule has an enforcement mechanism and a test | Pass |
| Every screen traces to at least one requirement | Pass (doc 24 §24.8) |
| Every table traces to at least one requirement | Pass (doc 20 §20.13 + this matrix) |
| Every metric in doc 10 is produced by at least one test in doc 09 | Pass (doc 09 §9.15) |
| Every dimension in doc 14 is fed by ≥ 2 MVP aim tests | Pass (doc 09 §9.15) |
| Every `EV-###` blocks a specific requirement | Pass (doc 36 §36.6) |
| Every Critical/High risk has a named mitigation traceable to a rule or requirement | Pass (doc 31) |
