# 19 — Test Engine Architecture

Related: [18-system-architecture.md](18-system-architecture.md) · [09-test-catalogue.md](09-test-catalogue.md) · [30-performance-strategy.md](30-performance-strategy.md) · [10-measurement-methodology.md](10-measurement-methodology.md)

The test engine is the measuring instrument. Everything else in SensLab is a user interface
around it. It is designed as a standalone, framework-free TypeScript module that happens to be
mounted by React.

---

## 19.1 Design principles

1. **React does not participate in measurement.** The engine owns a canvas and a rAF loop. React
   mounts it, hands it a plan, and receives coarse lifecycle events (round complete, paused,
   finished). Nothing else crosses the boundary during a trial (`SENS-NFR-004`).
2. **No allocation in the hot path.** All buffers are pre-allocated typed arrays sized from the
   plan (`SENS-NFR-003`).
3. **Time is measured, never assumed.** Every timestamp comes from `performance.now()`; frame
   deltas are measured, not derived from an assumed refresh rate (`SENS-NFR-006`).
4. **Target motion is analytic.** Position is a closed-form function of *t*, so a dropped frame
   cannot cause drift and any *t* can be evaluated exactly — including the instant of a click.
5. **Everything is seeded.** One session seed drives every random draw (`SENS-BR-031`).
6. **Input is never smoothed, filtered, or interpolated.** Raw counts in, angles out.
7. **Tests are data.** Adding a test means adding a definition, not editing the engine.

---

## 19.2 Modules

```
test-engine/
  engine.ts               orchestration, the rAF loop, module wiring
  session-controller.ts   stage sequencing, candidate switching, pause/resume/abort
  trial-manager.ts        trial lifecycle, validity classification, replacement
  input/
    pointer-lock.ts       lock acquisition, unadjustedMovement, loss detection
    input-manager.ts      coalesced-event accumulation, count buffer
  timing/
    clock.ts              performance.now wrapper, frame delta stats
    frame-monitor.ts      budget tracking, hitch detection, degradation flags
  render/
    camera.ts             yaw/pitch state, FOV, projection
    renderer.ts           canvas 2D draw, DPR handling, restricted effect set
    hud.ts                round/progress/pause only
  targets/
    target-manager.ts     spawn, lifetime, hit test at exact timestamps
    motion.ts             analytic motion functions
    placement.ts          seeded angular placement with constraint checks
  telemetry/
    ring-buffer.ts        pre-allocated typed-array buffers
    trial-recorder.ts     per-trial capture
    metric-collector.ts   post-trial derivation (doc 10)
  quality/
    quality-monitor.ts    frame quality, lock stability, focus, resize, velocity sanity
  definitions/
    flick.ts micro.ts tracking.ts switching.ts precision.ts
    reaction.ts comfort360.ts
    types.ts              the TestDefinition contract
  rng/
    sfc32.ts              seeded PRNG
  mount.tsx               the ONLY React-aware file
```

---

## 19.3 Lifecycle

```
                    +----------+
                    |  IDLE    |
                    +----+-----+
                         | init(plan)
                    +----v-----+
                    | READY    |   assets loaded, canvas sized, buffers allocated
                    +----+-----+
                         | requestLock()  (user gesture)
                    +----v-----+
             +----->| LOCKED   |
             |      +----+-----+
             |           | startStage()
             |      +----v-----+     ESC / lock lost / blur
             |      | RUNNING  +-------------------------+
             |      +----+-----+                         |
             |           | stage complete            +---v------+
             |           |                           | PAUSED   |
             |           |                           +---+------+
             |           |                               | resume -> countdown
             +-----------+-------------------------------+
                         |
                    +----v---------+
                    | ROUND_DONE   |  emit aggregates -> React -> network
                    +----+---------+
                         | next stage / next round
                    +----v-----+          +-----------+
                    | FINISHED |          | ABORTED   |
                    +----------+          +-----------+
```

**Invariants:**
- The active sensitivity changes **only** on a `ROUND_DONE → RUNNING` transition, never inside
  a trial (`SENS-NFR-008`).
- Entering `PAUSED` always closes the current trial as `invalid` with the causing reason.
- Resuming always requires re-acquiring pointer lock and always plays a 3-2-1 countdown, so the
  first trial after a pause is not measured against a cold start.
- `ABORTED` emits everything collected so far, marked as such, and guarantees no recommendation.

---

## 19.4 Input pipeline

```
pointermove / mousemove (pointer-locked)
  -> event.getCoalescedEvents()          all sub-frame samples, nothing lost
     -> for each sample:
          dx, dy  (raw counts when unadjustedMovement granted)
          accumulate into countBuffer
          integrate camera immediately     <- synchronous, same task
          record sample (t, yaw, pitch)  into ring buffer
```

**Pointer lock request:**

