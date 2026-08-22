# Phase 3 Completion Report — MVP Aim Tests

**Phase:** 3 of 11
**Scope:** the seven MVP tests, every metric they produce, and the surfaces that run them
**Source of truth:** [`09-test-catalogue.md`](../phase-0/09-test-catalogue.md) · [`10-measurement-methodology.md`](../phase-0/10-measurement-methodology.md)
**Date:** 2026-08-22

---

## 1. Status

**Complete.** All seven MVP tests run independently, end to end, producing valid trials and
populated metrics — which is Phase 3's stated exit criterion. Every metric doc 10 defines is
implemented and tested against hand-written movement traces. Rounds aggregate with sample counts
and uncertainty, persist to PostgreSQL, and are idempotent on retry.

**There is still no sensitivity recommendation, and the surfaces say so.** Running one test
measures performance at one sensitivity, which is not a comparison. Candidate generation,
counterbalancing, adaptive narrowing and scoring are Phase 4.

**No composite scoring was invented.** doc 10 §10.9 names the decision metric subset; nothing
here combines them, because how they combine is a Phase 4 specification.

---

## 2. What was built

### The battery — five scored, two deliberately not

| Test         | Category   | What it is for                                                    |
| ------------ | ---------- | ----------------------------------------------------------------- |
| `flick`      | scored     | Ballistic acquisition. The bulk of the Speed and Precision signal |
| `micro`      | scored     | Fine control. **The primary detector of "too high"**              |
| `tracking`   | scored     | Continuous following. Its optimum often differs from flick's      |
| `switching`  | scored     | Re-acquisition under pressure                                     |
| `precision`  | scored     | First-shot placement with speed de-emphasised                     |
| `reaction`   | baseline   | The player's reaction floor. **Never enters the decision**        |
| `comfort360` | constraint | Physical reach. Bounds the search range                           |

`reaction` and `comfort360` run once per session rather than once per candidate: running a
sensitivity-independent test per candidate spends the trial budget on a comparison that cannot
differ. Both are excluded from the decision set by construction — a test asserts that every
metric they declare is marked `isDecisionMetric: false`.

### Metrics

All 33 registered metrics now have derivations: the acquisition family (§10.2), the
placement/error family (§10.3), the tracking family (§10.4), and switching and comfort (§10.5).
Round aggregation follows §10.7 — median for times and errors, proportion with a Wilson interval
for rates, seeded bootstrap intervals for everything else, and `consistency` computed from each
test's primary metric.

Two supporting kernels went into `core/`: a first-order high-pass with a **per-sample** time step
(a fixed-Δt filter would change its own cutoff whenever a machine stuttered) and a reversal
counter with hysteresis and a refractory period (without both, sensor noise reports dozens of
corrections per trial that never happened).

### The contract change that made the tests declarable

`TargetSpec` is now an **offset from the camera at spawn**, which is what doc 09 §9.0.1 says and
what the contract's own comment claimed. Before, a definition had to know where the previous
trial happened to leave the view. The engine resolves the offset once at spawn, keeping the
target still while the player turns towards it.

Three further additive hooks made the remaining tests expressible without lifecycle changes:
`respawn` (switching's kill-and-replace), `variantFor` (comfort's three sub-tasks, flick's
distance classes) and `cameraEnabled: false` (reaction, where a live camera would let the player
pre-aim and turn a reaction measurement into an aiming one).

### Persistence and surfaces

`startTestRun` authors the plan **on the server** — seed, sensitivity and trial counts all decide
what the numbers mean, so a client that chose them could re-roll a favourable stimulus sequence.
Uploads are validated, ownership is enforced in SQL, and a first-time visitor is issued a guest
session rather than being asked to sign up.

`/test` lists the battery; `/test/[testKey]` runs one. While a trial is measured there is **no
navigation on the page at all** — not hidden, not disabled: not rendered, because a stray Tab
into a link steals focus and focus loss invalidates the open trial.

---

## 3. Files created / modified

### Created (24 files, ~3,180 lines)

```
src/core/signal/filters.ts, index.ts
src/test-engine/tests/{reaction,flick,micro,tracking,switching,precision,comfort360}.ts, index.ts
src/test-engine/metrics/{trace,acquisition,placement,tracking,switching,comfort,aggregate}.ts, index.ts
src/test-engine/plan/single-test.ts, index.ts
src/services/test-run-service.ts
src/features/test-run/{schema,actions,copy}.ts, test-surface.tsx
src/app/(app)/test/page.tsx, src/app/(app)/test/[testKey]/page.tsx
src/db/migrations/0001_trial_variant.sql
```

### Created — tests (9 files)

