# 25 — Wireframes

Related: [24-screen-inventory.md](24-screen-inventory.md) · [26-ui-ux-design-system.md](26-ui-ux-design-system.md) · [27-motion-and-interaction.md](27-motion-and-interaction.md)

Low-fidelity, structural. These fix **hierarchy, order and content**, not pixels. Layout at
1440 px unless noted; responsive behaviour in doc 28.

> **All values shown in these wireframes are illustrative placeholders.** They demonstrate
> layout and information hierarchy only. In particular, the CS2 tile shown as `verified` and the
> CS2 sensitivity value in §25.10 are mock-ups of a *future* state: at the end of Phase 0 every
> adapter is `unverified` (doc 36), and no game sensitivity value may be rendered until its
> entry is verified (`SENS-BR-013`).

---

## 25.1 SCR-001 — Landing

### Act 0 — Hero (100 vh)

```
+--------------------------------------------------------------------------+
| SENSLAB                            HOW IT WORKS        SIGN IN           |
+--------------------------------------------------------------------------+
|                                                                          |
|      . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .         |
|      .  interactive field: fine grid + drifting reticle marks   .        |
|      .  reacts subtly to pointer (parallax <= 8px, disabled     .        |
|      .  under reduced-motion and on touch)                      .        |
|                                                                          |
|                    FIND YOUR                                             |
|                    TRUE SENS.                                            |
|                                                                          |
|            Stop copying someone else's settings.                         |
|            Find the sensitivity your hands actually perform best with.   |
|                                                                          |
|            [  START CALIBRATION  ]      HOW IT WORKS ->                  |
|                                                                          |
|            ~20 min  ·  no account needed  ·  mouse required              |
|                                                                          |
|                              v  scroll                                   |
+--------------------------------------------------------------------------+
```

Three qualifiers under the CTA are load-bearing: they pre-empt the three most common bounce
reasons. The duration is a computed default for Standard mode, not a hardcoded string
(`SENS-BR-024`).

### Acts 1–5 — the scroll narrative

One persistent centred reticle element morphs through five acts as scroll progress drives it.
**Not** five stacked cards.

```
   scroll progress -->
   0%          20%          40%          60%          80%         100%
   |            |            |            |            |            |
 REACT   -->  FLICK   -->  TRACK   -->  CONTROL --> OPTIMIZE  --> CTA

+--------------------------------------------------------------------------+
|  01 / REACT                                                              |
|                                                                          |
|   +---------------------------+     Everything starts with a baseline.   |
|   |                           |                                          |
|   |   live canvas demo:       |     We measure your reaction floor so    |
|   |   a target appears,       |     we can separate "slow to start"      |
|   |   a reticle snaps to it   |     from "slow to arrive".               |
|   |                           |                                          |
|   +---------------------------+     Reaction never decides your          |
|                                     sensitivity.                         |
+--------------------------------------------------------------------------+
```

Acts alternate demo side (left/right) to create rhythm without becoming a card grid. Each demo is
a real engine instance in a reduced, decorative mode — the same renderer, so the landing page
looks like the product rather than an illustration of it. Demos mount on intersection and unmount
on exit (`SENS-NFR-010`).

### Act 6 — Close

```
+--------------------------------------------------------------------------+
|                                                                          |
|                    YOUR AIM HAS A PEAK.                                  |
|                    LET'S FIND IT.                                        |
|                                                                          |
|                    [  START CALIBRATION  ]                               |
|                                                                          |
|          SensLab runs in your browser. It is not the game engine.        |
|          Results are estimates with a stated confidence.                 |
+--------------------------------------------------------------------------+
```

The caveat sits on the landing page, before the user invests twenty minutes (`SENS-BR-022`).

---

## 25.2 SCR-010 — Game Selection

