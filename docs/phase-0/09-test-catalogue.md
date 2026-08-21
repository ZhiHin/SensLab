# 09 — Test Catalogue

Related: [10-measurement-methodology.md](10-measurement-methodology.md) · [19-test-engine-architecture.md](19-test-engine-architecture.md) · [13-calibration-algorithm.md](13-calibration-algorithm.md)

---

## 9.0 Shared conventions

These apply to every test unless the test overrides them.

### 9.0.1 The world is angular, not pixel-based

All targets are positioned in **angular coordinates** (yaw, pitch) relative to the camera, and
projected to the screen through a perspective camera with a configured horizontal FOV. This is
the single most important engine decision (ADR-006) because it is what makes cm/360 the real
independent variable: a target "20° to the right" requires the same physical mouse travel
regardless of window size, resolution, or FOV.

Target sizes are specified as an **angular radius in degrees**, never in pixels.

`ASSUMPTION` — the default simulated horizontal FOV for calibration is **103° hfov at 16:9**
(`TUNABLE`, `calibration_fov_hdeg`). Rationale: it sits in the range commonly used by the launch
titles' default/typical configurations, so target scale on screen feels familiar. The FOV is
held **constant across all candidates and all rounds** — varying it would confound the
independent variable. It is recorded on the session.

### 9.0.2 Trial structure

```
round  = one (candidate x test) block               -> many trials
trial  = one measured unit (one target engagement)
block  = the group of rounds for one candidate in one calibration round
```

Every trial has: a seeded stimulus, a start timestamp, an end condition, a validity
classification, and a metric bundle. Trial lifecycle is implemented once (doc 19 §19.3);
individual tests only supply a declarative definition.

### 9.0.3 Inter-trial interval

A randomised **250–600 ms** gap between trials (`TUNABLE`), during which input is recorded but
not scored. Purpose: prevent rhythmic anticipation, and give a clean baseline segment for
detecting pre-movement.

### 9.0.4 Shooting model

- Left mouse button = fire. Hit detection is **hitscan at the moment of the press**, evaluated
  against the target's analytic position at that exact timestamp (not the last rendered frame).
- Firing is not rate-limited except where a test declares a cooldown.
- Some tests use **click-to-confirm** (a shot is required); tracking tests use
  **hold-to-track** (button held; time-on-target accumulates while held).

### 9.0.5 Validity classification

| Class | Meaning | Scored? | Stored? |
|---|---|---|---|
| `valid` | Clean trial | Yes | Yes |
| `degraded` | Completed but the environment was poor (frame hitches over threshold) | Yes, with a flag | Yes |
| `invalid` | Procedurally unusable | **No** | Yes, with reason |

Universal invalid reasons: `pointer_lock_lost`, `focus_lost`, `frame_hitch` (a single frame
gap > 100 ms inside the measured window), `timeout`, `impossible_velocity`, `no_input`.
Per-test reasons are listed in each section. **No reason code may reference performance quality**
(`SENS-BR-009`).

### 9.0.6 Practice behaviour

Every test has a practice variant: same mechanics, `is_practice = true`, never scored, never
aggregated (`SENS-BR-011`). Practice runs at the **bracket centre** sensitivity, never at a
candidate, so practice cannot advantage one candidate.

### 9.0.7 Minimum sample requirements

Stated per test as *valid trials per candidate per round*. If the minimum is not reached after
the replacement allowance (doc 05, FR-060), the candidate is marked `insufficient` and is
excluded from the fit rather than estimated (`SENS-BR-012`).

### 9.0.8 Accessibility baseline for every test

- Full-text description of the task before pointer lock, readable by a screen reader.
- Target/background contrast ≥ 4.5:1; hit feedback encoded by **shape and motion**, not colour
  alone.
- No flashing above 3 Hz anywhere in the test surface.
- ESC always pauses; pausing is announced.
- Motion-discomfort advisory before the first pointer lock (`SENS-UX-024`).

---

# MVP TESTS

