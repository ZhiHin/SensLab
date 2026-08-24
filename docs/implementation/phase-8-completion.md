# Phase 8 Completion Report — Validation & Fine-Tuning

**Phase:** 8 of 11
**Scope:** the confirmatory test and the refinement Phase 0 assigns to this phase (FR-086 – FR-089, SCR-033, SCR-034)
**Source of truth:** [`17-validation-and-fine-tuning.md`](../phase-0/17-validation-and-fine-tuning.md) · [`15-confidence-model.md`](../phase-0/15-confidence-model.md) §15.8 · [`16-recommendation-model.md`](../phase-0/16-recommendation-model.md) §16.9 · [`20-data-model.md`](../phase-0/20-data-model.md) §20.8 · [`24-screen-inventory.md`](../phase-0/24-screen-inventory.md) · [`25-wireframes.md`](../phase-0/25-wireframes.md) §25.11
**Date:** 2026-08-24

---

## 1. Status

**Complete.** A player with a recommendation can put it to a **confirmatory test**: two arms,
their own sensitivity against the recommended one, blinded with an alphabet the calibration
never used, in ABBA/BAAB blocks whose pairs see matched stimuli. The verdict comes from the
composite the calibration optimised and from nothing else (`SENS-BR-016`); the five reported
metrics each carry their own interval, and a metric the session could not separate sits in the
same list at the same weight. Confidence is multiplied by the documented factor and both
values are kept.

**When the recommendation loses, the product says so.** The `worse` layout states it plainly,
shows the numbers in the same format as a win, keeps the player's original as the standing
value, and gives the two plausible causes — familiarity, and the estimate simply being wrong —
equal weight, with three concrete next steps and no nudge toward adopting the new value.

**Fine-tuning refines inside the uncertainty.** Five blinded candidates around `x*`, a
screening block each, then the top two duel in counterbalanced quartets with a pre-specified
early stop. The estimate itself is refined by **the same engine** the calibration used, and a
superseding recommendation is written only when the refined interval excludes the original —
"your recommendation held up" is the common outcome and is presented as a result, not a
failure. After the reveal, one optional preference question, recorded and **never** allowed to
change a stored value (`SENS-BR-002`).

---

## 2. What was built

### 2.1 `calibration_model_v2` — the protocol as data

Doc 17 needs constants v1 does not carry: how many paired blocks a validation runs, how long
its blocks are, the fine-tune offsets, the duel budget. A released set is immutable
(`SENS-BR-029`), so the set is **re-released** rather than edited, and the Phase 6 deferral —
the post-MVP tests' sample floors, which had lived only in their definitions — is folded in at
the same time. **Every search constant is identical to v1**, and the golden-session fixture
pins that: a session analysed under v2 produces the same curve as under v1. `v1` moves to
`HISTORICAL_PARAMETER_SETS`, still compiled and still hash-verified at boot, because results
generated under it must stay explainable (`SENS-BR-020`).

### 2.2 The sequence and the analysis (doc 17 §17.2–§17.3) — `core/validation`

`validationSequence` draws whole quartets from `{ABBA, BAAB}`: within each quartet the two arms
sit at the same mean position in time, so a **linear** drift cancels exactly — which is why
this and not alternation, and why a short run can assume linearity where the calibration search
cannot (doc 13 §13.7). The analysis pairs **adjacent** blocks, making the pairing a pure
function of the block index with nothing to store.

`analyseValidation` computes, for the composite and for each reported metric, the paired median
delta over matched block pairs with a **paired bootstrap over blocks and trials** — pairs are
resampled as units, and within each resampled pair the trials are resampled too, so the
interval carries both sources of variance. The verdict reads the composite interval alone.
Everything is fixed before the data arrives: the arms, the pairing, the five metrics, and the
one composite the headline comes from.

### 2.3 Fine-tuning (doc 17 §17.7) — `core/validation/fine-tune.ts`

`fineTuneCandidates` places `x* + {−δ₂, −δ₁, 0, +δ₁, +δ₂}`, clipped to the admissible range and
de-duplicated, so a clip can never produce the same sensitivity under two blind labels.
`screeningRanking` fits the same quadratic the calibration fits and ranks by it, pooling the
five short blocks into one shape estimate rather than trusting whichever block ran luckiest;
with no concave fit it falls back to the observed means. `duelDecision` implements the
pre-specified early stop — stop as soon as the paired interval excludes zero, otherwise
continue to `duelQuartetBudget` — and `originalHeldUp` decides whether anything supersedes.

### 2.4 Whether the comparison is offered (doc 17 §17.2) — `offer.ts`

