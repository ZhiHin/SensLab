# 13 — Adaptive Calibration Algorithm

Related: [14-scoring-model.md](14-scoring-model.md) · [15-confidence-model.md](15-confidence-model.md) · [09-test-catalogue.md](09-test-catalogue.md) · [11-canonical-sensitivity-model.md](11-canonical-sensitivity-model.md)

This is the algorithm that turns measured aim performance into a sensitivity estimate. It is
pure, deterministic given its inputs and seed, and completely game-independent (`SENS-BR-002`,
FR-063).

---

## 13.1 Problem statement

We are estimating the location of the maximum of an unknown, noisy, single-peaked function:

```
S(x) = the player's aiming performance at log-sensitivity x
```

subject to:

- **Expensive evaluations.** Each point costs ~2.5 minutes of a human's attention.
- **Heavy noise.** Trial-level variability dwarfs the between-candidate effect we are looking for.
- **Non-stationarity.** The player warms up, learns, and fatigues *during* the experiment.
- **Bias hazards.** If the player knows which candidate is which, they will not behave neutrally.
- **A hard physical constraint** on one end of the domain.
- **A real possibility that no maximum exists** within a detectable margin — the honest answer is
  often "flat" (`SENS-BR-017`).

This is a **noisy derivative-free 1-D optimisation with a nuisance drift term**, not a search.
The design follows accordingly: a response-surface method with blocked, counterbalanced,
randomised evaluation.

---

## 13.2 Work in log space

The search variable is:

```
x = log2( counts_per_360 )
```

**Why log:** sensitivity is perceived and used multiplicatively. The difference between 20 and
25 cm/360 is large; between 80 and 85 it is negligible. A linear search wastes evaluations at
the slow end and skips resolution at the fast end. In log space a fixed step is a fixed
*percentage*, which is the psychophysically meaningful unit. It also makes the response surface
far closer to symmetric, which is what the quadratic fit assumes.

Useful conversions: a step of `Δx = 1` doubles the sensitivity; `Δx = 0.1` is ≈ 7.2%;
`Δx = 0.585` is ×1.5.

Counts, not centimetres, so the search does not move when a user corrects their DPI
(doc 11 §11.1).

---

## 13.3 Initial bracket

```
bracket = [ x_c − w₀ , x_c + w₀ ]
```

**Centre `x_c`:**

| Available information | Centre |
|---|---|
| Current game + sensitivity, verified adapter | `log2(counts_per_360)` implied by the user's current setting |
| Current cm/360 stated directly | that value |
| Prior SensLab recommendation for this hardware profile | the prior `counts_per_360` |
| Nothing | the cold-start default |

`ASSUMPTION` (`TUNABLE`, `cold_start_center`): the cold-start centre is **30 cm/360**. Chosen
because it sits mid-range in the human-usable domain (doc 11 §11.10) and is close to the
geometric mean of the domain bounds — it minimises the worst-case number of bracket moves needed
to reach either extreme. It is not a claim about a typical player.

**Half-width `w₀`:**

| Situation | `w₀` (log2) | Multiplicative span |
|---|---|---|
| Known current sensitivity | 0.585 | ÷1.5 … ×1.5 |
| Prior SensLab recommendation | 0.30 | ÷1.23 … ×1.23 |
| Cold start | 0.85 | ÷1.8 … ×1.8 |

Cold start uses a wider bracket **and** an additional round in Standard/Advanced (doc 04 §4.4.4),
because with no anchor the first round's job is localisation rather than refinement.

**Domain clipping.** The bracket is intersected with the admissible domain
(8–100 cm/360, doc 11 §11.10) and with the physical constraint below. If clipping makes the
bracket narrower than `0.2` in log2, the bracket is re-centred rather than shrunk, so the search
still has room to move.

---

## 13.4 The physical constraint

The low-sensitivity (high cm/360) end is bounded by what the player can physically execute.

Inputs:
- `padWidthCm` — optional, self-reported.
- `comfortableSwipeCm` — measured by the 360 Comfort Test (doc 09 §9.7), median of three
  attempts, converted to physical distance using the session DPI.

```
usableSwipeCm = min( padWidthCm ?? ∞ , comfortableSwipeCm × κ )
maxCm360      = usableSwipeCm / ρ
```

