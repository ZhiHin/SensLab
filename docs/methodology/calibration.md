# Calibration methodology

What SensLab measures, how it turns measurements into a recommendation, and — the section that
matters most — what it does not claim.

This is the explanation a sceptical player deserves. The full specification is doc 13; this
describes the reasoning rather than the parameters.

---

## 1. The claim being made

> Across a set of sensitivities, this player performed measurably better in a particular range,
> and here is how confident that is.

Not "this is the best sensitivity". Not "pros use this". The product measures one player, over
one session, on tasks that are proxies for aiming, and reports what that measurement supports.

Everything below exists to keep that claim honest.

---

## 2. The canonical unit

Sensitivity is held as **counts per 360°** — how many mouse counts turn the view a full circle.

It is the only representation that is a property of the _player and their mouse_ rather than of
a game's config format. cm/360° is presentation: it depends on DPI, and DPI is often
self-reported. Games' own numbers are worse still — the same value means different angles in
different engines.

So the search, the statistics, and the stored result are all in `log2(counts_per_360)`. Log
scale because sensitivity is perceived multiplicatively: the difference between 20 and 25
cm/360 matters as much as between 40 and 50.

---

## 3. What is measured

Thirteen tests across four families (doc 09). Each produces metrics that are standardised and
combined into one **composite score per trial** — a single number where higher is better, with
the reaction-time floor removed so that being slow to start is not confused with being slow to
arrive.

Two properties do the heavy lifting:

- **Blinding.** The player is never shown which sensitivity they are on (`SENS-BR-007`). A
  visible number would be measuring belief, not aim.
- **Counterbalancing.** The same targets appear at every candidate, in orders arranged so that
  no candidate systematically gets the fresh trials or the tired ones.

---

## 4. The search

A noisy one-dimensional derivative-free search. There is **no machine learning anywhere in it**
(`SENS-BR-002`); it is deterministic given the trials and the seed, and re-running it on stored
trials reproduces the answer exactly (`SENS-BR-030`).

Each round:

1. **Place candidates** across the current bracket, blinded and interleaved.
2. **Fit a drift model.** Performance changes over a session — warm-up, then fatigue. Left in,
   it would read as a preference for whichever candidate happened to run last. The model is a
   spline in trial order, made identifiable by an **anchor**: the round-one centre is re-tested
   in the final round, so one sensitivity is measured at two widely separated times.
3. **Fit a weighted quadratic** to the drift-corrected candidate estimates, pooled across all
   rounds so far. Inverse-variance weights, so a noisily measured candidate moves the curve
   less. A quadratic is the lowest-order model with a _location_ for its peak rather than
   merely an ordering.
4. **Narrow or shift** the bracket toward the vertex, clipped to the admissible domain
   (8–100 cm/360) and to the player's physical constraint.
5. **Stop** when nothing separates, when the bracket has converged, or when the round budget
   runs out.

### The physical constraint

The low-sensitivity end is bounded by what the player can actually execute — derived from pad
width and a measured comfortable swipe. It bounds the _search_, not just the report: spending a
player's trials on sensitivities they cannot perform measures nothing. The recommendation is
therefore the constrained optimum, while the unconstrained fitted optimum stays on the stored
result as evidence.

---

## 5. Uncertainty

Everything uncertain is stated as an interval, and the intervals come from one bootstrap that
refits the **entire** pipeline — normalisation, drift model, quadratic — on each resample, 2,000
times, seeded. Refitting everything is what makes the interval mean something: it propagates
estimation error from every stage into the location of the peak, rather than pretending the
drift model and the normalisation were known exactly.

Trials are resampled _within candidate_, because the trial is the independent replicate.

Two candidates are **distinguishable** when the bootstrap interval on their difference excludes
zero at 90% two-sided. Ninety rather than ninety-five deliberately: this is a decision procedure
with a symmetric cost of error, not a hypothesis test guarding a literature against false
discovery.

### What the two ranges mean

- **High-performance range** — the credible interval on the peak location. Statistical
  evidence: where the peak probably is.
- **Comfort range** — the plateau: sensitivities not distinguishable from the peak. Always
  wider, always contains the high-performance range, and it is the range a player should
  actually choose within.

---

## 6. Refusing to invent a peak

The single most important negative property. `SENS-BR-017`: when no candidate is statistically
distinguishable, the product reports a range and low confidence, and does **not** fabricate a
point.

From `calibration_model_v3`, a `peak_found` verdict additionally requires the curvature itself
to be significant — the bootstrap interval on the quadratic term must exclude zero. Requiring
only that _some candidate pair_ separates was anti-conservative as a verdict: pooling nine
candidates makes it an OR across thirty-six comparisons with no multiplicity control, which a
flat response clears far more often than the level implies.

Measured on 100 simulated players whose response is exactly flat:

| Rule                                  | Flat players given a peak | Real peaks found | Median error |
| ------------------------------------- | ------------------------- | ---------------- | ------------ |
| v2 — any pair separates               | 27 / 100                  | 100 / 100        | 0.042 log2   |
| v3 — curvature interval excludes zero | 11 / 100                  | 100 / 100        | 0.042 log2   |

### The limitation that remains

Eleven percent is above the five percent a one-sided test at this level nominally gives, and
the excess is **post-selection inference**: the bracket narrows toward whatever looked humped,
and the verdict is then tested on that same data, so the stopping rule and the test are not
independent.

Fixing it properly needs a design change — splitting the sample, or holding out a confirmation
round from the search — not a tighter threshold. It is recorded as a known limitation rather
than tuned away, and confidence on such a session is correspondingly low.

---

## 7. Confidence

A weighted geometric mean of seven components: peak sharpness, sample size, consistency,
environment quality, drift, fit quality, and anchor agreement. Geometric because a single bad
component _should_ drag the whole index down — a beautifully sharp peak measured on a stuttering
display is not a confident result.

An `indistinguishable` verdict is capped below a `peak_found` one regardless of components. The
breakdown names the largest detractor, so the number comes with the reason.

---

## 8. What this is not

- **Not the game engine.** The measurement runs in a browser, on a canvas, with pointer lock.
  Input handling and rendering differ from any given game.
- **Not a population claim.** One player, one session. The reference distributions used to
  contextualise dimension scores are provisional and labelled as such.
- **Not permanent.** Aim changes with practice, hardware, and grip. A result is a measurement
  with a date on it.
- **Not a substitute for playing.** The product measures proxies for aiming. They correlate with
  aiming; they are not aiming.
