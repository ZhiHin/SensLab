# 35 — Glossary

This document is **normative**. Where a term appears in any Phase 0 document or in Phase 1+ code,
it carries the meaning defined here. Several terms have colliding everyday meanings and the
collisions are called out explicitly.

---

## Ambiguity warnings

| Term | The collision | Resolution |
|---|---|---|
| **sensitivity** | The physical property (cm/360) vs. the in-game number | Use **physical sensitivity** or **cm/360** for the former; **game sensitivity** or **setting** for the latter. Never bare "sensitivity" in code identifiers |
| **test** | An aim exercise vs. a software test | **aim test** or **trial** for the former; **unit/integration/E2E test** for the latter |
| **session** | A calibration run vs. an authentication session | **test session** / **calibration session** vs. **auth session**. Table names reflect this |
| **round** | A calibration search round vs. a test block | **calibration round** (a search step) vs. **round** / **block** (one candidate × one aim test). `calibration_rounds` and `test_rounds` are separate tables |
| **score** | A candidate's objective value vs. a displayed 0–100 dimension score | **objective score** vs. **display score** |
| **confidence** | The index vs. a statistical confidence interval | **confidence index** vs. **credible interval** / **confidence interval** |

---

## Terms

**adapter** — A module converting between canonical physical sensitivity and one game's settings,
for one game version. See doc 12.

**aim test** — One of the exercises in doc 09 (flick, tracking, …). Never a software test.

**anchor candidate** — The round-1 centre sensitivity, re-tested in the final round as a
check standard. Provides a within-session test–retest estimate and pins the drift model.
Doc 13 §13.5.

**block** — One candidate × one aim test, run contiguously. Stored as a `test_rounds` row.

**bounded influence** — The soft clip `4·tanh(z/4)` limiting any single trial's leverage without
removing it. Not trimming. Doc 14 §14.3.

**bracket** — The interval of log-sensitivity currently being searched. Doc 13 §13.3.

**candidate** — A specific physical sensitivity being evaluated in a calibration round.

**cm/360** — Centimetres of physical mouse travel required for a 360° in-game turn. The
user-facing canonical unit.

**comfort range** — The set of sensitivities statistically indistinguishable from the peak. Wider
than the high-performance range and usually the more actionable output. Doc 16 §16.3.

**confidence index** — A 0–100 composite quality score from seven named components, with a
version ceiling. Not a probability. Doc 15.

**counts / counts per 360** — Raw mouse sensor counts; the number required for a 360° turn. The
**canonical stored quantity** (ADR-004).

**counterbalancing** — Arranging presentation order (via a Latin square) so that position effects
cancel across candidates. Doc 13 §13.6.

**credible interval** — The bootstrap interval on the fitted optimum `x*`, reported as the
high-performance range.

**degraded (trial)** — Completed but measured under poor environmental conditions. Still scored,
always flagged. Distinct from **invalid**.

**dimension** — One of the six skill axes: Flick, Precision, Tracking, Speed, Control,
Consistency. Doc 14 §14.5.

**DPI (CPI)** — Mouse counts per inch of physical movement. Self-reported; provenance tracked as
`known` / `assumed` / `estimated`.

**drift** — The session-wide performance trend from warm-up, learning and fatigue. Modelled as a
nuisance term `g(b)` and removed before candidate comparison. Doc 13 §13.7.

**eDPI** — `DPI × game_sensitivity`. Meaningful only within one game; displayed as a familiarity
aid, never used internally.

**environment class** — `pass` / `degraded` / `blocked`, from the environment check.

**flick stop** — The moment a ballistic movement ends: the first button press, or the first local
speed minimum below threshold after covering 60% of the initial distance. The evaluation point
for `flickError`. Doc 10 §10.3.

**FOV** — Field of view. SensLab's simulated FOV is fixed per session and recorded; game FOV
conventions (axis, scaling) are per-adapter verification items.