---

## 9.1 Reaction Test — `reaction`

**Purpose.** Establish the player's simple visual-motor reaction floor. Used to *decompose*
acquisition time in other tests (doc 10 §10.4) and to detect anticipation strategies.
**It never influences the sensitivity recommendation** (`SENS-BR-006`).

**Setup.** Static crosshair, no camera rotation, empty field. Mouse movement is ignored.

**Trial structure.** Blank interval of uniform random 800–2600 ms (`TUNABLE`) → a target appears
at the crosshair → the player clicks as fast as possible → trial ends.

**Target behaviour.** Appears instantaneously at screen centre, angular radius 3.0°, high
contrast. No motion. Disappears on click or at 1200 ms.

**Input.** Left click only.

**Metrics produced.** `reactionTime` (primary), `prematureClickRate`, `reactionMedian`,
`reactionSD`, `reactionMAD`.

**Scoring.** Contributes to no skill dimension used in candidate comparison. Stored on the
session as a baseline attribute. Reported to the user as context.

**Invalid conditions.** `premature_click` (click before onset, or < 80 ms after onset — below
human simple-RT floor), `no_input` (no click within 1200 ms), plus universals.

**Practice.** 3 trials.

**Minimum sample.** 8 valid trials, once per session (not per candidate — it is sensitivity
independent, so running it per candidate would waste budget).

**Potential biases.** Anticipation from a predictable interval — mitigated by the wide uniform
interval and by penalising premature clicks with invalidation rather than a score. Fatigue —
mitigated by running it once, early.

**Performance considerations.** Trivially cheap. Onset timestamp must be taken from the actual
presentation frame (`requestAnimationFrame` callback time of the frame that painted it), not
from the scheduling call — this is the main correctness trap. Display latency is unknown and
uncorrected; documented as a constant offset that cancels out across candidates.

**Accessibility.** Onset is a large, high-contrast, centred shape; no colour-only cue.

---

## 9.2 Flick Test — `flick`

**Purpose.** The primary measure of ballistic target acquisition — the single most
sensitivity-dependent skill. Produces the bulk of the Speed and Precision signal.

**Setup.** Angular world, camera controlled by mouse, crosshair fixed at screen centre.

**Trial structure.**
1. A **reset target** appears at the crosshair; the player clicks it. This guarantees a known,
   identical starting orientation for every trial and prevents drift accumulation.
2. Inter-trial interval.
3. The **flick target** spawns at a seeded angular distance and direction.
4. The player flicks and clicks. Trial ends on the first hit, or on timeout.

**Target behaviour.** Static. Angular radius drawn from the test's size set. Distance classes:

| Class | Angular distance | Share of trials |
|---|---|---|
| Small | 5°–12° | 35% |
| Medium | 12°–28° | 40% |
| Large | 28°–50° | 25% |

Direction: uniformly sampled over the full circle, then **quota-balanced** into horizontal
(±20° of the horizontal axis), vertical (±20° of vertical), and diagonal bins so no direction
class is under-sampled by chance. Left/right and up/down are balanced within each bin.

**Input.** Movement + left click. Multiple shots permitted; the first shot is recorded
separately (that is where `firstShotAccuracy` comes from).

**Metrics produced.** `targetAcquisitionTime`, `timeToTarget`, `firstShotAccuracy`,
`hitAccuracy`, `flickErrorNorm`, `overshootRate`, `overshootMagnitudeNorm`, `undershootRate`,
`correctionCount`, `pathEfficiency`, plus per-distance-class breakdowns.

**Scoring.** Feeds **Flick**, **Speed**, and **Precision** dimensions (doc 14 §14.5).
Per-distance-class subscores are retained because a sensitivity that is good for small flicks
and bad for large ones is a real and diagnostic pattern.

**Invalid conditions.** `no_input` (no movement above threshold within 1500 ms of spawn),
`timeout` (5000 ms), `premature_movement` (significant movement in the 150 ms before spawn —
indicates the player was already moving), plus universals.

