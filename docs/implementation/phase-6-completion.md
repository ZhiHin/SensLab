# Phase 6 Completion Report — Advanced Tests

**Phase:** 6 of 11
**Scope:** the post-MVP aim tests Phase 0 assigns to this phase (FR-061, FR-062)
**Source of truth:** [`09-test-catalogue.md`](../phase-0/09-test-catalogue.md) §9.8–§9.14 · [`10-measurement-methodology.md`](../phase-0/10-measurement-methodology.md) · [`14-scoring-model.md`](../phase-0/14-scoring-model.md) · [`13-calibration-algorithm.md`](../phase-0/13-calibration-algorithm.md) §13.12
**Date:** 2026-08-23

---

## 1. Status

**Complete.** All seven post-MVP test categories doc 09 specifies are implemented and function
end to end through the real engine: **Wide Flick, Strafe Tracking, Slide Tracking, Speed,
Recoil Control, ADS** as test definitions, and **Scope Calibration** as what doc 09 §9.14 says
it is — the calibration engine run over a different parameter, not a distinct test.

Every one receives unit tests, deterministic fixtures, integration tests, quality tests and a
browser test. The 90% branch-coverage gate holds at 90.64%.

The phase prompt lists "reaction baseline enhancements" and "360 Comfort" as potential tests.
Phase 0 assigns neither to Phase 6 — the Reaction and 360 Comfort tests are MVP (doc 09
§9.1, §9.7) and shipped in Phase 3; the comfort constraint is wired into the search in Phase 4.
Per the prompt's own rule ("Only implement tests Phase 0 assigns to this phase. Use Phase 0 as
authority") they are not touched here, and doc 09 §9.10's interaction between Slide Tracking
and the comfort constraint (`pathTruncated`) is implemented as specified.

---

## 2. What was built

### Three engine extensions, each a data declaration the engine evaluates

The engine's central claim (doc 19 §19.9) is that a test is data plus pure hooks and adding one
never edits lifecycle code. Phase 6 stretched that claim harder than Phase 3 did, because three
of the new tests need things no MVP test needed. Each arrived as a new declarative contract the
engine evaluates, not as a branch on a test key:

| Extension                    | Contract                               | Used by                |
| ---------------------------- | -------------------------------------- | ---------------------- |
| Piecewise analytic motion    | `MotionPattern.kind = "segments"`      | Strafe, Slide          |
| Generated camera disturbance | `TestDefinition.disturbanceFor`        | Recoil                 |
| Per-trial view change        | `TestDefinition.viewFor` → `TrialView` | ADS, Scope Calibration |

**Segments.** A list of constant-acceleration pieces, each `s₀ + v₀·t + ½·a·t²`. Still
closed-form, so a position at any instant is an exact evaluation — the frame-rate independence
doc 19 §19.1 demands is preserved. The strafe generator draws reversal intervals from an
**exponential** distribution with a documented mean (650 ms, `TUNABLE`), which is the one
distribution with no memory: anticipation is impossible by construction (doc 09 §9.9). The
slide generator derives its accelerations from `v² = 2·a·d`, so the profile hits exactly the
peak speed and exactly the span with no fitting.

**Disturbance.** A closed-form camera offset as a function of cumulative **held** time: a
saturating vertical rise, a horizontal drift with a seeded sign schedule, per-shot jitter.
Every number is drawn from the session seed for the trial. **No proprietary pattern from any
game is reproduced, sampled, approximated or used as a reference** (doc 09 §9.12). The camera
exposes the offset additively, so the derivations subtract it back out to recover the player's
own movement exactly.

**View.** Applied the moment the reset target is cleared — the instant the player "scopes in"
— and restored when the trial resolves. The FOV narrows in tangent space; the sensitivity during
the window is an absolute counts/360. The ADS scope ladder is **SensLab's own simulation**
(`SIMULATED_SCOPES`, `ASSUMPTION`/`TUNABLE`), not a claim about any game's zoom.

### Six tests

| Test            | Key               | Distinctive design point                                                                |
| --------------- | ----------------- | --------------------------------------------------------------------------------------- |
| Wide Flick      | `wide-flick`      | 45/90/135/180° ±5°, left/right **exactly** balanced by an 8-trial cycle; `liftDetected` |
| Strafe Tracking | `strafe-tracking` | Memoryless reversals, bounded-acceleration turnarounds, excursion-bounded               |
| Slide Tracking  | `slide-tracking`  | Two slides per trial; `pathTruncated` against the measured reach, in counts             |
| Speed           | `speed`           | 3–5° targets, 2500 ms timeout, no accuracy weight: Precision's counterweight            |
| Recoil Control  | `recoil`          | Four generated families cycled per trial; burst in held time, then a recovery window    |
| ADS             | `ads`             | Alternates hipfire controls with scoped trials; two search parameters, one definition   |

