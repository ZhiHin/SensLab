# 11 — Canonical Sensitivity Model

Related: [12-game-adapter-architecture.md](12-game-adapter-architecture.md) · [13-calibration-algorithm.md](13-calibration-algorithm.md) · [19-test-engine-architecture.md](19-test-engine-architecture.md) · [36-external-verification-register.md](36-external-verification-register.md)

This is the mathematical foundation of the product. Everything upstream measures in these units
and everything downstream converts out of them.

---

## 11.1 The canonical quantity

> **The source of truth is `counts_per_360` — the number of mouse counts required to rotate the
> in-game view through a full 360° of yaw.**

`cm/360` is the *presentation* of that truth:

```
cm_per_360 = 2.54 × counts_per_360 / DPI
```

**Why counts, not centimetres, is the canonical stored quantity.** Centimetres depend on DPI,
and DPI is a self-reported number that may be wrong or unknown (doc 04 §4.4.3). Counts are what
the browser and the game both actually receive. Storing counts means:

- A recommendation remains meaningful even when DPI provenance is `assumed` or `estimated`.
- If a user later discovers their real DPI, their historical recommendations can be re-expressed
  in cm/360 correctly, without re-running anything.
- The engine's internal maths never has a DPI term in its inner loop.

**Both are stored** (`recommendations.recommended_counts_360` and `recommended_cm360`), with
counts as the authoritative column and cm/360 derived at write time from the session's DPI. The
UI leads with cm/360 because it is the number humans reason about.

**Secondary derived presentations:**

```
deg_per_cm      = 360 / cm_per_360
inches_per_360  = cm_per_360 / 2.54
eDPI            = DPI × game_sensitivity          (valid only within one game; never canonical)
```

`eDPI` is displayed for games where the community uses it, purely as a familiarity aid. It is
never an internal quantity, because it is meaningless across games.

---

## 11.2 The general game model

A game's sensitivity model is a function from the in-game setting to angular displacement per
mouse count:

```
deg_per_count = F_game(setting, context)
counts_per_360 = 360 / deg_per_count
```

where `context` may include FOV, scope state, aspect ratio, and any per-game toggles.

SensLab supports three model **forms**. The form is a property of the game and must be
determined by verification, never assumed (doc 08 §8.3).

### Form A — linear yaw constant

```
deg_per_count = setting × yaw
```

with `yaw` a fixed engine constant (degrees per count at setting = 1). Then:

```
counts_per_360 = 360 / (setting × yaw)
cm_per_360     = 2.54 × 360 / (DPI × setting × yaw)
               = 914.4 / (DPI × setting × yaw)
```

and the inverse, which is what SensLab actually needs:

```
setting = 914.4 / (DPI × yaw × cm_per_360)
```

This form is expected for engines in the Source lineage; the constant and its current value are
verification items (`EV-001`, `EV-002`).

### Form B — lookup table with interpolation

For games whose setting-to-rotation relationship is not linear (or not known to be linear), the
adapter stores measured anchor points `(setting_i, counts_per_360_i)` and interpolates. The
interpolation method (monotone cubic on log-log axes is the default) and the extrapolation
policy (**refuse**, do not extrapolate) are part of the adapter definition.

This is the form PUBG is most likely to need (`EV-003`).

### Form C — piecewise / custom

An explicit function with declared parameters, used when a game has documented breakpoints or a
non-monotone region. Requires a bespoke, individually reviewed and tested adapter module.

**Every adapter declares its form.** A model whose form is unverified cannot be assigned Form A
"provisionally" — that is precisely the guess `SENS-BR-013` forbids.

---

## 11.3 Worked example of the algebra (using a symbolic constant)

To make the pipeline concrete without asserting any unverified constant, let `Y` denote a game's
(unverified) yaw constant in degrees per count at setting 1.

Given DPI = 800 and a recommended `cm_per_360` = 30.0:

```
counts_per_360 = 2.54 × ... inverted:
counts_per_360 = cm_per_360 × DPI / 2.54 = 30.0 × 800 / 2.54 = 9448.8189 counts

deg_per_count  = 360 / 9448.8189 = 0.03810 deg/count
setting        = deg_per_count / Y = 0.03810 / Y
```