```
element.requestPointerLock({ unadjustedMovement: true })
   on rejection -> retry without the option
   record which path succeeded on the session environment
```

`REQUIRES_EXTERNAL_VERIFICATION` (**EV-010**) — the browser/OS matrix for `unadjustedMovement`,
including whether a rejection surfaces as a promise rejection or a silent downgrade, must be
confirmed empirically. The engine must detect the *effective* state, not merely the requested
one; where the API does not report it, a movement-scale probe during the environment check is
the fallback detection method.

**Why integrate on the event rather than on the frame:** integrating per frame would quantise
input to the frame rate and discard the sub-frame ordering that high-polling-rate mice provide.
Integrating per sample means an 8000 Hz mouse contributes 8000 integration steps per second while
the renderer still runs at display rate — which is exactly how a game behaves and is required by
`SENS-NFR-001`.

**Count-to-angle:**

```
degPerCount = 360 / countsPer360        // from the active candidate
yaw   += dx * degPerCount
pitch  = clamp(pitch - dy * degPerCount, -89, +89)
```

No acceleration, no smoothing, no dead zone, ever. The vertical clamp is the only non-linearity
and it matches standard FPS behaviour.

---

## 19.5 Camera and projection

- State: `{ yaw, pitch }` in degrees, `double`.
- Projection: standard perspective. Horizontal half-FOV `h` from the session config;
  `tan(v) = tan(h)/AR` (doc 11 §11.5).
- Screen position of a target at `(targetYaw, targetPitch)`: transform into camera space, reject
  if behind the camera, divide by depth, scale by `halfWidth / tan(h)`.
- Device pixel ratio handled by sizing the backing store to `cssSize × dpr` and scaling the
  context once. **DPR is captured at session start and a change mid-session flags the session** —
  moving a window between displays changes the angular-to-pixel mapping.
- Canvas size is fixed for the session's duration; a resize pauses the session and warns.

---

## 19.6 Targets and motion

**Placement.** Seeded, in angular space, with constraints: minimum separation from the crosshair,
minimum separation from other targets, and a pitch limit (±40°) so targets never approach the
pole where yaw sensitivity would feel distorted.

**Analytic motion.** Every moving target's position is `f(t)`:

```
horizontal:    yaw   = y0 + A·sin(2π·t/T + φ)
vertical:      pitch = p0 + A·sin(2π·t/T + φ)
diagonal:      both, with independent phase
circular:      yaw = y0 + A·cos(ωt+φ), pitch = p0 + A·sin(ωt+φ)
random-smooth: Σ_{i=1..3} A_i·sin(ω_i·t + φ_i), with incommensurate ω_i
strafe:        piecewise, direction reversals at seeded exponential intervals,
               each reversal smoothed by a bounded-acceleration ramp
slide:         accelerate / sustain / decelerate profile, C1-continuous
```

Amplitudes, periods and phases are drawn from the seed. Because position is closed-form:

- A dropped frame causes no drift.
- Hit tests evaluate the target at the **click timestamp**, not the last drawn frame.
- The engine harness can step time arbitrarily and reproduce positions exactly.

**Hit test.** At the click timestamp `t_click`: compute target position at `t_click`, compute
angular distance to the crosshair at `t_click` (the crosshair is also known exactly, since the
last input sample is timestamped), hit if `ε ≤ r`. This makes hit detection independent of frame
rate — a player on 60 Hz and a player on 240 Hz get the same hit decision for the same physical
input.

---

## 19.7 Telemetry buffers

Pre-allocated per trial from the plan's worst-case trial duration:

```
sampleT      Float64Array   timestamps
sampleYaw    Float64Array
samplePitch  Float64Array
sampleKind   Uint8Array     0 = frame, 1 = input
eventT       Float64Array   button events
eventKind    Uint8Array
```

- Capacity is sized for the trial's timeout at the maximum expected polling rate, with a
  documented headroom factor. Overflow drops the **oldest frame samples** (never input samples,
  never button events) and sets a `buffer_overflow` quality flag on the trial.
- Buffers are reused between trials. Zero allocation after warm-up.
- Nothing is copied out during the trial. Derivation runs in the inter-trial interval.

**Volume.** At 1000 Hz polling and 144 Hz rendering, a 2.5 s flick trial produces roughly 2,900
samples. A Standard session's ~450 trials produce on the order of 1.5 million samples — which is
exactly why none of it is transmitted (doc 22).

---

## 19.8 Randomness

`sfc32` seeded from the session seed, with a **separate stream per purpose**:

```
streams: candidate-order, test-order, target-placement, target-motion,
         timing-jitter, recoil-pattern, bootstrap
```

Separate streams mean that changing the number of trials in one test does not shift the target
positions of another — essential for reproducible fixtures and for the paired-stimulus design
(doc 13 §13.6), where candidate *i*'s trial *k* must draw the same placement as candidate *j*'s
trial *k*.

