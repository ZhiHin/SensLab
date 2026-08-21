# 10 — Measurement Methodology

Related: [09-test-catalogue.md](09-test-catalogue.md) · [14-scoring-model.md](14-scoring-model.md) · [19-test-engine-architecture.md](19-test-engine-architecture.md)

This document defines every metric SensLab computes. A metric that is not defined here does not
exist; a metric defined here must be implemented exactly as written, because the scoring model
and the calibration engine are built on these definitions.

---

## 10.1 Notation and primitives

| Symbol | Meaning |
|---|---|
| *t* | Time in milliseconds from `performance.now()`, monotonic |
| *t₀* | Trial start (the presentation frame timestamp of the stimulus) |
| **c**(*t*) | Crosshair orientation at time *t*, as (yaw, pitch) in degrees |
| **g**(*t*) | Target centre orientation at time *t*, in degrees |
| *r* | Target angular radius, degrees |
| *ε*(*t*) | Angular error = angular distance between **c**(*t*) and **g**(*t*), degrees |
| *ε̂*(*t*) | Normalised error = *ε*(*t*) / *r* — dimensionless, comparable across target sizes |
| *d₀* | Initial angular distance from crosshair to target at *t₀* |
| **û** | Unit vector along the initial crosshair→target direction |
| *p*(*t*) | Progress = projection of the crosshair's angular displacement onto **û**, degrees |
| *q*(*t*) | Lateral deviation = component perpendicular to **û**, degrees |

**Angular distance.** For small angles a planar approximation is inadequate near the poles, so
angular separation is computed as the true great-circle angle between the two view directions:

```
ε = acos( clamp( dir(c) · dir(g), -1, 1 ) ) · 180/π
```

where `dir(yaw, pitch)` is the unit direction vector. Pitch is clamped to ±89° in the engine, so
degenerate cases do not arise, but the great-circle form is used regardless because it is exact
and cheap.

**Sampling.** *ε*(*t*) is evaluated at (a) every rendered frame and (b) every pointer input
event. Target position is analytic, so it can be evaluated at any *t* exactly — including at the
precise timestamp of a mouse-button press, which is what makes hit detection frame-independent
(doc 09 §9.0.4).

**Time weighting.** Continuous metrics are weighted by the interval each sample represents, not
by sample count, so a frame hitch does not silently reweight the average:

```
mean_w(f) = Σ f(tᵢ)·Δtᵢ / Σ Δtᵢ
```

---

## 10.2 Metric registry — click/acquisition family

### `reactionTime`
- **Unit:** ms. **Direction:** lower is better.
- **Definition:** *t*(first button press) − *t₀*, where *t₀* is the presentation frame timestamp.
- **Tests:** Reaction.
- **Interpretation:** the player's simple visual-motor floor. Includes display latency, input
  latency and the browser's event path — an unknown but approximately constant offset that
  cancels in every comparison SensLab makes.
- **Outliers:** < 80 ms → `invalid` (`premature_click`), not an outlier. Values above the 1200 ms
  timeout → `invalid` (`no_input`). Everything else is retained; aggregation uses the median.
- **Never used for sensitivity selection** (`SENS-BR-006`).

### `timeToTarget`
- **Unit:** ms. **Direction:** lower is better.
- **Definition:** *t*(first moment *ε*(*t*) ≤ *r*) − *t₀*. The moment the crosshair first touches
  the target, irrespective of shooting.
- **Tests:** Flick, Micro, Switching, Precision, Speed, Wide Flick.
- **Interpretation:** pure movement performance, uncontaminated by trigger discipline.

### `targetAcquisitionTime`
- **Unit:** ms. **Direction:** lower is better.
- **Definition:** *t*(successful hit) − *t₀*. Includes any correction and re-aim.
- **Tests:** Flick, Micro, Switching, Precision, Speed, Wide Flick, ADS.
- **Interpretation:** the end-to-end cost of the engagement. This is the headline speed metric.

### `movementOnsetTime`
- **Unit:** ms. **Direction:** lower is better, but weakly.
- **Definition:** *t*(first sample where angular speed exceeds 15°/s for ≥ 10 ms) − *t₀*.
- **Tests:** all acquisition tests.
- **Interpretation:** the reaction component of acquisition. Its main use is **decomposition**:

```
targetAcquisitionTime = movementOnsetTime + ballisticTime + correctionTime + triggerTime
```

  This is why the Reaction Test exists. A player whose acquisition time is high because their
  *onset* is slow is not telling us anything about sensitivity; a player whose *correctionTime*
  is high at one candidate and low at another is telling us a great deal. The calibration engine
  therefore uses onset-adjusted acquisition (`targetAcquisitionTime − movementOnsetTime`) as its
  primary speed input, which strips out the sensitivity-independent component and reduces
  between-round noise.

### `firstShotAccuracy`
- **Unit:** proportion 0–1 (a per-round rate). **Direction:** higher is better.
- **Definition:** (number of trials whose first button press was a hit) / (valid trials).
- **Tests:** Flick, Micro, Precision, Switching, Speed, ADS.
- **Interpretation:** the cleanest single measure of aim placement. The most important precision
  metric in the product.
- **Outliers:** a rate has no per-trial outliers; uncertainty comes from its binomial nature
  (§10.7).

### `hitAccuracy`
- **Unit:** proportion 0–1. **Direction:** higher is better.
- **Definition:** hits / total shots across the round.
- **Tests:** Flick, Switching, Speed.
- **Interpretation:** trigger discipline plus aim. Lower value than `firstShotAccuracy` for
  players who spam.

---

## 10.3 Metric registry — placement/error family

### `flickError` and `flickErrorNorm`
- **Unit:** degrees / dimensionless. **Direction:** lower is better.
- **Definition:** *ε* evaluated at the **flick stop**, where the flick stop is the earlier of:
  (a) the first button press, or (b) the first local minimum of angular speed falling below
  20°/s after the crosshair has travelled at least 60% of *d₀*.
  `flickErrorNorm` = flickError / *r*.
- **Tests:** Flick, Precision, Wide Flick, ADS.
- **Interpretation:** how accurately the ballistic phase landed, before corrections. Values < 1
  mean the ballistic movement alone would have hit.
- **Why normalised:** target radius varies within and between tests; the raw degree value is not
  comparable across them. **All cross-test aggregation uses the normalised form.**
- **Outliers:** the distribution is right-skewed and heavy-tailed by nature (occasional wild
  flicks). Aggregate with the **median**, and report spread with MAD. Never trim.

### `microAdjustmentError`
- **Unit:** dimensionless. **Direction:** lower is better.
- **Definition:** `flickErrorNorm` restricted to Micro Adjustment trials. Kept as a distinct
  metric key because it feeds different dimension weights.

### `overshootRate`
- **Unit:** proportion 0–1. **Direction:** lower is better.
- **Definition:** a trial **overshoots** if, before the crosshair first enters the target,
  *p*(*t*) exceeds *d₀* + *r* at any point.
- **Tests:** Flick, Micro, Switching, Speed, Wide Flick.
- **Interpretation:** **the canonical signature of excessive sensitivity.** A sensitivity that is
  too high for a player produces systematic overshoot before it produces anything else.

### `overshootMagnitudeNorm`
- **Unit:** dimensionless. **Direction:** lower is better.
- **Definition:** (max *p*(*t*) before first target entry − *d₀*) / *r*, evaluated only on
  overshooting trials; 0 otherwise.
- **Interpretation:** distinguishes "slightly past" from "wildly past". Reported alongside the
  rate, because rate alone conflates them.

### `undershootRate`
- **Unit:** proportion 0–1. **Direction:** lower is better.
- **Definition:** a trial **undershoots** if the crosshair's speed drops below 20°/s for ≥ 40 ms
  while *p*(*t*) < *d₀* − *r*, i.e. the ballistic movement stopped short and a second movement
  was required.
- **Interpretation:** **the canonical signature of insufficient sensitivity**, and the mirror of
  overshoot. Together, overshoot and undershoot rates are what make the response curve
  interpretable: high-sens candidates overshoot, low-sens candidates undershoot, and the optimum
  minimises the sum.

