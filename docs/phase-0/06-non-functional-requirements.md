# 06 — Non-Functional Requirements

Related: [30-performance-strategy.md](30-performance-strategy.md) · [23-security-and-privacy.md](23-security-and-privacy.md) · [28-responsive-accessibility.md](28-responsive-accessibility.md)

**ID format:** `SENS-NFR-###`. Security NFRs live in doc 23 as `SENS-SEC-###`; UX NFRs live in
doc 26/27/28 as `SENS-UX-###`.

Every NFR below is stated with a measurable target and the method used to verify it. An NFR
without a verification method is a wish, not a requirement.

---

## 6.1 Measurement fidelity (the ones that actually matter)

| ID | Requirement | Target | Verification |
|---|---|---|---|
| SENS-NFR-001 | Input-to-camera latency added by SensLab's own code shall be bounded | Pointer sample → camera state update ≤ 1 frame; no artificial input smoothing, ever | Engine harness measures the count-to-yaw path; a unit test asserts the transform is applied synchronously on the event, not on the next frame |
| SENS-NFR-002 | The scored-test render loop shall hold its frame budget | ≥ 99% of frames within 1.25× the display frame interval on the reference machine; ≥ 95% on the minimum machine | Automated frame-time capture during a scripted engine run in CI (headless, with a synthetic clock) plus manual profiling on reference hardware |
| SENS-NFR-003 | No allocation shall occur in the per-frame or per-input hot path during a scored trial | Zero GC-visible allocations per trial after warm-up | Chrome DevTools allocation profile on a scripted 60 s run; assertion via `performance.measureUserAgentSpecificMemory` sampling in a manual perf gate |
| SENS-NFR-004 | React shall not re-render in response to pointer movement or per-frame updates | Zero renders of test-screen components between trial boundaries | React Profiler assertion in the engine integration test; a render-counting wrapper fails the test if any render occurs mid-trial |
| SENS-NFR-005 | Frame instability shall be detected and surfaced, never silently tolerated | Per-trial degradation flag when > 8% of frames exceed budget; per-session warning at sustained degradation | Synthetic frame-time injection test |
| SENS-NFR-006 | Timing shall use a monotonic high-resolution clock | All trial timing from `performance.now()`; no `Date.now()` in the engine | Lint rule banning `Date.now` inside `test-engine/` |
| SENS-NFR-007 | Pointer input shall use coalesced events so no movement is lost between frames | All movement deltas within a frame are accumulated, not sampled | Unit test over a synthetic coalesced-event sequence |
| SENS-NFR-008 | Sensitivity changes between candidates shall be exact and instantaneous | The count→degree factor changes at a block boundary only, with no interpolation | Unit test; engine asserts no candidate change occurs while a trial is active |

**Reference machine (for targets above):** a 2020-or-later desktop/laptop CPU, integrated GPU
acceptable, 144 Hz display, Chrome stable, on mains power.
**Minimum machine:** 4-core CPU from 2017 or later, 60 Hz display. Below this the environment
check should classify `degraded`.

---

## 6.2 Application performance

| ID | Requirement | Target | Verification |
|---|---|---|---|
| SENS-NFR-009 | Landing page shall be fast on a mid-tier connection | LCP ≤ 2.0 s and INP ≤ 200 ms at p75 on 4G/4× CPU throttle | Lighthouse CI budget in the pipeline |
| SENS-NFR-010 | Landing page JS shall be budgeted | ≤ 180 KB gzipped for the initial route, canvas demos lazily mounted | `size-limit` check in CI |
| SENS-NFR-011 | The test route shall be fully loaded before pointer lock is offered | No dynamic import, no network fetch, and no font swap after a scored round begins | E2E asserts zero network requests between round start and round end |
| SENS-NFR-012 | Result page shall render the recommendation without waiting on optional data | Recommendation, range, confidence and response curve render in the first server payload | Playwright measures time-to-first-meaningful-content of the result hero |
| SENS-NFR-013 | Server actions and route handlers shall respond quickly at p95 | ≤ 300 ms p95 for CRUD, ≤ 800 ms p95 for recommendation persistence | Server timing metrics; load test before launch |
| SENS-NFR-014 | Round aggregate ingestion shall be bounded in size | ≤ 64 KB per round payload after aggregation | Schema-level size assertion; server rejects oversize payloads |