Stream derivation: `streamSeed = hash(sessionSeed, streamName, roundIndex, trialIndex)`.

---

## 19.9 Test definitions

A test is data plus a small number of pure hooks:

```
TestDefinition
  key, version, category
  displayName, instructions           (localised keys)
  trialCount(mode)                    -> number
  minValidTrials(mode)                -> number
  timeoutMs, interTrialIntervalMs
  spawn(rng, trialIndex, ctx)         -> TargetSpec[]        pure, seeded
  motion                              -> MotionSpec | null   analytic
  endCondition                        -> "first_hit" | "single_shot" | "duration" | "kill_count"
  shootingModel                       -> "click" | "hold" | "none"
  validity: {
    reasons: InvalidReason[]
    check(trialRecord) -> validity
  }
  metrics: MetricKey[]                which derivations to run
  practice: { trialCount }
  render: { targetStyle, distanceCue, showReticleDot }
```

**No lifecycle logic lives in a definition.** Spawning, timing, validity checking, buffering and
metric derivation are all engine responsibilities driven by these declarations. FR-058's
acceptance test proves it: a synthetic definition runs end to end without any engine change.

---

## 19.10 Quality monitoring

`quality-monitor.ts` observes and classifies:

| Signal | Source | Consequence |
|---|---|---|
| Frame interval | `clock` | > 1.25× budget = late frame; > 100 ms inside a measured window = `frame_hitch` → invalid trial |
| Late-frame ratio per trial | derived | > 8% → `degraded` |
| Late-frame ratio per round | derived | > 20% of trials degraded → round flagged, re-queued once |
| Sustained session degradation | derived | quality warning screen (doc 04 §4.4.6) |
| Pointer lock loss | `pointerlockchange` | trial invalid, session pause, counter |
| Document hidden / window blur | `visibilitychange`, `blur` | trial invalid, session pause |
| Canvas resize / DPR change | `ResizeObserver`, media query | session pause + flag |
| Implied hand velocity | input stream | > threshold → `impossible_velocity`, invalid (doc 23 §23.10) |
| Buffer overflow | ring buffer | trial quality flag |

The monitor never modifies measurements — it only classifies. Separating classification from
measurement is what keeps `SENS-BR-009` enforceable.

---

## 19.11 The React boundary

`mount.tsx` is the only React-aware file:

```
props in:   plan, callbacks
callbacks:  onStageChange, onRoundComplete(aggregate), onPaused(reason),
            onQualityWarning(state), onFinished(summary), onAborted
```

- Engine → React communication happens at **stage boundaries only**. There is no per-frame or
  per-trial callback into React.
- The HUD (round number, progress, pause hint) is drawn **on the canvas**, not in the DOM, so
  updating it cannot trigger a React render or a layout.
- The pause overlay *is* DOM — but it only exists while paused, when nothing is being measured.
- A `RenderCounter` test wrapper asserts zero renders between round boundaries (`SENS-NFR-004`).

---

## 19.12 Testing the engine

Canvas and high-frequency behaviour cannot be tested like React UI. Three separate harnesses:

**1. Headless deterministic harness (Vitest, no browser).**
The engine accepts injected `clock` and `input` sources. A test script feeds a synthetic movement
trace with exact timestamps and asserts the exact trial record and derived metrics. This is where
the majority of engine tests live, and they are fast and fully deterministic.

**2. Synthetic-player fixtures.**
Programmatic "players" with known characteristics — a perfect aimer, an overshooter, a laggy
tracker, a player whose optimum is at a known sensitivity. Running the full pipeline on a
synthetic player whose optimum is 28 cm/360 must recover ≈28 cm/360. **This is the single most
important test in the entire project**, because it validates the engine, the metrics, the
scoring and the calibration together, end to end, against a known truth.

**3. Browser integration (Playwright).**
Real pointer lock, real canvas, real rAF: asserts that lock is acquired, the HUD shows no score,
frame quality is captured, pause/resume works, and a full short session completes. Not used for
numerical assertions — the headless harness owns those.

**Explicitly not tested with React Testing Library:** anything inside a trial.

---

## 19.13 Performance safeguards summary

| Safeguard | Mechanism |
|---|---|
| No React re-render during trials | Canvas HUD; stage-boundary callbacks only |
| No allocation in the loop | Pre-allocated typed arrays, object pools for targets |
| No layout thrash | Canvas size fixed; no DOM reads/writes during a trial |
| No GC pressure from metrics | Derivation deferred to the inter-trial interval |
| No mid-session network | Everything preloaded; ingest happens at round boundaries |
| No font swap mid-test | HUD uses a preloaded font, or a canvas-safe fallback measured at init |
| No effect creep | Renderer exposes a fixed, small effect set; adding to it requires an ADR |
| Frame budget visibility | Frame monitor always on; degradation surfaced, never hidden |