Doc 17 says validation is not offered when the two arms "differ by less than the MDE". That is
read through the session's own statement of what it could not separate: the **credible
interval** on the peak. An arm A inside it is a sensitivity this session already declined to
call different, and a head-to-head between them would re-ask a question the calibration
answered with "cannot tell". The fitted score gap is still reported for the copy, but the
quadratic extrapolates badly away from the peak and is not the gate (§4.4).

### 2.5 Plans, persistence and services

| Piece                                  | What it does                                                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `test-engine/plan/paired-blocks.ts`    | The validation blocks, the duel quartets and the screening pass, as `SessionPlan`s; practice at block 0 keeps pairs adjacent |
| `repositories/validation-repo.ts`      | `validation_runs`, `validation_metric_deltas`, `subjective_preferences` — with the verdict/interval CHECK doing real work    |
| `services/validation-service.ts`       | Offer → start (arms, labels, sequence) → submit → analyse → verdict → confidence multiplier → accept / keep                  |
| `services/fine-tune-service.ts`        | Screening → duel quartets with early stop → refinement through `analyseCalibration` → superseding row or "held up"           |
| `features/session-run/plan-runner.tsx` | One server-issued plan, run by the engine, handed back as aggregates — shared by calibration, validation and fine-tune       |

The fine-tune's stage machine is **recovered from stored blocks** on every submit: which stage
is next, which two candidates duel, and how many looks have happened are all derived from what
was measured, never from client state (`SENS-BR-034`).

### 2.6 The screens

| Screen  | Route                         | What it does                                                                                                                                                         |
| ------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SCR-033 | `/results/[id]/validate`      | Briefs the comparison — "two sensitivities, shown as letters" — then runs the blocks. 404 when the comparison is not offered.                                        |
| SCR-033 | `/results/[id]/validation`    | The result: both arms, every metric with its interval and its reading, the confidence move, the verdict-specific layout, and the accept / fine-tune / keep controls. |
| SCR-034 | `/fine-tune/[id]`             | Briefs and runs screening, then the duel quartets, with a plain interstitial that says how far along the run is and nothing about how it is going.                   |
| SCR-034 | `/fine-tune/[id]/[sessionId]` | The reveal: what each letter was, whether the original held up, and the optional preference question.                                                                |
| SCR-031 | `/results/[id]`               | Gains the entry point — or, when the recommendation is effectively where the player already plays, says so instead of hiding the control.                            |

---

## 3. Files created / modified

### Created — `src/` (16 files)

| File                                               | Purpose                                                  |
| -------------------------------------------------- | -------------------------------------------------------- |
| `core/params/calibration-model-v2.ts`              | The protocol constants and the post-MVP floors           |
| `core/validation/sequence.ts`                      | ABBA/BAAB sequences, the pairing rule                    |
| `core/validation/analysis.ts`                      | Paired analysis, the five metrics, the composite verdict |
| `core/validation/offer.ts`                         | Whether a comparison is worth running                    |
| `core/validation/fine-tune.ts`                     | Candidates, screening ranking, early stop, held-up rule  |
| `core/validation/index.ts`                         | Barrel                                                   |
| `test-engine/plan/paired-blocks.ts`                | Paired-block and screening plans                         |
| `repositories/validation-repo.ts`                  | Runs, metric deltas, preferences                         |
| `services/validation-service.ts`                   | The validation loop and its read model                   |
| `services/fine-tune-service.ts`                    | The fine-tune loop and its read model                    |
| `features/session-run/plan-runner.tsx`, `flags.ts` | Shared plan runner; quality-flag filter                  |
| `features/validate/*` (4)                          | Schema, actions, run surface, result view                |
| `features/fine-tune/*` (3)                         | Actions, run surface, reveal view                        |
| `app/(app)/results/[id]/validate`, `/validation`   | SCR-033                                                  |
| `app/(app)/fine-tune/[id]`, `/[sessionId]`         | SCR-034                                                  |

### Created — tests (6 files, 51 new cases)

| File                                           | Cases | Covers                                                                      |
| ---------------------------------------------- | ----- | --------------------------------------------------------------------------- |
| `tests/unit/validation/validation.test.ts`     | 12    | Counterbalancing, pairing, the three verdicts, no metric shopping, advisory |
| `tests/unit/validation/fine-tune.test.ts`      | 15    | Candidates, screening, early stop, held-up, the offer rule                  |
| `tests/unit/validation/paired-blocks.test.ts`  | 11    | Block layout, matched stimuli, blinding, refusals                           |
| `tests/integration/validation-session.test.ts` | 6     | Both loops end to end through the real server and database                  |
| `tests/e2e/validation.spec.ts`                 | 7     | Offer, briefing, the metric table, the summary, blinding, ownership         |
| `tests/e2e/auth.setup.ts`, `auth-state.ts`     | 1     | One sign-in for the suite                                                   |

