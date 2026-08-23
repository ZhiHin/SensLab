# Phase 7 Completion Report — Results & Aim Profile Experience

**Phase:** 7 of 11
**Scope:** the results experience Phase 0 assigns to this phase — the recommendation object, the confidence index, dimension scores and the aim profile, the response curve, the results and settings screens (SCR-030, SCR-031, SCR-032, SCR-040)
**Source of truth:** [`15-confidence-index.md`](../phase-0/15-confidence-index.md) · [`16-recommendation-engine.md`](../phase-0/16-recommendation-engine.md) · [`14-scoring-model.md`](../phase-0/14-scoring-model.md) §14.4–§14.5 · [`13-calibration-algorithm.md`](../phase-0/13-calibration-algorithm.md) §13.6–§13.10 · [`24-screen-inventory.md`](../phase-0/24-screen-inventory.md) · [`20-database-schema.md`](../phase-0/20-database-schema.md)
**Date:** 2026-08-23

---

## 1. Status

**Complete.** A player can start a blinded calibration at `/calibrate`, run every round the
server plans, watch the analysis stage, and land on `/results/[id]` — where the recommendation
is presented as an **object, not a number**: the canonical value, two ranges that answer two
different questions, a seven-component confidence index with its breakdown, six dimension
scores drawn as an Aim DNA, a profile classified by doc 16's fixed rules and explained from
the measured numbers, and the response curve with the evidence on it. `/results/[id]/settings`
turns it into a game setting through the Phase 5 adapters, which — because no verification
entry has closed — show the canonical targets and say plainly why there is no number.

Every piece is deterministic, versioned and persisted with the parameter sets that produced
it. Re-running the assembly over the same session produces the same object (`SENS-BR-030`).

**One scope inclusion.** No execution-prompt phase assigns the _session orchestration loop_ —
the server-side "plan round → ingest → analyse → narrow or stop" cycle that joins the Phase 4
engine to the Phase 2/3 runner. Phase 6 deferred it to "Phase 7 builds the session
experience", and a results screen with nothing to show is not a results screen. A minimal,
complete loop is built here (§2.6). The polished onboarding, environment check and landing
experience remain Phase 10; saved hardware profiles remain Phase 9.

---

## 2. What was built

### 2.1 The confidence index (doc 15) — `core/confidence`

`computeConfidence` is the weighted geometric mean of seven components — peak, sample,
consistency, environment, drift, fit, anchor — each reported with its value, weight, whether it
was measured or took its documented neutral value, and whether it was capped. The ceiling is
0.92; a `peak_found` verdict caps at 92 and `indistinguishable` at 40 (`verdictCapped` says
so). The worked example of doc 15 §15.4 reproduces to within a point. The index has no floor:
a bad session reads single digits, and the geometric mean drives it towards zero when one
component collapses — the property doc 15 §15.9 requires, tested as stated.

The index is a **diagnostic, never a probability**. No text anywhere in the results surface
renders it as "N% chance"; the E2E suite asserts that regex never matches.

### 2.2 Dimension scores and shape (doc 14 §14.4) — `core/recommendation/dimensions.ts`

Six dimensions from `scoring_model_v2`'s weight matrix against the provisional reference
distribution: `score = clamp(50 + 12.5·z, 1, 99)`. Consistency is a dimension, not a modifier,
computed per test from the robust CV of that test's primary metric and pooled by median. A
dimension is `sufficient` only with eight or more contributing trials (§5 deviation 3). Shape
is the within-player deviation from the player's own mean, divided by a floored spread, so a
beginner and an expert with the same relative strengths get the same shape.

### 2.3 The classifier and its explanation (doc 16 §16.5–§16.6) — `profile.ts`, `explanation.ts`

Rules 0–8 exactly as doc 16 states them, in order, first match wins; the sensitivity band from
the documented cm/360 thresholds. Every classification carries the rule number and the
dimensions it keyed on as `evidence`, and the explanation is generated **from that evidence**:
it names the dimensions and their values, states the rule in plain language, describes the
measurement rather than the person, never uses a weakness as a punchline, and never compares to
other users while the reference is provisional (`SENS-BR-036`). The output is structured
(`sentences[{key, text, cites}]`) so it can be localised without the classifier changing.

### 2.4 The response curve and the two ranges (doc 16 §16.3, §16.7) — `response-curve.ts`, `calibration/engine.ts`

`buildResponseCurve` emits the contract the chart needs and nothing the chart has to compute:
candidates with their effect, standard error, n and blind label; the quadratic fit when valid;
a **bootstrap envelope** (`fitEnvelope`, from the bootstrap surface samples the engine already
produced); the optimum with its credible interval; the comfort band; the constraint as a
forbidden region; and the current sensitivity when known.