`ASSUMPTION` (`TUNABLE`): `κ = 1.0` (the measured comfortable swipe is taken at face value) and
`ρ = 0.55`. `ρ` encodes that a player does not need to perform a full 360° in one motion to be
comfortable — the common demand is a fast ~180° turn plus margin. Setting `ρ = 0.55` means a
player whose comfortable swipe is 22 cm is not offered anything slower than 40 cm/360.

**Precedence and disagreement.** If the declared pad width and the measured swipe disagree
substantially (measured swipe exceeds pad width by more than 20%), the *measured* value wins and
the session records `constraint_source = 'measured'` with a note — a player may have desk space
beyond the pad, or may have mismeasured. The reverse case (pad much wider than the comfortable
swipe) is not a conflict: the swipe is the binding limit.

**No upper constraint on the fast end** other than the admissible domain, because there is no
physical barrier to a high sensitivity — only a performance one, which the measurement itself
detects.

**If the constraint eliminates the user's current sensitivity**, that is a finding and is
reported: "your current sensitivity requires more space than you have."

---

## 13.5 Candidate generation

Per round, given bracket `[x_lo, x_hi]` with centre `x_m` and half-width `w`:

**Standard (3 candidates):** `{ x_m − w, x_m, x_m + w }`
**Advanced (4 candidates):** `{ x_m − w, x_m − w/3, x_m + w/3, x_m + w }`

Three points is the minimum for a quadratic fit and therefore the minimum for locating a peak
rather than merely ranking. Four points in Advanced provide one degree of freedom for lack-of-fit,
which is what lets the Advanced mode's confidence legitimately exceed Standard's.

**The anchor candidate.** In the **final** round, one additional block re-tests the *round-1
centre* candidate `x_c`. This is a metrology "check standard" and it does three jobs:

1. It gives a direct **within-session test–retest estimate**: the difference between the same
   sensitivity measured early and late is a pure measure of session noise plus drift.
2. It **identifies the drift term** far more strongly than counterbalancing alone can, because
   it is the same *x* at two widely separated times.
3. It provides a **sanity check on the whole result**: if the final estimate claims a large
   improvement over `x_c` but the anchor re-test at `x_c` scores as well as the winner, the
   result is downgraded.

Cost: one extra block (~2.5 min in Standard). It is worth it, and it is the single highest-value
addition to the naive three-candidate design.

**Candidate identity is never revealed** during the session (`SENS-BR-007`). Candidates carry
opaque blind labels (`A`, `B`, `C`) that are themselves shuffled per round, so a player cannot
even track "the one labelled A" across rounds. The mapping is stored server-side and revealed on
the result page.

---

## 13.6 Presentation design — blocking, ordering, randomisation

Within a round:

```
for each candidate  ->  one BLOCK
  a block = [ flick trials, micro trials, tracking trials, switching trials, precision trials ]
```

**Rules:**

1. **Blocks are contiguous per candidate.** The sensitivity changes only at block boundaries
   (`SENS-NFR-008`). Switching sensitivity mid-block would give the player no chance to adapt and
   would measure adaptation cost instead of performance.
2. **Block order is counterbalanced** across rounds using a **Latin square** over candidates. For
   3 candidates × 3 rounds, the square guarantees each candidate occupies each position exactly
   once, so position effects cancel exactly rather than approximately. For 4 candidates, a
   cyclic Latin square with a randomised starting row is used.
3. **Test order within a block is randomised per block**, from the session seed, with the
   constraint that the same test does not open two consecutive blocks.
4. **Stimulus seeds are matched across candidates within a round.** Candidate *i*'s flick trial
   *k* uses the same seeded target distance/direction as candidate *j*'s flick trial *k*. This is
   a **paired design**, and it removes stimulus variance from the between-candidate comparison —
   a substantial power gain for free. The seed differs between rounds so nothing is memorised.
5. **A short neutral interstitial** (3–5 s, fixed crosshair, no feedback) separates blocks.

Point 4 is the second-highest-value design decision in this document after blinding. Comparing
candidates on *identical* stimulus sequences converts a between-subjects-style comparison into a
paired one.

---

## 13.7 Removing the drift (learning and fatigue)

A player's performance changes monotonically-ish over a 20-minute session. Left unmodelled, that
drift is confounded with candidate order, and counterbalancing alone only removes its *average*
effect, not its contribution to variance.

**Model.** For trial-level standardised score `y` (doc 14 §14.3), trial *t* belonging to
candidate *i* and global block index *b*:

```
y_t = μ + α_i + g(b_t) + ε_t
```

