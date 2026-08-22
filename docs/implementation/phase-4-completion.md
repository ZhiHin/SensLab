# Phase 4 Completion Report — Calibration & Statistical Engine

**Phase:** 4 of 11
**Scope:** the deterministic statistical engine that turns measurements into a response curve
**Source of truth:** [`13-calibration-algorithm.md`](../phase-0/13-calibration-algorithm.md) · [`14-scoring-model.md`](../phase-0/14-scoring-model.md)
**Date:** 2026-08-22

---

## 1. Status

**Complete.** The engine takes measured trials and returns a statistically defensible response
curve: candidate effects with the session drift removed, a weighted quadratic fit, a seeded
bootstrap over the **whole** pipeline, an interval on the peak, and a documented stopping
decision for every round. It runs on the server, and it is a pure function of
`(trials, spec, parameters)`.

**It is not AI.** It is a noisy one-dimensional derivative-free optimisation with a nuisance
drift term, exactly as doc 13 specifies. Every number it produces is traceable to an equation in
Phase 0 and a versioned parameter set.

**It refuses to invent a peak.** A flat response, an indistinguishable set of candidates, or too
few surviving candidates all return a range and a reason rather than a point (`SENS-BR-017`).
The synthetic-player suite asserts both halves: it recovers a known optimum, and it declines
when there is none.

**No recommendation row is written.** `recommendations` requires a confidence index and
breakdown (doc 15) and an aim profile (doc 17), both of which are Phase 7. Storing a number
without any indication of how much to trust it would be worse than not storing it.

---

## 2. What was built

### The scoring objective (doc 14 §14.1–§14.3, §14.7)

```
raw metric → direction alignment → robust standardisation → soft clip → weighted sum
```

Standardisation is **within-session**, pooling every candidate and round. Standardising within a
candidate would remove exactly the between-candidate differences the product exists to measure.
It never touches the cross-player reference distribution, which is why the calibration decision
is fully valid on day one while the display scores remain provisional (doc 14 §14.4).

The soft clip `4·tanh(z/4)` is a **bounded-influence M-estimator, not trimming**: no trial is
removed, every trial still moves the estimate, and the mapping is smooth, monotone and
invertible. That is what reconciles "never delete a bad trial" (`SENS-BR-009`) with "one
catastrophic trial must not decide the recommendation".

### The search (doc 13 §13.2–§13.8)

| Piece                 | What it does                                                                  |
| --------------------- | ----------------------------------------------------------------------------- |
| `bracket.ts`          | Log space, domain bounds, the physical constraint, the initial bracket        |
| `candidates.ts`       | 3 or 4 candidates per round, blind labels re-shuffled every round, the anchor |
| `counterbalance.ts`   | Latin-square block order, randomised test order, matched stimulus seeds       |
| `drift.ts`            | `y = μ + α_i + g(b) + ε` by weighted least squares                            |
| `response-surface.ts` | The weighted quadratic, the vertex, and doc 13's bracket decision table       |
| `significance.ts`     | Bootstrap over the whole pipeline, distinguishability, the MDE                |
| `engine.ts`           | Round analysis, stopping conditions, the final verdict                        |

Three decisions carry most of the design's weight:

**Blinding.** Labels are re-shuffled every round, so a player cannot even track "the one called
A" across rounds. If they could, the measurement would be of their expectations.

**Matched stimuli.** Candidate _i_'s flick trial _k_ faces the same seeded target as candidate
_j_'s trial _k_. This turns a between-candidate comparison into a paired one — a substantial
power gain for nothing.

**The anchor.** The final round re-tests the round-1 centre. It is the only candidate that shares
a sensitivity with an earlier block, and §4.1 below explains why that single repeat is what makes
the drift model work at all.

### Server boundary

`calibration-service.ts` plans each round and analyses each round **on the server**. The
candidate list is written to the database before the client sees it, and the objective is
re-derived from stored trials rather than accepted from the browser. A client that could submit
its own objective values could submit a curve with a peak wherever it liked, and nothing
downstream could tell (`SENS-BR-034`).

Every round writes `calibration_rounds` — bracket, fit, drift form, condition estimate, MDE and
decision — so the whole search is auditable (FR-069) and the result re-derivable
(`SENS-BR-030`).

---

## 3. Files created / modified

### Created — engine (12 files)