**Practice.** 6 trials across all three distance classes.

**Minimum sample.** 12 valid trials per candidate per round (Standard), 8 (Quick), 18
(Advanced). Rationale in §9.16.

**Potential biases.**
- *Spatial learning* — if targets recur in the same places, players pre-learn positions.
  Mitigated by continuous-valued seeded positions and by never repeating an exact position
  within a session.
- *Direction preference* — most players are better flicking in one horizontal direction.
  Mitigated by balanced direction quotas, so candidates face equivalent direction mixes.
- *Reset-target contamination* — clicking the reset target is itself a micro-task. It is
  excluded from all metrics; only the interval after the reset click counts.
- *Distance-class imbalance across candidates* — quotas are fixed per round, so every candidate
  sees the same distance mix.

**Performance considerations.** The heaviest metric computation (path efficiency, correction
counting) runs from the trial's ring buffer **after** the trial ends, during the inter-trial
interval — never inside the frame loop.

**Accessibility.** Distance classes are announced in the pre-test description. Target is a solid
shape with a distinct outline, not a colour patch.

---

## 9.3 Micro Adjustment Test — `micro`

**Purpose.** Measure fine control at small angles. This is the **primary detector of "too high"**
sensitivity: excessive sensitivity shows up here as overshoot, repeated correction, and
instability long before it shows up in large flicks.

**Setup.** As flick, but small angles only.

**Trial structure.** Reset target → interval → target spawns at 0.8°–4.0° from the crosshair →
player must place the crosshair inside it and click. A **dwell requirement** applies: the shot
counts only if the crosshair is inside the target at the press moment; there is no click-through
grace.

**Target behaviour.** Static, angular radius 0.35°–0.7° (`TUNABLE`) — small enough that the
sensitivity's fine-control cost is exposed, large enough to stay clickable.

**Input.** Movement + click. Cooldown of 120 ms between shots to prevent spam-clicking through
the task.

**Metrics produced.** `microAdjustmentError` (normalised), `targetAcquisitionTime`,
`correctionCount`, `overshootRate`, `firstShotAccuracy`, `settleTime` (time from first entering
the target to the shot), `jitterRMS` (high-frequency component of angular position while
settling).

**Scoring.** Feeds **Precision**, **Control**, and **Consistency**.

**Invalid conditions.** `no_input`, `timeout` (4000 ms), plus universals.

**Practice.** 6 trials.

**Minimum sample.** 12 per candidate per round (Standard), 8 (Quick), 18 (Advanced).

**Potential biases.**
- *Click-spam strategy* — a player could hold the crosshair roughly and click rapidly. The
  cooldown plus `firstShotAccuracy` weighting removes the advantage.
- *Mouse sensor jitter at low speed* — real, and it is part of what we are measuring, but it is
  hardware-dependent. It is held constant across candidates within a session, so it cannot bias
  the *comparison*; it can bias absolute scores, which is why absolute scores are provisional
  (doc 14 §14.4).
- *Screen-scale confound* — at small angular radii, screen pixel size matters. FOV and canvas
  size are fixed for the session; if the window is resized mid-session the session is flagged.

**Performance considerations.** `jitterRMS` requires the full position stream for the settling
window; computed post-trial from the ring buffer.

**Accessibility.** Small targets are the point of the test, but they are rendered with a
generous outline and a centre dot so they remain locatable for low-acuity users. A high-contrast
mode increases outline weight without changing the hit radius.

---

## 9.4 Tracking Test — `tracking`

**Purpose.** Measure continuous target following. Tracking optimum often sits at a *different*
sensitivity than flicking optimum; measuring both is what lets the recommendation express a
genuine trade-off.

**Setup.** Angular world; a single moving target; player holds the fire button.

**Trial structure.** Target appears, moves for a fixed duration (**5.0 s**, `TUNABLE`), player
tracks it with the button held. Time-on-target accumulates only while the button is held.

