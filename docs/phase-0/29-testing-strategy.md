# 29 — Testing Strategy

Related: [19-test-engine-architecture.md](19-test-engine-architecture.md) · [13-calibration-algorithm.md](13-calibration-algorithm.md) · [12-game-adapter-architecture.md](12-game-adapter-architecture.md)

**Terminology warning:** in this document, "test" means a software test. An aiming exercise is an
**aim test** or a **trial**. The glossary (doc 35) is normative on this.

---

## 29.1 What actually needs testing

SensLab's risk is not concentrated in its UI. It is concentrated in a chain of pure computations
that a user cannot check and that fail *silently*:

```
metrics -> normalisation -> scoring -> drift model -> response surface
        -> recommendation -> confidence -> game conversion
```

A bug anywhere in that chain produces a plausible, confident, wrong number. Nothing crashes,
nothing looks broken, and the user acts on it. That is where the test effort goes.

**Effort allocation (approximate):**

| Layer | Share | Why |
|---|---|---|
| `core/` unit + property tests | 40% | The silent-failure zone |
| Engine harness (headless, deterministic) | 20% | Measurement correctness |
| Game adapters | 10% | Wrong numbers shipped to users |
| Integration (DB, services, authz) | 15% | Persistence and ownership |
| E2E | 10% | Flows hold together |
| Accessibility / performance gates | 5% | Automated portions |

---

## 29.2 The pyramid, and the one test that matters most

Before the layers: **the synthetic-player end-to-end test** (doc 19 §19.12) is the single most
valuable test in the project and is worth building first.

```
Given a programmatic player whose true optimum is 28.0 cm/360,
whose performance follows a known noisy inverted-U with a known
learning curve and known trial-level variance,
When a full Standard calibration is simulated end to end
Then the recommendation is within the reported high-performance range
And the range contains 28.0
And across 200 seeded runs, coverage is >= 85%
```

This validates metrics, scoring, the drift model, the search, the fit, the interval and the
confidence *together*, against a known truth. No other test can do that. It also gives a
regression guard with real teeth: any change that degrades the estimator shows up here
immediately.

Variants: a player with no optimum (flat) must produce `indistinguishable`; a player with heavy
fatigue must be detected; a player at the domain edge must be handled; an inconsistent player must
produce a wide range and low confidence.

---

## 29.3 Unit tests (Vitest)

**Coverage target: ≥ 90% branch coverage on `core/` and `game-adapters/`.** Elsewhere, coverage
is a diagnostic, not a target.

| Module | Tests |
|---|---|
| `core/statistics` | median, MAD, robust CV, Wilson interval, weighted least squares, natural cubic spline, seeded bootstrap. Compared against hand-computed fixtures and, where possible, against reference values from a known-good implementation |
| `core/metrics` | Every metric in doc 10, from a synthetic movement trace with a known answer. Overshoot/undershoot detection, correction counting with hysteresis, path efficiency, high-pass jitter |
| `core/scoring` | Direction alignment, robust standardisation, bounded influence, dimension weights, unit invariance, separation of Speed and Precision |
| `core/calibration` | Bracket derivation, constraint clipping, candidate generation, Latin-square counterbalancing, drift recovery, response-surface fit, all decision-table branches, all stopping conditions, tie handling |
| `core/confidence` | Each component, monotonicity, ceiling, caps, determinism |
| `core/recommendation` | Range invariants, aim-profile classifier fixture table (every rule + fallthrough), explanation generation |
| `core/sensitivity` | cm/360 ↔ counts ↔ degrees, FOV conversions, the MDC family including its two analytic limits |
| `game-adapters/*` | The eight classes in doc 12 §12.8, including golden vectors |

**Property-based tests** (fast-check or equivalent) for:

- Round-trip conversions in every adapter.
- Unit invariance in scoring.
- Monotonicity in confidence.
- Bounded influence: no single trial moves the estimate more than a documented bound.
- Robustness: injecting 10% wild outliers shifts `x*` by less than the MDE.
- The counterbalancing generator produces a valid Latin square for any candidate count.

---

## 29.4 Engine tests

Three harnesses (doc 19 §19.12). Specifically:

**Headless deterministic (majority of engine tests).**
Injected clock and input source. A scripted movement trace with exact timestamps produces an
exact trial record and exact derived metrics. Covers: hit detection at the click timestamp,
frame-independence (the same trace at 60 Hz and 240 Hz produces identical metrics), validity
classification for every reason code, buffer overflow handling, replacement logic, seeded
reproducibility, candidate switching only at block boundaries.

**Synthetic players.** As §29.2.

**Browser integration (Playwright).** Real pointer lock, real canvas, real rAF. Asserts lock
acquisition and loss handling, HUD content (and the absence of score-like content), pause/resume
with countdown, resize handling, and completion of a minimal session. No numerical assertions.

**Explicitly out of scope:** React Testing Library for anything inside a trial. The engine is not
React and testing it through React would test the wrong thing.

---

## 29.5 Integration tests

Real PostgreSQL (ephemeral per CI run), transactional rollback per test.