### Twelve metrics

`liftDetected`, `reversalRecoveryTime`, `peakSpeedTrackingError`, `accelerationLagMs`,
`pathTruncated`, `recoilDeviationVertical`, `recoilDeviationHorizontal`,
`recoilCompensationGain`, `recoilRecoveryTime`, `stabilityUnderRecoil`, `adsTransitionTime`,
`adsFirstShotAccuracy` — each a doc 10 definition with its own derivation and fixture test.
Four enter the decision set (§5.3).

### Scope Calibration (doc 09 §9.14, doc 13 §13.12)

`createScopeCalibrationPlan` builds ADS rounds under `searchParameter: "scope"`: the round's
sensitivity is the **scoped** candidate and the hipfire is held at the recommended baseline.
`computeObjective` gained a `scopeKey` so the objective is computed on the scope's own track.
Nothing in the search, the drift model or the response surface changed — which is the test of
doc 13's "parameter-agnostic" claim, and it passes.

The exposure rule lives in `scope-calibration-service.ts`: only scopes the selected game's
adapter declares with verified optics are offered. With every adapter unverified, **no game is
offered any scope.** That is the feature complete with its gate closed, not a gap.

### `scoring_model_v2`

The post-MVP tests enter the dimension weights and the objective per the doc 09 §9.15 matrix.
v1 is released and hashed against every Phase 3–5 result, so it is not edited (`SENS-BR-029`):
v2 is a new set, v1 stays compiled and boot-verified as `HISTORICAL_PARAMETER_SETS`, and
`findParameterSet(version)` resolves either. The same for `reference_dist_provisional_v2`.

**The Tracking exception closes.** doc 09 §9.15 documented Tracking as single-sourced "until
Strafe Tracking and Slide Tracking arrive in Phase 6". The v2 invariant test asserts every
dimension draws from at least two tests with no exception.

---

## 3. Files created / modified

### Created — `src/` (17 files)

```
src/test-engine/targets/profiles.ts          strafe + slide generators, concat, windows
src/test-engine/targets/disturbance.ts       generated recoil family + evaluator
src/test-engine/tests/{wide-flick,strafe-tracking,slide-tracking,speed,recoil,ads}.ts
src/test-engine/metrics/{motion-tracking,recoil,lift,ads}.ts
src/test-engine/plan/scope-calibration.ts
src/core/signal/correlation.ts               uniform resampling, windowed-Pearson lag
src/core/params/scoring-model-v2.ts
src/core/params/reference-dist-provisional-v2.ts
src/services/scope-calibration-service.ts    the doc 09 §9.14 exposure rule
```

### Created — tests (8 files, 109 new cases)

```
tests/helpers/battery-runner.ts              shared synthetic player (bounded hand speed,
                                             reaction delay, partial compensation)
tests/unit/tests/advanced-battery.test.ts    every advanced test end to end, determinism
tests/unit/tests/scope-calibration.test.ts   the plan, the scope track, through the engine
tests/unit/engine/advanced-motion.test.ts    segments, profiles, disturbance, camera view
tests/unit/metrics/advanced.test.ts          every derivation against a known trace
tests/unit/metrics/advanced-edges.test.ts    gaps, releases, flat signals, every mode
tests/integration/advanced-tests.test.ts     seed, boot, recoil + ADS ingest, exposure
```

### Modified