```
+--------------------------------------------------------------------------+
| SENSLAB                                                     EXIT  x      |
+--------------------------------------------------------------------------+
|  STEP 1 OF 3                                                             |
|                                                                          |
|  WHICH GAME ARE THESE SETTINGS FOR?                                      |
|  The test itself is the same for every game. This only decides which     |
|  numbers we hand you at the end.                                         |
|                                                                          |
|  +-------------+ +-------------+ +-------------+ +-------------+         |
|  |             | |             | |             | |             |        |
|  |    CS2      | |    APEX     | |    PUBG     | | DELTA FORCE |        |
|  |             | |   LEGENDS   | |             | |   GLOBAL    |        |
|  | o verified  | | ! unverified| | ! unverified| | ! unverified|        |
|  +-------------+ +-------------+ +-------------+ +-------------+         |
|                                                                          |
|  +-------------+ +-----------------------------+                        |
|  |  三角洲行动  | |  I play several / not listed |                       |
|  | ! unverified| |  You'll get cm/360 only      |                       |
|  +-------------+ +-----------------------------+                        |
|                                                                          |
|  ! We don't yet have a verified sensitivity model for this game.         |
|    You'll still get your full result in cm/360 — we just won't guess     |
|    at the in-game number.                            [ learn more ]      |
|                                                                          |
|                                          [ CONTINUE -> ]                 |
+--------------------------------------------------------------------------+
```

The unverified explanation appears **on selection**, not on hover, so the user is never surprised
at the end (doc 04 §4.4.11).

---

## 25.3 SCR-011 — Hardware Setup

```
+--------------------------------------------------------------------------+
|  STEP 2 OF 3                                                             |
|                                                                          |
|  WHAT ARE YOU PLAYING ON?                                                |
|                                                                          |
|  MOUSE DPI                                                     required  |
|  +---------------------+                                                 |
|  |  800                |   (?) what is DPI       I don't know my DPI ->  |
|  +---------------------+                                                 |
|                                                                          |
|  --------------------------------------------------------------------    |
|  [ v ] Add setup details (optional — none of this is required)           |
|  --------------------------------------------------------------------    |
|                                                                          |
|      when expanded:                                                      |
|      CURRENT GAME [ CS2 v ]   CURRENT SENS [ 2.00 ]                      |
|         -> "That's about 27.4 cm/360. We'll search around it."           |
|      MOUSEPAD  W [ 450 ] mm   H [ 400 ] mm                               |
|      MONITOR   [ 2560 ] x [ 1440 ]   REFRESH [ 165 ] Hz                  |
|      POLLING [ 1000 v ] Hz    GRIP [ claw v ]    OS [ Windows v ]        |
|      WINDOWS POINTER SPEED [ 6/11 v ]   ENHANCE POINTER PRECISION [ off ]|
|                                                                          |
|  [ registered only ]  Save as hardware profile  [ Main Setup        ]    |
|                                                                          |
|                                          [ CONTINUE -> ]                 |
+--------------------------------------------------------------------------+
```

The live "that's about 27.4 cm/360" feedback after entering a current sensitivity is a small
detail that does a lot: it teaches the canonical unit at the exact moment it becomes meaningful.

**"I don't know my DPI" panel:**

```
+--------------------------------------------------------------------------+
|  FINDING YOUR DPI                                                x       |
|                                                                          |
|  1  LOOK IT UP        Most gaming mice show it in their software.        |
|                       [ common defaults by brand v ]                     |
|                                                                          |
|  2  MEASURE IT        Takes 30 seconds and a ruler. We count the raw     |
|                       movement while you drag a known distance.          |
|                       [ MEASURE MY DPI ]         (most accurate here)    |
|                                                                          |
|  3  ASSUME 800        The most common setting. Your cm/360 result stays  |
|                       correct either way — only the in-game number       |
|                       depends on this.        [ USE 800 ]                |
+--------------------------------------------------------------------------+
```

---

## 25.4 SCR-012 — Environment Check

