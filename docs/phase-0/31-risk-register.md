# 31 — Risk Register

Related: [32-decision-log.md](32-decision-log.md) · [36-external-verification-register.md](36-external-verification-register.md) · [30-performance-strategy.md](30-performance-strategy.md)

**Scoring:** Probability and Impact each Low / Medium / High. **Severity** = the combination, with
"Critical" reserved for High × High.
**Area** is the owning discipline, since there is no team structure yet to name individuals.

---

## 31.1 Register

### R-01 — The recommendation is simply wrong for many users
**P:** Medium · **I:** High · **Severity: Critical** · **Area:** Algorithms

The whole product rests on a 20-minute noisy experiment recovering a real parameter. If the
estimator is biased or the noise dominates, users get confidently wrong advice.

*Mitigations:* the synthetic-player end-to-end test with known ground truth (doc 29 §29.2);
paired stimuli and counterbalancing for power (doc 13 §13.6); the drift model; the anchor
re-test; conservative confidence with a hard ceiling; the validation A/B as an independent check;
the `indistinguishable` verdict as a legitimate output; monitoring the validation verdict mix in
production (doc 22 §22.7) as the standing ground-truth signal.
*Residual:* Accepted, with the explicit commitment that a rising `worse` rate in validation is a
stop-and-fix trigger, not a metric to explain away.

---

### R-02 — Game conversion constants are wrong
**P:** Medium · **I:** High · **Severity: Critical** · **Area:** Game adapters

A wrong yaw constant, a wrong ADS model, or a linear assumption on a non-linear game produces a
number every user copies into their game.

*Mitigations:* nothing ships unverified (`SENS-BR-013/014`); verification requires empirical
measurement, not documentation alone (doc 08 §8.5); golden-vector tests compare the model to
measurements rather than to itself (doc 12 §12.8); adapters throw rather than approximate;
per-scope verification granularity; re-verification triggers; the canonical value is physical so
a correction is a re-derivation, not a lost result.
*Residual:* Low for shipped adapters. The real residual is *schedule* — see R-03.

---

### R-03 — Verification work blocks the launch roster
**P:** High · **I:** Medium · **Severity: High** · **Area:** Product / Game adapters

Verification needs the games, the hardware, the time and a person who can measure carefully.
Five games is five projects. Realistically not all five will be verified at launch.

*Mitigations:* the launch gate requires only **CS2** verified (doc 02 §2.7); the product is
designed to be genuinely good with zero verified adapters (cm/360, counts/360, response curve,
profile all work); the unverified state is a designed, useful screen, not an error; verification
is tracked as a first-class register with owners (doc 36).
*Residual:* Accepted. Launching with one or two verified games is a viable product.

---

### R-04 — Browser input is not raw on a significant share of sessions
**P:** Medium · **I:** High · **Severity: High** · **Area:** Engineering / Platform

If `unadjustedMovement` is unavailable or silently ineffective on common browser/OS
combinations, a large share of measurements pass through OS acceleration.

*Mitigations:* detect and record; warn; penalise confidence; recommend disabling EPP; a
movement-scale sanity probe where the API does not report effectiveness; `EV-010` as a blocking
verification item before the support matrix is finalised; monitoring the grant rate by browser in
production.
*Residual:* Medium. If the grant rate proves poor, the mitigation becomes "recommend a specific
browser for calibration", which is acceptable but costs conversion.

---

### R-05 — Frame instability corrupts measurements silently
**P:** Medium · **I:** Medium · **Severity: Medium** · **Area:** Engineering

Background applications, thermal throttling and browser GC produce hitches that distort timing.

*Mitigations:* always-on frame monitoring; per-trial degradation and invalidation; replacement
trials; session-level warning; confidence penalty; a representative (not empty) frame probe;
strict frame budget with large headroom; CI frame assertions.
*Residual:* Low.

---

### R-06 — Users' DPI is wrong
**P:** High · **I:** Medium · **Severity: High** · **Area:** Product

Self-reported DPI is frequently wrong, and every converted game number scales with it.

*Mitigations:* counts/360 is canonical, so the *measurement* is unaffected (doc 11 §11.1);
provenance tracked; an in-browser ruler measurement offered; plausibility cross-checks against
declared sensitivity, pad width and the measured comfort swipe; settings reliability reported
separately from confidence (doc 15 §15.5); the dependency stated plainly in the settings block.
*Residual:* Low for the physical result, Medium for the game number. Fully resolvable only by a
desktop companion (Future).

---

### R-07 — Learning and fatigue confound the comparison
**P:** High · **I:** Medium · **Severity: High** · **Area:** Algorithms

Performance drifts across a 20-minute session; candidates tested later are not tested under the
same conditions as candidates tested earlier.

*Mitigations:* practice stage excluded from scoring; Latin-square counterbalancing; an explicit
drift term in the model; the anchor re-test to identify it; fatigue reported to the user;
`stop_fatigue` when drift is severe; confidence penalty; a bounded trial budget.
*Residual:* Medium, and honestly disclosed. The design confound between round and time
(doc 13 §13.7) is stated rather than hidden, and a multi-session design would be the real fix.