The **comfort range** was a stand-in in Phase 4 (it equalled the high-performance range). It
is now what doc 16 §16.3 describes: the plateau `x* ± √(MDE/|b₂|)` — the span over which the
fitted response cannot be distinguished from its peak at the session's minimum detectable
effect — clipped to the measured span, widened to contain the credible interval, and clipped
by the pad-width ceiling when one exists. A flat player gets the measured span. The invariant
_comfort ⊇ high-performance ∋ recommendation_ is a unit test.

### 2.5 Assembly and persistence — `assemble.ts`, `recommendation-repo.ts`, `recommendation-service.ts`

`assembleRecommendation` is a pure function of persisted facts. `saveRecommendation` writes the
`recommendations` row with its `algorithm_versions` ids, the six `dimension_scores`, the
structured explanation as JSONB (doc 20 §20.10) and the response-curve contract; a re-run sets
`superseded_by` on the parent. `getRecommendation` reads it back under the ownership predicate
(a stranger gets `null` → 404) with the guest expiry joined in for SCR-040.

### 2.6 The session loop — `calibration-session-service.ts`, `plan/calibration-round.ts`

`startCalibrationSession` creates the session, builds the initial bracket from the current
sensitivity (or 30 cm/360 when unknown), generates round-0 candidates and returns a
`SessionPlan`. `createCalibrationRoundPlan` lays a round out per doc 13 §13.6: in round 0 the
baseline tests (Reaction, 360 Comfort) then one practice block, then a scored block per
candidate in the `blockOrder` the engine drew, with test order varied between blocks (no
repeated opener) and **matched stimulus seeds** across candidates so every candidate sees the
same targets. `submitCalibrationRound` ingests the aggregates, reads the comfort swipe into the
physical constraint, rebuilds the brackets from the stored rounds, runs `analyseCalibration`,
and either returns the next round's plan or generates the recommendation and marks the session
complete. **The server decides when to stop**; the client only runs what it is given.

### 2.7 The screens

| Screen  | Route                    | What it does                                                                                                                                                                                                                                                                  |
| ------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —       | `/calibrate`             | Mode, DPI (or "I don't know"), current cm/360, pad width, game. Issues a guest session when signed out. Briefs the first round — letters, not numbers — before pointer lock is requested.                                                                                     |
| SCR-030 | (stage in `/calibrate`)  | "Analysing your aim" with real stage progress from the server round-trip, 1.2 s minimum hold, reduced-motion honoured.                                                                                                                                                        |
| SCR-031 | `/results/[id]`          | Three verdict layouts. `peak_found` leads with the number and both ranges; `indistinguishable` leads with the comfort range and "No single sensitivity won" — deliberately not an error; `insufficient_data` explains what was missing. Superseded and guest-expiring states. |
| SCR-032 | `/results/[id]/settings` | Output-game switcher, canonical targets, copy controls that copy exactly what is shown, the verification state of each adapter. **No verified adapter = no number**, stated as a feature.                                                                                     |
| SCR-040 | (banner on SCR-031)      | Guest-only "this result disappears on _date_" with sign-up link.                                                                                                                                                                                                              |

The response curve is an accessible SVG on a log-sensitivity axis: candidate dots with error
bars, the fit band, the fit curve, the comfort band, the peak marker, the current sensitivity
at the foot of the plot. The Aim DNA is a six-axis tick-band SVG with a reveal animation that
`prefers-reduced-motion` disables. Desktop is immersive; on mobile the chart scrolls inside its
own container and nothing else is lost.

---

## 3. Files created / modified

### Created — `src/` (24 files)

| File                                                     | Purpose                                                        |
| -------------------------------------------------------- | -------------------------------------------------------------- |
| `core/confidence/index.ts`                               | Doc 15 index, components, verdict caps, validation multiplier  |
| `core/recommendation/dimensions.ts`                      | Dimension scores, consistency, shape                           |
| `core/recommendation/profile.ts`                         | Band, rules 0–8, strengths and areas                           |
| `core/recommendation/explanation.ts`                     | Structured explanations from the evidence                      |
| `core/recommendation/response-curve.ts`                  | Chart contract, `fitValueAt`                                   |
| `core/recommendation/assemble.ts`, `index.ts`            | The recommendation object                                      |
| `test-engine/plan/calibration-round.ts`                  | A calibration round as a session plan                          |
| `repositories/recommendation-repo.ts`                    | Recommendations, dimension scores, game settings               |
| `services/recommendation-service.ts`                     | Generate / read / settings view / output-game options          |
| `services/calibration-session-service.ts`                | Start / submit-round / abandon — the loop                      |
| `features/calibrate/*` (5)                               | Schema, actions, form, surface, analysis stage                 |
| `features/results/*` (5)                                 | Results view, response curve, Aim DNA, confidence, copy button |
| `features/test-run/measuring-layer.tsx`                  | Extracted from `test-surface.tsx` for reuse                    |
| `app/(app)/calibrate/page.tsx`                           | Entry                                                          |
| `app/(app)/results/[recommendationId]/page.tsx`          | SCR-031, 404 for non-owners                                    |
| `app/(app)/results/[recommendationId]/settings/page.tsx` | SCR-032                                                        |

