# 01 — Product Vision

Related: [02-scope.md](02-scope.md) · [03-personas.md](03-personas.md) · [11-canonical-sensitivity-model.md](11-canonical-sensitivity-model.md) · [32-decision-log.md](32-decision-log.md)

---

## 1.1 What SensLab is

SensLab is a browser-based **mouse sensitivity calibration platform**. It measures how a
player actually aims at several different mouse sensitivities, identifies the physical
sensitivity range in which that specific player performs best, and translates that range
into concrete settings for the FPS games they play.

The one-sentence definition:

> SensLab finds the sensitivity your hands perform best with by measuring you, not by asking you.

The unit of truth is **physical**, not per-game: SensLab reasons in **cm/360** — the number of
centimetres of physical mouse travel required to rotate the in-game view a full 360°. Every
game-specific number is a *derived output*, produced by a versioned adapter at the very end of
the pipeline. See [11-canonical-sensitivity-model.md](11-canonical-sensitivity-model.md).

The pipeline, end to end:

```
Player
  -> Hardware Setup            (DPI is the only hard requirement)
  -> Environment Check         (pointer lock, raw input, frame stability)
  -> Practice                  (unscored; removes first-contact learning effects)
  -> Baseline                  (reaction floor + current-sens reference point)
  -> Adaptive Calibration      (blind, interleaved, multi-round candidate search)
       - Aim Tests             (flick, micro-adjust, tracking, switching, precision)
       - Performance Analysis  (normalise -> dimensions -> candidate score +/- error)
  -> Recommended cm/360        (+ high-performance range + confidence index)
  -> Game Conversion           (versioned adapters; verified games only)
  -> Validation                (blind A/B against the player's original sensitivity)
  -> Fine Tuning               (optional, blind, narrow)
  -> Saved Aim Profile         (guest: temporary; registered: durable + comparable)
```

---

## 1.2 The problem

A player's sensitivity is one of the highest-leverage settings in an FPS and one of the least
rationally chosen. In practice players pick a number by one of four bad methods:

1. **Inheritance** — they copy a professional player or a streamer.
2. **Inertia** — they have used the same number since a game they stopped playing years ago.
3. **Vibes** — they nudge it after a bad session and never measure the result.
4. **Conversion** — they take a number from one game and convert it into another, which
   preserves whatever mistake they started with.

None of these involve any measurement of the player. The result is that a large number of
players are playing at a sensitivity that is measurably wrong for their grip, their arm/wrist
balance, their desk space and their reflex profile — and they have no way of knowing it,
because the only feedback signal available is "I lost that fight", which is far too noisy to
learn from.

The specific failure is that **sensitivity is a personal physical parameter being chosen by
social imitation.**

---

## 1.3 Why sensitivity converters are insufficient

A converter answers: *"I use 2.0 in CS2. What is the equivalent in Apex?"*

That is a genuinely useful question and SensLab must answer it too — but it is a
**units problem**, not a **performance problem**. A converter:

- **Assumes the input is correct.** It faithfully propagates a bad sensitivity into a new game.
- **Has no opinion about the player.** Two players with identical hardware and completely
  different arm mechanics get identical output.
- **Cannot express uncertainty**, because it is doing arithmetic, not estimation.
- **Cannot express a range.** Real human performance has a plateau, not a point. A converter
  cannot tell you that 29.7–32.4 cm/360 is all equally good for you and that the exact number
  inside that band does not matter.
- **Never checks its own answer.** There is no feedback loop.

SensLab contains a converter as its *final stage* (the game adapter layer, doc 12) but the
converter is not the product. The product is everything upstream of it.

---

## 1.4 Why copying professional players is unreliable

Copying a pro's sensitivity transfers a number without transferring any of the things that
produced it. Specifically it ignores:

- **Arm mechanics and grip.** A fingertip-grip wrist aimer and a palm-grip arm aimer have
  different achievable angular precision and different comfortable travel distance. Their
  optimum sensitivities differ substantially, and they differ in opposite directions on
  different tests.
- **Desk and mousepad space.** A 45 cm/360 sensitivity requires the physical room to make a
  45 cm swipe without lifting. Many players do not have it. See the 360 Comfort Test (doc 09).
- **Role and playstyle.** A player whose value comes from holding long angles wants different
  trade-offs from one who plays close-range movement duels.
- **Motor idiosyncrasy.** Overshoot tendency, correction frequency and tracking smoothness vary
  between individuals in ways that are not predicted by skill level.
- **Selection bias.** Pros are not successful *because* of their sensitivity; they are
  successful players who happen to also have a sensitivity. Their number is a survivor, not the
  output of a controlled experiment.
- **Adaptation.** A pro has thousands of hours at their number. Any number, given enough hours,
  becomes "theirs". The observed comfort is largely a consequence of exposure, not of fit.

SensLab's position: a pro's sensitivity is a *plausible starting bracket* for a search, and
nothing more. It is never an answer.

---

## 1.5 How SensLab differs from an aim trainer