**Target behaviour.** Analytic motion (doc 19 §19.6) as a function of *t*. Pattern per trial,
sampled from:

| Pattern | Description |
|---|---|
| `horizontal` | Sinusoidal yaw sweep, randomised amplitude and period |
| `vertical` | Sinusoidal pitch sweep |
| `diagonal` | Combined with a phase offset |
| `circular` | Lissajous with 1:1 frequency ratio |
| `random-smooth` | Sum of 3 sinusoids with incommensurate frequencies — unpredictable but C¹-continuous |

Angular speed is bounded to **20°/s – 90°/s** (`TUNABLE`), angular radius 1.2°–2.0°.

**Input.** Movement + held left button.

**Metrics produced.** `trackingAccuracy` (time-on-target fraction), `trackingError` (RMS angular
distance, normalised by target radius), `trackingStability` (high-pass filtered error RMS),
`correctionFrequency`, `trackingBias` (mean signed lead/lag along the motion direction).

**Scoring.** Feeds **Tracking**, **Control**, **Consistency**.

**Invalid conditions.** `no_input` (button never held), `button_held_ratio_low` (< 70% of the
trial duration held — the player was not attempting the task), plus universals.

**Practice.** 2 trials (they are long).

**Minimum sample.** 5 valid trials per candidate per round (Standard), 3 (Quick), 8 (Advanced).
Fewer trials than the click tests because each trial contains ~5 s of continuous data —
statistically it is many samples, not one.

**Potential biases.**
- *Pattern predictability* — `random-smooth` and randomised phases prevent memorisation; the
  same pattern mix is used for every candidate.
- *Lead/lag strategy* — tracking slightly ahead is a legitimate strategy; `trackingBias` records
  it rather than penalising it, and error is measured from the target centre either way.
- *Duration/fatigue* — 5 s is long enough to measure and short enough not to fatigue.

**Performance considerations.** The highest-frequency metric collection in the product: error is
sampled at every frame and every input event, into pre-allocated typed arrays. The high-pass
filter for stability is applied post-trial.

**Accessibility.** Continuous smooth motion may be uncomfortable for motion-sensitive users;
the advisory covers it, and tracking tests are the ones a user can skip in a documented reduced
battery (with an explicit confidence consequence).

---

## 9.5 Target Switching Test — `switching`

**Purpose.** Measure repeated re-acquisition under time pressure — the closest analogue to
multi-opponent engagements, and a strong discriminator between sensitivities that are fast but
unstable versus slow but reliable.

**Setup.** Angular world; several simultaneous targets.

**Trial structure.** A trial is a **sequence**: 5 targets are visible at once; the player must
destroy them in any order; each destroyed target immediately respawns at a new seeded position
outside a minimum angular separation from the crosshair. The trial ends after **8 kills** or a
12 s timeout. Each individual kill contributes a switching measurement.

**Target behaviour.** Static, angular radius 1.5°–2.5°, distributed 8°–35° from the crosshair
and ≥ 10° apart from each other.

**Input.** Movement + click, no cooldown.

**Metrics produced.** `switchingTime` (hit *n* → hit *n+1*), `switchingTravelTime` (hit *n* →
first entry into target *n+1*), `targetAcquisitionTime`, `hitAccuracy`, `firstShotAccuracy`,
`overshootRate`, `pathEfficiency`.

**Scoring.** Feeds **Speed**, **Flick**, **Control**.

**Invalid conditions.** `insufficient_kills` (< 4 kills before timeout — task not attempted),
plus universals. Note this is a *procedural* threshold set far below any plausible genuine
attempt, not a performance filter.

**Practice.** 1 sequence.

**Minimum sample.** 2 sequences per candidate per round (Standard) yielding ≥ 14 switching
measurements; 1 (Quick); 3 (Advanced).

**Potential biases.**
- *Route optimisation* — players may find an efficient order. This is a real skill and is not
  removed, but respawn positions are re-seeded per kill so a memorised route is impossible.
