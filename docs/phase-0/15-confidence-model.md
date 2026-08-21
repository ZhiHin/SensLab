# 15 — Confidence Model

Related: [13-calibration-algorithm.md](13-calibration-algorithm.md) · [14-scoring-model.md](14-scoring-model.md) · [16-recommendation-model.md](16-recommendation-model.md) · [17-validation-and-fine-tuning.md](17-validation-and-fine-tuning.md)

---

## 15.1 What "confidence" means here, precisely

SensLab reports a **confidence index**: a 0–100 composite that expresses *how much the
measurement conditions and the data support the recommendation*.

It is **not**:
- a p-value,
- a posterior probability that the recommendation is optimal,
- a percentage of anything.

It **is**: a bounded, monotone, deterministic function of seven named quality inputs, each of
which is individually reported in the confidence breakdown. Every component is something the
user could in principle verify.

Two separate things are reported and must not be conflated:

| Reported quantity | Answers | Where it comes from |
|---|---|---|
| **High-performance range** | "Where is the peak, and how precisely do we know?" | The bootstrap credible interval on `x*` (doc 13 §13.9) — a genuine statistical interval |
| **Confidence index** | "How much should you trust this session at all?" | The composite below |

The range is statistics. The index is a quality score. Presenting them separately is what lets
the range stay honest.

`SENS-BR-027` (no fake confidence) and `SENS-BR-028` (a hard ceiling until empirically
calibrated) govern this document.

---

## 15.2 Components

Each component `C_k ∈ [0, 1]`, higher is better.

### C1 — Peak identification (`C_peak`)

How tightly the data localise the optimum.

```
W       = width of the 90% credible interval on x*, in log2 units
C_peak  = 1 / ( 1 + (W / W_ref)² )
```

`ASSUMPTION` (`TUNABLE`): `W_ref = 0.30` log2 ≈ a ±10% band. At that width `C_peak = 0.5`; at
±5% it is ≈ 0.8; at ±20% it is ≈ 0.2.

**Caps:** if `verdict = indistinguishable`, `C_peak` is capped at **0.35** regardless of the
computed value — because a narrow interval around a flat curve is precision about nothing.
If `verdict = insufficient_data`, no confidence is produced at all.

### C2 — Sample adequacy (`C_sample`)

```
r          = min( 1, n_valid_total / n_target_for_mode )
C_sample   = sqrt(r)
```

Square root because the marginal value of additional trials falls off; going from 50% to 100% of
target matters more than the last 10%. Trials that are `degraded` count as 0.5.

### C3 — Player consistency (`C_consistency`)

```
rCV        = session-level robust coefficient of variation of the trial composite score
C_consistency = 1 / ( 1 + rCV / rCV_ref )
```

`ASSUMPTION` (`TUNABLE`): `rCV_ref = 0.30`. A highly variable player produces a genuinely less
certain estimate, and this is the component that says so.

### C4 — Environment quality (`C_env`)

A product of independent penalties:

```
C_env = P_raw × P_frames × P_lock × P_window
```

| Factor | Value |
|---|---|
| `P_raw` | 1.00 if `unadjustedMovement` granted; **0.85** if not (doc 04 §4.4.2) |
| `P_frames` | `clamp(cleanFrameFraction, 0.6, 1.0)` — the session-wide fraction of frames within budget |
| `P_lock` | 1.00 with no unexpected pointer-lock losses; −0.03 per loss, floor 0.80 |
| `P_window` | 1.00 normally; 0.90 if the window was resized mid-session (changes angular-to-pixel scale) |

### C5 — Drift contamination (`C_drift`)

```
D        = |fitted change in g(b) from first to last block|, in score units
C_drift  = 1 / ( 1 + D / D_ref )
```

`ASSUMPTION` (`TUNABLE`): `D_ref = 0.5` score units (half a within-session SD). Additionally,
if the drift model fell back to linear because the design matrix was ill-conditioned
(doc 13 §13.7), `C_drift` is multiplied by 0.9.

### C6 — Model fit (`C_fit`)

Only meaningful once there are more distinct sensitivity points than fitted parameters.

```
if distinct_x <= 3:   C_fit = 0.80          // neutral; the fit is saturated, R² is meaningless
else:                 C_fit = clamp( R²_adj , 0.3 , 1.0 )
```

Using adjusted R² is deliberate: a saturated fit must not be rewarded for being saturated.

### C7 — Anchor agreement (`C_anchor`)

From the anchor re-test (doc 13 §13.5):

```
t          = |anchorDeltaScore| / se(anchorDelta)
C_anchor   = 1 / ( 1 + max(0, t − 1) / 2 )
```

A small, within-noise difference between the early and late measurement of the same sensitivity
gives `C_anchor ≈ 1`. A large discrepancy — the session was not internally repeatable —
drives it down. If the anchor was not run (Quick mode), `C_anchor = 0.85` (neutral-negative,
because the check genuinely was not performed).

---

## 15.3 Composition

A **weighted geometric mean**, so that a single very poor component cannot be masked by good
ones — which is exactly the behaviour a quality index needs and which an arithmetic mean lacks.

```
raw = exp( Σ_k  ω_k · ln(C_k) / Σ_k ω_k )
```

`ASSUMPTION` (`TUNABLE`, `confidence_model_v1`):

| Component | ω | Rationale |
|---|---|---|
| `C_peak` | 3.0 | The dominant term: if the peak is not identified, nothing else matters |
| `C_sample` | 2.0 | Directly controls every interval width |
| `C_consistency` | 1.5 | A real property of the player, not a defect |
| `C_env` | 2.0 | A bad environment invalidates comparisons |
| `C_drift` | 1.5 | Contaminates between-block comparison |
| `C_fit` | 1.0 | Informative but partly redundant with `C_peak` |
| `C_anchor` | 1.0 | A direct repeatability check, but a single observation |