```
+--------------------------------------------------------------------------+
|  STEP 3 OF 3                                                             |
|                                                                          |
|  CHECKING YOUR SETUP                                                     |
|                                                                          |
|   [ok]  Pointer lock                     supported                       |
|   [ok]  Raw mouse input                  enabled                         |
|   [..]  Display timing                   measuring... 2.1s               |
|   [--]  DPI consistency                  waiting                         |
|                                                                          |
|         +--------------------------------------------------+            |
|         |  ..||||...|||.||||..||||||.....||||||.||||.....   |            |
|         |  frame interval trace, 3 seconds                  |            |
|         +--------------------------------------------------+            |
|                                                                          |
|         165 Hz detected  ·  99.2% of frames on time                      |
|                                                                          |
|                                          [ CONTINUE -> ]                 |
+--------------------------------------------------------------------------+
```

Degraded and blocked variants replace the summary line with a specific, actionable explanation
and, when blocked, remove the continue control entirely rather than disabling it (FR-030).

---

## 25.5 SCR-013 — Test Introduction

```
+--------------------------------------------------------------------------+
|                                                                          |
|                    BEFORE YOU START                                      |
|                                                                          |
|   WHAT HAPPENS          You'll aim at targets across five short tests.   |
|                         We change your sensitivity between rounds.       |
|                                                                          |
|   WE HIDE WHICH IS      You won't be told which sensitivity you're on,   |
|   WHICH                 and you won't see a score. That's deliberate —   |
|                         it's what makes the result trustworthy.          |
|                                                                          |
|   HOW LONG              18 – 24 minutes        [ computed, not fixed ]   |
|                                                                          |
|   CONTROLS              MOVE to aim · LEFT CLICK to shoot · ESC to pause |
|                                                                          |
|   COMFORT               This simulates a first-person camera. If motion  |
|                         makes you unwell, take breaks or stop.           |
|                                                                          |
|   MODE   [ QUICK ~9 min ]  [ STANDARD ~21 min ]*  [ ADVANCED ~40 min ]   |
|                                                                          |
|                    [  START PRACTICE  ]                                  |
+--------------------------------------------------------------------------+
```

---

## 25.6 SCR-017..021 — A scored test (the canonical lab screen)

```
+--------------------------------------------------------------------------+
|                                                                          |
|  ROUND 03                                                     14 / 20    |
|                                                                          |
|                                                                          |
|                                                                          |
|                                  o                                       |
|                                                                          |
|                                                                          |
|                                  +                                       |
|                                                                          |
|                                                                          |
|                                                                          |
|                                                                          |
|                                                                          |
|  ESC — PAUSE                                              FLICK          |
+--------------------------------------------------------------------------+
```

Everything visible is: round number, trial progress, the target, the crosshair, the pause hint,
and the test name. **No score. No accuracy. No candidate. No timer.** Drawn on canvas, not DOM
(doc 19 §19.11).

**Pause overlay (SCR-022):**

```
+--------------------------------------------------------------------------+
|                        [ dimmed, blurred canvas ]                        |
|                                                                          |
|                              PAUSED                                      |
|                                                                          |
|                  Round 3 of 3 · Flick · trial 14 of 20                   |
|                                                                          |
|                     [  RESUME  ]                                         |
|                       RESTART THIS ROUND                                 |
|                       ABORT CALIBRATION                                  |
|                                                                          |
|             Your progress is saved. Aborting discards this session.      |
+--------------------------------------------------------------------------+
```

---

## 25.7 SCR-030 — Analysis

```
+--------------------------------------------------------------------------+
|                                                                          |
|                     ANALYZING YOUR AIM                                   |
|                                                                          |
|         normalising 1,847 trials                            [done]       |
|         separating warm-up and fatigue                      [done]       |
|         comparing sensitivities                             [....]       |
|         fitting your response curve                                      |
|         checking confidence                                              |
|                                                                          |
|              ...|.......|.....|.....                                     |
|              a sparse trace of real measured values animating in         |
|                                                                          |
+--------------------------------------------------------------------------+
```