If and only if `Y` has been verified for that game version does the adapter return
`setting`; otherwise it refuses (doc 12 §12.6).

Note that `counts_per_360 = cm_per_360 × DPI / 2.54` is exact and DPI-dependent, while
`deg_per_count = 360 / counts_per_360` is exact and DPI-independent. **This is the boundary
where DPI enters the pipeline, and it is the only place it does.**

---

## 11.4 Setting quantisation

Games expose sensitivity with a finite range and step (e.g. two decimal places, or a 0–100
integer slider). The adapter declares `setting_min`, `setting_max`, `setting_step`, and the
rounding mode. SensLab must:

1. Compute the ideal `setting`.
2. Clamp to `[setting_min, setting_max]`; if clamping was required, say so in the UI, because it
   means the recommendation is not achievable in that game at that DPI and the user should
   change DPI.
3. Quantise to the nearest achievable step.
4. **Recompute the actual resulting cm/360 from the quantised setting** and display that as the
   achieved value, alongside the ideal. The gap is usually negligible; when it is not (coarse
   sliders), the user deserves to see it.
5. Where quantisation error exceeds a threshold (`TUNABLE`, default 1.5%), suggest a DPI that
   lands closer to a representable step.

Skipping step 4 is a common and avoidable dishonesty in existing converters.

---

## 11.5 FOV and the camera model

SensLab's test engine renders a perspective camera. FOV matters for two reasons: it changes how
far a target *appears* to be for a given angle, and it is the basis of every ADS/scope
conversion.

**Definitions.** Let `h` be the **horizontal half-FOV** in radians and `v` the vertical
half-FOV. For an aspect ratio `AR = width / height`:

```
tan(v) = tan(h) / AR
```

A target at yaw angle θ from the camera axis projects to a horizontal screen offset, as a
fraction of the half-screen-width:

```
k(θ) = tan(θ) / tan(h)
```

and the inverse, which is what the ADS conversion uses:

```
θ(k) = atan( k × tan(h) )
```

**FOV scaling conventions.** Games differ in whether a stated FOV is horizontal or vertical, and
in how it responds to aspect ratio ("Hor+", "Vert−", and others). This is a per-game property
that must be verified, not assumed — an adapter declares `fov_axis` (`horizontal` | `vertical` |
`fourthirds_base`) and `fov_scaling` and both are verification items. Getting this wrong
silently corrupts every ADS conversion while leaving hipfire correct, which makes it a
particularly nasty class of bug.

**SensLab's own FOV is fixed** across a session (doc 09 §9.0.1) and recorded, so it cannot
confound the calibration.

---

## 11.6 ADS and scope conversion

The question: given a hipfire sensitivity, what scoped sensitivity "feels the same"? There is no
single correct answer — there are several defensible matching criteria, and they disagree.
SensLab implements the family properly, names the criterion, and lets the user choose.

### 11.6.1 The general matching identity

Let config 1 (source) have half-FOV `h₁` and config 2 (target) have half-FOV `h₂`. Choose a
**monitor distance coefficient** `k ∈ [0, 1]`: the fraction of the half-screen-width at which
the two configurations should feel matched.

For the same physical mouse displacement to move the crosshair to screen fraction `k` in both
configurations:

```
cm360₂ / cm360₁ = atan(k · tan h₁) / atan(k · tan h₂)
```

Equivalently, in the form the adapter uses:

```
counts_360₂ = counts_360₁ × atan(k · tan h₁) / atan(k · tan h₂)
```

### 11.6.2 The named special cases

| Criterion | `k` | Ratio reduces to | Meaning |
|---|---|---|---|
| **Focal length / zoom ratio** | k → 0 | `tan h₁ / tan h₂` | Matches angular velocity at the exact screen centre. The mathematical limit of monitor-distance matching as the match point approaches the crosshair |
| **Monitor distance (horizontal edge)** | k = 1 | `h₁ / h₂` | Matches at the horizontal edge of the screen |
| **Monitor distance, coefficient k** | 0 < k < 1 | general form | Matches at a chosen fraction of the half-screen |
| **360 distance** | — | `1` (identity) | Physical distance for a full turn is identical in both states. Not a member of the MDC family; a separate criterion |
| **Monitor distance vertical (MDV)** | as above with `v` | | Same construction using vertical half-FOV |