### `correctionCount`
- **Unit:** count per trial. **Direction:** lower is better.
- **Definition:** the number of sign reversals of *ṗ*(*t*) after the end of the ballistic phase,
  counted with hysteresis: a reversal registers only when the speed exceeds +20°/s in the new
  direction after having exceeded 20°/s in the old, with a 25 ms refractory period.
- **Interpretation:** a direct measure of aiming instability. Hysteresis and refractory period
  are essential — without them, sensor noise produces dozens of phantom "corrections".
- **Outliers:** aggregate with the median; the distribution is a small-count discrete variable.

### `pathEfficiency`
- **Unit:** dimensionless 0–1. **Direction:** higher is better.
- **Definition:** *d₀* / (total angular path length travelled from *t₀* to first target entry),
  clamped to [0, 1].
- **Interpretation:** how direct the movement was. A perfectly straight flick scores 1.0.
  Corrections, overshoot and wandering all reduce it. It is the single most compact summary of
  movement quality and is highly sensitivity-sensitive.
- **Numerical note:** path length is accumulated from input samples, not frames, so it does not
  depend on frame rate.

### `settleTime`
- **Unit:** ms. **Direction:** lower is better.
- **Definition:** *t*(shot) − *t*(first target entry).
- **Tests:** Micro, Precision.
- **Interpretation:** the cost of stabilising once you are on target. Rises sharply when
  sensitivity is too high.

### `jitterRMS`
- **Unit:** degrees. **Direction:** lower is better.
- **Definition:** RMS of the high-pass filtered angular position during the settling window
  (from first target entry to shot). Filter: a first-order high-pass with cutoff **6 Hz**
  (`TUNABLE`), applied to yaw and pitch independently, combined in quadrature.
- **Interpretation:** separates *tremor and micro-correction* from *deliberate slow movement*.
  Without the high-pass, a slow deliberate approach and a shaky hover produce similar variance.

---

## 10.4 Metric registry — tracking family

### `trackingAccuracy`
- **Unit:** proportion 0–1. **Direction:** higher is better.
- **Definition:** time-weighted fraction of the trial (while the fire button is held) for which
  *ε*(*t*) ≤ *r*.
- **Interpretation:** the headline tracking metric; directly analogous to "time on target".

### `trackingError`
- **Unit:** dimensionless (normalised). **Direction:** lower is better.
- **Definition:** time-weighted RMS of *ε̂*(*t*) over the held portion of the trial.

```
trackingError = sqrt( Σ ε̂(tᵢ)²·Δtᵢ / Σ Δtᵢ )
```

- **Interpretation:** unlike `trackingAccuracy`, it distinguishes "just off" from "far off", and
  it does not saturate when the player is consistently on target. Both are kept because they
  fail in different regimes: accuracy is more interpretable, error is more sensitive.

### `trackingStability`
- **Unit:** dimensionless. **Direction:** higher is better (it is defined as an inverse).
- **Definition:** let *ε_hp*(*t*) be *ε̂*(*t*) high-pass filtered at 3 Hz (`TUNABLE`). Then

```
trackingStability = 1 / (1 + RMS(ε_hp))
```

- **Interpretation:** this is the metric that catches "too sensitive". A player at an excessive
  sensitivity may still achieve decent time-on-target by constantly correcting; the correction
  activity lives in the high-frequency band and shows up here and nowhere else.

### `correctionFrequency`
- **Unit:** Hz. **Direction:** context-dependent; interpreted jointly with error.
- **Definition:** zero-crossing rate of the derivative of the *signed* along-motion error.
- **Interpretation:** high frequency with low error = a fine, controlled tracking style. High
  frequency with high error = instability. It is never scored alone.

### `trackingBias`
- **Unit:** dimensionless, signed. **Direction:** neither; magnitude near 0 is better.
- **Definition:** time-weighted mean of the signed along-motion component of *ε̂*.
- **Interpretation:** positive = leading the target, negative = lagging. Systematic lag at low
  sensitivity is a classic signature of a sensitivity too low for the target's angular speed.