```
tests/helpers/trial-fixture.ts             hand-written movement traces
tests/unit/core/signal.test.ts
tests/unit/metrics/{acquisition,placement,tracking,switching-comfort,aggregate}.test.ts
tests/unit/tests/{mvp-battery,sample-budget}.test.ts
tests/unit/features/test-run-schema.test.ts
tests/integration/test-run.test.ts
tests/e2e/aim-tests.spec.ts, tests/e2e/aim-run.locked.spec.ts, tests/e2e/global-setup.ts
```

### Modified

| File                                                              | Change                                                                                                                                                                           |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/test-engine/contracts/index.ts`                              | `TargetSpec` relative; `TrialIdentity`/`TrialContext` split; `respawn`, `variantFor`, `cameraEnabled`, `minKills`, `primaryMetricKey`; `TrialRecord.variant` and `.qualityFlags` |
| `src/test-engine/trial-manager.ts`                                | Offset resolution, respawn, variants, camera-disabled, `insufficient_kills`                                                                                                      |
| `src/test-engine/round-runner.ts`                                 | One shared observation; true angular target distance; round aggregation                                                                                                          |
| `src/test-engine/targets/target-manager.ts`                       | Resolves an offset against a spawn anchor                                                                                                                                        |
| `src/test-engine/session-controller.ts`, `engine.ts`, `mount.tsx` | Expose `trialPhase`                                                                                                                                                              |
| `src/test-engine/input/pointer-lock.ts`                           | Lock-loss reporting corrected; remembers a refused option (see §4.2)                                                                                                             |
| `src/core/statistics/descriptive.ts`                              | Reducers widened to `ArrayLike<number>` so typed arrays work uncopied                                                                                                            |
| `src/repositories/session-repo.ts`                                | Persists `variant` and **all** trial quality flags                                                                                                                               |
| `src/db/schema/sessions.ts`                                       | `test_trials.variant`                                                                                                                                                            |
| `src/app/globals.css`                                             | `scrollbar-gutter: stable` (see §4.3)                                                                                                                                            |
| `playwright.config.ts`                                            | Serial `locked` project; global setup clears rate limits                                                                                                                         |
| `docs/phase-0/10-measurement-methodology.md`                      | **Corrected** `overshootRate` (see §5.1)                                                                                                                                         |

---

## 4. Defects found and fixed

**4.1 Every round upload failed validation.** Zod 4's `z.record()` with an enum key is
_exhaustive_: it demanded all 33 registered metrics on every trial and every round. Trial metrics
are sparse by design — a tracking metric is meaningless on a flick trial — so nothing would ever
have persisted from the browser. Found by feeding a **real engine-produced round** through the
validator rather than a hand-written fixture, which is now a permanent test.

**4.2 A refused pointer-lock option paused the session it had just started.** On this platform
`requestPointerLock({ unadjustedMovement: true })` rejects asynchronously — the EV-010 case the
engine was built for. The plain fallback succeeded and the session started; then the queued
`pointerlockerror` from the superseded request arrived and the engine read it as losing a lock it
was holding. The document is now the authority: if it still reports a lock, the error belongs to
a superseded request. The refusal is also remembered, so the next request does not spend its
transient activation rediscovering it.

**4.3 A surface that reflowed when the test started paused itself.** The engine pauses on a
canvas resize, correctly — a resize changes the angular-to-pixel mapping. But a canvas in the
document flow is resized by anything that reflows the page: a header unmounting, a scrollbar
appearing. The measuring view is now a fixed full-viewport layer with the page behind it locked,
and `scrollbar-gutter: stable` removes the whole class of problem app-wide.

**4.4 An anonymous visitor could not start a test.** Sessions need an owner and ownership is
enforced in SQL, so an anonymous actor matched no rows. `issueGuestSession` existed from Phase 1
but nothing called it. Starting a run now issues a guest session — which is what guest sessions
are for.

**4.5 Trial quality flags were dropped on the way to the database.** The repository mapped only
`bufferOverflow`, discarding everything else the engine raised. A session looked cleaner than it
was.

---

## 5. Deviations from Phase 0

### 5.1 `overshootRate` — doc 10 corrected

doc 10 §10.3 defined an overshoot as _p_(_t_) exceeding _d₀_ + _r_ **before the crosshair first
enters the target**. That is vacuous for the case the metric exists to detect: a crosshair
travelling towards a target reaches _d₀_ − _r_ (entry) _before_ it reaches _d₀_ + _r_, so a
straight-line overshoot — the canonical signature of excessive sensitivity, in the metric's own
Interpretation — could never satisfy it.

The window now runs from _t₀_ until the target is destroyed, falling back to the trial's end.
Bounding at the kill is what keeps it meaningful in a multi-kill test such as Switching, where
travel towards the _next_ target would otherwise count against the previous one.
**doc 10 has been updated with the correction and its reasoning.**

### 5.2 `comfortableSwipeCm` is not computed in the engine

doc 10 §10.5 defines it as the swipe converted to centimetres, which needs the mouse DPI. The
engine does not know the DPI, deliberately: that is what makes degrees-per-count DPI-independent
by construction (doc 11 §11.1). The engine emits `maxSingleSwipeDeg`, which it can measure
exactly, and the conversion belongs to the layer that holds the DPI. Emitting centimetres from
here would mean inventing a DPI.

### 5.3 `switchingTime` is the within-trial median

A switching trial is a sequence: eight kills produce seven intervals, and a trial record holds one
value per metric. The trial value is the median of its intervals. Pooling every interval across
trials as if independent would overstate the sample size — intervals within one sequence share a
player, a moment and a fatigue state — and shrink a confidence interval the data has not earned.

### 5.4 `fatigueDrift` is not implemented

doc 10 §10.6 defines it as a slope across the whole session **after candidate effects are
removed**, with the joint estimation specified in doc 13 §13.7. It is a session-level quantity
that needs the calibration model, so it belongs to Phase 4 rather than being approximated here.

### 5.5 The i18n catalogue is a placeholder

Definitions carry message keys, as they must. The English copy that resolves them lives in one
file (`features/test-run/copy.ts`) until the Phase 10 catalogue exists; an architecture test
asserts no definition carries literal player-facing copy.

---

## 6. Testing

| Layer        | Tests | Notes                                                      |
| ------------ | ----- | ---------------------------------------------------------- |
| Unit         | 657   | 29 files; metrics against known traces, battery end to end |
| Architecture | 33    | +5 new rules for definitions and derivations               |
| Integration  | 79    | +7 for the run → database path, against real PostgreSQL    |
| E2E          | 29    | +11 for the aim-test surfaces                              |

Branch coverage across `core/`, `game-adapters/` and `test-engine/`: **91.82%** (gate 90%).

### What the metric tests actually assert

Each case has an answer computable by hand, because a metric bug does not crash — it produces a
plausible number for the wrong quantity.

- **Path efficiency** is exactly 1.0 for a straight flick and falls with a detour.
- **Overshoot** fires for a crosshair that sailed past and came back, and does _not_ fire once
  the target is dead, so a later engagement cannot be blamed on it.
- **Undershoot** fires for a ballistic movement that stopped short for longer than the dwell
  threshold, and not for a brief hesitation.
- **Correction count** counts a real there-and-back as one and sensor noise as zero.
- **Tracking accuracy** is 1.0 for a perfect follower, 0 for one held just outside the target,
  and measures only the _held_ portion — a player who released has stopped performing the task.
- **Tracking stability** falls monotonically as the hand gets shakier, on traces where accuracy
  and error cannot tell the difference. It is the metric that catches "too sensitive" in
  tracking, and nothing else does.
- **Aggregation** takes the median so one wild trial cannot outweigh ten good ones, pools
  `hitAccuracy` by shot count rather than averaging ratios, and reports **no interval below three
  trials** rather than inventing one.

### Two documented limitations, asserted as tests

- `trackingStability` high-passes the _unsigned_ error, so a crosshair oscillating perfectly
  symmetrically about the exact target centre holds a constant error magnitude and is invisible
  to it. Real hands do not do this; the limitation is pinned by a test rather than left to be
  rediscovered.
- `jitterRMS`'s window opens at first _entry_, which is a few milliseconds before a fast approach
  finishes — so the approach transient is present in every value and, for a fast approach,
  dominates it. The metric is monotone in tremor, which is what it is used for, and the test
  asserts monotonicity rather than an absolute figure.

---

## 7. Deferred to later phases

| Item                                                             | Phase |
| ---------------------------------------------------------------- | ----- |
| Candidate generation, counterbalancing, adaptive narrowing       | 4     |
| Composite scoring and the six dimensions (doc 14)                | 4     |
| `fatigueDrift`, `comfortableSwipeCm` (both need Phase 4 context) | 4     |
| Synthetic-player fixtures — doc 19 §19.12 harness 2              | 4     |
| The environment check that measures the real frame budget        | 4     |
| Telemetry upload; nothing is transmitted beyond aggregates today | 4     |
| The seven post-MVP tests (doc 09 §9.8–§9.14)                     | 6     |
| Results, Aim DNA, the real session flow                          | 7, 10 |
| The i18n message catalogue                                       | 10    |

---

## 8. Risks and known limitations

**8.1 Client-side measurement cannot be server-verified.** The server validates structure —
unknown metric keys, contradictory validity, impossible ranges — but it cannot confirm that a
reported acquisition time is what a hand did. That is inherent to measuring in a browser. The
checks that _can_ be made run in the engine at capture time, where the sample stream still exists.

**8.2 `unadjustedMovement` is refused on at least one platform in the support matrix.** Now
observed rather than hypothesised (§4.2). Sessions still run, with `no_raw_input` flagged, and
the confidence model prices it in (doc 15 §15.2). The behaviour on the rest of the matrix remains
**EV-010**.

**8.3 The frame budget still defaults to 60 Hz.** Carried from Phase 2: the environment check
that measures the real display interval is not built, so late-frame counts under-report on a
high-refresh display.

**8.4 The trial budget for a full battery is untested at session length.** Every test is verified
individually; nobody has yet run all seven back to back with fatigue and attention in play. doc 09
§9.16 budgets it, and Phase 4's session flow is where that gets exercised.

**8.5 `switching` respawn placement does not check separation against live targets.** It avoids
the crosshair and draws from the same distance band, but the separation constraint applies only
within a single spawn call. Overlap is possible though unlikely; hit resolution arbitrates by
proximity to centre, so a click never resolves two engagements.

---

## 9. Verification gate

| Check                                | Result                                   |
| ------------------------------------ | ---------------------------------------- |
| `npm run format:check`               | Pass                                     |
| `npm run lint`                       | Pass — no suppressions, no rule changes  |
| `npm run typecheck`                  | Pass — strict, no `any`, no `@ts-ignore` |
| `npm run check:boundaries`           | Pass                                     |
| `npm run check:secrets`              | Pass                                     |
| `npm run test` (unit + architecture) | 690 passed                               |
| `npm run test:coverage`              | 91.82% branches (gate 90%)               |
| `npm run test:integration`           | 79 passed against real PostgreSQL        |
| `npm run build`                      | Pass                                     |
| `npm run test:e2e`                   | 29 passed                                |

---

## 10. Exit criteria

| Criterion (doc 34, Phase 3)                                   | Met | Evidence                                            |
| ------------------------------------------------------------- | --- | --------------------------------------------------- |
| Every MVP test implemented from Phase 0's list                | Yes | `MVP_TESTS`, seven definitions                      |
| **Each test works independently**                             | Yes | `mvp-battery.test.ts` runs all seven end to end     |
| Instructions, practice mode, minimum trial counts             | Yes | `copy.ts`, practice rounds, `sample-budget.test.ts` |
| Seeded, reproducible stimulus generation                      | Yes | Same seed → identical trials, asserted per test     |
| Randomised positions with matched stimulus families           | Yes | Quota-balanced distance and direction classes       |
| Only Phase 0 metrics, implemented exactly as defined          | Yes | 33 derivations, tested against known traces         |
| Quality rules and invalid-trial handling                      | Yes | Carried from Phase 2, exercised per test            |
| Reaction not used to choose sensitivity                       | Yes | `baseline` category, `isDecisionMetric: false`      |
| Sessions, rounds, trials, metrics and quality flags persisted | Yes | `test-run.test.ts` against PostgreSQL               |
| No unbounded raw mouse events stored                          | Yes | Only aggregates and derived metrics are uploaded    |
| Distraction-free test screens, clear pause behaviour          | Yes | `aim-run.locked.spec.ts`                            |
| No composite scoring invented                                 | Yes | Nothing combines the decision metrics               |

---

## 11. Readiness for Phase 4

Phase 4 builds the calibration engine. What it needs is in place:

- Seven tests that each produce reproducible, aggregated metrics with sample counts and
  uncertainty — the inputs a search operates on.
- A decision metric subset that is already marked in the registry, and a battery where every
  scored test contributes at least one of them (asserted).
- `comfort360` producing `maxSingleSwipeDeg`, the physical bound the search range must respect.
- `reaction` producing the floor that makes onset-adjusted acquisition interpretable.
- An ingest path that is idempotent and transactional, so a candidate's rounds arrive intact.

Two things Phase 4 should do early: build the **synthetic-player fixtures** (doc 19 §19.12
harness 2), because the calibration engine needs a known truth to be validated against — doc 19
calls it the single most important test in the project — and build the environment check, so
frame quality stops defaulting to 60 Hz.

---

## Repository status

**No commit and no push were performed.** The working tree holds every change described above.

Suggested review order: `src/test-engine/metrics/trace.ts`, then the derivation modules, then
`src/test-engine/tests/`, then the tests that pin them.

```bash
git status
git add -A
git commit -m "feat: complete phase 3 core aim tests"
git push origin main
```
