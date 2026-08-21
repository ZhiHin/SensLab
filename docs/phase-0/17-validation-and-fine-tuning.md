# 17 — Validation and Fine-Tuning

Related: [13-calibration-algorithm.md](13-calibration-algorithm.md) · [15-confidence-model.md](15-confidence-model.md) · [16-recommendation-model.md](16-recommendation-model.md) · [04-user-journeys.md](04-user-journeys.md)

---

## 17.1 Why validation exists

The calibration produced an estimate from a search. Validation asks a different, harder question
with a cleaner design:

> Head-to-head, with everything else held constant, does the recommended sensitivity actually
> beat the one you came in with?

It is a **confirmatory** test after an **exploratory** search. That distinction matters
statistically: the calibration searched over many candidates and picked the best, which
systematically biases the winner's estimated advantage upward (the winner's curse). A fresh,
pre-specified, two-arm comparison is the correct way to check whether the advantage survives.

Validation is also the product's credibility mechanism. A tool that checks its own answer, and
is willing to report that its answer lost, is a different kind of tool.

---

## 17.2 Design

**Arms.** Exactly two:
- **A** = the user's original cm/360 (from their stated current sensitivity, or the round-1
  bracket centre if they had none — in which case validation is offered but framed as
  "recommended vs your starting point").
- **B** = the recommended cm/360.

If A and B differ by less than the MDE, validation is **not offered**; instead the result page
states that the recommendation is effectively the user's current sensitivity, which is itself a
useful, honest finding.

**Structure.** Paired blocks in an **ABBA / BAAB** counterbalanced sequence:

```
sequence = randomly chosen from { ABBA, BAAB }, then repeated: e.g. ABBA BAAB
```

Four to eight short blocks (`TUNABLE`; default 8 blocks in Standard). ABBA counterbalancing
cancels a *linear* time trend exactly, which is why it is preferred over simple alternation for
a short run — and unlike the calibration phase, the run is short enough that a linear drift
assumption is defensible.

**Test set.** A reduced battery — Flick, Micro, Tracking — chosen because they carry the
most sensitivity signal per second (doc 14 §14.7). Roughly 4–6 minutes total.

**Blinding.** Full. Blind labels are re-shuffled and bear no relation to the calibration's
labels. The player is told only "you are comparing two sensitivities".

**Paired stimuli.** As in calibration (doc 13 §13.6), corresponding trials in A and B blocks use
matched seeds, so the comparison is paired at the stimulus level.

---

## 17.3 Analysis

For each reported metric *m*:

```
per-block value:  m_A,k  and  m_B,k     for matched block pairs k
paired delta:     Δ_k = m_B,k − m_A,k   (direction-aligned so positive = B better)
estimate:         Δ̄ = median(Δ_k)
interval:         paired bootstrap over blocks and trials, 90% CI, seeded
```

The reported metrics are fixed in advance (no metric shopping):

| Reported metric | Direction |
|---|---|
| `firstShotAccuracy` | higher better |
| onset-adjusted `targetAcquisitionTime` | lower better |
| `overshootRate` | lower better |
| `trackingAccuracy` | higher better |
| `consistency` (of acquisition time) | higher better |

**Composite verdict.** Computed from the same objective score the calibration used, so that the
verdict is about the thing that was optimised, not about a metric chosen after the fact:

```
Δ_composite with 90% CI
  CI entirely > 0   -> "improved"
  CI entirely < 0   -> "worse"
  CI spans 0        -> "no_measurable_difference"
```

`SENS-BR-016` — this enum is the *only* source of the headline wording. Per-metric deltas are
also reported individually with their own intervals, each labelled significant or not, so a user
can see (for example) that accuracy improved measurably while tracking did not.

---

## 17.4 Presentation

The verdict determines the layout, not just the copy.

**`improved`:**

```
ACCURACY            +8.7%     [ +3.1  ,  +14.2 ]
TARGET ACQUISITION  −43 ms    [ −71   ,  −16   ]
OVERSHOOT           −14%      [ −24   ,  −4    ]
TRACKING            +5.3%     [ −0.8  ,  +11.1 ]   no measurable difference
CONSISTENCY         +6.0%     [ +1.2  ,  +10.8 ]
```

Every number carries its interval. A metric whose interval spans zero is explicitly labelled, in
the same list, at the same visual weight. Cherry-picking the significant rows into a highlight
reel is prohibited.

**`no_measurable_difference`:** the headline is exactly that, with the honest reading:

> *Neither sensitivity clearly outperformed the other in this comparison. That usually means the
> difference is small enough that comfort should decide — or that a longer test is needed to
> resolve it.*

**`worse`:** see §17.5.

---

## 17.5 When the recommendation loses

This case is designed first-class, because it is where a dishonest product would hide.

1. **State it plainly.** "Your original sensitivity performed better in this comparison."
2. **Show the numbers**, in the same format as a win.
3. **Retain the original as the standing recommendation.** The stored recommendation's
   `accepted_value` becomes A, with B retained as the calibration's estimate. Nothing is deleted.
4. **Reduce confidence** by the documented factor (doc 15 §15.8).
5. **Explain the two plausible causes**, without using either as an excuse:
   - *Familiarity.* You have thousands of hours at your current sensitivity and roughly twenty
     minutes at the new one. Short-term tests are biased toward the familiar (§17.6).
   - *The estimate may simply be wrong.* The calibration could have been misled by noise,
     fatigue, or an unlucky candidate arrangement.