---

### R-08 — Familiarity bias makes the recommendation lose validation
**P:** High · **I:** Medium · **Severity: High** · **Area:** Product / Algorithms

A user with two years at their current sensitivity will often beat a genuinely better new one in
a 20-minute test.

*Mitigations:* validation is designed to report a loss honestly (doc 17 §17.5); the original is
retained as the standing recommendation when it wins; familiarity is explained without being used
as an excuse; the recommended action after a large change is "try it for a week, then re-check",
which turns the bias into a product loop rather than a defect.
*Residual:* Accepted and disclosed. It is a real property of the world, not a bug.

---

### R-09 — Insufficient statistical power at the chosen trial budget
**P:** Medium · **I:** High · **Severity: High** · **Area:** Algorithms

If the trial counts in doc 09 §9.16 are too low for the real trial-level variance, most sessions
return `indistinguishable` and the product looks useless.

*Mitigations:* the budget is derived from an explicit power calculation with stated assumptions;
the MDE is computed and reported per session; the `indistinguishable` rate is monitored in
production; pilot testing before launch re-derives the calculation from real variance; paired
stimuli materially increase power at no time cost; Advanced mode exists as the escape hatch.
*Residual:* Medium until pilot data exists. **This is the single most important thing to measure
during the Phase 2–4 pilot.**

---

### R-10 — Session length drives abandonment
**P:** High · **I:** Medium · **Severity: High** · **Area:** Product / UX

Twenty minutes of repetitive aiming is a long ask from a cold visitor.

*Mitigations:* Quick mode as the suggested default for first-time guests; computed, honest
duration estimates; progress always visible; pause and resume with no data loss; abandonment
tracked by stage as the primary funnel metric; the result reveal designed to be worth the
investment.
*Residual:* Medium. Expect meaningful drop-off; the mitigation is measurement and iteration, not
a shorter test that produces worse answers.

---

### R-11 — Users game or fake the measurement
**P:** Medium · **I:** Low · **Severity: Low** · **Area:** Security / Data

*Mitigations:* server-side computation; physical, timing, structural and statistical plausibility
checks; idempotent ingest; only clean sessions feed reference distributions (doc 23 §23.10).
*Residual:* Accepted. A user who fakes their own calibration harms only themselves; the
protection needed is for aggregate data, and it exists.

---

### R-12 — Overclaiming destroys credibility
**P:** Medium · **I:** High · **Severity: High** · **Area:** Product

The commercial temptation is to present a confident number. One well-argued public teardown of an
overconfident claim would be very damaging to a product whose entire pitch is rigour.

*Mitigations:* `SENS-BR-016/017/022/027/028`; confidence ceiling; "no measurable difference" as a
first-class verdict; the response curve as visible evidence; `SENS-NFR-043` as a content-level
NFR with a UI test; the methodology page; the verification register being user-visible.
*Residual:* Low, provided the rules survive commercial pressure. Recorded here precisely so that
weakening them is a visible decision.

---

### R-13 — Telemetry volume becomes unmanageable
**P:** Low · **I:** High · **Severity: Medium** · **Area:** Data

*Mitigations:* raw data never leaves the device by default (`SENS-BR-032`); aggregation on the
client; a hard 64 KB per-round ingest cap; consent-gated, retention-bound object storage for
research; volume projections and a partitioning trigger with an alert (doc 21 §21.6).
*Residual:* Low.

---

### R-14 — Privacy exposure from behavioural data
**P:** Low · **I:** High · **Severity: Medium** · **Area:** Security / Legal

High-resolution hand-movement data is a behavioural biometric.

*Mitigations:* not collected by default; explicit, revocable, versioned consent; separate
storage; short retention; no third-party analytics; no session replay; minimal PII; documented
deletion with an honest backup window.
*Residual:* Low.

---

### R-15 — Cross-tenant data exposure
**P:** Low · **I:** High · **Severity: Medium** · **Area:** Security

*Mitigations:* actor-scoped repository layer; 404-not-403; a *generated* cross-tenant test suite
covering every owned resource and every route; guest identity from a server-issued cookie only;
a transactional, idempotent claim flow (doc 23 §23.4, §23.6).
*Residual:* Low.

---

### R-16 — A game patch silently invalidates a shipped adapter
**P:** High · **I:** Medium · **Severity: High** · **Area:** Game adapters

Live-service games change. A conversion that was right last month may be wrong today.

*Mitigations:* per-version adapters; re-verification triggers including a staleness window;
"last verified against build X" surfaced in the UI; user mismatch reports (post-MVP); canonical
values stored physically so historical results are correctable; a one-click "update to current
model" that recomputes from the stored canonical value.
*Residual:* Medium — it is an ongoing operational cost, not a one-time fix, and it should be
budgeted as such.

---

### R-17 — Scope creep from the "future features" list
**P:** High · **I:** Medium · **Severity: High** · **Area:** Product