### Created — tests and tooling (8 files, 70 new cases)

| File                                               | Cases | Covers                                                                   |
| -------------------------------------------------- | ----- | ------------------------------------------------------------------------ |
| `tests/unit/recommendation/confidence.test.ts`     | 14    | Doc 15 §15.4 worked example, §15.9 properties, §15.8 multipliers         |
| `tests/unit/recommendation/profile.test.ts`        | 29    | One fixture per rule, explanation per rule, dimension scores, edge cases |
| `tests/unit/recommendation/assemble.test.ts`       | 15    | Assembly invariants, determinism, round plan, curve contract             |
| `tests/integration/calibration-session.test.ts`    | 5     | The full loop through the real server and database                       |
| `tests/e2e/results.spec.ts`                        | 7     | Three layouts, breakdown, settings switching, clipboard, 404, briefing   |
| `tests/helpers/simulate-calibration.ts`            | —     | Extracted from `recovery.test.ts`; gained `maxCmPer360`                  |
| `scripts/e2e-fixtures.ts`, `tsconfig.scripts.json` | —     | Real recommendations for the E2E suite, pinned seeds                     |

### Modified

| File                                          | Change                                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `core/calibration/engine.ts`                  | Comfort range rewritten as the plateau (§2.4); `fitBand` emitted                          |
| `core/calibration/significance.ts`            | Bootstrap keeps its surface samples; `fitEnvelope`                                        |
| `core/calibration/contracts.ts`               | `CalibrationResult.fitBand`                                                               |
| `services/calibration-service.ts`             | `minimumTrials` sums the mode's roster, not all five MVP tests (§4.1)                     |
| `repositories/session-repo.ts`, `index.ts`    | Comfort swipe, quality flags, quality summary; `recommendationRepo` export                |
| `test-engine/plan/index.ts`                   | Exports the round planner                                                                 |
| `features/test-run/test-surface.tsx`          | Uses `MeasuringLayer`                                                                     |
| `app/(marketing)/page.tsx`, `app/globals.css` | Start link; Aim DNA reveal keyframes with reduced-motion override                         |
| `tests/helpers/battery-runner.ts`             | `runPlan`, per-candidate skill, reaction delay by skill, shoots only when landed          |
| `tests/unit/calibration/recovery.test.ts`     | Uses the helper; the two-ranges invariant; the constraint clip                            |
| `tests/unit/calibration/golden-session.json`  | Regenerated for the comfort-range change (`UPDATE_GOLDEN=1`); every other field unchanged |
| `tests/e2e/global-setup.ts`                   | Runs the fixture script                                                                   |
| `README.md`                                   | Status, phase table, testing notes                                                        |

---

## 4. Defects and design problems found

**4.1 `minimumTrials` ignored the mode's roster.** It summed the floors of all five MVP tests,
so every Quick-mode candidate read as insufficient and no Quick session could ever finish.
Phase 6 left `scoredTestsForMode` ready; the service now uses it. Caught by the first full-loop
integration test.

**4.2 The switching primary metric was wrong.** `PRIMARY_METRIC_BY_TEST.switching` named a
metric the switching test does not emit, so its consistency term silently dropped out. Now
`switchingTravelTime`; a test keeps the table in step with the definitions.

**4.3 Rule 7 (hybrid) was nearly unreachable with six dimensions.** Two dimensions +1.0 above
the mean while the other four sit exactly on it is only possible when the spread floor
dominates. The fixture for the rule now makes that explicit (72/72/69×4) rather than pretending
a different geometry. Noted as a risk (§9.2).

**4.4 The comfort range equalled the high-performance range.** A Phase 4 stand-in that §2.4
replaces. The first plateau implementation collapsed for a flat player when clipped to the
domain; the range is now clipped by the pad-width ceiling only, and only when the ceiling is
above the plateau's low end.