- *Target-choice strategy differences between candidates* — mitigated by identical seeds for the
  same round index across candidates where possible (doc 13 §13.6), so candidates face
  equivalent spatial problems.

**Performance considerations.** Five simultaneous targets is the highest draw count in the MVP
battery, and it is still trivial for Canvas 2D.

**Accessibility.** Targets are distinguishable by position; no reliance on colour differences
between them.

---

## 9.6 Precision Test — `precision`

**Purpose.** Isolate accuracy at small angular size and greater simulated distance, with speed
de-emphasised. Complements Flick (which rewards speed) so the scoring model can separate
"fast but sloppy" from "slow but exact".

**Setup.** Angular world; a single small, distant-looking target.

**Trial structure.** Reset → interval → target spawns at 6°–20° → the player has a generous
time budget and is instructed to prioritise accuracy → **one shot only**. The trial ends on the
shot.

**Target behaviour.** Static, angular radius 0.4°–0.6°, rendered with a distance cue
(smaller, lower-contrast surround) so the task reads as "far away".

**Input.** Movement + exactly one click.

**Metrics produced.** `firstShotAccuracy` (the headline metric here), `flickErrorNorm`,
`targetAcquisitionTime`, `settleTime`, `correctionCount`, `jitterRMS`.

**Scoring.** Feeds **Precision** heavily, **Control** moderately, **Speed** not at all.

**Invalid conditions.** `no_input`, `timeout` (6000 ms), `extra_shot` (a second press before the
trial resolves — the UI makes the one-shot rule explicit), plus universals.

**Practice.** 4 trials.

**Minimum sample.** 10 per candidate per round (Standard), 6 (Quick), 14 (Advanced).

**Potential biases.**
- *Speed–accuracy trade-off drift* — some players will rush despite instruction. `settleTime` and
  `targetAcquisitionTime` are recorded so the analysis can detect a player who is not honouring
  the instruction, and the session quality report can note it.
- *One-shot anxiety* — the single-shot rule increases variance. Accepted: it is the cleanest
  measure of first-shot placement, and the sample size compensates.

**Performance considerations.** Low cost.

**Accessibility.** The "distance cue" must not reduce contrast below the accessible floor; it is
achieved by size and surround treatment, with contrast held at the accessible minimum.

---

## 9.7 360 Comfort Test — `comfort360`

**Purpose.** Not a performance test. It produces a **hard physical constraint** on the search
range: the largest turn the player can execute comfortably in one motion, given their real desk,
pad, grip and body. Prevents SensLab from recommending a sensitivity the player physically
cannot use.

**Setup.** Angular world; camera responds to movement; no targets, a horizon reference and a
marked start heading.

**Trial structure.** Three sub-tasks, each repeated 3 times:
1. **Single-swipe maximum** — "starting from the marked heading, turn as far right as you
   comfortably can in one motion without lifting or straining." Records maximum yaw achieved and
   the physical distance implied.
2. **180° comfort** — "turn to face exactly behind you." Records whether it took one motion,
   how many lifts/re-grips, and the time taken.
3. **Repeatability** — "return to the marked heading." Records error.

**Target behaviour.** None. Visual references only.

**Input.** Movement; a click confirms the end of each attempt.

**Metrics produced.** `maxSingleSwipeDeg` (at the test sensitivity, converted to physical cm),
`comfortableSwipeCm`, `liftCount180`, `time180`, `returnErrorDeg`.

**Scoring.** No dimension contribution. Produces `constraint.maxCm360` — see doc 13 §13.4.

**Invalid conditions.** `no_input`, `timeout` (15 s per attempt), plus universals.

**Practice.** 1 guided attempt, heavily instructed — this is the test users most often
misunderstand.

**Minimum sample.** 3 attempts per sub-task, once per session (sensitivity-independent, since
it measures physical reach; run at the bracket centre).