- `α_i` — the candidate effect. This is what we want.
- `g(b)` — the session drift, a **monotone-free smooth function** of block index, represented as
  a natural cubic spline with 2 interior knots (Standard) or a straight line (Quick). Not forced
  monotone, because real sessions warm up *then* fatigue.
- Identifiability constraint: `Σ α_i = 0` and `g(b̄) = 0`.

**Estimation.** Weighted least squares on the trial-level design matrix. With counterbalanced
blocks and the anchor candidate, the design is well-conditioned; the anchor is what pins `g`
against `α`.

**Outputs used downstream:**
- `α̂_i` with standard errors — the de-drifted candidate scores.
- `fatigueDrift` = the fitted change in `g` from the first to the last block, in score units —
  reported to the user and used by the confidence model (doc 15 §15.2).

**Honest caveat, recorded here and surfaced in the methodology page:** because later rounds test
a narrower sensitivity range *and* occur later in time, drift and round are partially
confounded. Within-round counterbalancing and the anchor candidate identify `g` primarily from
within-round and anchor contrasts. When the design matrix's condition number exceeds a threshold
(`TUNABLE`), the engine falls back to a linear `g` and records `drift_model = 'linear_fallback'`,
and the confidence model applies a penalty. This is a real limitation of a single-session
design and is not papered over.

---

## 13.8 Response-surface fit and next bracket

Given candidate estimates `(x_i, α̂_i, se_i)` — **pooled across all rounds completed so far**,
not just the current round — fit a weighted quadratic:

```
α(x) = β₀ + β₁x + β₂x²        weights  wᵢ = 1 / se_i²
```

Pooling across rounds is legitimate precisely because `g(b)` has removed the time effect; it
means the final fit has 3 points after round 1, 6 after round 2, and 9 (+ anchor) after round 3,
which is what makes a quadratic worth fitting at all.

**Vertex:**

```
x* = −β₁ / (2β₂)      valid only when β₂ < 0 (concave)
```

**Decision table for the next bracket:**

| Condition | Decision | Next bracket |
|---|---|---|
| `β₂ < 0` and `x*` inside `[x_lo − 0.25w, x_hi + 0.25w]` | `narrow` | centre `x*`, half-width `max(γ·w, w_min)` |
| `β₂ < 0` but `x*` outside that range | `shift` | move the bracket one half-width toward `x*`, keep width `w` |
| `β₂ ≥ 0` (convex/flat) and the best candidate is at an edge | `shift` | move one half-width toward that edge, keep width |
| `β₂ ≥ 0` and the best candidate is interior, differences significant | `narrow_conservative` | centre on the best candidate, half-width `0.7w` |
| No pair of candidates differs significantly (§13.9) | `stop_indistinguishable` | — |

`ASSUMPTION` (`TUNABLE`): `γ = 0.5`, `w_min = 0.10` (≈ ±7%). Halving each round means a
cold-start bracket of ±1.8× narrows to about ±1.2× after two narrows — appropriate given the
noise level. A more aggressive `γ` would outrun the data.

**Guard against runaway extrapolation:** `x*` is always clipped to the admissible domain and to
the physical constraint before being used as a centre.

---

## 13.9 Statistical significance and the minimum detectable effect

Two candidates are **distinguishable** when the bootstrap confidence interval on `α̂_i − α̂_j`
excludes zero at the configured level (`ASSUMPTION`, `TUNABLE`: 90% two-sided — deliberately not
95%, because this is a decision procedure with a symmetric cost of error, not a hypothesis test
protecting against a false discovery in the literature).

**Bootstrap.** Resample *trials within candidate-block* with replacement (2,000 resamples,
seeded), refitting the **entire** pipeline — normalisation, drift model, quadratic — on each
resample. This propagates every source of estimation uncertainty into `x*`, which is what
produces the credible interval reported as the high-performance range (doc 16 §16.3).

Resampling trials rather than blocks is correct here because the trial is the independent
replicate; block-level resampling would be preferable if there were more blocks, but with 3–4
blocks per candidate it would have almost no resolution.

**Minimum detectable effect.** Recorded per session as the smallest `|α_i − α_j|` the achieved
sample size could have detected at 80% power. Reported in the confidence breakdown, and used to
distinguish "the sensitivities are genuinely equivalent" from "we could not tell" — two
different things that a naive system conflates.

---

## 13.10 Stopping conditions

Checked after every round, in this order:

| Order | Condition | Verdict recorded |
|---|---|---|
| 1 | Environment/quality abort (sustained degradation, repeated pointer-lock loss) | `stop_quality` |
| 2 | `|fatigueDrift|` exceeds the abort threshold | `stop_fatigue` |
| 3 | No candidate pair distinguishable, **and** ≥ 2 rounds complete | `stop_indistinguishable` |
| 4 | Bracket half-width `w ≤ w_min` | `stop_converged` |
| 5 | Round budget exhausted (Quick 2, Standard 3, Advanced 4) | `stop_budget` |
| 6 | otherwise | continue |

Condition 3 requires two rounds so that a merely underpowered first round does not end the
session prematurely.

Every round writes `calibration_rounds.decision` (FR-069), so the whole search is auditable.

**On `stop_quality` or `stop_fatigue`:** a recommendation is still produced if the minimum
sample requirements were met, but with a substantially reduced confidence and an explicit
explanation. If the minimums were not met, no recommendation is produced and the user is offered
a re-run — an honest failure rather than a fabricated result.

---

## 13.11 Outputs

```
CalibrationResult
  verdict                "peak_found" | "indistinguishable" | "insufficient_data"
  xStar                  log2 counts_per_360 (null when not peak_found)
  countsPer360           2^xStar
  credibleInterval       { low, high, level }      from the bootstrap distribution of x*
  comfortRange           { low, high }             see doc 16 s16.3
  candidates             [{ x, alphaHat, se, n, roundIndex, blindLabel }]
  fitParams              { b0, b1, b2, r2, concave }
  driftModel             { form, deltaFirstToLast, conditionNumber }
  anchorRetest           { deltaScore, se }        null if not run
  mde                    minimum detectable effect
  stopReason             enum
  constraint             { maxCm360, source }
  seed, algorithmVersion
```

Everything needed to redraw the response curve, re-derive the recommendation, and explain the
decision is in this object, and all of it is persisted (`SENS-BR-030`).

---

## 13.12 Parameter-agnosticism

The engine optimises **a scalar parameter under a scored objective**. Nothing in it knows the
parameter is a sensitivity. The same engine therefore runs the post-MVP Scope Calibration
(doc 09 §9.14), where the parameter is a scope multiplier, with no change beyond the parameter's
domain and constraint function.

Concretely, the engine's input is:

```
CalibrationSpec
  parameterName, domain, constraint, initialCenter, initialHalfWidth
  candidateCountPerRound, roundBudget
  objective: (trials) -> trialScores      // supplied by the scoring module
  seed
```

Keeping this interface honest in Phase 1 is what makes Phase 6 and Phase 8 cheap.

---

## 13.13 Handling the difficult cases

| Case | Handling |
|---|---|
| **Two candidates tie for best** | The new bracket spans both, centred on their midpoint. No coin flip. |
| **Highly inconsistent player** (large within-candidate variance) | Detected via `consistency` and the MDE. Leads to `stop_indistinguishable` with a comfort range, plus the specific finding that variance, not sensitivity, is the limiter (doc 04 §4.4.9). |
| **Player improves dramatically mid-session** (large positive drift) | Handled by `g(b)`; if the drift exceeds the abort threshold the session stops with `stop_fatigue` (the same condition covers large drift in either direction, since both invalidate cross-block comparison). The user is told the honest reason: "you were still warming up throughout — a second session will be more accurate." |
| **The optimum is at the edge of the admissible domain** | The bracket shifts until it hits the domain bound, then reports the bound with an explicit note that the true optimum may lie beyond what SensLab considers usable. |
| **The physical constraint eliminates the fitted optimum** | The recommendation is the constrained optimum, and the unconstrained optimum is reported separately as "with more desk space, your aim peaked at X". |
| **Anchor re-test contradicts the result** | Confidence penalty proportional to the contradiction; if severe, the verdict downgrades to `indistinguishable`. |
| **A candidate has insufficient valid trials** | Excluded from the fit (`SENS-BR-012`), not imputed. If fewer than 3 candidates survive in total, verdict is `insufficient_data`. |

---

## 13.14 Determinism and reproducibility

- One seed per session drives every random draw: candidate order, target positions, timings,
  test order, and every bootstrap resample.
- The engine is a pure function of `(trials, spec, parameterSet)`.
- A golden-session fixture is committed and asserted bit-for-bit in CI (`SENS-NFR-019`), run on
  both Linux and Windows to catch platform floating-point divergence.
- Re-running the engine over stored trials must reproduce the stored recommendation exactly
  (`SENS-BR-030`). This is the test that keeps the whole "explainable forever" promise real.