**4.5 The synthetic player's verdict varied by seed.** A "peak" fixture sometimes produced
`indistinguishable`. Fixtures now run on pinned seeds (`1000003n`, `3000009n`) via a test-only
`seed?` on `startCalibrationSession`.

**4.6 Importing a test file to reuse its helper re-ran its suites.** `simulate` moved to
`tests/helpers/simulate-calibration.ts`.

**4.7 UI copy tripped its own tests.** "This is not a failed test" matched the `/error|failed/`
guard; the guard now targets error phrasing. "YOU WERE HERE" collided with the peak label; it
moved to the foot of the plot. `verdict-cap-note` appeared only when the cap _bound_, so a
clearly-capped indistinguishable result could omit the reason; it now appears whenever the
verdict is indistinguishable.

**4.8 `react-hooks/set-state-in-effect` in the analysis stage.** The reduced-motion query is
read in initial state rather than set from an effect.

**4.9 Dead defensive branches in the explanation generator.** Each rule had `?? 0` fallbacks
for evidence the classifier always supplies. Removed; the generator now reads the evidence in
the order the rule reasons about it, and the unused `dimensionByKey` went with it.

---

## 5. Deviations from Phase 0

| #   | Phase 0 says                                                                                   | Implementation                                     | Why                                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | doc 16 §16.3 defines the comfort range as the plateau; Phase 4 shipped the credible interval   | The plateau, as §2.4                               | Phase 4's report recorded the stand-in; this phase is where the range is shown, so this is where it is made right. Golden fixture regenerated; only `comfortRange` changed.               |
| 2   | doc 16 §16.5 rule 0: "fewer than 4 dimensions have sufficient samples", _sufficient_ undefined | `MIN_TRIALS_PER_DIMENSION = 8` contributing trials | The smallest per-candidate floor any scored test has (doc 13 §13.4). Labelled `TUNABLE`.                                                                                                  |
| 3   | doc 24 SCR-030 lives at `/(lab)/run/[id]/analysis`                                             | A stage inside `/calibrate`                        | The loop keeps one client surface across rounds; a route change between the last round and the analysis would drop pointer-lock and session state. Behaviour (progress, hold) as SCR-030. |
| 4   | doc 24 SCR-032 lists a conversion-method selector                                              | Not rendered                                       | There is exactly one verified method per adapter by construction (Phase 5); a selector with one option is noise. Revisit when an adapter offers two.                                      |
| 5   | FR-106 / SCR-035 shared result pages                                                           | Not built                                          | Both are tagged **POST**. The phase prompt says "if Phase 0 includes share results for this phase" — it does not.                                                                         |
| 6   | `startCalibrationSession` has no test hook                                                     | Optional `seed?: bigint`, documented as test-only  | Reproducible E2E fixtures need a pinned seed. The form's schema does not accept it; only the script can pass it.                                                                          |
| 7   | Nothing assigns the session orchestration loop to a phase                                      | Built here (§1, §2.6)                              | Scope inclusion, not a contradiction.                                                                                                                                                     |

---

## 6. Testing

| Layer       | Result                                                                     |
| ----------- | -------------------------------------------------------------------------- |
| Lint        | clean, `--max-warnings 0`                                                  |
| Typecheck   | clean, strict                                                              |
| Unit + arch | **51 files, 1113 passed** (Phase 6: 1045)                                  |
| Coverage    | **90.10% branches** (gate 90%)                                             |
| Integration | **9 files, 105 passed** (Phase 6: 100)                                     |
| E2E         | **43 passed** (Phase 6: 36) — 7 new in `results.spec.ts`, on real fixtures |
| Build       | ✓ Compiled successfully                                                    |
| Boundaries  | ok — no violations (`core/` still imports nothing outside itself)          |
| Secrets     | ok                                                                         |
| Prettier    | clean                                                                      |

**What the browser proves that the unit suites cannot:** the right layout for each verdict,
the chart and Aim DNA rendered as accessible SVG, no number on an unverified game, the copy
control copying exactly the value shown, a stranger receiving a 404, and the first round
briefed with letters before any pointer lock. The fixtures are **real recommendations**
produced by the real loop on a synthetic player with pinned seeds — not hand-written rows.

**Visual check.** Screenshots of both layouts, mobile and the settings page were taken with a
Playwright script: peak page 31.2 cm, HP 29.8–38.1, comfort 20.0–45.0, confidence 43,
BALANCED; indistinguishable page leads with the comfort range, confidence 27; mobile usable.

---

## 7. Phase boundary verification