### `reversalRecoveryTime` *(post-MVP, strafe tracking)*
- **Unit:** ms. **Direction:** lower is better.
- **Definition:** for each direction reversal, the time from the reversal until *ε*(*t*) returns
  below *r* for ≥ 50 ms.

### `peakSpeedTrackingError` / `accelerationLagMs` *(post-MVP, slide tracking)*
- As `trackingError` restricted to the sustained-peak segment; and the cross-correlation lag
  between target angular velocity and crosshair angular velocity during the acceleration phase.

---

## 10.5 Metric registry — switching, recoil, comfort

### `switchingTime`
- **Unit:** ms. **Direction:** lower is better.
- **Definition:** *t*(hit *n*+1) − *t*(hit *n*).
- **Tests:** Switching.

### `switchingTravelTime`
- **Unit:** ms. **Direction:** lower is better.
- **Definition:** *t*(first entry into target *n*+1) − *t*(hit *n*). Excludes the settle and
  trigger phases, isolating movement.

### `recoilDeviationVertical` / `recoilDeviationHorizontal` *(post-MVP)*
- **Unit:** degrees, RMS. **Direction:** lower is better.
- **Definition:** RMS of the vertical / horizontal component of *ε*(*t*) during the recoil window.

### `recoilCompensationGain` *(post-MVP)*
- **Unit:** dimensionless. **Direction:** closer to 1.0 is better.
- **Definition:** OLS slope of the player's counter-movement against the applied recoil
  displacement over the trial. 1.0 = perfect compensation, < 1 = under-compensation,
  > 1 = over-compensation. Reported signed, not as an absolute error, because the direction of
  the failure is diagnostic.

### `maxSingleSwipeDeg` / `comfortableSwipeCm`
- **Unit:** degrees / centimetres. **Direction:** higher is better (more physical room).
- **Definition:** maximum yaw achieved in one continuous motion (no lift detected), converted to
  physical distance using the test sensitivity and DPI. Aggregated across attempts by the median.

### `liftCount180`, `time180`, `returnErrorDeg`
- Supporting comfort metrics; definitions as stated in doc 09 §9.7.

---

## 10.6 Metric registry — derived and session-level

### `consistency`
- **Unit:** dimensionless 0–1. **Direction:** higher is better.
- **Definition:** computed per (candidate, test) from the trial-level values of that test's
  primary metric *m*:

```
rCV       = 1.4826 · MAD(m) / |median(m)|
consistency = 1 / (1 + rCV)
```

  MAD is the median absolute deviation; the 1.4826 factor makes it a consistent estimator of the
  standard deviation for normal data. `rCV` is a **robust coefficient of variation**.
- **Why robust:** a single wild trial would dominate a plain standard deviation, and wild trials
  are common and legitimate in aiming data. We must not delete them (`SENS-BR-009`), so the
  statistic must tolerate them instead.
- **Interpretation:** consistency is a first-class output. For many players the honest finding is
  "your sensitivity is fine; your variance is your limiter" (doc 04 §4.4.9).

### `standardDeviation` / `robustSD`
- Reported alongside every aggregated metric. `robustSD = 1.4826 · MAD`. The plain SD is stored
  too, because the difference between them is itself informative about tail behaviour.

### `fatigueDrift`
- **Unit:** score units per 100 trials, signed. **Direction:** magnitude near 0 is better.
- **Definition:** the OLS slope of the composite trial score against the trial's global
  presentation index across the whole session, after candidate effects are removed
  (doc 13 §13.7 gives the joint estimation).
- **Interpretation:** negative = declining performance (fatigue), positive = still improving
  (warm-up not complete, or learning). Either, if large, means the session's candidate
  comparisons are contaminated; it is an input to the confidence model (doc 15 §15.2).

### `qualityScore` (per trial)
- **Unit:** 0–1. Fraction of frames within the trial that met the frame budget. Drives the
  `degraded` classification and the environment component of confidence.

---

## 10.7 Aggregation rules