6. **Offer three concrete next steps:** fine-tune around a value between A and B; re-run
   calibration with a wider bracket; or keep the current sensitivity and re-check in a week.

Point 5's ordering is deliberate: the familiarity explanation is real, but leading with it would
be self-serving. Both causes are given equal weight, and the UI does not push the user toward
adopting B.

---

## 17.6 Familiarity bias — stated, not hidden

The honest limitation:

> A sensitivity you have used for a year has a practice advantage that no twenty-minute test can
> overcome. If the new value is close to your old one, that advantage is small. If it is very
> different, expect the new one to test worse today and possibly better in two weeks.

This appears on the validation result whenever `|log2(B) − log2(A)| > 0.30` (≈ a 23% change),
because that is the regime where adaptation cost is material.

**Product consequence:** the recommended action after a large change is *not* "switch
immediately". It is: switch, play for a week, then re-run a short validation. That flow is the
foundation of the post-MVP drift-monitoring feature, and the copy is written now so it does not
have to be retrofitted.

`ASSUMPTION` — the 0.30 log2 threshold and the "two weeks" adaptation guidance are judgements
based on the general shape of motor-adaptation, not on SensLab data. They are `TUNABLE` and
should be revisited once re-validation data exists.

---

## 17.7 Fine-tuning

**Purpose.** Refine within the comfort range, and give the user agency without giving them a
biased slider.

**Design.** Five blinded candidates around the recommendation:

```
x* + { −δ₂, −δ₁, 0, +δ₁, +δ₂ }
```

`ASSUMPTION` (`TUNABLE`): `δ₁ = 0.06` log2 (≈ 4.2%), `δ₂ = 0.14` log2 (≈ 10.2%). Chosen so `δ₂`
is roughly the width of a typical high-performance range — fine-tuning explores *inside* the
uncertainty, which is exactly where it is useful.

**Presentation.** The labels shown are "Lower / Slightly Lower / Recommended / Slightly Higher /
Higher" **only after the run is complete**. During the run they are blind labels in randomised
order, so the player cannot anchor on "Recommended" (FR-089, `SENS-BR-007`).

**Two-phase procedure:**

*Phase 1 — screening.* One short block per candidate (Flick + Micro only, ~40 s each), order
counterbalanced. Fit the same quadratic; keep the top two.

*Phase 2 — duel.* The top two go head to head in ABBA paired blocks with an early-stopping rule:
after each block pair, if the 90% CI on the paired difference excludes zero, stop; otherwise
continue to the block budget. Early stopping on a pre-specified rule with a fixed maximum is
declared in advance, and the number of looks is recorded so the interval can be adjusted for
multiplicity in a later model version (recorded as a known simplification in
`calibration_model_v1`).

**Output.** A superseding recommendation (doc 16 §16.9) with its own confidence, or — very
commonly and legitimately — "the original recommendation held up; nothing changed."

---

## 17.8 Preference capture

After fine-tuning, and *after* the reveal, the user is asked one optional question:

> Which of these felt best to you? (Blind labels shown alongside their revealed values.)

This is recorded as `subjective_preference` and is **never** allowed to change the
recommendation (`SENS-BR-002`). It exists for two reasons: it is genuinely useful for the user to
notice when their preference disagrees with their measurement, and, aggregated, it is the dataset
that would let a future model learn how measured optimum and felt preference relate.

When preference and measurement disagree, the product says so neutrally: *"You picked the faster
option, but you measured better on the slower one. Both are inside your comfort range — either is
a defensible choice."*

---

## 17.9 Session comparison (across sessions)

Used by history (FR-093) and by the post-validation return flow.

**Comparability check first.** Two sessions are directly comparable only when hardware profile,
DPI, environment class, session mode, and algorithm versions match. Any mismatch produces a
flagged comparison (`SENS-BR-019`) that states specifically what differed.

**Statistical statement.** A change between two sessions is called *meaningful* only when the two
high-performance ranges do not overlap. Otherwise:

> *Your recommendation moved from 34.1 to 31.2 cm/360, but the two measurements' ranges overlap —
> this is within the noise of the method, not a demonstrated change.*

This is a deliberately conservative rule. Non-overlap of two 90% intervals is a stricter
criterion than a formal test of the difference, and it errs toward *not* telling users they have
changed when they may not have. Given how tempting a fabricated progress narrative would be here,
being conservative is the right default.

**What is compared:**

| Field | Comparison |
|---|---|
| Recommended cm/360 | With the overlap verdict |
| Confidence | Both values, with components that differed |
| Dimension scores | Deltas, each labelled meaningful or within-noise |
| Aim profile | Same or changed, with the shape difference that caused it |
| Environment | Explicit differences called out |
| Sample sizes | Both, so a Quick vs Standard comparison is visible |

---

## 17.10 Testing requirements

| Property | Test |
|---|---|
| Verdict correctness | Synthetic data where B is better / worse / identical produces `improved` / `worse` / `no_measurable_difference` |
| Counterbalancing | Generated sequences are valid ABBA/BAAB and balanced |
| Pairing | Matched blocks use matched stimulus seeds |
| No cherry-picking | The headline verdict is derived from the composite only; a fixture where one metric is significant and the composite is not produces `no_measurable_difference` |
| Loss handling | A `worse` verdict retains A as the standing recommendation and applies the confidence multiplier |
| Blinding | No candidate value appears in the DOM during a fine-tune or validation run |
| Preference isolation | Setting `subjective_preference` does not alter any stored recommendation value |
| Comparison conservatism | Overlapping ranges never produce a "meaningful change" verdict |