No Phase 8 work was started: no validation test, no A/B, no fine-tune stage, no
`validation_results` row; `applyValidationMultiplier` exists in `core/confidence` because doc
15 §15.8 defines it with the index, but nothing calls it. No Phase 9 work: no history, no
saved hardware profiles (the form asks for DPI every time). No Phase 10 work: no environment
check, no onboarding beyond the one briefing, no landing redesign — only a start link.

---

## 8. Deferred items

| Item                                                      | Where it lands                                    |
| --------------------------------------------------------- | ------------------------------------------------- |
| Shared result pages (SCR-035, FR-106)                     | POST                                              |
| Validation and fine-tune stages (SCR-033, SCR-034)        | Phase 8                                           |
| Calling `applyValidationMultiplier` on a validated result | Phase 8                                           |
| Saved hardware profiles pre-filling `/calibrate`          | Phase 9                                           |
| History list and re-calibration from a previous result    | Phase 9                                           |
| Environment check, onboarding, landing                    | Phase 10                                          |
| Conversion-method selector on SCR-032                     | When an adapter has two verified methods          |
| Localising the structured explanation                     | The structure is in place; no locale work planned |

---

## 9. Risks and known limitations

**9.1 The reference distribution is provisional.** Every dimension score is against
`reference_dist_provisional_v2`; the Aim DNA says so on the chart. Scores will shift when a
real reference replaces it, and the `provisional` flag is persisted so the history can say
which scores were which.

**9.2 Rule 7 is rarely reached** (§4.3). With six dimensions and the documented thresholds, a
hybrid needs two strengths with the rest pinned near the mean. That is doc 16's rule, applied
as written; if real data shows hybrids are under-classified it is a parameter-set change.

**9.3 The comfort plateau depends on the fit's curvature.** A very flat peak (small `|b₂|`)
gives a wide plateau, which is the correct reading — but it is clipped to the measured span, so
the range can never claim more than the session explored.

**9.4 The synthetic player is not a human.** It is adequate to prove the loop runs and the
verdicts are reachable; it says nothing about how real players' curves look. Phase 8's
validation data is where the presentation gets its first real test.

**9.5 The session loop is minimal.** Abandoning mid-round discards the round; there is no
resume. Acceptable for a calibration that takes minutes; revisit in Phase 10 if the
onboarding data shows abandonment.

---

## 10. Exit criteria

| Criterion (phase prompt)                                                | State                                                                                |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| The response curve is the centrepiece, not a single number              | ✓ Candidates, error bars, fit, band, optimum, interval, comfort, constraint, current |
| Canonical / physical recommendation shown                               | ✓ cm/360 and counts, degrees/cm, both ranges, confidence with breakdown              |
| No fake percentages                                                     | ✓ Index labelled a diagnostic; E2E asserts no "N% chance"                            |
| Indistinguishable result is premium, not an error                       | ✓ Own layout, explains range / uncertainty / why / what next; no critical styling    |
| Aim DNA from measured normalised dimensions                             | ✓ Six axes, shape from the player's own mean, provisional label                      |
| Phase 0 classifier, no invented personality labels                      | ✓ Rules 0–8 as written; display names from the parameter set                         |
| Strengths and improvement areas explained from measurement              | ✓ Named, valued, worded per `SENS-BR-036`                                            |
| Game settings: game, DPI, hipfire, scopes where verified, copy controls | ✓ All present; **no verified adapter = no number**                                   |
| Desktop immersive, mobile fully usable                                  | ✓ Checked by screenshot                                                              |
| Shareability if Phase 0 assigns it to this phase                        | — It does not (POST)                                                                 |
| Premium transitions that respect reduced motion                         | ✓ Aim DNA reveal and analysis stage both honour `prefers-reduced-motion`             |
| Users understand WHAT and WHY                                           | ✓ Every number on the page traces to the evidence shown beside it                    |

---

## 11. Readiness for Phase 8

Phase 8 (validation and fine-tuning) has what it needs: a persisted recommendation with its
versions, `applyValidationMultiplier` waiting for a validation result, the round planner able
to build a two-candidate blind block (the current setting vs. the recommendation), and a
session loop that already decides server-side when a stage is finished.

---

## Repository status

**Branch:** `main`
**No commit created. No push performed.** The working tree holds every change described above.

### Recommended review commands

```bash
git status
git diff --stat
git diff src/core/calibration/engine.ts src/services/calibration-service.ts
git diff tests/unit/calibration/golden-session.json
```

### Recommended commit commands

```bash
git add .
git commit -m "feat: complete phase 7 results experience"
git push origin main
```

### Next phase

Phase 8 — Validation & Fine Tuning. **Not started.**