```
src/core/scoring/standardise.ts, objective.ts
src/core/calibration/bracket.ts, candidates.ts, counterbalance.ts, drift.ts,
                     response-surface.ts, significance.ts, engine.ts
src/repositories/calibration-repo.ts
src/services/calibration-service.ts
src/db/migrations/0002_drift_form_none.sql
```

### Created — tests (7 files, 90 cases)

```
tests/helpers/synthetic-player.ts          players with a known optimum
tests/unit/calibration/recovery.test.ts    the most important test in the project
tests/unit/calibration/search.test.ts      bracket, constraint, candidates, counterbalancing
tests/unit/calibration/drift.test.ts       separation of α from g
tests/unit/calibration/golden-session.test.ts + golden-session.json
tests/unit/scoring/objective.test.ts
tests/integration/calibration.test.ts      the server boundary, against PostgreSQL
```

### Modified

| File                               | Change                                                      |
| ---------------------------------- | ----------------------------------------------------------- |
| `src/core/types/vocabulary.ts`     | `DRIFT_FORMS` gains `none` (see §4.1)                       |
| `src/core/scoring/index.ts`        | Exports the pipeline                                        |
| `src/repositories/session-repo.ts` | Round ingest resolves and attaches its candidate (see §4.3) |
| `src/repositories/index.ts`        | Exports the calibration repository                          |
| `.prettierignore`                  | Excludes the byte-exact golden fixture (see §4.5)           |
| `docs/phase-0/…`                   | No change this phase                                        |
| `README.md`                        | Phase 4 status and the `core/` layout                       |

---

## 4. Defects and design problems found

**4.1 The drift term was not identifiable, and would have silently absorbed the candidate
effects.** doc 13's design gives each candidate exactly one block, and every round generates new
candidates — so with N candidates in N blocks and a bijection between them, α and `g(b)` are
_exactly collinear_. No arithmetic can say whether a late block scored well because of its
sensitivity or because of when it ran.

The resolution is the one doc 13 §13.5 names but does not spell out: **the candidate effect must
be keyed by sensitivity, not by candidate instance**, so the anchor — a different candidate row
at the _same_ x, many blocks later — shares a level with the round-1 centre. That shared level,
measured twice at widely separated times, is the entire mechanism.

Where no sensitivity repeats, the honest model has no drift term at all. `DRIFT_FORMS` gained
`none` for that case, because recording `linear_fallback` when nothing was fitted would overstate
what the session knew. The fallback ladder is spline → linear → none, and the form is stored so
the confidence model can price it.

**4.2 The domain and the physical constraint were inverted.** Counts and centimetres are
_proportional_ — `cm/360 = 2.54 × counts / DPI` — so more counts is a slower sensitivity. The
first implementation treated them as inverted, which put the domain bounds the wrong way round
and applied the physical constraint to the **fast** end. A player with a small mousepad would
have been forbidden exactly the sensitivities they can execute, and offered the ones they cannot.
Caught by the synthetic-player suite returning an inverted comfort range. Both directions are now
asserted directly against `cmPer360FromCounts`.

**4.3 An ingested round was not attached to its candidate.** `ingestRoundAggregate` hardcoded
`candidateId: null` from Phase 1, so a calibration round's trials could not be attributed to a
sensitivity — which is the entire point of storing them. Ingest now resolves the candidate and
refuses a round naming one the session does not have.

**4.4 Replanning a round returned a different set of candidates.** A retried plan request
generated fresh candidate indices, so a client already running against the first response would
have ingested trials pointing at candidates nobody was measuring. Planning is now idempotent:
a round that already has candidates returns those.

**4.5 The formatter rewrote the byte-exact golden fixture.** `prettier --write` pretty-printed
`golden-session.json`, breaking the exact-match guarantee it exists to provide — silently, on a
run that touched nothing else. The fixture is now in `.prettierignore` with the reason.

**4.6 An unconditioned fatigue threshold misreported inconsistency as fatigue.** doc 13 §13.10
aborts when `|fatigueDrift|` exceeds a threshold. But a drift term fitted on a very noisy player
is itself noisy, and the raw threshold told an _inconsistent_ player "you were still warming up" —
a confident explanation of something that did not happen. Fatigue now also requires that the
drift was identified at all and exceeds the session's own minimum detectable effect. Recorded as
a deviation in §5.1.

---