### Modified

| File                                                             | Change                                                                                                   |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `core/calibration/engine.ts`, `contracts.ts`                     | A peak is claimed only where it was measured; `peakBeyondMeasured` reports the direction (§4.1)          |
| `core/recommendation/assemble.ts`                                | Both ranges clipped by the constraint, comfort still containing high-performance (§4.2)                  |
| `core/recommendation/response-curve.ts`                          | Carries `peakBeyondMeasured`                                                                             |
| `core/params/index.ts`, `db/seed/index.ts`                       | v2 current, v1 historical                                                                                |
| `services/calibration-service.ts`                                | `minimumTrialsPerCandidate` override for the fine-tune's short blocks; `minimumTrials` exported          |
| `services/calibration-session-service.ts`                        | The current round's bracket is recovered from its own candidates (§4.3)                                  |
| `services/recommendation-service.ts`                             | `parentRecommendationId` on generate; a fine-tune target-trials figure                                   |
| `repositories/calibration-repo.ts`                               | Candidate `source` exposed; `blockIndexFrom: "planned"` for the paired analyses                          |
| `repositories/recommendation-repo.ts`                            | Version labels joined in; `updateRecommendation`; `accepted_counts_360` starts null (§4.5)               |
| `test-engine/tests/index.ts`                                     | Validation and fine-tune rosters                                                                         |
| `tests/helpers/battery-runner.ts`                                | The synthetic player: seeded first-shot error, skill-squared speed cap, per-target reaction reset (§4.6) |
| `tests/unit/calibration/golden-session.json`                     | Regenerated for the new `peakBeyondMeasured` field; **every other value unchanged**                      |
| `scripts/e2e-fixtures.ts`, `playwright.config.ts`, `tests/e2e/*` | Searched seeds, a validated fixture, one shared sign-in                                                  |

---

## 4. Defects and design problems found

**4.1 A peak was reported where none had been measured.** The engine called `peak_found`
whenever the fitted quadratic was concave with a vertex — including when that vertex sat far
outside the sensitivities actually tested, which is the quadratic extrapolating rather than a
measurement. One synthetic session recommended **0.37 cm/360** from candidates spanning 20–45
cm/360, with a "high-performance range" of 0.0008–19. The verdict now requires the vertex to
lie within the measured span plus the same tolerance that governs narrow-versus-shift (doc 13
§13.8); a vertex beyond it is reported as `indistinguishable` with `peakBeyondMeasured` naming
the direction, which is the useful finding such a session actually has. Found by the Phase 8
probe, but the defect is Phase 4's.

**4.2 The high-performance range was not clipped by the physical constraint.** Doc 16 §16.3
says both ranges are; the engine clipped only the comfort range, so a constrained session could
show a high-performance range extending past what the player can physically execute, and the
comfort range then failed to contain it. Both are now clipped at assembly, and the nesting is
restored afterwards.

**4.3 The current round's bracket was re-derived from the previous round's decision.** On
submit, the just-run round has no audit row yet, and the service replanned it from the previous
bracket — which returns the _previous_ bracket when the last decision was a `shift`, silently
analysing the round against the wrong window. It is now recovered from the round's own
candidates, which sit exactly at the bracket's ends by construction.

**4.4 The MDE gate on the offer used the fitted gap.** `|f(x_B) − f(x_A)|` against the MDE
refused validation for arms 12 cm/360 apart, because the quadratic flattens away from the peak
and predicts a gap of ~0.001 where the measurements differ plainly. The gate is now the
credible interval — the session's own statement of what it could not separate.

**4.5 A recommendation looked accepted before anyone accepted it.** Phase 7 wrote the
recommended value into `accepted_counts_360` at creation, so the validation page's accept
control rendered as "✓ Accepted" on first view. The column means "what the user is told to use
**after validation**" (doc 20 §20.8) and now starts null. Caught by screenshot.

**4.6 The synthetic player could not produce a sensitivity effect.** Three separate problems,
all in the test harness rather than the product, and all found by probing rather than by a
failing assertion: skill scaled the speed cap linearly (too weak to move onset-adjusted
acquisition), first-shot accuracy was 1.000 at every skill because the player never fired until
it had landed, and the reaction-delay queue was not reset per target, so a delayed player aimed
where the _previous_ target had been, found itself already there, and fired instantly. Fixed
with a seeded first-shot placement error proportional to `1 − skill`, a quadratic speed cap, and
a per-target queue reset. Monotone by skill afterwards: 30 / 37 / 73 ms at skill 1 / 0.9 / 0.6.