Derivation of the two limits, for review:
- As `k → 0`, `atan(k·x) → k·x`, so the ratio → `tan h₁ / tan h₂`.
- At `k = 1`, `atan(tan h) = h`, so the ratio → `h₁ / h₂`.

Because `h₂ < h₁` when zoomed in, all MDC criteria give `cm360₂ > cm360₁` (scoped aim is slower
in physical terms), with focal-length scaling the slowest and monitor-edge matching the fastest
within the family; 360-distance matching leaves it unchanged.

`REQUIRES_EXTERNAL_VERIFICATION` — the *naming* used by well-known third-party calculators for
these criteria (particularly what "0% monitor distance" denotes) must be confirmed before
SensLab adopts any of those labels in its UI, so that a user comparing tools is not misled.
SensLab's own maths above is derived from first principles and stands on its own. Tracked as
**EV-011**.

### 11.6.3 Defaults and their rationale

`ASSUMPTION` (`TUNABLE`, per-adapter override):

| Scope state | Default criterion | Rationale |
|---|---|---|
| ADS / low magnification (≤ 2×) | Monitor distance, k = 0.5 | Compromise between centre-feel and screen-feel; the most common preference in practice |
| Medium magnification (3×–4×) | Monitor distance, k = 0.5 | Consistency across the scope ladder matters more than per-scope optimisation |
| High magnification (≥ 6×) | Focal length (k → 0) | At high zoom the edge-match criterion produces very fast scoped aim; centre-matching is more usable |

These defaults are opinions, are labelled as such in the UI, and are user-overridable
(FR-085). They are **not** presented as the correct answer, because there isn't one.

### 11.6.4 The critical adapter question

Some games already apply an internal FOV-dependent scaling to their ADS sensitivity setting;
others do not. If SensLab applies a monitor-distance conversion *on top of* a game that already
does so, the result is wrong by exactly the factor the game applied.

Therefore every adapter must declare, per scope, `ads_model`:

- `raw_multiplier` — the setting multiplies the hipfire count-to-degree factor directly, with no
  internal FOV compensation.
- `internally_fov_scaled` — the game already applies its own scaling; SensLab's target is
  expressed in the game's own terms and the MDC family is not applied.
- `unknown` — **no ADS value is emitted**.

This is a first-class verification item for every game (`EV-001`..`EV-005`), and it is the
single most common source of error in sensitivity conversion.

---

## 11.7 Which criterion for the *recommendation*

The calibration engine recommends a hipfire `counts_per_360`. Scoped values are derived, not
measured, at MVP. Once the ADS and Scope Calibration tests exist (doc 09 §9.13–9.14), scoped
values become *measured* and the criterion becomes a starting point rather than an answer —
another reason `scope_key` exists throughout the schema from Phase 1.

---

## 11.8 Windows pointer speed and OS acceleration

Three distinct things are often conflated:

1. **Windows pointer speed slider (1–11).** Applies a multiplier to pointer movement for the
   desktop cursor.
2. **Enhance Pointer Precision (EPP).** A non-linear, velocity-dependent acceleration curve.
3. **Raw input.** When an application reads raw HID input, neither (1) nor (2) applies.

For SensLab:

- If `unadjustedMovement: true` is granted by the browser, `movementX/Y` should reflect raw
  device counts and neither (1) nor (2) applies. This is the required configuration.
- If it is **not** granted, `movementX/Y` may be affected by the OS pointer pipeline. SensLab
  cannot correct for this reliably — EPP in particular is a velocity-dependent curve that would
  need to be inverted from an unknown table. The correct response is to **warn, penalise
  confidence, and recommend the user disable EPP**, not to attempt a correction
  (doc 04 §4.4.2).