| Area | Tests |
|---|---|
| Session lifecycle | Create → rounds → complete → recommendation; abort; abandon and sweep; resume |
| Ingest idempotency | Same payload 3× produces one round (`SENS-NFR-016`) |
| Transactionality | Injected failure mid-round-write leaves no partial round (`SENS-NFR-020`) |
| Recompute | Golden session: recompute from stored trials reproduces the stored recommendation exactly (`SENS-BR-030`) |
| Version isolation | A v1 fixture renders correctly under a deployment where v2 is current (`SENS-BR-020`) |
| Authorisation | **Generated** cross-tenant suite over every owned resource and every route/action (doc 23 §23.4) |
| Guest claim | Claim is cookie-driven, idempotent, transactional; a body-supplied session id is rejected; expired sessions cannot be claimed |
| Auth | Registration, verification, sign-in, reset, session rotation, enumeration resistance, rate limits |
| Hardware snapshot | Editing a profile does not alter historical sessions (`SENS-BR-035`) |
| Retention | Guest expiry, abandoned sweep, telemetry expiry, `ip_hash` nulling |
| Adapter gating | Every unverified adapter/scope throws on conversion; no `recommendation_game_settings` row is created |
| Constraint enforcement | Every CHECK constraint in doc 20 is exercised with a violating insert |

---

## 29.6 End-to-end tests (Playwright)

Kept few and high-value; E2E is the slowest and most brittle layer.

| Flow | Assertions |
|---|---|
| **Guest calibration, Quick mode** | No auth prompt; result renders; response curve renders from real data; caveat and version line present |
| **Registered calibration** | Session attributed to the user; appears in history |
| **Guest → account claim** | Result survives registration and appears in history |
| **Output-game switching** | Values change; no new session; unverified game shows the verification state and no number anywhere in the block |
| **Validation flow** | Blind run completes; verdict rendered; every metric row carries an interval |
| **History and comparison** | Two sessions compare; a cross-hardware comparison is flagged |
| **Hardware profiles** | Create, edit, set default, delete; historical sessions unchanged |
| **Mobile gate** | Calibration routes render SCR-050 on a touch-only context; results and history render normally |
| **Environment blocked** | With Pointer Lock stubbed unavailable, the start control is absent |
| **Reduced motion** | With the media query forced, no animation runs outside the allowlist |
| **Accessibility** | axe scan on every visited page in the above flows |

E2E aim tests are driven by a **scripted input driver** injected into the engine, not by
simulating human aim — Playwright cannot produce realistic mouse traces, and asking it to would
make these tests both slow and flaky.

---

## 29.7 Performance tests

| Gate | Method | Blocking? |
|---|---|---|
| Frame budget in a scripted engine run | Headless capture with a synthetic clock; assert late-frame ratio | Yes |
| Zero React renders during trials | Render-counting wrapper | Yes |
| No allocation in the hot path | Manual profiling on the reference machine, per release | No — advisory |
| Landing Lighthouse budget | Lighthouse CI | Yes |
| Bundle size | `size-limit` | Yes |
| Query latency | Seeded benchmark against the `SENS-NFR-024` target | Yes |
| Load test (1,000 concurrent) | Pre-launch, once, then per major change | Pre-launch only |

---

## 29.8 Test data

| Kind | Purpose |
|---|---|
| **Movement traces** | Recorded once from real sessions (with consent), anonymised, committed as fixtures. Realistic input for metric tests |
| **Synthetic players** | Parameterised generators (optimum, noise, drift, overshoot bias, tracking skill) |
| **Golden session** | One complete stored session + its expected recommendation, used for the recompute test |
| **Adapter golden vectors** | From verification measurements, per game (doc 12 §12.8) |
| **Database seeds** | Deterministic, idempotent (doc 21 §21.9) |
| **Volume fixture** | A seeded dataset at the scale of `SENS-NFR-024` for query benchmarks |

No production data is ever used as test data (doc 21 §21.8).

---

## 29.9 CI pipeline

```
1. install (frozen lockfile)
2. lint + format check + boundary rules (doc 18 s18.5)
3. tsc --noEmit                                   [blocking]
4. unit + property tests, coverage gate           [blocking]
5. engine headless harness + synthetic players    [blocking]
6. adapter suite incl. golden vectors             [blocking]
7. integration tests against ephemeral Postgres   [blocking]
8. build
9. bundle size + Lighthouse budgets               [blocking]
10. E2E (Chromium; Firefox + WebKit nightly)      [blocking on Chromium]
11. axe + contrast + reduced-motion audits        [blocking]
12. dependency audit                              [blocking on high severity]
13. secret scan / NEXT_PUBLIC_ check              [blocking]
```

Determinism tests (`SENS-NFR-019`) run on both Linux and Windows runners, because floating-point
divergence between platforms is a real risk for a product that promises bit-identical
recomputation.

---

## 29.10 Definition of done for a change

- [ ] Behaviour covered by a test at the appropriate layer
- [ ] `core/` change → property test considered and added or justified
- [ ] Algorithm parameter change → new version, not an edit (`SENS-BR-029`)
- [ ] Adapter change → golden vectors updated from a verification record, not from the model
- [ ] New endpoint → covered by the generated cross-tenant suite
- [ ] New screen → axe fixture, keyboard pass, reduced-motion state
- [ ] Lab change → frame-budget measurement recorded
- [ ] No new lint suppression or `@ts-expect-error` without a linked issue
- [ ] Docs updated where a documented decision changed

---

## 29.11 What is deliberately not tested

| Not tested | Why |
|---|---|
| Exact pixel rendering | Visual regression on a canvas that draws seeded random targets is noise. Component-level visual regression is used for the design system only |
| Third-party game behaviour | Cannot be automated; handled by the verification process (doc 08 §8.5) |
| Real human aim performance | Handled by pilot testing, not CI |
| Browser pointer-lock internals | Handled by the capability probe and `EV-010` |
| The provisional reference distribution's accuracy | It is provisional by declaration (doc 14 §14.4); what *is* tested is that it is labelled provisional everywhere |