| File                                                        | Change                                                                                                                                                 |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/core/types/vocabulary.ts`                              | `MVP_TEST_KEYS`, `ADVANCED_TEST_KEYS`, `TEST_KEYS` = both                                                                                              |
| `src/core/metrics/registry.ts`                              | Twelve metric definitions                                                                                                                              |
| `src/test-engine/contracts/index.ts`                        | `segments`, `MotionSegment`, `DisturbancePattern`, `TrialView`, hooks, `TrialContext` surroundings, `SessionPlan.searchParameter`/`physicalConstraint` |
| `src/test-engine/render/camera.ts`                          | `setDisturbance`, `setMagnification`; effective orientation = base + offset                                                                            |
| `src/test-engine/trial-manager.ts`                          | Evaluates the disturbance on held time; applies/restores the view                                                                                      |
| `src/test-engine/round-runner.ts`, `session-controller.ts`  | Carry surroundings and reach into the observation                                                                                                      |
| `src/test-engine/telemetry/metric-collector.ts`             | `TrialObservation` gains `disturbance`, `view`, `degreesPerCount`, `maxSingleSwipeCounts`                                                              |
| `src/test-engine/targets/motion.ts`                         | `evaluateSegments`, `segmentEnd`                                                                                                                       |
| `src/test-engine/metrics/tracking.ts`                       | Held-window helpers exported for the new tracking metrics                                                                                              |
| `src/test-engine/tests/index.ts`                            | `ADVANCED_TESTS`, `ALL_TESTS`, `scoredTestsForMode`                                                                                                    |
| `src/core/scoring/{standardise,objective}.ts`               | Scope track; `pathTruncated` and control-trial exclusions (§5.2)                                                                                       |
| `src/core/params/index.ts`, `src/lib/parameter-registry.ts` | Current vs historical sets; every released set verified                                                                                                |
| `src/repositories/calibration-repo.ts`                      | `loadObservedTrials` supplies `scopeKey` and `variant`                                                                                                 |
| `src/services/{calibration,test-run}-service.ts`            | v2 scoring; standalone ADS runs under the simulated `ads` scope                                                                                        |
| `src/db/seed/index.ts`                                      | Seeds thirteen definitions; post-MVP floors from the definitions (§5.4)                                                                                |
| `src/app/(app)/test/page.tsx`, `features/test-run/copy.ts`  | Advanced section; briefings for six tests                                                                                                              |
| `playwright.config.ts`                                      | `PLAYWRIGHT_PROD_PORT` / `PLAYWRIGHT_DEV_PORT` (§4.7)                                                                                                  |
| `tests/architecture/boundaries.test.ts`                     | i18n-key rule accepts hyphenated test keys (§4.6)                                                                                                      |
| `README.md`                                                 | Phase 6 status                                                                                                                                         |

---

## 4. Defects and design problems found

**4.1 Pitch drift made "180°" mean 94°.** Every target is an offset from the live camera
(doc 09 §9.0.1), and the MVP flick's vertical classes random-walk the camera's pitch towards
the ±40° band where `clampPitch` stops it. At 40° of pitch, a 180° yaw offset is a **94°**
great-circle turn. The battery caught it: a `deg180` trial measured 156°. Wide Flick now
anchors its small pitch offset to the **horizon** (`pitch − context.cameraAngles.pitchDeg`), so
the angle class means what it says. The MVP flick is unaffected (its distances are ≤ 50°,
where the effect is negligible) and is left alone.

**4.2 A mouse at rest sends nothing — two derivations assumed otherwise.** `recoilRecoveryTime`
walked the samples after the burst looking for 50 ms inside the target; a player who had
settled perfectly and _stopped moving_ produced no samples and read as never recovering (1000
ms). `liftDetected` looked for a run of slow samples; a real lift is a **gap** with no samples
at all, and the re-grip lands as one slow sample. Both now treat the sample stream honestly:
recovery carries the last known crosshair across the gap to the burst end and the trial end,
and lift detection recognises a gap ≥ 80 ms mid-flight followed by resumed progress as well as
the slow-run signature. Both signatures are fixture-tested.

**4.3 The acceleration-lag estimator was biased low by ~45%.** Two causes, both fixed and both
worth recording. (a) Both signals were built at the sparse sample times and linearly
interpolated, which smears the response _earlier_; the target velocity is analytic and is now
evaluated on the uniform grid directly, with the crosshair resampled as **position** and
differentiated on the grid. (b) The correlator used one global mean and a non-circular sum over
a shrinking overlap, so the lag that kept the most of a long plateau won regardless of
alignment; it now computes the Pearson coefficient on **each lag's own overlap**. A probe across
reaction delays of 0/25/50/100/200 ms now reads 2/28/52/102/204 — within one 4 ms grid step.

**4.4 The synthetic player teleported.** The Phase 3 battery player moved the whole gap in one
frame, which is fine for proving a lifecycle and useless for metrics that need an onset, a
ballistic phase and a stop. The shared `battery-runner` bounds hand speed (2°/frame, 480°/s)
and models partial recoil compensation as a fraction of the _disturbance_ rather than of the
gap — a fraction of the gap converges geometrically and reads as full compensation with a lag.
The MVP battery now uses the same runner; its assertions are unchanged.

**4.5 The compensation gain regressed on the wrong quantity.** The first OLS used the recorded
crosshair directly; a perfect compensator holds the crosshair still, leaves no variance, and
read as a gain of 0. doc 10 §10.5 defines the gain on the player's _counter-movement_ — the
recorded crosshair minus the applied disturbance — against the applied offset. On that
definition a perfect pull reads 1.0, a 30% pull reads ~0.3, and doing nothing reads 0, which
the battery and the fixture both now assert.

**4.6 Architecture rules caught two things.** The i18n-key rule `^test\.[a-z0-9]+\.` predates
hyphenated test keys and rejected `test.wide-flick.instructions`; the middle segment now admits
`-`. And `window` as a local identifier in two derivations tripped the DOM-access rule — correctly,
since it also shadows a global. Renamed to `span`.

**4.7 Playwright would silently test a stranger's app.** `reuseExistingServer: !isCi` with a
hardcoded port 3000 means that if another project's dev server holds 3000, the E2E suite
either fails with `EADDRINUSE` or — worse — passes requests to the wrong app (observed: a
travel app's 404 page answering `/test/tracking` on 3100). Ports are now `PLAYWRIGHT_PROD_PORT`
/ `PLAYWRIGHT_DEV_PORT`. The 36 E2E tests in this report ran on 3517 after confirming it free.

---

## 5. Deviations from Phase 0

**5.1 Scope Calibration is not a test key.** doc 09 §9.14 lists it under "tests" but describes
it as the calibration engine on a different parameter. It is implemented as a plan
(`createScopeCalibrationPlan`) over ADS rounds with `searchParameter: "scope"`, an objective
`scopeKey`, and a service-layer exposure rule. `TEST_KEYS` has six new entries, not seven.

**5.2 Scoring exclusions are in `scorableTrials`, not in the engine.** doc 09 §9.10 says
truncated slides are "excluded from tracking scoring while being retained as evidence". The
trial is stored with `pathTruncated = 1`; the exclusion happens in `core/scoring`, where all
scoring eligibility lives. The same function drops hipfire _control_ trials from a scope's
track. Both are documented in the function.

**5.3 Four new decision metrics, not six.** `reversalRecoveryTime`, `peakSpeedTrackingError`,
`recoilDeviationVertical` and `stabilityUnderRecoil` enter the decision set. The ADS tags and
`recoilDeviationHorizontal` do not: the tags duplicate `firstShotAccuracy`/`movementOnsetTime`
restricted to scoped trials, and the horizontal component is secondary by construction. The
"small and deliberate" cap rose from 16 to 18 and the reason is in the test.

**5.4 Post-MVP sample floors live in the definitions.** `calibration_model_v1.minimumValidTrials`
is a released, hashed parameter set and is not edited to add six keys. The seed reads the
floor from the parameter set when present and from the definition otherwise; the service's
per-candidate floor still sums the MVP five. A future `calibration_model_v2` can fold them in.

**5.5 ADS alternates within a trial round rather than within a trial.** doc 09 §9.13 says
"trials alternate between hipfire and ADS segments". Each scoped trial already has both — a
hipfire positioning segment, then the scoped measured window — so "alternate" is read as
alternating _trials_ between a hipfire control and a scoped trial, which gives the transition
metric a within-round control it would not otherwise have. Trial counts are doubled against
doc 09's "10 per candidate per round per scope" so ten scoped trials remain.

**5.6 Wide Flick pitch is horizon-relative** (§4.1). A deliberate, commented exception to the
camera-relative rule of doc 09 §9.0.1, for the one test where it would otherwise be wrong.

---

## 6. Testing

| Layer       | Result                                                                |
| ----------- | --------------------------------------------------------------------- |
| Lint        | clean, `--max-warnings 0`                                             |
| Typecheck   | clean, strict                                                         |
| Unit + arch | **48 files, 1045 passed** (Phase 5: 930)                              |
| Coverage    | **90.64% branches** (gate 90%)                                        |
| Integration | **8 files, 100 passed** (Phase 5: 94)                                 |
| E2E         | **36 passed** (Phase 5: 35) — 2 new, 1 updated for `scoring_model_v2` |
| Build       | ✓ Compiled successfully                                               |
| Boundaries  | ok — no violations                                                    |
| Secrets     | ok                                                                    |

**Per the phase prompt, every new test received:** unit tests (definitions, generators,
derivations), deterministic fixtures (seed-reproducibility asserted for all six; hand-built
traces for every derivation), integration tests (recoil and ADS ingest, seed, boot, exposure),
quality tests (`pathTruncated`, the `no_input` / `button_held_ratio_low` paths through the
battery, frame-budget behaviour inherited from the engine), and a browser test (the index lists
thirteen, the recoil and ADS briefings carry their honesty claims).

---

## 7. Phase boundary verification

No Phase 7 work was started: no results screen, no response-curve rendering, no dimension
scores computed, no `recommendations` row, no confidence index, no aim profile. The scoring
parameter set gained weights the results screen will read, because the post-MVP tests cannot
be scored without them and the matrix is Phase 0's — but nothing consumes the dimension
weights yet. The `/test` index gained a section; no new screen was added.

---

## 8. Deferred items

| Item                                                                | Where it lands                                                       |
| ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Folding the post-MVP sample floors into a `calibration_model_v2`    | When the calibration set next changes for its own reasons            |
| An Advanced-mode **session** planner (candidates × roster × rounds) | Phase 7 builds the session experience; `scoredTestsForMode` is ready |
| `liftDetected` feeding the physical-constraint model                | Phase 8 (validation / fine-tune), where the constraint is revisited  |
| Offering Scope Calibration to a real game                           | Gated on EV-006..009 + EV-014 closing                                |
| Updating doc 09 §9.15's "until Phase 6" prose                       | Docs sweep in Phase 11; the code and its test already say it closed  |

---

## 9. Risks and known limitations

**9.1 The simulated scope ladder is an assumption.** `SIMULATED_SCOPES` chooses magnifications
and criteria; they are `TUNABLE`, labelled, and not a claim about any game. A scoped result is
comparable across candidates and sessions but is not transferable to a game until that game's
scope model is verified (doc 36).

**9.2 The recoil family is original and therefore unfamiliar.** A player trained on a specific
game's pattern may over- or under-compensate. doc 09 §9.12 anticipates this and weights the
test for Control, not as a benchmark; the gain is reported signed so the direction is visible.

**9.3 The lag estimator assumes a trailing response.** Lags are searched from 0 upward; a
player who anticipates a _seeded_ acceleration cannot exist, but a player who happens to be
moving the right way when it begins reads as zero lag rather than negative. Documented in
`crossCorrelationLag`.

**9.4 Strafe excursion bounding introduces mild predictability at the edges.** A target that
has reached the ±24° band must reverse. The exponential draw is otherwise untouched, and a
player cannot see the band. Accepted as the price of a target that stays followable.

**9.5 Pitch drift in the MVP flick** (§4.1) is real but small at ≤ 50°. Left as is; flagged
for Phase 8 if validation data shows a pitch-dependent effect.

---

## 10. Exit criteria

| Criterion (phase prompt)                                                  | State                                                |
| ------------------------------------------------------------------------- | ---------------------------------------------------- |
| Only tests Phase 0 assigns to this phase                                  | ✓ FR-061's seven; Reaction/Comfort untouched (MVP)   |
| Wide Flick at 45/90/135/180°                                              | ✓ ±5° jitter, exact L/R balance                      |
| Strafe: unpredictable direction changes, no rhythm                        | ✓ Exponential intervals; spread/mean asserted        |
| Slide: high-speed lateral with accel/decel; no proprietary movement       | ✓ 120–220°/s, kinematic description only             |
| Recoil: original/generated curves, no proprietary patterns                | ✓ Parametric family, seeded; legal note honoured     |
| ADS/Scope: within sound browser simulation; no engine-reproduction claim  | ✓ `SIMULATED_SCOPES` labelled as SensLab's own       |
| 360 Comfort: Phase 0 methodology; may constrain the region                | ✓ Unchanged from Phase 3/4; `pathTruncated` reads it |
| Unit, fixtures, integration, quality, UI tests per new test               | ✓ §6                                                 |
| All Phase 0 test categories required before full result analysis function | ✓ Thirteen definitions run through one engine        |

---

## 11. Readiness for Phase 7

Phase 7 (results & aim profile) has everything it needs from the measurement side: thirteen
tests, `scoring_model_v2` with every dimension multi-sourced, `reference_dist_provisional_v2`
covering every decision metric, and a settings block that takes a `GameSettingsView`.

---

## Repository status

**Branch:** `main`
**No commit and no push were performed.** The working tree holds every change described above.

### Recommended review commands

```bash
git status
git diff --stat
git diff src/test-engine/contracts/index.ts src/test-engine/trial-manager.ts
```

### Recommended commit commands

```bash
git add .
git commit -m "feat: complete phase 6 advanced aim tests"
git push origin main
```

### Next phase

Phase 7 — Results & Aim Profile Experience. **Not started.**