**Potential biases.**
- *Effort ceiling* — "as far as you comfortably can" is subjective. Mitigated by asking for
  *comfortable*, not maximum, and by taking the **median** of three attempts, and by treating
  the result as a soft bound with a documented margin rather than a hard cliff.
- *Grip change mid-attempt* — recorded via lift/pause detection in the movement stream.

**Performance considerations.** Negligible.

**Accessibility.** This is the test most directly affected by physical differences. Copy must be
neutral: it measures a *workspace*, not a capability. Users may enter a pad width instead of
performing the test, and that path must be equally prominent.

---

# POST-MVP TESTS (architected now, implemented later)

These are fully specified so the test-definition schema and the metric registry are designed to
accommodate them from Phase 1, without implementing them.

---

## 9.8 Wide Flick Test — `wide-flick`

**Purpose.** Large-angle acquisition, where physical travel limits and arm mechanics dominate.
Distinguishes a sensitivity that works for duels from one that works for repositioning.

**Structure.** As Flick, but distance classes are fixed near **45°, 90°, 135°, 180°**
(±5° jitter), balanced left/right. A reset target re-centres between trials.

**Metrics.** `targetAcquisitionTime`, `firstShotAccuracy`, `flickErrorNorm`, `overshootRate`,
`correctionCount`, `liftDetected` (whether the movement stream shows a lift/re-grip), plus a
per-angle-class breakdown.

**Scoring.** Feeds **Flick** and **Speed**; also feeds the physical-constraint model — a
sensitivity where 180° reliably requires a lift is penalised through `liftDetected`, which is a
measured fact, not an assumption.

**Invalid.** Universals plus `no_input`, `timeout` (6000 ms).

**Minimum sample.** 8 per candidate per round, balanced across the four angle classes.

**Biases.** Direction asymmetry is strong at large angles (turning across the body differs from
turning away). Left/right must be exactly balanced, not merely randomised.

**Notes.** Deferred from MVP because it is the most fatiguing test per trial and the MVP battery
already covers the dimensions needed to locate the peak.

---

## 9.9 Strafe Tracking Test — `strafe-tracking`

**Purpose.** Tracking against unpredictable direction reversals — closer to real duel behaviour
than smooth sinusoidal motion.

**Structure.** 5 s trials; the target moves horizontally at a randomised speed and reverses
direction at intervals drawn from a memoryless (exponential) distribution with a documented
mean, so reversal timing carries no learnable pattern. Direction changes use a bounded
acceleration so motion stays C⁰-continuous and physically plausible.

**Metrics.** `trackingAccuracy`, `trackingError`, `trackingStability`, `reversalRecoveryTime`
(time to re-acquire after a reversal), `correctionFrequency`.

**Scoring.** **Tracking**, **Control**.

**Biases.** Anticipation is impossible by construction (memoryless intervals) — that is the
point of using an exponential distribution rather than a uniform one.

**Minimum sample.** 5 per candidate per round.

---

## 9.10 Slide Tracking Test — `slide-tracking`

**Purpose.** High-speed lateral movement with acceleration and deceleration; tests whether the
sensitivity supports fast movement-heavy engagements without losing control.

**Structure.** 4 s trials; the target executes a smooth accelerate → sustain → decelerate
profile across a wide angular span, peak speed **120°/s – 220°/s** (`TUNABLE`), with a randomised
direction and profile shape.

**Metrics.** `trackingAccuracy`, `trackingError`, `peakSpeedTrackingError` (error during the
sustained-peak segment specifically), `accelerationLagMs`, `trackingStability`.

**Scoring.** **Tracking**, **Speed**.

**Biases.** At very high sensitivities this test flatters; at very low sensitivities it may be
physically impossible within pad space. `pathTruncated` is recorded when the required physical
travel exceeds the measured comfort constraint, and such trials are excluded from tracking
scoring while being retained as evidence for the constraint model — a deliberate, documented
interaction between two tests.

**Minimum sample.** 4 per candidate per round.

---

## 9.11 Speed Test — `speed`

