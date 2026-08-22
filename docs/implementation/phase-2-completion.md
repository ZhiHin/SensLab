# Phase 2 Completion Report — Aim Test Engine

**Phase:** 2 of 11
**Scope:** the runtime that presents an aim stimulus and records what the player did about it
**Source of truth:** [`docs/phase-0/19-test-engine-architecture.md`](../phase-0/19-test-engine-architecture.md)
**Date:** 2026-08-22

---

## 1. Status

**Complete.** The engine runs a full session end to end — free-aim warm-up, sensitivity
switching at round boundaries, trials with a measured window, validity classification,
replacement, pause/resume/restart/abort — under a real browser and under a scripted clock, with
identical results.

**No aim tests were written.** The seven MVP tests are Phase 3, each with a specification in
doc 09 and metrics in doc 10. What Phase 2 delivers is the machine that runs them, plus one
synthetic definition on a development-only route that exists to prove the machine needs no
knowledge of any particular test.

**No metric derivations were written**, for the same reason. The derivation seam is built,
tested, and registers zero derivations. A trial record's `metrics` object is `{}` today, which
is the honest answer — and a very different thing from a zero.

---

## 2. What was built

### The claim the whole phase rests on

A target's position is a **closed-form function of elapsed time**, and the crosshair's position
is integrated **per input sample**, not per frame. Everything else follows:

- A dropped frame causes no drift. An integrator that misses a frame is permanently wrong; a
  closed form is right at every `t` regardless of what was drawn.
- A hit can be resolved at the _exact timestamp of the mouse press_, including presses that
  landed between two frames. A player on 60 Hz and a player on 240 Hz get the same decision for
  the same physical input — asserted directly in
  [`hud-and-determinism.test.ts`](../../tests/unit/engine/hud-and-determinism.test.ts).
- The harness can step time arbitrarily and reproduce a session exactly.

### Modules

| Module                          | What it owns                                                                 |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `core/geometry/angular.ts`      | Directions, great-circle distance, camera basis, perspective projection      |
| `timing/clock.ts`               | The injected clock: `performance.now()`/rAF in production, scripted in tests |
| `timing/frame-monitor.ts`       | Frame budget, late frames, hitches, p95, degraded classification             |
| `input/pointer-lock.ts`         | Pointer lock, `unadjustedMovement`, coalesced samples, environment events    |
| `render/camera.ts`              | Counts → angles. No acceleration, smoothing, dead zone or interpolation      |
| `render/renderer.ts`            | Canvas 2D. Six shapes, no per-frame allocation, null context for headless    |
| `render/hud.ts`                 | The HUD model — with no field for score, accuracy, streak or candidate       |
| `targets/motion.ts`             | Analytic motion with closed-form velocity                                    |
| `targets/placement.ts`          | Seeded rejection-sampled placement with separation and pitch constraints     |
| `targets/target-manager.ts`     | Live targets and exact-instant hit resolution                                |
| `telemetry/ring-buffer.ts`      | Pre-allocated typed arrays with an asymmetric overflow policy                |
| `telemetry/metric-collector.ts` | The derivation seam. Zero derivations registered, by design                  |
| `quality/quality-monitor.ts`    | Environmental classification. Never modifies a measurement                   |
| `trial-manager.ts`              | The trial state machine, validity and the measured window                    |
| `round-runner.ts`               | The trial sequence for one round, and bounded replacement                    |
| `session-controller.ts`         | Stage sequencing, sensitivity switching, pause/resume/abort                  |
| `engine.ts`                     | The frame loop, wiring, and the coarse callback surface                      |
| `mount.tsx`                     | The **only** React-aware file in the engine                                  |

### Three invariants, each enforced rather than documented

**`SENS-NFR-008` — sensitivity changes only at a round boundary.** `session-controller.ts` is
the only caller of `camera.setDegreesPerCount`. A test records the camera's degrees-per-count on
_every frame of every trial_ and asserts each round saw exactly one value.

**`SENS-NFR-004` — React learns nothing per frame.** The stage object is rebuilt each frame so
the canvas HUD can read live progress, but `onStageChange` fires only when the stage _identity_
changes. A test runs a three-trial round across hundreds of frames and asserts exactly two
callbacks: `round` and `finished`.

**`SENS-BR-009` — a trial is never invalidated for being a bad trial.** Every invalid reason is
procedural. A test asserts the reason vocabulary itself contains no performance-derived code,
and another asserts that a player who missed twice and hit late produces a `valid` trial.

---

## 3. Files created / modified

### Created — engine (20 files, ~4,280 lines)

