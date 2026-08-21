# 14 — Scoring Model

Related: [10-measurement-methodology.md](10-measurement-methodology.md) · [13-calibration-algorithm.md](13-calibration-algorithm.md) · [15-confidence-model.md](15-confidence-model.md) · [16-recommendation-model.md](16-recommendation-model.md)

---

## 14.1 The pipeline

```
raw trial metrics
   -> direction alignment        (higher = better, always)
   -> robust standardisation     (per metric, per test, within the session)
   -> bounded influence          (soft clip, NOT trimming)
   -> trial composite score      (weighted, per test)
   -> [ calibration objective ]  --------> doc 13, drift model, candidate effects
   -> round aggregates
   -> test scores
   -> skill dimensions           (6 dimensions)
   -> display scaling            (0-100, provisional reference)
   -> overall score
```

Two consumers branch off this pipeline and they have **different requirements**:

| Consumer | Needs | Normalisation used |
|---|---|---|
| **Calibration engine** (doc 13) | To compare *the same player* across candidates, with maximum sensitivity to small differences | **Within-session**, relative to the player's own distribution |
| **Result display** (Aim DNA, dimension scores) | To tell the player how they did in absolute terms | **Reference distribution**, cross-player |

Conflating these is the single most common modelling error in products like this. The
calibration decision never touches the reference distribution, so it is unaffected by the
reference distribution being provisional (§14.4).

---

## 14.2 Direction alignment

Every metric declares `direction` in the metric registry (doc 10). Before anything else, each
metric is converted to a **goodness** orientation:

```
value_aligned = (direction === "higher_better") ? value : −value
```

After this point, higher is better everywhere in the pipeline, without exception. No later stage
needs to know a metric's direction, which removes an entire class of sign bug.

---

## 14.3 Robust standardisation

For each metric *m* within a test *T*, computed across **all valid trials in the session** (all
candidates, all rounds):

```
med   = median( m over session )
rsd   = 1.4826 × MAD( m over session )        // robust SD
z_t   = ( m_t − med ) / max(rsd, floor_m)
```

- **Why within-session, not within-candidate:** standardising within candidate would remove
  exactly the between-candidate differences we are measuring. The session-wide distribution is
  the correct reference.
- **Why robust:** aiming data has genuine heavy tails, and `SENS-BR-009` forbids deleting them.
  Median/MAD tolerate them without removal.
- **`floor_m`** is a per-metric minimum scale (`TUNABLE`), preventing division by a near-zero MAD
  for a player who is unusually consistent — which would otherwise inflate their z-scores
  absurdly.

**Binary metrics** (hit / first-shot hit) are standardised against their binomial scale:

```
z_t = ( m_t − p̄ ) / sqrt( max(p̄(1−p̄), 0.02) )
```

**Bounded influence.** Standardised values are passed through a soft clip:

```
z_clipped = 4 · tanh( z / 4 )
```

This limits any single trial's leverage to ±4σ while remaining smooth and monotone. It is
**not** trimming: no trial is removed, every trial still moves the estimate, and the mapping is
invertible. It is a bounded-influence M-estimator, and it is the technique that reconciles
"never delete a bad trial" with "one catastrophic trial must not decide the recommendation".

---

## 14.4 Reference distributions and the honesty problem

The **display** scores (0–100 dimension values, overall score, percentiles) require a
cross-player reference distribution. At MVP, SensLab has no population data.

**Decision:** ship a documented **provisional reference** and label it as such.

```
score_display = clamp( 50 + 12.5 × z_ref , 1 , 99 )
```

where `z_ref` is the player's session-median metric standardised against the provisional
reference mean and SD for that metric.

- The provisional reference values are an explicit, versioned parameter set
  (`reference_dist_provisional_v1`), seeded from engineering estimates and pilot testing.
  They are `ASSUMPTION`s, marked as such in the parameter file, and every one of them is
  expected to be replaced.
- The UI labels absolute scores as **provisional** while the reference is provisional, with a
  one-line explanation. It does **not** show percentiles until a real population exists —
  a percentile against a made-up distribution is a lie with a number attached.
- Once consented sessions accumulate, `reference_dist_v2` is fitted from real data, published as
  a new version, and historical results keep rendering under the version that produced them
  (`SENS-BR-020`).

