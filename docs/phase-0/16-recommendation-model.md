# 16 — Recommendation Model

Related: [13-calibration-algorithm.md](13-calibration-algorithm.md) · [15-confidence-model.md](15-confidence-model.md) · [12-game-adapter-architecture.md](12-game-adapter-architecture.md) · [25-wireframes.md](25-wireframes.md)

---

## 16.1 The recommendation is an object, not a number

```
Recommendation
  canonical
    recommendedCountsPer360      authoritative
    recommendedCmPer360          derived (needs DPI)
    degPerCm                     derived
  ranges
    highPerformanceRange         { lowCm360, highCm360, level: 0.90 }   statistical
    comfortRange                 { lowCm360, highCm360 }                practical plateau
    constraintBound              { maxCm360, source } | null
  quality
    confidenceIndex              0-100
    confidenceBreakdown          7 components (doc 15)
    verdict                      "peak_found" | "indistinguishable"
    settingsReliability          "normal" | "estimated_dpi" | "assumed_dpi"
  profile
    aimProfileKey
    aimProfileExplanation        generated, cites measured values
    dimensionScores              6 x { score, provisional }
    strengths / improvementAreas
  evidence
    responseCurve                candidates + fit + band, everything to redraw it
    driftSummary, anchorSummary, sampleSummary
  provenance
    scoringVersion, calibrationVersion, confidenceVersion
    sessionId, hardwareSnapshot, environmentSummary, seed
  derived
    gameSettings[]               per (gameVersion, scope), regenerable, never authoritative
```

`SENS-BR-025`: the canonical block is authoritative and `gameSettings` is a cache. Anything that
cannot be regenerated from the canonical block plus an adapter is a design error.

---

## 16.2 The recommended value

```
recommendedCountsPer360 = 2^x*
recommendedCmPer360     = 2.54 × recommendedCountsPer360 / DPI
```

**Rounding.** cm/360 is displayed to **one decimal place** (e.g. `31.2`). This is honest
precision: the credible interval is typically ±5–10%, i.e. ±1.5–3 cm at 30 cm/360, so a second
decimal would be false precision and rounding to an integer would discard usable resolution.
`counts_per_360` is displayed as an integer.

**No snapping.** The recommendation is not nudged toward a round number. If the answer is 31.2,
it is 31.2 — a product that quietly rounds to 30 is deciding it knows better than its own
measurement.

---

## 16.3 The two ranges, and why there are two

Users conflate "how sure are you where the peak is" with "what range is fine for me". These are
different questions with different answers, and answering only one of them is the reason existing
tools feel either overconfident or useless.

### High-performance range — *statistical*

The 90% credible interval on `x*` from the bootstrap (doc 13 §13.9), expressed in cm/360.

> "We are 90% confident the peak of your performance curve lies between 29.7 and 32.4 cm/360."

Narrow when the data are good. Answers: *where is the peak?*

### Comfort range — *practical*

The set of sensitivities whose fitted performance is statistically indistinguishable from the
peak:

```
comfortRange = { x : α̂(x*) − α̂(x) ≤ MDE }
```

using the minimum detectable effect from doc 13 §13.9. Because a response curve is flat near its
maximum, this is typically **wider** than the high-performance range.

> "Anywhere from 27.5 to 35.0 cm/360 performed about the same for you. Pick what feels good in
> that band."

Answers: *what can I actually use?* This is usually the more actionable number, and for the
`indistinguishable` verdict it is the *only* output.

**Invariants** (asserted by tests):
- `comfortRange` always contains `highPerformanceRange`.
- Both always contain `recommendedCmPer360` when `verdict = peak_found`.
- Both are clipped by the physical constraint; if clipping occurs, `constraintBound` is non-null
  and the UI says so.

---

## 16.4 Output by verdict

| Verdict | Headline | Ranges shown | Confidence | Framing |
|---|---|---|---|---|
| `peak_found` | The recommended cm/360 | Both | Up to 92 | "Your aim peaked here." |
| `indistinguishable` | The **comfort range**, no point value | Comfort only | ≤ 40 | "No single sensitivity clearly outperformed the others for you — which is useful information." |
| `insufficient_data` | No recommendation | None | None | Explains what went wrong and offers a re-run |

For `indistinguishable`, the product deliberately does **not** show a big number
(`SENS-BR-017`). The screen is redesigned around the range and around the real finding: the
player's variance exceeds the sensitivity effect, so their sensitivity is not their limiter. The
response curve is still shown — a visibly flat curve is the most convincing possible
presentation of that finding.

---

## 16.5 Aim profile classification

Deterministic rules over the six dimension scores and the recommended sensitivity band. No
randomness, no personality-quiz mapping (`SENS-BR-002` in spirit; FR-076).

### Inputs

```
d[]     = the six display dimension scores
μ       = mean(d)
σ_p     = max( SD(d), 3.0 )              // floor prevents divide-by-noise for flat profiles
shape_i = (d_i − μ) / σ_p                // the player's profile SHAPE, not their skill level
band    = "high" | "mid" | "low"         from recommended cm/360
```

`ASSUMPTION` (`TUNABLE`, `aim_profile_rules_v1`): band thresholds are
**high < 20 cm/360**, **mid 20–40**, **low > 40**. These are conventional community bands, used
here as descriptive labels only — they carry no claim about what is good.