**4.7 The E2E suite exhausted the sign-in rate limit.** Thirteen sign-ins against a limit of ten
per fifteen minutes (`SENS-SEC-011`). The suite now signs in once in a `setup` project and
reuses the storage state; the limiter itself is untouched and still asserted by the integration
suite.

**4.8 Pinned fixture seeds broke on every measurement change.** A seed does not carry a
verdict — the data does. The fixture script now searches a fixed seed list for the verdict it
needs, which is deterministic per build and self-repairing when the player or a parameter set
changes.

**4.9 Dead fallbacks in the new core.** `?? 0` on an index drawn from the array's own length,
and `?? "1"` on a metric the registry is guaranteed to know. Removed; an unregistered reported
metric now throws, because it would be a table error rather than a case to handle.

---

## 5. Deviations from Phase 0

| #   | Phase 0 says                                                                    | Implementation                                                                                       | Why                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | §17.2: not offered when the arms "differ by less than the MDE"                  | The gate is the credible interval, not the fitted gap                                                | §4.4. The interval is the same claim expressed where the evidence is, rather than through a fit that extrapolates.                                                             |
| 2   | §17.7: the duel stops "after each block pair"                                   | After each counterbalanced **quartet** (two pairs)                                                   | A single pair is one A block and one B block; stopping on it would discard the counterbalancing the design rests on. `duelQuartetBudget` bounds the looks, as doc 17 requires. |
| 3   | §17.3 lists `targetAcquisitionTime` (onset-adjusted)                            | `adjustedAcquisitionTime`                                                                            | That is the registry's name for the onset-adjusted metric (doc 10 §10.2). Same quantity.                                                                                       |
| 4   | doc 24: SCR-033/034 live at `/(lab)/run/[id]?stage=…`                           | `/results/[id]/validate`, `/results/[id]/validation`, `/fine-tune/[id]`, `/fine-tune/[id]/[session]` | Both start from a result and return to it; a query-string stage on a run route would make the result page's own URL ambiguous. The screens' behaviour is as specified.         |
| 5   | §17.9 session comparison (history)                                              | Not built                                                                                            | It is used by history (FR-093), which is Phase 9. The conservative overlap rule lands with the screen that shows it.                                                           |
| 6   | Phase 6 deferred the post-MVP floors to "when the calibration set next changes" | Folded into v2 here                                                                                  | This is that change.                                                                                                                                                           |

---

## 6. Testing

| Layer       | Result                                                             |
| ----------- | ------------------------------------------------------------------ |
| Lint        | clean, `--max-warnings 0`                                          |
| Typecheck   | clean, strict                                                      |
| Unit + arch | **54 files, 1152 passed** (Phase 7: 1113)                          |
| Coverage    | **90.26% branches** (gate 90%)                                     |
| Integration | **10 files, 111 passed** (Phase 7: 105)                            |
| E2E         | **51 passed** (Phase 7: 43) — 7 new, plus one shared sign-in setup |
| Build       | ✓ Compiled successfully                                            |
| Boundaries  | ok — no violations                                                 |
| Secrets     | ok                                                                 |
| Prettier    | clean                                                              |

**Doc 17 §17.10's table, point by point:**

| Property                | Where                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Verdict correctness     | `validation.test.ts` — synthetic B-better / A-better / identical fixtures; the integration suite runs all three through the real loop |
| Counterbalancing        | `validation.test.ts` — every quartet ABBA/BAAB, arms at equal mean position                                                           |
| Pairing                 | `paired-blocks.test.ts` — adjacent blocks share stimulus seeds, pairs differ                                                          |
| No cherry-picking       | `validation.test.ts` — one significant metric with an inseparable composite yields `no_measurable_difference`                         |
| Loss handling           | `validation-session.test.ts` — `worse` retains A in `accepted_counts_360` and applies ×0.70                                           |
| Blinding                | `validation.spec.ts` — no sensitivity in the DOM before a run; fine-tune labels absent until the reveal                               |
| Preference isolation    | `validation-session.test.ts` — every `recommendations` row byte-identical after recording one                                         |
| Comparison conservatism | Phase 9, with the history screen that shows it                                                                                        |

**Visual check.** Screenshots of the validation result (desktop and 390 px), the offer on a
result page, and the fine-tune briefing. Two things were fixed from them: §4.5, and the metric
table overflowing its panel on a narrow screen — it now scrolls inside its own container.

---

## 7. Phase boundary verification