---

## 6.3 Reliability and data integrity

| ID | Requirement | Target | Verification |
|---|---|---|---|
| SENS-NFR-015 | A completed calibration shall be recoverable from stored data | Any stored recommendation can be recomputed exactly from stored trials + algorithm version | Golden-session integration test: recompute and assert equality |
| SENS-NFR-016 | Round ingestion shall be idempotent | Replaying an identical round payload creates no duplicate rows | Integration test replays the same payload 3× |
| SENS-NFR-017 | No partially-written session shall produce a recommendation | Recommendation generation requires `status = completed` and minimum sample checks | Constraint + integration test |
| SENS-NFR-018 | Client-side loss shall be bounded to one round | Completed rounds persisted locally before transmission | Integration test kills the transport mid-session |
| SENS-NFR-019 | All monetary-free, user-visible derived numbers shall be deterministic | Same inputs + same versions → same outputs, on every platform | Property tests with fixed seeds run on Linux and Windows in CI |
| SENS-NFR-020 | Database writes for a session shall be transactional at round granularity | A round is fully written or not at all | Integration test with an injected failure mid-write |

---

## 6.4 Scalability and cost

| ID | Requirement | Target | Verification |
|---|---|---|---|
| SENS-NFR-021 | Storage per completed Standard session shall be bounded | ≤ 300 KB of relational data per session (see doc 21 §21.6, which records why the initial 250 KB target was raised) | Measured against a real completed session in staging |
| SENS-NFR-022 | Raw pointer telemetry shall not be written to the primary database | Zero rows of per-event telemetry in PostgreSQL | Schema review; no table exists for it by design |
| SENS-NFR-023 | The system shall support 1,000 concurrent active calibrations without degradation of ingest latency | p95 ingest ≤ 500 ms at that load | Load test |
| SENS-NFR-024 | History queries shall stay fast as data grows | ≤ 50 ms p95 for a user's 50-session history at 10M trial rows | Query plan review + seeded benchmark |

---

## 6.5 Maintainability and code quality

| ID | Requirement | Target | Verification |
|---|---|---|---|
| SENS-NFR-025 | Core domain logic shall be pure TypeScript with no framework dependency | `core/` imports nothing from React, Next, or the database layer | ESLint `import/no-restricted-paths` zones + a CI boundary test |
| SENS-NFR-026 | Game-specific constants shall exist in exactly one place | No game name, yaw constant, or per-game multiplier appears outside `game-adapters/` | Grep-based CI check with an allowlist |
| SENS-NFR-027 | Algorithm parameters shall be versioned data, not literals | Weights, thresholds and bracket constants live in versioned parameter sets | Code review checklist + a test asserting the parameter set hash matches the recorded version |
| SENS-NFR-028 | TypeScript shall run in strict mode with no escapes | `strict: true`, `noUncheckedIndexedAccess: true`, zero `any` without a documented, reviewed exception | `tsc --noEmit` in CI; ESLint `no-explicit-any` as an error |
| SENS-NFR-029 | Schemas shall be defined once and shared | One Zod schema per boundary payload, used by client and server | Duplicate-schema review; types derived via `z.infer` |
| SENS-NFR-030 | Lint and type errors shall not be suppressed to pass CI | Zero new `eslint-disable` or `@ts-expect-error` without a linked issue reference in the comment | CI check on the diff |
| SENS-NFR-031 | No mock or stub implementation shall exist on a production path | Fakes exist only under test directories | CI check for test-only imports in production bundles |
| SENS-NFR-032 | Modules shall stay small enough to review | Soft limits: 400 lines per file, 60 per function, flagged in review not enforced by lint | Review checklist |