**Purpose.** Rapid acquisition with generous targets — isolates pure speed with accuracy
demands minimised, as the counterweight to Precision.

**Structure.** As Flick but angular radius 3°–5°, distances 10°–35°, timeout 2500 ms, explicit
"go as fast as you can" instruction.

**Metrics.** `targetAcquisitionTime`, `timeToTarget`, `hitAccuracy`, `overshootRate`.

**Scoring.** **Speed** primarily.

**Biases.** Encourages reckless movement, which is intended; the pairing with Precision is what
makes the Speed/Precision trade-off measurable rather than conflated.

**Minimum sample.** 12 per candidate per round.

---

## 9.12 Recoil Control Simulation — `recoil`

**Purpose.** Measure compensation for a sustained, predictable-but-unmemorised aim disturbance.

**Structure.** The player holds fire on a static or slowly drifting target; the engine applies a
**generated recoil curve** to the camera. Trial duration 1.5–2.5 s.

**Recoil patterns are original and generated** (`SENS-BR` intent, doc 01 §1.7): a parametric
family defined by a vertical rise profile, a horizontal drift with a seeded sign-change
schedule, and per-shot jitter. **No proprietary weapon pattern from any game is reproduced,
sampled, or approximated.** Patterns are generated per trial from the session seed, with a
family label (e.g. `steep-vertical`, `late-horizontal`) so results are comparable across
candidates without being memorisable.