Stages are real work, with a 1.2 s minimum hold for legibility (`SENS-UX-021`). Trial counts are
the actual counts.

---

## 25.8 SCR-031 — Results (verdict `peak_found`)

```
+--------------------------------------------------------------------------+
| SENSLAB                                     HISTORY   ACCOUNT            |
+--------------------------------------------------------------------------+
|                                                                          |
|   CALIBRATION COMPLETE                                                   |
|                                                                          |
|   YOUR TRUE SENS                                                         |
|                                                                          |
|          31.2                                                            |
|          CM / 360°                                = 9,827 counts/360     |
|                                                                          |
|   HIGH-PERFORMANCE RANGE      29.7 — 32.4 cm/360                         |
|   COMFORT RANGE               27.5 — 35.0 cm/360   anything here is fine |
|   CONFIDENCE                  79 / 100        [ what does this mean? ]   |
|   AIM PROFILE                 BALANCED PRECISION                         |
|                                                                          |
|   You were at 27.4. Your measured peak is about 14% slower than that.    |
|                                                                          |
+--------------------------------------------------------------------------+
|   YOUR RESPONSE CURVE                                    [ 25.9 ]        |
|                                                                          |
|   score                                                                  |
|     ^                        ___----____                                 |
|     |                  __---/    |     \---__                            |
|     |            __---/          |          \---__                       |
|     |      ---/       o    o     |    o        o  \---                   |
|     |   o        (shaded credible band around the fit)                   |
|     +----|--------|--------|-----|-----|--------|--------|--> cm/360     |
|         20       25       30    31.2  35       40       50               |
|                             ^you were here                               |
|                                                                          |
|   Each dot is one sensitivity you tested, with its error bar. The curve  |
|   is fitted to your results. The band is how sure we are about the peak. |
+--------------------------------------------------------------------------+
|   AIM DNA                    |   BREAKDOWN                               |
|                              |                                           |
|      (polar specimen plot,   |   STRONGEST                               |
|       6 radial bands:        |     Precision           87                |
|       Flick / Precision /    |     Control             84                |
|       Tracking / Speed /     |                                           |
|       Control / Consistency; |   IMPROVEMENT AREA                        |
|       radius = score,        |     Long-flick precision 71               |
|       band width =           |     Your flicks past 28° landed further   |
|       consistency)           |     from centre and needed 1.8 corrections|
|                              |     on average, versus 0.9 on short ones. |
|                              |                                           |
|      scores marked           |   OVERALL  82   (provisional scale)       |
|      PROVISIONAL             |                                           |
+--------------------------------------------------------------------------+
|   [  SEE YOUR GAME SETTINGS  ->  ]     [ TEST YOUR RECOMMENDED SENS ]    |
+--------------------------------------------------------------------------+
|   SensLab runs in a browser and is not the game engine. This is an       |
|   estimate with a stated confidence.                                     |
|   scoring_model_v1 · calibration_model_v1 · confidence_model_v1          |
+--------------------------------------------------------------------------+
```

**`indistinguishable` variant** — the hero is restructured, not merely re-worded:

```
|   NO SINGLE SENSITIVITY WON                                              |
|                                                                          |
|          27.5 — 35.0                                                     |
|          CM / 360°   your comfort range                                  |
|                                                                          |
|   CONFIDENCE  34 / 100                                                   |
|                                                                          |
|   Across everything we measured, no sensitivity in this range clearly    |
|   outperformed the others for you. Your trial-to-trial variance was      |
|   larger than the difference between sensitivities — which means your    |
|   sensitivity probably isn't what's limiting you right now.              |
|                                                                          |
|   [ flat response curve rendered exactly as above — the evidence ]       |
```

---

## 25.9 The two signature visualisations

### Response curve — the evidence chart