| Metric family | Trial → round aggregation | Uncertainty estimate |
|---|---|---|
| Times (`reactionTime`, `targetAcquisitionTime`, `timeToTarget`, `switchingTime`, `settleTime`) | **Median** | Bootstrap SE over trials (2000 resamples, seeded) |
| Errors (`flickErrorNorm`, `microAdjustmentError`, `trackingError`) | **Median** | Bootstrap SE |
| Rates (`firstShotAccuracy`, `hitAccuracy`, `overshootRate`, `undershootRate`) | **Proportion** | Wilson score interval (correct for small *n*, unlike the normal approximation) |
| Counts (`correctionCount`) | **Median** | Bootstrap SE |
| Continuous, time-weighted (`trackingAccuracy`, `trackingStability`, `pathEfficiency`) | **Time-weighted mean across trials** | Bootstrap SE over trials |
| Spread (`consistency`) | Computed from the trial set directly | Bootstrap SE |

**Why median rather than mean for times and errors:** these distributions are right-skewed with
occasional large values that are genuine performance events, not measurement errors. The mean
would let one bad flick move a candidate's score more than ten good ones. The median is the
honest central-tendency estimator here, and using it removes any temptation to trim.

**Bootstrap seeding.** All resampling uses the session seed so results are reproducible
(`SENS-BR-031`).

---

## 10.8 Outlier policy

The policy is deliberately restrictive, because outlier handling is where measurement products
quietly become dishonest.

1. **A trial is never excluded for its result.** Only procedural invalidity excludes a trial, and
   every reason code is procedural by construction (`SENS-BR-009`).
2. **No trimming, no winsorising, no z-score filtering** of performance values. Robust
   *estimators* replace outlier *removal*.
3. **Physical impossibility is a validity question, not an outlier question.** An angular
   velocity implying a physically impossible mouse speed (default threshold: sustained
   > 8 m/s of implied hand movement, `TUNABLE`) marks the trial `impossible_velocity` and
   `invalid` — this is anti-manipulation, not data cleaning (doc 23 §23.10).
4. **Invalid trials are stored, counted, and surfaced.** The result page's quality section shows
   valid / degraded / invalid counts. A session with an unusual invalid rate is flagged rather
   than silently cleaned.
5. **Replacement, not deletion.** A procedurally invalid trial triggers an extra trial so sample
   size targets are met without discarding information (`SENS-BR-009`, FR-060), capped so a
   malfunctioning environment cannot extend a session indefinitely.

---

## 10.9 Which metrics drive the sensitivity decision

Not all metrics feed the calibration. The engine's candidate score uses this subset, chosen for
sensitivity-responsiveness and low sensitivity-independent variance:

| Metric | Why it is in the decision set |
|---|---|
| onset-adjusted `targetAcquisitionTime` | Direct speed effect, reaction component removed |
| `firstShotAccuracy` | Direct placement effect |
| `flickErrorNorm` | Ballistic accuracy, target-size independent |
| `overshootRate` + `undershootRate` | The two-sided signature that makes the curve peak |
| `correctionCount` | Instability |
| `pathEfficiency` | Compact movement-quality summary |
| `trackingAccuracy`, `trackingError`, `trackingStability` | The tracking optimum, which often differs from the flick optimum |
| `switchingTravelTime` | Re-acquisition under pressure |
| `consistency` | Penalises candidates that are good on average but erratic |

Explicitly **excluded** from the decision set: `reactionTime` (BR-006), `hitAccuracy` (confounded
by trigger discipline), `trackingBias` (a style descriptor), `correctionFrequency` (only
meaningful jointly), all comfort metrics (they are a constraint, not a score), and every
per-trial quality metric.

---

## 10.10 Units, storage and precision

- Angles: degrees, `double precision`. Internally radians where trigonometry demands it;
  converted at the boundary, never stored in mixed units.
- Times: milliseconds, `double precision` — sub-millisecond resolution from `performance.now()`
  matters for short intervals and must not be truncated to integers.
- Distances: centimetres for user-facing physical values, with an inch display option
  (presentation only; storage is always metric).
- Rates and normalised errors: dimensionless `double precision`.
- Every stored aggregate carries `n_valid`, `n_invalid`, `n_degraded`, and its uncertainty
  estimate. **A metric value without a sample count is not storable** — enforced by the schema
  (doc 20 §20.7).