## 5. Deviations from Phase 0

### 5.1 `stop_fatigue` requires evidence, not just magnitude

doc 13 §13.10 condition 2 compares `|Δg|` against a fixed threshold. Implemented literally, a
noisy player trips it on an estimate that is mostly noise. The condition now additionally
requires `driftForm !== "none"` and `|Δg| > MDE` — the session cannot claim to have seen a drift
smaller than the smallest effect it could detect. This is strictly more conservative: it aborts
less often, and never for a drift the data cannot support.

### 5.2 `DRIFT_FORMS` gains `none`

See §4.1. A forward-only enum migration (`ALTER TYPE … ADD VALUE`).

### 5.3 The within-test split of the objective weights

doc 14 §14.7 gives per-**test** objective weights but does not say how a test's weight divides
among its decision metrics. This implementation splits it equally over the decision metrics
_present on that trial_, renormalising when one is absent — because a flick trial that never
reached the target has no `pathEfficiency`, and scoring the missing metric as zero would punish
the trial twice.

### 5.4 The omitted level's standard error is an upper bound

Sum-to-zero coding leaves one level's effect as minus the sum of the others. Its exact variance
needs the full covariance matrix; the implementation uses the sum of the individual variances,
which is an upper bound. That is the conservative direction for a confidence claim — it widens an
interval rather than narrowing one.

### 5.5 No `recommendations` row, no dimension scores

Both need Phase 7 inputs: the confidence model (doc 15) and the aim profile (doc 17) for the
recommendation, the reference distribution (doc 14 §14.4–§14.5) for the six display dimensions.
The calibration decision itself never touches either, which is exactly why it can be finished
first.

---

## 6. Testing

| Layer        | Tests | Notes                                                       |
| ------------ | ----- | ----------------------------------------------------------- |
| Unit         | 742   | +90 for calibration and scoring                             |
| Architecture | 33    | Unchanged; `core/` purity now covers the calibration engine |
| Integration  | 87    | +8 for the server boundary, against real PostgreSQL         |
| E2E          | 29    | Unchanged                                                   |

Branch coverage across `core/`, `game-adapters/` and `test-engine/`: **90.42%** (gate 90%).

### The synthetic-player suite

doc 19 §19.12 calls this the single most important test in the project, and the reason holds:
every other test asserts a component computes what it was told, while this one asserts the whole
pipeline recovers a **known truth**.

- A player with a clear optimum is recovered to within 0.25 in log2 — about 19% in sensitivity —
  and the reported interval contains the true optimum.
- A player who is **still warming up** is recovered to within 0.3. Without `g(b)`, a rising
  session reads as a preference for whichever candidate ran last.
- A player who **warms up and then tires** is recovered too — the shape a straight-line drift
  term cannot represent, and the reason `g` is a spline.
- A **flat** player returns no peak, no point estimate and no interval, but still returns a range.
- An **inconsistent** player returns `indistinguishable` with an MDE larger than their true
  effect: the finding is that variance, not sensitivity, is their limiter (doc 04 §4.4.9).
- **10% wild trials** move the estimate by less than the MDE, and every one of them stays in the
  estimator.

### The golden session

A fixed three-round session with an anchor, committed and asserted **bit for bit**
(`SENS-NFR-019`). The recovery tests assert the answer is close enough; this one asserts it is
_identical_, which is the stricter property `SENS-BR-030` actually promises. It runs the shipped
parameters, all 2,000 resamples included — a fixture generated with a reduced resample count
would pin a configuration nobody runs.

---

## 7. Deferred to later phases

| Item                                                          | Phase |
| ------------------------------------------------------------- | ----- |
| The confidence model (doc 15) and the `recommendations` row   | 7     |
| The six display dimensions and the reference distribution     | 7     |
| The aim profile rules (doc 17)                                | 7     |
| The session flow that drives plan → measure → analyse in a UI | 7     |
| `fatigueDrift` surfaced to the user                           | 7     |
| Validation runs and fine-tuning (doc 17 §17.7)                | 8     |
| Game conversion of the recommended sensitivity                | 5     |

---

## 8. Risks and known limitations

**8.1 Drift and round remain partially confounded.** doc 13 §13.7 says so, and the
implementation does not fix it — it cannot. Later rounds test a narrower range _and_ occur later
in time. The anchor identifies `g` from one repeated sensitivity; with a single anchor that is
one degree of freedom against a spline's three, so the spline is often ill-conditioned and the
model falls back. Both the fallback and the condition estimate are recorded.