`REQUIRES_EXTERNAL_VERIFICATION` — the exact multiplier table for the 11 Windows pointer-speed
steps, and the precise conditions under which the browser's `movementX/Y` is or is not affected
by it per browser/OS, are platform facts SensLab must confirm empirically rather than take from
folklore. Tracked as **EV-012** and **EV-010**.

SensLab collects the user's stated pointer-speed step and EPP state as *context for the warning
and for support diagnosis only*. It is never used as a multiplier in any calculation.

---

## 11.9 DPI: verification, estimation, and plausibility

DPI is the weakest link in the chain. SensLab handles it in three ways.

### 11.9.1 Method A — in-browser ruler measurement (preferred estimate)

Requires `unadjustedMovement`. The user places a ruler or a known-width object (a standard credit
card, 8.56 cm, is a good universal reference) on the pad and drags the mouse along it. SensLab
counts raw counts `N` over a declared physical distance `L` cm:

```
DPI = 2.54 × N / L
```

Repeated three times, taking the median. Accuracy is limited by the user's physical care;
realistically ±5–10%, which is enough to detect a *wrong* DPI (e.g. 400 vs 1600) even when it is
not precise enough to replace a known value. Recorded as `dpi_source = 'estimated'`.

### 11.9.2 Method B — in-game 360 measurement

If the user plays a game with a **verified** adapter and can measure their in-game 360 distance
`L` cm at a known setting `S`, then for a Form-A game:

```
DPI = 914.4 / (L × S × Y)
```

More accurate than Method A when performed carefully, but it requires the user to leave the
browser, and it requires a verified adapter — so it is offered second.

### 11.9.3 Method C — plausibility cross-check (always run)

Whenever enough information exists, SensLab checks internal consistency and warns on conflict:

- If current game + sensitivity are given (verified adapter): compute implied `cm_per_360`. If it
  falls outside a plausible human band (`ASSUMPTION`: 5–120 cm/360, `TUNABLE`), the DPI is
  probably wrong.
- If mousepad width is given: if implied `cm_per_360` substantially exceeds the pad width (a
  360° turn that cannot physically be performed even with lifts), flag it.
- After the 360 Comfort Test: compare the measured `comfortableSwipeCm` against the implied
  physical scale. A large mismatch is strong evidence of a wrong DPI, and it is available before
  the recommendation is generated.

The check **warns**, never blocks (FR-033).

### 11.9.4 Consequences of unknown DPI

Because `counts_per_360` is canonical, an unknown DPI degrades gracefully:

| Output | Depends on DPI? |
|---|---|
| `counts_per_360` recommendation | No — fully valid |
| Relative statement ("about 18% slower than your current setting") | No — fully valid |
| `cm_per_360` | Yes |
| Converted game setting | **Yes** — a wrong DPI produces a wrong game number |

The UI states that dependency plainly rather than hiding it (`SENS-BR-005`).

---

## 11.10 Plausible range and safety bounds

`ASSUMPTION` (`TUNABLE`, `sensitivity_domain`): the admissible search domain is
**8 cm/360 to 100 cm/360**.

Rationale: below ~8 cm/360 a full turn is a wrist flick and precision collapses for essentially
all players; above ~100 cm/360 a full turn requires multiple lifts on any realistic desk. These
are soft product bounds chosen to keep the search inside the region where a human can actually
operate, not claims about what is optimal. Candidates are additionally clipped by the physical
constraint from doc 13 §13.4.

The domain is stored with the calibration algorithm version so a change to it is a versioned
change (`SENS-BR-029`).

---

## 11.11 Numerical policy

- All internal computation in `double` (JS `number`). No `float32` anywhere in the maths path.
- Conversions are performed in **log space** where a chain of multiplications would otherwise
  accumulate error, and the calibration search operates in `log2(counts_per_360)` throughout
  (doc 13 §13.2).
- Round-trip property test, required for every adapter: for a dense sample of settings across the
  game's valid range, `to_canonical(from_canonical(x))` must equal `x` within 1e-9 relative
  before quantisation, and within one step after quantisation.
- Presentation rounding happens only at the render boundary: cm/360 to one decimal, game settings
  to the game's own precision.