**Metrics.** `recoilDeviationVertical`, `recoilDeviationHorizontal`, `recoilCompensationGain`
(regression slope of the player's counter-movement against the applied recoil),
`recoilRecoveryTime`, `stabilityUnderRecoil`.

**Scoring.** **Control** primarily, **Consistency** secondarily.

**Invalid.** `no_input`, `button_held_ratio_low`, universals.

**Minimum sample.** 6 per candidate per round.

**Biases.** Players experienced with a specific game's real patterns may over- or under-
compensate against a generated pattern. This is why generated patterns are randomised per trial
and why this test is weighted for Control rather than treated as a skill benchmark.

**Legal note.** Reproducing a game's actual recoil pattern data would be both a copyright
question and a cheating-adjacent capability. SensLab does neither.

---

## 9.13 ADS Test — `ads`

**Purpose.** Measure aiming performance in a scoped/aimed state, where the effective FOV is
narrower and the effective sensitivity is therefore different.

**Structure.** As Flick and Micro, but the camera FOV is reduced to the scope's simulated FOV
and the count→degree factor is adjusted by the scope's sensitivity model. Trials alternate
between hipfire and ADS segments to also measure the **transition** cost.

**Metrics.** All Flick and Micro metrics, tagged with `scope_key`, plus `adsTransitionTime`
and `adsFirstShotAccuracy`.

**Scoring.** Produces a **separate candidate scoring track per scope**, which is why `scope_key`
exists on rounds from Phase 1 even though MVP only uses `hipfire`.

**Dependency.** Requires a verified scope model for a real game only when *converting* the
result; the test itself can run on SensLab's own simulated scope definitions.

**Minimum sample.** 10 per candidate per round per scope.

---

## 9.14 Scope Calibration — `scope-calibration`

**Purpose.** Determine the best per-scope sensitivity multiplier, rather than assuming a
matching rule.

**Structure.** For each supported magnification (hipfire, 1×, 2×, 3×, 4×, 6×, 8×), run a short
candidate search over the scope multiplier while holding the hipfire cm/360 fixed at the
already-recommended value. This is the same calibration engine operating on a different
parameter — a strong argument for keeping the engine parameter-agnostic (doc 13 §13.12).

**Metrics.** Flick + Micro metrics per scope.

**Scoring.** Per-scope optimum multiplier plus confidence.

**Exposure rule.** Only scopes that the selected game actually has are offered, driven by
`game_scopes` (doc 08 §8.9). SensLab never presents an 8× calibration for a game without one.

**Minimum sample.** 8 per candidate per scope; budget grows linearly with scope count, which is
why this is an opt-in Advanced feature rather than part of a standard session.

---

## 9.15 Test → dimension contribution matrix

Weights are illustrative of *structure*; the authoritative values are the versioned parameter
set in doc 14 §14.5.

| Test | Flick | Precision | Tracking | Speed | Control | Consistency |
|---|---|---|---|---|---|---|
| Reaction | — | — | — | — | — | — |
| Flick | ●●● | ●● | — | ●●● | ● | ●● |
| Micro Adjustment | ● | ●●● | — | — | ●●● | ●● |
| Tracking | — | ● | ●●● | — | ●● | ●● |
| Target Switching | ●● | ● | — | ●●● | ●● | ● |
| Precision | ● | ●●● | — | — | ●● | ●● |
| 360 Comfort | — | — | — | — | — | — |
| *Wide Flick* (post) | ●●● | ● | — | ●● | ● | ● |
| *Strafe Tracking* (post) | — | ● | ●●● | — | ●●● | ●● |
| *Slide Tracking* (post) | — | — | ●●● | ●● | ●● | ● |
| *Speed* (post) | ●● | — | — | ●●● | — | ● |
| *Recoil* (post) | — | ● | ● | — | ●●● | ●● |
| *ADS* (post) | ●● | ●● | — | ●● | ●● | ●● |

No dimension may depend on a single test, so that one noisy test cannot dominate it.

**One documented exception at MVP: Tracking.** The MVP battery contains exactly one
continuous-tracking test, so the Tracking dimension is single-sourced until Strafe Tracking and
Slide Tracking arrive in Phase 6. The exception is tolerable because a tracking trial is roughly
five seconds of continuously sampled error rather than one discrete observation — statistically
it is many samples, not one — but it is a real limitation and it is why the Tracking dimension
is the first thing Phase 6 improves.

*Corrected during Phase 1: this section previously asserted the two-test rule held for every
dimension, which contradicted the matrix above. The matrix was right.*

---

## 9.16 Trial budget analysis

The budget is the product's scarcest resource. Every added trial costs attention and raises
abandonment; every removed trial costs statistical power.

**Per-candidate-per-round trial counts (Standard):**

| Test | Trials | Est. seconds each | Est. total |
|---|---|---|---|
| Flick | 12 | 2.6 | 31 s |
| Micro | 12 | 2.4 | 29 s |
| Tracking | 5 | 6.0 | 30 s |
| Switching | 2 sequences | 11.0 | 22 s |
| Precision | 10 | 3.0 | 30 s |
| **Per candidate per round** | | | **~142 s** |

Standard session: 3 candidates × 3 rounds × ~142 s ≈ **21 min** of scored testing, plus
interstitials, plus one-off Reaction (~30 s), 360 Comfort (~90 s), practice (~90 s) and
onboarding.

| Mode | Candidates | Rounds | Tests | Scored time (est.) |
|---|---|---|---|---|
| Quick | 3 | 2 | Flick, Micro, Tracking | ~9 min |
| Standard | 3 | 3 | All five | ~21 min |
| Advanced | 3–4 | 4 | All five (+ post-MVP tests when available) | ~38–48 min |

`ASSUMPTION` — per-trial durations above are engineering estimates. `SENS-BR-024` requires the
UI to compute displayed durations from **measured** per-trial timing once real data exists; these
values seed the estimator and are replaced by observed medians after pilot testing.

**Statistical justification for the minimums.** With 12 flick trials per candidate per round and
3 rounds, each candidate region accumulates ≥ 36 flick trials. For a within-subject comparison
with a typical trial-level coefficient of variation around 0.25 for acquisition time, 36 paired
observations give roughly 80% power to detect a ~12% difference in the mean at α = 0.05 — which
is approximately the smallest sensitivity-induced difference worth acting on. This is the
reasoning behind the minimum, and it is the calculation to redo with real pilot variance
(`ASSUMPTION`, tracked as a Phase 11 task).