No Phase 9 work: no history list, no session comparison, no saved hardware profiles, no guest
claim flow. No Phase 10 work: no environment check, no onboarding, no landing changes. The
`subjective_preferences` table is written and read back for display only — nothing computes
with it, which is the whole point of it existing (`SENS-BR-002`).

---

## 8. Deferred items

| Item                                                   | Where it lands                                                                         |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Session comparison across sessions (§17.9, FR-093)     | Phase 9, with history                                                                  |
| Re-validation reminders after a large change           | Post-MVP drift monitoring; the copy is written now                                     |
| Multiplicity adjustment for the duel's looks           | A future `calibration_model_v3`; recorded as a known simplification                    |
| Aggregating preference-versus-measurement disagreement | Post-MVP research use, as doc 17 §17.8 describes                                       |
| A second validation of a superseded recommendation     | One run per recommendation today; a re-validation is a new recommendation's validation |

---

## 9. Risks and known limitations

**9.1 The duel's early stop is not multiplicity-adjusted.** Declared in advance with a fixed
maximum and a bounded number of looks, as doc 17 requires, but the interval is nominal. With a
budget of two looks the inflation is small; it is recorded in the parameter set's notes and is
a v3 change, not a code change.

**9.2 A validation runs once per recommendation.** The unique index on
`validation_runs.recommendation_id` enforces it. Re-validating after a week — which §17.6's
advice explicitly recommends — means a new calibration or fine-tune first. Acceptable now,
awkward once drift monitoring exists.

**9.3 The synthetic player is still not a human.** §4.6 made it monotone in skill, which is
enough to prove the loops and reach every verdict, but its variance structure is nothing like a
real player's. Whether the block budget gives a real player enough power is a question only
pilot data answers.

**9.4 Familiarity bias is stated, not corrected.** The 0.30 log2 threshold and the "two weeks"
guidance are `ASSUMPTION`s from the general shape of motor adaptation, unchanged from doc 17.
The product does not attempt to model adaptation — it says the limitation out loud.

**9.5 The confidence multiplier compounds across stages.** A validation multiplies the stored
index; a fine-tune that supersedes writes a fresh recommendation with its own index computed
from scratch. The two are not made consistent with each other, and the pre/post pair is kept so
the history can show what moved.

---

## 10. Exit criteria

| Criterion (phase prompt)                                                    | State                                                                                         |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Compare original vs recommended, matched/blinded where practical            | ✓ Two arms, fresh alphabet, ABBA/BAAB, stimuli matched within a pair                          |
| Evaluate accuracy, acquisition, overshoot, tracking, stability, consistency | ✓ The five doc 17 §17.3 metrics, each with an interval                                        |
| Only show improvement where the data supports it                            | ✓ Verdict from the composite interval; DB CHECK refuses a claim its interval does not support |
| No "your aim improved 12%" unless the metric supports it                    | ✓ Deltas are per-metric with intervals; the headline is an enum (`SENS-BR-016`)               |
| Worse: say so, reduce confidence, offer another pass, preserve original     | ✓ §17.5 implemented in full, including the two causes at equal weight                         |
| Fine-tuning: blind candidates around the recommendation                     | ✓ Five, blinded, revealed only afterwards                                                     |
| Documented pairwise/adaptive comparison methodology                         | ✓ Screening then a duel with a pre-specified early stop                                       |
| Persist session, before/after metrics, accepted, rejected, fine-tuned       | ✓ `validation_runs`, `validation_metric_deltas`, `accepted_counts_360`, superseding rows      |
| Understandable comparison rather than a wall of statistics                  | ✓ One verdict, five rows, one confidence line, three actions                                  |
| The user can validate, accept, reject or refine                             | ✓ End to end in a browser                                                                     |

---

## 11. Readiness for Phase 9

Phase 9 (accounts, history, hardware profiles) inherits a lineage that is already honest:
sessions carry `parent_session_id`, recommendations carry `parent_recommendation_id` and
`superseded_by_id`, and every result records the parameter-set versions it was produced under.
What history needs beyond that is the comparison rule of §17.9 and the screens to show it.

---

## Repository status

**Branch:** `main`
**No commit created. No push performed.** The working tree holds every change described above.

### Recommended review commands

```bash
git status
git diff --stat
git diff src/core/calibration/engine.ts src/core/recommendation/assemble.ts
git diff src/services/calibration-session-service.ts tests/helpers/battery-runner.ts
```

### Recommended commit commands

```bash
git add .
git commit -m "feat: complete phase 8 validation and fine tuning"
git push origin main
```

### Next phase

Phase 9 — Accounts, History & Hardware Profiles. **Not started.**