The most important pixel-work in the product. Requirements:

- X axis: cm/360, **log-scaled** (the search space is logarithmic; a linear axis would distort
  the curve's symmetry and misrepresent the fit).
- Y axis: relative performance, deliberately **unlabelled numerically** — the units are
  standardised score and a number there would invite false interpretation. Labelled "worse ←→
  better".
- Each candidate: a dot with a vertical error bar (±1 SE), sized by sample count, with the
  anchor candidate marked distinctly.
- Fitted curve with the bootstrap credible band as a soft fill.
- The peak marked with a vertical line and the value.
- The comfort range as a horizontal bracket under the axis.
- The user's current sensitivity marked, if known — the single detail that makes the chart
  personal.
- The physical constraint, if binding, as a shaded forbidden region.
- Hover/focus on a dot reveals: cm/360, trial count, round, and the blind label it was shown as.

**Why this chart and not a bar chart of candidates:** a bar chart implies "the winner", which
invites over-interpretation of a small difference. A curve with a band shows the *shape* of the
answer, including when the shape is flat — which is exactly the honesty the product needs.

### Aim DNA — the profile shape

```
                 FLICK
                   |
      CONSISTENCY  |  PRECISION
              \    |    /
               \   |   /
                \  |  /
     CONTROL ----- + ----- TRACKING
                  /|\
                 / | \
                   |
                 SPEED
```

Not a filled radar polygon. Each of the six axes carries a **band of fine tick marks**:

- **Radius of the band's centre** = the dimension score.
- **Width of the band** = the dimension's uncertainty / the player's consistency in it — so a
  player with erratic tracking gets a visibly *fuzzy* tracking axis.
- **Tick density** = sample size.

This encodes three quantities per axis, where a radar chart encodes one, and it makes uncertainty
a visual property rather than a footnote. It renders in canvas, animates once on reveal, and is
static under `prefers-reduced-motion`.

---

## 25.10 SCR-032 — Game Settings

```
+--------------------------------------------------------------------------+
|   YOUR SETTINGS                                                          |
|                                                                          |
|   CONVERT TO:  [ CS2 ]*  [ APEX ]  [ PUBG ]  [ DELTA FORCE ]  [ 三角洲 ] |
|                                                                          |
|   +------------------------------------------------------------------+   |
|   |  COUNTER-STRIKE 2                          verified · build XXX  |   |
|   |                                                                  |   |
|   |  DPI                    800                              [copy]  |   |
|   |  Sensitivity            1.34                             [copy]  |   |
|   |  Zoom Sensitivity       [ per scope, below ]                     |   |
|   |                                                                  |   |
|   |  Achieved: 31.2 cm/360   (ideal 31.24 — 0.1% off due to the      |   |
|   |  game's 2-decimal slider)                                        |   |
|   |                                                                  |   |
|   |  [ COPY ALL ]                                                    |   |
|   +------------------------------------------------------------------+   |
|                                                                          |
|   MATCHING METHOD FOR SCOPED AIM                                         |
|   ( ) 360 distance — same physical turn distance when scoped             |
|   (o) Monitor distance 50% — matches feel halfway across the screen      |
|   ( ) Focal length — matches feel at the exact centre                    |
|                                          [ what's the difference? ]      |
+--------------------------------------------------------------------------+
```

**Unverified variant:**

```
|   +------------------------------------------------------------------+   |
|   |  三角洲行动                                       not yet verified |   |
|   |                                                                  |   |
|   |  We don't have a verified sensitivity model for this game, so    |   |
|   |  we won't guess at a number.                                     |   |
|   |                                                                  |   |
|   |  What you can use instead:                                       |   |
|   |     Target             31.2 cm/360                       [copy]  |   |
|   |     At 800 DPI         9,827 counts per 360°             [copy]  |   |
|   |                                                                  |   |
|   |  [ NOTIFY ME WHEN THIS GAME IS VERIFIED ]                        |   |
|   +------------------------------------------------------------------+   |
```

No number field is rendered. The empty state is useful, not apologetic.

---

## 25.11 SCR-033 — Validation result

```
+--------------------------------------------------------------------------+
|   VALIDATION                                                             |
|                                                                          |
|   YOUR ORIGINAL 27.4        vs        RECOMMENDED 31.2                   |
|                                                                          |
|   RESULT:  RECOMMENDED PERFORMED BETTER                                  |
|                                                                          |
|   ACCURACY             +8.7%      [ +3.1 , +14.2 ]      measurable       |
|   TARGET ACQUISITION   -43 ms     [ -71  , -16   ]      measurable       |
|   OVERSHOOT            -14%       [ -24  , -4    ]      measurable       |
|   TRACKING             +5.3%      [ -0.8 , +11.1 ]      not measurable   |
|   CONSISTENCY          +6.0%      [ +1.2 , +10.8 ]      measurable       |
|                                                                          |
|   Confidence updated: 79 -> 85                                           |
|                                                                          |
|   Your recommendation is 14% slower than what you're used to. Expect     |
|   it to feel wrong for a few days. Re-check in a week.                   |
|                                                                          |
|   [ ACCEPT 31.2 ]   [ FINE-TUNE FURTHER ]   [ KEEP MY ORIGINAL ]         |
+--------------------------------------------------------------------------+
```

Every row carries its interval, and the non-significant row sits in the same list at the same
weight (`SENS-BR-016`, doc 17 §17.4).

---

## 25.12 SCR-041 — History

```
+--------------------------------------------------------------------------+
|   HISTORY                            PROFILE [ Main Setup v ]            |
|                                                                          |
|   +------------------------------------------------------------------+   |
|   | AUG 19    CS2    800 DPI    31.2 cm/360   82   79%   BAL.PRECISION|   |
|   |           standard · validated · improved              [ compare ]|   |
|   +------------------------------------------------------------------+   |
|   | AUG 01    CS2    800 DPI    34.1 cm/360   78   64%   PRECISION    |   |
|   |           standard                                     [ compare ]|   |
|   +------------------------------------------------------------------+   |
|   | JUL 12    APEX   1600 DPI   30.8 cm/360   80   71%   BALANCED     |   |
|   |           quick · different hardware profile           [ compare ]|   |
|   +------------------------------------------------------------------+   |
|                                                                          |
|   [ RE-CALIBRATE ]                                                       |
+--------------------------------------------------------------------------+
```

Sessions from a different hardware profile are visually distinguished, because comparing them is
flagged (`SENS-BR-019`).

---

## 25.13 SCR-050 — Desktop required

```
+--------------------------------------------------------------------------+
|                                                                          |
|                    CALIBRATION NEEDS A MOUSE                             |
|                                                                          |
|   SensLab measures physical mouse movement. A touchscreen can't produce  |
|   the measurement, and pretending otherwise would give you a confident   |
|   wrong answer.                                                          |
|                                                                          |
|   [ SEND THIS TO MY DESKTOP ]      [ QR ]                                |
|                                                                          |
|   Meanwhile you can:                                                     |
|     -> See a sample result                                               |
|     -> Read how it works                                                 |
|     -> View your history                                                 |
+--------------------------------------------------------------------------+
```

---

## 25.14 Layout system

| Region | Rule |
|---|---|
| Max content width | 1200 px for reading surfaces, 1440 px for the results page |
| Grid | 12 columns, 24 px gutters desktop; 8 px base spacing scale |
| Hero blocks | Full-bleed background, constrained content |
| Lab | 100 vw × 100 vh canvas; HUD drawn in canvas with a 48 px safe inset |
| Vertical rhythm | Section spacing 96 / 64 / 40 / 24 px by level |
| Sticky | Only the results page's output-game switcher becomes sticky on scroll; nothing else |