**high-performance range** — The 90% credible interval on the fitted optimum. Answers "where is
the peak"; narrower than the comfort range.

**indistinguishable** — The verdict when no candidate is statistically separable. A legitimate,
designed outcome, not a failure. Doc 16 §16.4.

**invalid (trial)** — Procedurally unusable (pointer lock lost, focus lost, frame hitch, premature
click, timeout, impossible velocity). Excluded from scoring, always stored with a reason. **Never
assigned because performance was poor** (`SENS-BR-009`).

**MDC — monitor distance coefficient** — The fraction of half-screen-width at which two FOV
states are matched, parameterising the ADS/scope conversion family. Doc 11 §11.6.

**MDE — minimum detectable effect** — The smallest candidate difference the achieved sample size
could have detected at 80% power. Distinguishes "genuinely equivalent" from "we could not tell".

**normalised error (`ε̂`)** — Angular error divided by target angular radius. Dimensionless, so it
is comparable across target sizes and tests.

**objective score** — The per-trial weighted composite the calibration engine optimises.
Distinct from a display score. Doc 14 §14.7.

**paired stimuli** — Matching seeded target sequences across candidates within a round, so the
comparison is paired and stimulus variance is removed. Doc 13 §13.6.

**practice** — Unscored trials preceding measurement, to absorb first-contact learning.
`is_practice = true`; never aggregated.

**provenance (DPI)** — `known` / `assumed` / `estimated`. Affects settings reliability, not the
confidence index.

**provisional (score)** — An absolute display score computed against a reference distribution that
has not yet been fitted from real data. Labelled as such wherever it appears. Doc 14 §14.4.

**response curve** — The plot of the player's measured performance against sensitivity, with
candidates, error bars, the fitted curve and the credible band. The product's signature evidence.
Doc 16 §16.7, doc 25 §25.9.

**scope key** — `hipfire` / `ads` / `x1` … `x8`. Present throughout the schema from Phase 1 even
though MVP uses only `hipfire`.

**settings reliability** — Whether the converted game numbers can be trusted, driven by DPI
provenance. Reported separately from the confidence index. Doc 15 §15.5.

**shape (profile)** — Dimension scores centred on the player's own mean and scaled by their own
spread. Describes what kind of aimer someone is, independent of how good they are. Doc 16 §16.5.

**stimulus seed** — The per-trial seed reproducing the exact target sequence a player faced.

**trial** — One measured unit: one target engagement, or one tracking interval.

**unadjustedMovement** — The Pointer Lock option requesting raw, OS-unprocessed movement deltas.
Its availability is a blocking verification item (`EV-010`).

**verdict** — `peak_found` / `indistinguishable` / `insufficient_data` for calibration;
`improved` / `no_measurable_difference` / `worse` for validation. In both cases the verdict enum
is the **only** source of headline wording.

**verification status** — `verified` / `partial` / `needs_recheck` / `unverified` for a game
adapter scope. `unverified` means the conversion function throws and no number is ever rendered.

**x, x\*** — `x = log2(counts_per_360)`, the search variable; `x*` the fitted optimum.

**yaw constant** — In a linear-yaw game model, degrees of rotation per mouse count at
sensitivity 1. A per-game verification item, never assumed.

---

## Naming conventions for Phase 1 code

| Concept | Identifier |
|---|---|
| Canonical stored value | `countsPer360` |
| User-facing physical value | `cmPer360` |
| A game's in-game number | `settingValue` (never `sensitivity`) |
| Search variable | `xLog2` |
| Fitted optimum | `xStar` |
| Candidate effect estimate | `alphaHat` |
| Aim test definition | `TestDefinition` |
| Software test file | `*.test.ts` |
| Calibration search step | `CalibrationRound` |
| Candidate × aim-test block | `TestRound` |
| Auth session | `AuthSession` |
| Calibration session | `TestSession` |

Consistency here is not cosmetic: the two "session" concepts and the two "round" concepts are the
most likely source of a confusing bug in this codebase.