Aim trainers (Aim Lab, KovaaK's, and the browser trainers) are **training** products. Their
loop is: practice a scenario repeatedly, improve at that scenario, watch the score go up.

SensLab is a **measurement** product. Its loop is: run a controlled, blinded, counterbalanced
experiment on you, estimate a parameter, report it with an honest error bar, stop.

| | Aim trainer | SensLab |
|---|---|---|
| Goal | Improve the player over weeks | Estimate one parameter in one session |
| Sensitivity | Held fixed; picking it is the player's problem | **The independent variable** |
| Session length | Open-ended, habitual | Bounded by a designed trial budget |
| Score meaning | Progress signal | Nuisance variable to be controlled for |
| Learning effects | Desirable — that *is* the product | Contamination — modelled and regressed out (doc 13) |
| Randomisation | For variety | For **bias control** — blinded candidates, counterbalanced order |
| Output | A leaderboard number | A cm/360 estimate, a range, a confidence index, an explanation |

The most important difference is philosophical. An aim trainer wants your score to go up.
SensLab does not care whether your score is high; it cares whether the *difference between your
scores at different sensitivities* is real. That reframing changes every downstream design
decision — sample sizes, presentation order, blinding, and what counts as a valid trial.

SensLab is not a competitor to aim trainers and must never present itself as one. A reasonable
player uses SensLab once, acts on the result, and goes back to their trainer.

---

## 1.6 How SensLab differs from a questionnaire "sensitivity finder"

Several existing tools ask a handful of questions ("do you play aggressively?", "wrist or
arm?") and emit a number. These are horoscopes with a form UI. SensLab rejects this: self-report
is a legitimate *input* for constraining the search space (starting bracket, mousepad limits,
game choice) but is never permitted to determine the output. See
[07-business-rules.md](07-business-rules.md), rule `SENS-BR-002`.

---

## 1.7 What SensLab honestly cannot do

Stating this early is a product feature, not a disclaimer. Expanded in
[30-performance-strategy.md](30-performance-strategy.md) §30.8 and
[31-risk-register.md](31-risk-register.md).

- **SensLab is not the game engine.** It runs in a browser with a simulated first-person
  camera. Input path, frame pacing, FOV rendering and target contrast are similar in kind but
  not identical to CS2, Apex, PUBG or Delta Force.
- **SensLab cannot verify your DPI.** It can only cross-check it for internal consistency
  against your other answers and warn when something looks wrong (doc 11 §11.9).
- **SensLab measures short-term performance.** A sensitivity you have used for two years will
  usually test *better* than a genuinely superior new one, because you are practised at it.
  This familiarity bias is real, is unavoidable inside a single session, and is reported to the
  user rather than hidden (doc 17 §17.6).
- **SensLab cannot promise you will win more.** It can only tell you where, on the axis it
  measured, your measured performance peaked, and how confident that estimate is.

A product that overclaims here is worse than useless, because it converts an honest measurement
into a superstition. Every recommendation surface must carry its confidence and its caveats.

---

## 1.8 Target audience

**Primary (MVP):** PC FPS players on a desktop-class machine with a physical mouse, who play at
least one of the five launch titles, and who are dissatisfied with or uncertain about their
current sensitivity. Detailed in [03-personas.md](03-personas.md).

**Secondary (MVP, read-only):** the same players on mobile, reviewing a result they generated
earlier or one that was shared with them.

**Explicitly not the audience at MVP:** console/controller players, touch-only users seeking a
calibration, and players looking for a training regimen.

---

## 1.9 Core value proposition

**For the player:** *"Stop copying someone else's settings. In about twenty minutes, find out
where your aim actually peaks — with the data to back it up."*

**Why they trust it:** because SensLab shows its work. The signature result view is not a
number in a large font; it is the measured **response curve** — the player's own performance
plotted against sensitivity, with every tested candidate, the fitted peak, and the uncertainty
band. The number is a visible consequence of a visible curve. This is the single strongest
differentiator and it should be defended in every design review.

**Why they come back:** hardware changes, games change, hands change. A saved aim profile plus
history turns a one-off measurement into a tracked parameter.

---

## 1.10 MVP vision

A guest lands on SensLab, picks one of five games, enters a DPI, passes an environment check,
and completes a blinded adaptive calibration across five core aim tests in roughly twenty
minutes. They receive a recommended cm/360 with a high-performance range, a confidence index,
an aim profile with a derived explanation, a response curve showing the evidence, and
game-specific settings for every launch game whose adapter is verified. They can run a blind
validation against their original sensitivity and see an honest before/after. They can create
an account at any point and keep the result.

Everything in the MVP list in [02-scope.md](02-scope.md) and nothing else.

---

## 1.11 Long-term vision

SensLab becomes the place a serious FPS player's *physical aiming parameters* live.

- **Sensitivity drift monitoring** — periodic five-minute re-checks that detect when a player's
  optimum has moved (new mouse, new pad, injury, changed playstyle).
- **Multi-hardware profiles** — the same player's optimum on their main desktop, their laptop
  setup, and a LAN rig, each tracked separately.
- **Population reference data** — once enough consented sessions exist, absolute percentiles and
  *empirically calibrated* confidence replace the provisional priors (doc 14 §14.4, doc 15 §15.7).
  This is the main reason the scoring model is versioned from day one.
- **Optional AI coach** — a layer that *explains measured data* in plain language and never
  generates the recommendation itself (doc 32, ADR-014).
- **Ecosystem** — shareable profiles, mouse and mousepad databases, community benchmarks, and a
  desktop companion that can read real DPI and real in-game config files, closing the two
  largest accuracy gaps the browser cannot close on its own.

The architectural consequence of this vision, and the one thing Phase 1 must get right, is that
**the calibration engine must never learn about a specific game**, and **every derived number
must be reproducible from stored raw inputs plus a stored algorithm version**.