**8.2 A full analysis takes seconds.** 2,000 bootstrap resamples, each refitting the drift model
and the quadratic, costs roughly 2–4 s per round on the development machine. That is acceptable
for a server-side step that runs once per round, but it is not free, and it is the first thing to
measure if session latency becomes a complaint.

**8.3 The objective's within-test weighting is an interpretation**, not a specification (§5.3).
It should be revisited when doc 14 is next updated with real variance data.

**8.4 The minimum detectable effect uses the median pairwise standard error** rather than an
exact per-pair calculation. It is a summary figure reported to the user, not a decision input,
but it is an approximation and is described as one.

**8.5 Nothing has been validated against a real player.** Every result in this phase comes from
synthetic players whose truth was constructed. That is the correct way to test the _engine_, and
it says nothing about whether the model matches human aiming — which is what Phase 8's validation
runs exist to find out (risk R-09).

---

## 9. Verification gate

| Check                                | Result                                   |
| ------------------------------------ | ---------------------------------------- |
| `npm run format:check`               | Pass                                     |
| `npm run lint`                       | Pass — no suppressions, no rule changes  |
| `npm run typecheck`                  | Pass — strict, no `any`, no `@ts-ignore` |
| `npm run check:boundaries`           | Pass                                     |
| `npm run check:secrets`              | Pass                                     |
| `npm run test` (unit + architecture) | 775 passed                               |
| `npm run test:coverage`              | 90.42% branches (gate 90%)               |
| `npm run test:integration`           | 87 passed against real PostgreSQL        |
| `npm run build`                      | Pass                                     |
| `npm run test:e2e`                   | 29 passed                                |

---

## 10. Exit criteria

> _"The system should be capable of taking simulated/test-session measurements and returning a
> statistically defensible response curve/recommendation without any game conversion."_

| Criterion                                                  | Met | Evidence                                         |
| ---------------------------------------------------------- | --- | ------------------------------------------------ |
| Search in `log2(counts_per_360)`                           | Yes | `bracket.ts`, asserted against fixed percentages |
| Candidate generation, blinded                              | Yes | Labels re-shuffled per round                     |
| Latin-square counterbalancing                              | Yes | Each candidate in each position exactly once     |
| Matched stimuli across candidates                          | Yes | Seed excludes the candidate, includes the round  |
| Bracket, narrowing, shifting, stopping                     | Yes | doc 13 §13.8's decision table, case by case      |
| Physical constraint from the comfort test                  | Yes | Bounds the slow end; direction asserted          |
| Drift/nuisance model `g(block)`                            | Yes | Spline → linear → none, with the form recorded   |
| Weighted quadratic response fit                            | Yes | Inverse-variance weights                         |
| Non-concave fallback, never a forced peak                  | Yes | Convex fits report no vertex                     |
| Anchor candidate                                           | Yes | Generated, stored, and used to identify drift    |
| Seeded bootstrap over the full pipeline                    | Yes | Refits drift _and_ quadratic per resample        |
| Flat curve → explicit "no distinguishable optimum" + range | Yes | Synthetic flat player                            |
| Algorithm versions, seeds and configuration persisted      | Yes | Session columns + `calibration_rounds`           |
| Adaptive step server-side                                  | Yes | `calibration-service.ts`, integration-tested     |
| Deterministic tests with synthetic fixtures                | Yes | 90 cases plus a bit-for-bit golden session       |

---

## 11. Readiness for Phase 5

Phase 5 builds verified game profiles and conversion. It needs a canonical `counts_per_360` to
convert, which this phase now produces — and the adapter contract, the verification register and
the refusal path all already exist from Phase 1.

Nothing in the calibration engine knows a game exists, and an architecture test enforces that. So
Phase 5 is additive: it turns a number this engine produced into a number a game accepts, or
declines to, and the calibration is unaffected either way.

---

## Repository status

**No commit and no push were performed.** The working tree holds every change described above.

Suggested review order: `src/core/calibration/drift.ts` (and §4.1), then `engine.ts`, then
`tests/unit/calibration/recovery.test.ts`.

```bash
git status
git add -A
git commit -m "feat: complete phase 4 calibration engine"
git push origin main
```