```
src/core/geometry/angular.ts, index.ts
src/test-engine/engine.ts, round-runner.ts, session-controller.ts, trial-manager.ts, index.ts
src/test-engine/timing/clock.ts, frame-monitor.ts
src/test-engine/input/types.ts, pointer-lock.ts
src/test-engine/render/camera.ts, hud.ts, renderer.ts
src/test-engine/targets/motion.ts, placement.ts, target-manager.ts
src/test-engine/telemetry/ring-buffer.ts, metric-collector.ts
src/test-engine/quality/quality-monitor.ts
src/test-engine/mount.tsx
```

### Created — the development harness route

```
src/app/(lab)/layout.tsx              404s the whole route group in production
src/app/(lab)/lab/engine/page.tsx
src/features/lab/harness-definition.ts   a synthetic TestDefinition, not one of the seven
src/features/lab/engine-harness.tsx
```

### Created — tests (10 files, ~4,290 lines, 228 tests)

```
tests/helpers/engine-harness.ts          scripted input, recording renderer, plan builders
tests/unit/core/geometry.test.ts
tests/unit/engine/timing-and-camera.test.ts
tests/unit/engine/targets.test.ts
tests/unit/engine/telemetry.test.ts
tests/unit/engine/trial-lifecycle.test.ts
tests/unit/engine/session.test.ts
tests/unit/engine/pointer-lock.test.ts
tests/unit/engine/renderer.test.ts
tests/unit/engine/hud-and-determinism.test.ts
tests/unit/engine/engine-lifecycle.test.ts
tests/e2e/lab.engine.spec.ts
```

### Modified