The brief lists many attractive future features. Each is a plausible reason to complicate the MVP.

*Mitigations:* doc 02's explicit MVP/Post/Future split; the rule that no Future item may justify
MVP complexity without an ADR proving it is free; the launch gate; the guardrail table in
doc 02 §2.6.
*Residual:* Medium. This is a discipline risk, and discipline risks are managed by making
exceptions visible.

---

### R-18 — The measurement/animation conflict is resolved the wrong way
**P:** Medium · **I:** High · **Severity: High** · **Area:** Engineering / Design

The product wants to look premium, and the test route wants to be inert. Under design pressure,
effects creep into the lab.

*Mitigations:* `SENS-BR-021`; a physically separate restricted renderer with a fixed effect
allowlist; CI frame-budget and render-count assertions; adding to the allowlist requires an ADR.
*Residual:* Low, because the enforcement is structural rather than cultural.

---

### R-19 — The provisional reference distribution misleads users
**P:** Medium · **I:** Medium · **Severity: Medium** · **Area:** Algorithms / Product

Absolute 0–100 scores against invented reference values look authoritative.

*Mitigations:* scores labelled provisional everywhere while the reference is provisional
(`SENS-UX-017`); **no percentiles shown at all** until real data exists; the recommendation and
every comparison come from within-session data and are valid regardless; the reference
distribution is a separately versioned artefact so replacing it is a clean, traceable event.
*Residual:* Low.

---

### R-20 — High-refresh and hardware diversity make sessions incomparable
**P:** Medium · **I:** Low · **Severity: Low** · **Area:** Algorithms

*Mitigations:* full environment fingerprint on every session; comparability verdict before any
comparison; explicit flags; hardware profiles separating setups (`SENS-BR-018/019`).
*Residual:* Low.

---

### R-21 — Motion discomfort excludes or harms users
**P:** Medium · **I:** Medium · **Severity: Medium** · **Area:** UX / Accessibility

A first-person camera driven by mouse movement can cause discomfort.

*Mitigations:* advisory before the first pointer lock (`SENS-UX-024`); ESC always pauses;
aborting never loses completed rounds; the fixed FOV avoids the worst offenders; a reduced
battery omitting continuous tracking is a documented post-MVP option with a stated confidence
cost.
*Residual:* Medium. Partly inherent to the task.

---

### R-22 — Accessibility gap in the core experience
**P:** High · **I:** Medium · **Severity: High** · **Area:** Accessibility

Precise mouse control is required. The calibration is genuinely not usable by everyone.

*Mitigations:* everything around the test meets AA; complete text descriptions; canvas
announcements; fully accessible results with data tables; the limitation stated plainly rather
than implied away (doc 28 §28.8).
*Residual:* Accepted and disclosed. It is a property of what is being measured.

---

### R-23 — Solo/small-team delivery capacity
**P:** High · **I:** Medium · **Severity: High** · **Area:** Delivery

The Phase 0 specification describes a substantial product. Eleven phases is a long road.

*Mitigations:* an aggressively bounded MVP; a single Next.js app with no distributed
infrastructure; pure-TypeScript core that is fast to test; phase gates with explicit exit
criteria; the launch gate requiring only one verified adapter; post-MVP items designed to be
additive.
*Residual:* Medium. The main lever is holding the scope line (R-17).

---

### R-24 — Floating-point divergence across platforms breaks reproducibility
**P:** Low · **I:** Medium · **Severity: Low** · **Area:** Engineering

`SENS-BR-030` promises exact recomputation. Transcendental functions can differ across engines
and platforms.

*Mitigations:* determinism tests run on Linux **and** Windows in CI; the search operates in log
space with a small, reviewed set of operations; bootstrap resampling is seeded; if exact equality
proves impossible, the promise is downgraded to a documented tolerance rather than quietly
broken.
*Residual:* Low. Recorded because discovering it late would be expensive.

---

## 31.2 Severity summary

| Severity | Risks |
|---|---|
| **Critical** | R-01 (wrong recommendations), R-02 (wrong conversions) |
| **High** | R-03, R-04, R-06, R-07, R-08, R-09, R-10, R-12, R-16, R-17, R-18, R-22, R-23 |
| **Medium** | R-05, R-13, R-14, R-15, R-19, R-21 |
| **Low** | R-11, R-20, R-24 |

## 31.3 The five to watch first

1. **R-09 (statistical power)** — resolve with pilot data during Phases 2–4. Everything about the
   trial budget depends on it, and it is cheap to measure and expensive to get wrong.
2. **R-04 (raw input availability)** — resolve `EV-010` early; it determines the support matrix
   and possibly the onboarding copy.
3. **R-01 (estimator correctness)** — the synthetic-player harness should exist before the first
   real user session.
4. **R-03 (verification schedule)** — start CS2 verification in Phase 1, not Phase 5.
5. **R-17 (scope creep)** — the cheapest risk to manage and the one most likely to be neglected.