---

## 6.6 Observability

| ID | Requirement | Target | Verification |
|---|---|---|---|
| SENS-NFR-033 | Every session shall record its environment fingerprint | All fields in doc 36 §environment present | Not-null constraint on completed sessions |
| SENS-NFR-034 | Errors shall be reported with correlation to session and round | Structured logs with `session_id`, `round_id`, `trace_id` | Log schema review |
| SENS-NFR-035 | Funnel analytics shall identify the abandonment stage | `test_abandoned` carries `stage` and `round_index` | Analytics contract test |
| SENS-NFR-036 | Recommendation quality shall be monitorable in aggregate | Dashboards for confidence distribution, indistinguishable-outcome rate, validation verdict mix | Defined in doc 22 §22.7 |

---

## 6.7 Compatibility

| ID | Requirement | Target | Verification |
|---|---|---|---|
| SENS-NFR-037 | Calibration shall be supported on the documented browser matrix | Chrome, Edge, Firefox on Windows and macOS, current and current-1 | E2E matrix; support state derives from a capability probe, not UA sniffing |
| SENS-NFR-038 | Unsupported or degraded browsers shall be handled explicitly | Capability probe drives `pass`/`degraded`/`blocked`; no silent breakage | Environment check tests with stubbed capabilities |
| SENS-NFR-039 | Read-only surfaces shall work on modern mobile browsers | iOS Safari and Android Chrome, current and current-1 | Responsive E2E |

`REQUIRES_EXTERNAL_VERIFICATION` — the exact browser/OS support matrix for
`requestPointerLock({ unadjustedMovement: true })` must be confirmed empirically before the
matrix above is finalised. Tracked as **EV-010**.

---

## 6.8 Privacy, compliance, ethics

| ID | Requirement | Target | Verification |
|---|---|---|---|
| SENS-NFR-040 | Personal data collection shall be minimal | Email is the only PII required; no IP stored in raw form | Data inventory review (doc 23 §23.9) |
| SENS-NFR-041 | Raw telemetry retention shall be opt-in and time-bounded | Default off; when on, ≤ 30 days unless separately consented | Retention job + test |
| SENS-NFR-042 | Users shall be able to export and delete their data | Export complete; deletion purges within the documented window | Integration test |
| SENS-NFR-043 | The product shall not overstate its accuracy | Every recommendation surface carries confidence and the browser-limitation caveat | Content review checklist; a UI test asserts the caveat element exists on the result page |

`SENS-NFR-043` is unusual in being a *content* NFR. It is here deliberately: overclaiming is the
single largest reputational and ethical risk in this product (doc 31, R-12).

---

## 6.9 Accessibility

Full detail in [28-responsive-accessibility.md](28-responsive-accessibility.md). Summary targets:

| ID | Requirement | Target |
|---|---|---|
| SENS-NFR-044 | WCAG conformance outside active tests | WCAG 2.2 AA |
| SENS-NFR-045 | Keyboard operability outside active tests | 100% of interactive controls reachable and operable |
| SENS-NFR-046 | Contrast | ≥ 4.5:1 body text, ≥ 3:1 large text and meaningful UI boundaries |
| SENS-NFR-047 | Reduced motion | Honoured globally; no parallax, magnetism, or scroll-driven transform when set |
| SENS-NFR-048 | Canvas accessibility | Every canvas has an accessible name and adjacent text instructions describing the task and its controls |

---

## 6.10 The NFRs that are allowed to be violated

Stated explicitly so that trade-offs are conscious:

- **Visual richness yields to measurement.** Any conflict between `SENS-NFR-002/003/004` and any
  UX or motion requirement is resolved in favour of measurement, always
  (`SENS-BR-021`).
- **Result-page performance yields to evidence.** The response curve may cost more than a plain
  number; that is an accepted cost.
- **Onboarding brevity yields to honesty.** The environment check adds friction and will cost
  conversion. It stays, because a calibration run on a broken environment is worse than no
  calibration.