| File                                    | Change                                                                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/test-engine/contracts/index.ts`    | Additive only: `killTarget`, `minMovementCounts`, `minHeldRatio`, `FreeAimStage`, and four `SessionPlan` fields |
| `src/core/random/index.ts`              | `deriveRng` accepts a string seed — a session seed crosses the network as one                                   |
| `tests/architecture/boundaries.test.ts` | React boundary, framework isolation, DOM isolation, lab-route guard                                             |
| `vitest.config.mts`                     | Coverage now includes `src/test-engine/**`                                                                      |
| `playwright.config.ts`                  | A `lab` project against a dev server; the harness route 404s in the production build                            |
| `tests/e2e/smoke.spec.ts`               | Asserts `/lab/engine` returns 404 in production                                                                 |
| `README.md`                             | Phase 2 status, engine layout, testing section                                                                  |

---

## 4. Defects found and fixed during the phase

Each of these was found by a test that was written to assert a documented property, and each
would have produced a plausible-looking wrong result rather than a crash.

**4.1 Every tracking trial would have ended on its first tick.** `isSatisfied()` returned `true`
unconditionally for the `duration` end condition, so the check that a duration trial runs to its
clock was unreachable. A tracking trial would have recorded a duration of one frame and looked
entirely normal. Fixed in `trial-manager.ts`; `duration` now answers "not satisfied by anything
the player does", and `tick` handles the clock explicitly.

**4.2 Pausing destroyed the round, and resuming hung the session.** doc 19 §19.3 says entering
`PAUSED` closes the current _trial_. The implementation aborted the whole round, emitted a
partial aggregate, and left `runner === null` — after which the countdown transitioned into a
round stage with nothing to run, and the session sat there forever. `RoundRunner` gained
`invalidateOpenTrial`, and the countdown now begins a round when there is no runner.

**4.3 Every successful hit was drawn as a miss.** `recordFeedback` ran _after_ the controller had
handled the button — and a successful shot destroys its target, so the feedback lookup found
nothing. Invisible to every headless test, because a null renderer skips feedback entirely.
Found by the first test that used a recording renderer.

**4.4 `onStageChange` fired on every frame.** Wired to React, that is a render inside every
measured window — the exact thing `SENS-NFR-004` forbids. Now gated on stage identity.

**4.5 The harness page tore its own engine down.** A `Date.now()`-based seed differed between the
server and client render. Hydration failure does not merely warn: React regenerates the tree,
the canvas element is replaced, and the engine attached to it is destroyed mid-session. The
harness now uses a fixed seed, which also makes two runs comparable.

**4.6 `deriveRng` rejected string seeds**, which is the form a session seed takes over the wire.

---

## 5. Testing

| Layer         | Files | Tests | Notes                                         |
| ------------- | ----- | ----- | --------------------------------------------- |
| Unit (engine) | 10    | 228   | Headless deterministic harness                |
| Unit (total)  | 20    | 497   |                                               |
| Architecture  | 1     | 28    | +4 new rules for the engine and the lab route |
| Integration   | 4     | 72    | Unchanged from Phase 1, still green           |
| E2E           | 2     | 20    | 13 Phase 1 + 7 engine harness                 |

Branch coverage across `core/`, `game-adapters/` and `test-engine/`: **91.89%** (gate: 90%).
Lines 97.5%, functions 96.71%.

### What the engine tests actually assert

- **Frame-rate independence.** The same wall-clock input timeline is replayed at 60 Hz, 144 Hz
  and 240 Hz. The three runs render provably different numbers of frames and reach _identical_
  hit decisions, including on a 2.4°-from-a-2°-target near miss where a frame-quantised decision
  would diverge.
- **Reproducibility.** Same seed, same input, byte-identical trial records.
- **The camera is linear.** One 1000-count movement produces exactly the same rotation as 1000
  one-count movements — which is what "no acceleration, no smoothing, no dead zone" means when
  stated as a test rather than a comment. And exactly `counts_per_360` counts turns exactly 360°.
- **Great-circle geometry.** Two directions 90° apart in yaw at 80° pitch are 14.106° apart, not
  90°. A planar approximation would make every high-pitch measurement wrong.
- **The overflow policy is asymmetric.** Frame samples drop oldest-first; input samples keep a
  contiguous prefix and flag the trial. Overwriting input oldest-first would silently corrupt
  path length and correction counting — a plausible wrong number instead of an obviously
  incomplete one.
- **The HUD has no score.** Asserted on the _shape of the model_, not on drawn pixels, and again
  in the browser against the rendered DOM.
- **The renderer's effect set is restricted.** A recording context throws on gradients, shadows,
  filters, composite modes and `drawImage`. `setTransform` is called at resize and never per
  frame.
- **`unadjustedMovement` refusals.** A rejected promise, a thrown error and a silent downgrade
  are all handled, and anything unconfirmed is reported as _not_ effective (**EV-010**).
- **Calls that must do nothing.** Resume when not paused, pause when finished, abort twice,
  destroy twice — each inert rather than half-applied.

---

## 6. Deviations from Phase 0

### 6.1 `round-runner.ts` is split out of `trial-manager.ts`

doc 19 §19.2's module list gives `trial-manager.ts` both the trial state machine and the round
loop. They are separate concerns with separate tests, and the combined file was past a
reviewable size. No behaviour differs.

### 6.2 Targets are not pooled

doc 19 §19.13 lists "object pools for targets" among the no-allocation safeguards. They are not
pooled, deliberately: a trial spawns a handful (a switching sequence is the worst case, roughly
eight over twelve seconds) and they are created at trial and kill boundaries, never inside the
frame loop. Pooling buys nothing measurable there while adding a real hazard — a recycled target
carrying a stale spawn time would corrupt every position it reports. The allocation that
genuinely matters, per-sample telemetry, **is** pooled.

### 6.3 The engine reports free-aim state; it does not own the "Continue" control

doc 19 §19.3 shows free aim as a stage. The engine exposes `freeAimSatisfied` and
`completeFreeAim()` and leaves the control to the UI, because while pointer lock is held there
is no cursor and no DOM control is reachable. The harness binds it to Enter. **The real screen
(SCR-014) must do the same or equivalent** — a "Continue" button beside a locked canvas is a
control the player cannot press.

### 6.4 The camera is not re-centred on resume

A round re-centres the view at its start. After a pause, the round continues from wherever the
view was left. Re-centring mid-round would move the world under the player's hand during a
countdown; the reset-target mechanism is the intended way to re-anchor within a round.

---

## 7. Deferred to later phases

| Item                                                   | Phase |
| ------------------------------------------------------ | ----- |
| The seven aim test definitions                         | 3     |
| Every metric derivation (the seam exists and is empty) | 3     |
| Round metric aggregation (`roundMetrics` is `{}`)      | 3     |
| Synthetic-player fixtures — doc 19 §19.12 harness 2    | 3–4   |
| The session planner that produces a real `SessionPlan` | 4     |
| The environment check that measures the frame budget   | 3     |
| Telemetry upload (nothing is transmitted today)        | 4     |
| The real session screens; `/lab/engine` is a harness   | 7, 10 |
| i18n message catalogue for the HUD keys                | 10    |

---

## 8. Risks and known limitations

**8.1 `unadjustedMovement` behaviour is still unverified (EV-010).** The three refusal shapes
handled here are the ones documented in Phase 0. Until a real browser matrix is run, a fourth
shape could be reported as a success. The code's bias is toward reporting _not effective_, so
the failure mode is an over-cautious confidence penalty rather than a silently distorted
measurement.

**8.2 The frame budget defaults to 60 Hz.** `createFrameMonitor` takes a measured budget, and
nothing measures one yet — the environment check is Phase 3. On a 240 Hz display an unmeasured
session would under-report late frames.

**8.3 Free-aim placement uses the tangent-plane approximation** like all placement. Exact to
within the distances SensLab uses (≤ 50°), and the recomputed angular distance is what gets
recorded, so nothing downstream trusts the polar parameters.

**8.4 The Phase 1 password-reset E2E test is not repeatable within an hour.** Its per-IP rate
limit bucket is shared across runs, so running `npm run test:e2e` several times in an hour fails
it with a rate-limit response. The application is behaving correctly; the test lacks isolation.
Not fixed here because it is Phase 1 behaviour and outside this phase's scope — recommended fix
is a per-run identifier in the bucket key, or a test-only reset seam.

**8.5 `mount.tsx` is not unit-tested.** It needs a DOM, and adding jsdom for one file is a
dependency this project does not need. The Playwright `lab` project covers it against a real
browser.

---

## 9. Verification gate

| Check                                | Result                                   |
| ------------------------------------ | ---------------------------------------- |
| `npm run format:check`               | Pass                                     |
| `npm run lint`                       | Pass — no suppressions, no rule changes  |
| `npm run typecheck`                  | Pass — strict, no `any`, no `@ts-ignore` |
| `npm run check:boundaries`           | Pass — no violations                     |
| `npm run check:secrets`              | Pass                                     |
| `npm run test` (unit + architecture) | 525 passed                               |
| `npm run test:coverage`              | 91.89% branches (gate 90%)               |
| `npm run test:integration`           | 72 passed against real PostgreSQL        |
| `npm run build`                      | Pass                                     |
| `npm run test:e2e`                   | 20 passed                                |

---

## 10. Exit criteria

| Criterion (doc 34, Phase 2)                                        | Met | Evidence                                                     |
| ------------------------------------------------------------------ | --- | ------------------------------------------------------------ |
| Canvas renders at the display's refresh rate                       | Yes | Browser harness; frame monitor adapts to the measured budget |
| Pointer lock acquired, `unadjustedMovement` requested and recorded | Yes | `pointer-lock.test.ts`, `lab.engine.spec.ts`                 |
| Camera turns exactly 360° for `counts_per_360` counts              | Yes | `timing-and-camera.test.ts`                                  |
| No acceleration, smoothing, dead zone or interpolation             | Yes | Linearity test: 1×1000 counts ≡ 1000×1 count                 |
| Targets placed from a seed, reproducibly                           | Yes | `targets.test.ts`                                            |
| Hit detection is frame-rate independent                            | Yes | 60/144/240 Hz identical decisions                            |
| Trial lifecycle with a gated measured window                       | Yes | `trial-lifecycle.test.ts`                                    |
| Validity is procedural only                                        | Yes | Vocabulary assertion + missed-shot-stays-valid test          |
| Telemetry buffers pre-allocated, overflow policy asymmetric        | Yes | `telemetry.test.ts`                                          |
| Frame quality captured per trial and per session                   | Yes | `timing-and-camera.test.ts`, round aggregates                |
| Sensitivity switches only at round boundaries                      | Yes | Per-frame observation across two rounds                      |
| Pause/resume/restart/abort                                         | Yes | `session.test.ts`, `lab.engine.spec.ts`                      |
| No React render between round boundaries                           | Yes | Two stage callbacks across hundreds of frames                |
| HUD shows no score                                                 | Yes | Model shape, renderer text, and rendered DOM                 |
| A synthetic definition runs end to end with no engine change       | Yes | FR-058 test, and the lab route                               |
| Headless deterministic harness exists                              | Yes | `tests/helpers/engine-harness.ts`                            |

---

## 11. Readiness for Phase 3

Phase 3 writes the seven aim tests and their metrics. Everything it needs is in place:

- `TestDefinition` is data plus pure hooks, and a definition the engine has never seen runs
  end to end. Adding a test is a new declaration, not an edit to lifecycle code.
- The metric seam takes pure functions of a read-only trial observation and runs them after the
  trial closes, outside the frame loop.
- The deterministic harness can feed an exact movement trace and assert the exact trial record —
  which is how a metric specification in doc 10 becomes a test.

Two things Phase 3 should do first: build the environment check that measures the real frame
budget (risk 8.2), and build the synthetic-player fixtures (doc 19 §19.12 harness 2), because
the metrics need a known truth to be validated against.

---

## Repository status

**No commit and no push were performed.** The working tree holds every change described above.

Suggested review order: `src/core/geometry/angular.ts`, `src/test-engine/trial-manager.ts`,
`src/test-engine/session-controller.ts`, then the tests.

```bash
git status
git add -A
git commit -m "feat(phase-2): aim test engine — camera, pointer lock, trials, telemetry"
git push
```