**What is *not* provisional:** the recommended sensitivity, the range, the response curve, the
comparison between candidates, the validation verdict, and the aim profile *shape*. All of those
come from within-session comparisons and are fully valid on day one. This separation is why the
product can launch honestly without population data.

---

## 14.5 Skill dimensions

Six dimensions. Each is a weighted combination of round-level standardised metrics.

### Dimension definitions and weights (`scoring_model_v1`)

**Flick** — ballistic acquisition of targets at meaningful distance.

| Metric | Test | Weight |
|---|---|---|
| onset-adjusted `targetAcquisitionTime` | Flick (medium+large) | 0.30 |
| `flickErrorNorm` | Flick | 0.25 |
| `firstShotAccuracy` | Flick | 0.25 |
| `pathEfficiency` | Flick | 0.10 |
| `switchingTravelTime` | Switching | 0.10 |

**Precision** — accuracy of placement when accuracy is what is asked for.

| Metric | Test | Weight |
|---|---|---|
| `firstShotAccuracy` | Precision | 0.30 |
| `microAdjustmentError` | Micro | 0.25 |
| `flickErrorNorm` | Precision | 0.20 |
| `firstShotAccuracy` | Micro | 0.15 |
| `jitterRMS` | Micro + Precision | 0.10 |

**Tracking** — continuous following.

| Metric | Test | Weight |
|---|---|---|
| `trackingAccuracy` | Tracking | 0.35 |
| `trackingError` | Tracking | 0.30 |
| `trackingStability` | Tracking | 0.25 |
| `correctionFrequency` (jointly with error) | Tracking | 0.10 |

**Speed** — how quickly engagements are resolved.

| Metric | Test | Weight |
|---|---|---|
| `switchingTime` | Switching | 0.30 |
| onset-adjusted `targetAcquisitionTime` | Flick | 0.30 |
| `timeToTarget` | Flick + Switching | 0.25 |
| `settleTime` | Micro | 0.15 |

**Control** — stability and economy of movement; the anti-overshoot dimension.

| Metric | Test | Weight |
|---|---|---|
| `overshootRate` | Flick + Micro + Switching | 0.30 |
| `correctionCount` | Flick + Micro | 0.25 |
| `pathEfficiency` | Flick + Switching | 0.20 |
| `undershootRate` | Flick + Micro | 0.15 |
| `trackingStability` | Tracking | 0.10 |

**Consistency** — repeatability across trials.

| Metric | Test | Weight |
|---|---|---|
| `consistency` of `targetAcquisitionTime` | Flick | 0.30 |
| `consistency` of `flickErrorNorm` | Flick + Precision | 0.25 |
| `consistency` of `trackingError` | Tracking | 0.25 |
| `consistency` of `switchingTime` | Switching | 0.20 |

### Rationale for the weight structure

- **No dimension depends on a single test**, so one bad round cannot dominate it — with one
  documented MVP exception, Tracking, which has only one continuous-tracking test until Phase 6
  (doc 09 §9.15).
- **Overshoot and undershoot both feed Control**, with overshoot weighted higher, because
  overshoot is the more reliable and more sensitivity-specific signal.
- **Speed excludes accuracy entirely and Precision excludes time entirely.** If both dimensions
  contained both, they would be correlated by construction and the Aim DNA shape would carry no
  information. Keeping them clean is what makes "fast but imprecise" a visible, real pattern.
- **`hitAccuracy` is absent everywhere**, because it is contaminated by trigger discipline
  (doc 10 §10.9).
- **`reactionTime` is absent everywhere** (`SENS-BR-006`).
- **Consistency is a dimension, not a modifier.** Making it a dimension means a player whose
  limiter is variance sees that plainly rather than having it silently depress every other score.

Weights are stored in the versioned parameter set, never in code (`SENS-NFR-027`). They sum to
1.0 within each dimension, asserted by a test.

---

## 14.6 Weight profiles per game

The default profile weights all six dimensions equally in the *candidate objective*. A per-game
profile may re-weight them, because different games genuinely stress different skills.

```
objective_score(candidate) = Σ_d  profileWeight_d × dimensionScore_d(candidate)
```