Then:

```
confidence = round( 100 × CEILING × raw )
```

`CEILING = 0.92` for `confidence_model_v1` (`SENS-BR-028`).

**Why a ceiling:** until the index has been validated against test–retest data (§15.7), claiming
95%+ confidence would assert a precision SensLab has not demonstrated. The ceiling is a version
property; it rises only when evidence justifies it.

**No floor.** A bad session produces a low number and says why (`SENS-BR-027`).

**Verdict caps:**

| Verdict | Max confidence |
|---|---|
| `peak_found` | 92 |
| `indistinguishable` | 40 |
| `insufficient_data` | — (no recommendation produced) |

---

## 15.4 Worked example

A clean Standard session:

| Component | Value | Reason |
|---|---|---|
| `C_peak` | 0.78 | 90% CI on `x*` spans ±5.5% (W ≈ 0.159 log2) |
| `C_sample` | 0.98 | 96% of target trials valid |
| `C_consistency` | 0.71 | rCV 0.12 |
| `C_env` | 0.97 | raw input granted; 98.5% clean frames; no lock losses |
| `C_drift` | 0.83 | mild fatigue, 0.10 score units |
| `C_fit` | 0.86 | adjusted R² 0.86 over 9 points |
| `C_anchor` | 0.94 | anchor re-test within noise |

```
weights (3, 2, 1.5, 2, 1.5, 1, 1), Σω = 12
Σ ω·ln(C) = -1.853        ->   mean = -0.1544   ->   raw = e^-0.1544 = 0.857
confidence = round(100 × 0.92 × 0.857) = 79
```

A session with the same data but **no raw input** and a **6% frame-drop rate**:

```
C_env = 0.85 × 0.94 = 0.80   ->   raw ≈ 0.830   ->   confidence = 76
```

A session where the curve is flat:

```
verdict = indistinguishable  ->  C_peak capped at 0.35, verdict cap 40
raw ≈ 0.701  ->  100 × 0.92 × 0.701 = 65  ->  capped to 40
```

The third example is worth reading twice: the *other* six components were all good, and the
uncapped index would have read 65. The cap is what stops a well-run session from lending
credibility to a result that has no peak in it.

---

## 15.5 Conversion confidence is separate

DPI provenance does **not** enter the confidence index above, because the index describes the
quality of the *measurement*, and the measurement is in counts/360 — which is independent of DPI
(doc 11 §11.9.4).

Instead, the game settings block carries its own **settings reliability** state:

| DPI provenance | Settings block state |
|---|---|
| `known` | Normal |
| `estimated` | "These game values assume your DPI is ~X, which we estimated. If it is wrong, the game numbers are wrong by the same proportion. Your cm/360 and counts/360 results are unaffected." |
| `assumed` | As above, more strongly worded, with a prompt to confirm DPI |

Separating these two is a meaningful honesty improvement over folding everything into one
percentage: a user with an unknown DPI still has a *fully trustworthy* physical result, and they
should be told so.

---

## 15.6 The breakdown UI contract

The result page must be able to show, on demand, every component with:

- its name in plain language,
- its value,
- one sentence on what it measured,
- and, when it is the largest contributor to a reduced score, a concrete action
  ("enable raw input", "close background applications", "run the Standard test instead of Quick").

This turns confidence from a mysterious percentage into a diagnostic, which is what persona P2
and P4 need (doc 03), and it is the mechanism by which `SENS-BR-027` is visibly satisfied.

---

## 15.7 Calibrating the index (post-MVP)

The index is currently an ordinal quality score. To become a probability it needs evidence:

1. **Collect test–retest pairs.** Users who calibrate twice on the same hardware within a short
   window, with no deliberate change in between.
2. **Measure agreement.** For each pair, whether the second session's recommendation fell inside
   the first session's high-performance range.
3. **Fit calibration.** Regress observed agreement against the index; the result is either a
   monotone recalibration curve or evidence that a component is weighted wrongly.
4. **Publish `confidence_model_v2`** with an evidence-based mapping and a justified ceiling.

Until step 4, the UI wording is "confidence index", never "X% chance". The distinction is small
in characters and large in honesty.

Success criterion for v2: among sessions reporting confidence ≥ 80, at least 80% of
same-hardware re-tests fall within the reported high-performance range.

---

## 15.8 Interaction with validation

Running the validation test (doc 17) updates confidence:

| Validation verdict | Effect |
|---|---|
| `improved` | `confidence × 1.08`, then re-clamped to the ceiling |
| `no_measurable_difference` | `confidence × 0.97` — a mild reduction: the recommendation was not corroborated, but neither was it refuted |
| `worse` | `confidence × 0.70`, and the verdict is surfaced prominently (doc 17 §17.5) |

The multipliers are applied to the stored index and the pre/post values are both retained, so the
result page can show that validation moved the number and in which direction.

---

## 15.9 Testing requirements

| Property | Test |
|---|---|
| Determinism | Same inputs → same output, always (`SENS-BR-027`) |
| Monotonicity | Improving any single component, holding others fixed, never decreases confidence |
| Ceiling | No input combination produces a value above `100 × CEILING` |
| No floor | Sufficiently poor inputs produce single-digit values |
| Cap enforcement | `indistinguishable` never exceeds 40 |
| Component isolation | Zeroing one component drives confidence toward 0 (geometric-mean property) |
| Breakdown completeness | Every component appears in the breakdown payload with a non-null value or an explicit "not measured" |
| Separation | DPI provenance changes settings reliability and does **not** change the confidence index |