Using *shape* rather than raw scores is essential: the profile describes what kind of aimer you
are, not how good you are. A beginner and an expert with the same relative strengths get the same
profile, which is correct.

### Rules — first match wins

| # | Profile | Condition |
|---|---|---|
| 0 | `provisional` | Fewer than 4 dimensions have sufficient samples |
| 1 | `balanced` | `max(|shape_i|) < 0.60` — no dimension stands out |
| 2 | `tracking-focused` | Tracking is top **and** exceeds the 2nd-highest by ≥ 0.50 shape units |
| 3 | `precision-focused` | Precision and Control are both in the top two **and** Speed is the lowest |
| 4 | `fast-flick` | Flick and Speed are both in the top two **and** Precision is the lowest |
| 5 | `low-sensitivity-control` | Control is top **and** `band = "low"` |
| 6 | `high-mobility` | Speed is top **and** `band = "high"` |
| 7 | `hybrid` | Two dimensions ≥ +0.60 that are not adjacent in the ordering above, with no dimension ≤ −0.60 |
| 8 | `balanced` | fallback |

Rule order matters and is fixed; the table is the specification. The fixture table in the test
suite covers every rule including the fallthrough.

### Explanation generation

Every profile ships with a generated explanation that cites the actual numbers that triggered it:

> **BALANCED PRECISION** — *Precision (82) and Control (79) were your two strongest dimensions,
> and Speed (61) was your lowest. That pattern means you place shots accurately and correct
> rarely, but you take longer to get there. Your recommended sensitivity sits in the mid band at
> 31.2 cm/360.*

Rules for the generated text (`SENS-BR-036`):
- Always names the specific dimensions and their values.
- Always states the rule that fired, in plain language.
- Never characterises the player as a person; describes what the measurement showed.
- Never uses a weakness as a punchline.

**Note on naming:** the displayed label may combine the profile key with a modifier
(`precision-focused` + mid band → "Balanced Precision"). The mapping from
`(profileKey, band)` to display name is a table in the parameter set, so labels can be
retuned without touching the classifier.

---

## 16.6 Strengths and improvement areas

```
strengths        = dimensions with shape_i ≥ +0.50, ordered descending, max 3
improvementAreas = dimensions with shape_i ≤ −0.50, ordered ascending, max 2
```

If neither set is populated (a flat profile), the copy says so directly rather than manufacturing
a "strongest" out of noise: *"Your six dimensions were within noise of each other — you don't
have a stand-out strength or weakness at this sensitivity."*

**Framing rules:**
- An improvement area is stated with the measurement and one concrete, testable implication.
  *"Long-flick precision (71) — your ballistic flicks landed further from centre on targets past
  28°, and you needed 1.8 corrections on average versus 0.9 on short flicks."*
- Never more than two improvement areas. A list of five weaknesses is discouraging and not
  actionable.
- Never compares the user to other users while the reference distribution is provisional
  (doc 14 §14.4).

---

## 16.7 The response curve — the primary evidence

The signature visualisation (doc 25 §25.9). Its data contract:

```
responseCurve
  candidates[]   { xLog2, cm360, alphaHat, se, n, roundIndex, blindLabel, isAnchor }
  fit            { b0, b1, b2, concave, r2Adj }
  band[]         sampled { cm360, lo, hi } from the bootstrap fit envelope
  xStar          { cm360, ciLow, ciHigh }
  comfortBand    { lo, hi }
  constraint     { maxCm360 } | null
  currentSens    { cm360 } | null            the user's own starting point, if known
```

Marking the user's **current** sensitivity on the curve is what makes the result personally
meaningful: they see where they were, where the peak is, and how much of a difference the gap
actually represents. When the gap is small, the honest message is "you were already close" —
which is a good outcome to be able to deliver clearly.

---

## 16.8 Game settings derivation

```
for each (gameVersion, scope) requested:
    adapter = registry.resolve(gameVersion)
    if adapter.verification(scope) is unverified: emit verification state, no number
    else: result = adapter.fromCanonical(recommendedCountsPer360, ctx)
```

- Derived at read time; cached in `recommendation_game_settings` for history and export.
- The cache stores `adapter_version` and `conversion_method` (`SENS-BR-026`), so a later adapter
  change is detectable and the user can choose to refresh.
- Changing the output game re-derives; it never re-runs a test and never writes to the session
  (FR-078).

---

## 16.9 Superseding

Fine-tuning and re-validation produce a **new** recommendation row linked by
`parent_recommendation_id`, with the old row's `superseded_by` set. Nothing is ever overwritten.

This means history shows the honest sequence — initial recommendation, validation result, fine
-tuned recommendation — rather than a single number that silently changed.

---

## 16.10 What the recommendation never says

| Never | Instead |
|---|---|
| "Your perfect sensitivity is X" | "Your measured performance peaked around X" |
| "This will improve your aim by N%" | "In this session, X scored N% better than Y — here is the interval" |
| "Pro players use X" | *(nothing — `SENS-BR-037`)* |
| "You are a Fast Flick player" as an identity | "At this sensitivity, your flick and speed scores were your strongest" |
| A confidence above the version ceiling | The ceiling (`SENS-BR-028`) |
| A converted setting for an unverified game | The verification state and the canonical target (`SENS-BR-014`) |
| An improvement claim with an interval spanning zero | "No measurable difference" (`SENS-BR-016`) |