`ASSUMPTION` — the illustrative per-game profiles below are **product judgements, not measured
facts**. They must be validated by playtesting before being enabled; at MVP the default balanced
profile is used for every game and per-game profiles are shipped disabled behind a parameter-set
flag.

| Profile | Flick | Precision | Tracking | Speed | Control | Consistency |
|---|---|---|---|---|---|---|
| `balanced` (default, MVP) | 1/6 each | | | | | |
| `tactical` (illustrative) | 0.20 | 0.25 | 0.10 | 0.15 | 0.15 | 0.15 |
| `movement` (illustrative) | 0.20 | 0.10 | 0.25 | 0.20 | 0.15 | 0.10 |
| `long-range` (illustrative) | 0.10 | 0.30 | 0.15 | 0.10 | 0.20 | 0.15 |

This is the *only* place where the selected game influences anything upstream of the adapter, and
at MVP it does not, because every game uses `balanced`. FR-011's acceptance test (identical
session plans regardless of game) holds because the profile affects scoring, not the plan — and
with `balanced` everywhere it does not even affect scoring at MVP.

---

## 14.7 The calibration objective

The score the calibration engine optimises is **not** the display score. It is:

```
y_t = Σ_m  w_{T,m} × z_clipped(m, t)
```

computed **per trial**, where `w_{T,m}` are the decision-set weights for the trial's test *T*
(doc 10 §10.9). Per-trial rather than per-round, because the drift model (doc 13 §13.7) needs
trial-level observations to estimate `g(b)` with any resolution.

Test-level weights within the objective (`TUNABLE`, `scoring_model_v1`):

| Test | Objective weight | Rationale |
|---|---|---|
| Flick | 0.30 | Most sensitivity-responsive, largest sample |
| Micro Adjustment | 0.25 | Best detector of "too high" |
| Tracking | 0.20 | Independent optimum; guards against a flick-only answer |
| Target Switching | 0.15 | Realistic re-acquisition load |
| Precision | 0.10 | Lowest trial count, highest per-trial variance |

Weights reflect **information content per unit of session time**, not perceived importance. A
test with high variance and few trials gets less weight because it contributes less signal, and
weighting it higher would import noise into the recommendation.

---

## 14.8 Overall score

```
overall = mean( dimension display scores )
```

Deliberately a plain mean, not a weighted one. The overall score is a *summary for the user*, has
no role in any decision, and any weighting would imply a judgement about which aiming skill
matters more in general — which SensLab does not have a basis to make.

The overall score is displayed with less prominence than the dimension breakdown, because the
breakdown is the informative part.

---

## 14.9 Versioning

```
scoring_model_v1 = {
  metricRegistryVersion,
  directionMap,
  robustScaleFloors,
  clipConstant,
  dimensionWeights,
  objectiveTestWeights,
  decisionMetricSet,
  displayScaling,
  referenceDistributionVersion,
  gameWeightProfiles, gameWeightProfilesEnabled
}
```

- The parameter set is hashed; the hash is stored on `algorithm_versions` and asserted at boot
  against the loaded parameters. A mismatch is a startup failure, not a warning.
- Released versions are immutable (`SENS-BR-029`).
- Every `recommendations` row references the version that produced it (`SENS-BR-020`).
- A result generated under v1 renders under v1 forever. A "recompute with the current model"
  action is available and explicit; it creates a new recommendation rather than mutating the old.

---

## 14.10 Testing requirements

| Property | Test |
|---|---|
| Unit invariance | Scaling a metric's unit (ms → s) leaves all dimension scores unchanged |
| Direction correctness | For each metric, perturbing it in the "better" direction increases its dimension |
| Weight normalisation | Every dimension's weights sum to 1.0 |
| Bounded influence | A single trial set to an extreme value moves the candidate estimate by less than a documented bound |
| No deletion | The number of trials entering the estimator equals the number of valid trials, exactly |
| Robustness | Injecting 10% wild outliers shifts the recommended `x*` by less than the MDE |
| Separation | With synthetic "fast and sloppy" data, Speed is high and Precision is low — the dimensions do not move together |
| Version isolation | A v1 fixture scored under v2 code produces the v1 result when the v1 parameter set is loaded |
| Determinism | Same inputs + same seed → identical output on Linux and Windows |
