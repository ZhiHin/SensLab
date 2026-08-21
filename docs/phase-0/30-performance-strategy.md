# 30 — Performance Strategy

Related: [19-test-engine-architecture.md](19-test-engine-architecture.md) · [06-non-functional-requirements.md](06-non-functional-requirements.md) · [27-motion-and-interaction.md](27-motion-and-interaction.md)

---

## 30.1 Two different performance problems

| Problem | Nature | Failure mode |
|---|---|---|
| **Measurement performance** | Hard real-time. A late frame is a corrupted data point | Silent, invisible, produces wrong recommendations |
| **Application performance** | Ordinary web performance | Visible, annoying, costs conversion |

They get different budgets, different tools and different priorities. When they conflict,
measurement wins (`SENS-BR-021`).

---

## 30.2 Measurement performance budget

Per frame, during a scored trial, on a 144 Hz display (6.94 ms budget):

| Work | Target |
|---|---|
| Input processing (all coalesced samples) | < 0.3 ms |
| Camera integration | < 0.05 ms |
| Target position evaluation (analytic) | < 0.05 ms |
| Canvas draw (clear, grid, targets, crosshair, HUD) | < 1.5 ms |
| Telemetry write (typed arrays) | < 0.1 ms |
| **Total SensLab work** | **< 2.0 ms** |
| Headroom for browser compositing, GC, OS | > 4.9 ms |

The large headroom is deliberate. A budget that is merely achievable on a good machine will be
missed on a bad one, and the whole point is that the measurement holds up on the machines real
players have.

### The rules that produce this

1. **Zero allocation in the loop.** Pre-allocated typed arrays, pooled target objects, no
   closures created per frame, no array methods that allocate (`map`, `filter`, spread) in the
   hot path (`SENS-NFR-003`).
2. **Zero React involvement.** No state updates, no context reads, no effects between round
   boundaries (`SENS-NFR-004`).
3. **Zero DOM work.** The HUD is canvas-drawn. No `getBoundingClientRect`, no style reads, no
   class toggles during a trial.
4. **Zero layout.** Canvas dimensions are fixed for the session.
5. **Metric derivation is deferred** to the inter-trial interval, never inside the frame loop.
6. **Draw calls are minimal.** Canvas 2D, flat fills and strokes, no shadows, no filters, no
   `globalCompositeOperation` beyond `source-over`, no gradients per frame.
7. **The grid is pre-rendered** to an offscreen canvas once and blitted.
8. **No `console` calls** in the loop — they are surprisingly expensive and they retain objects.

### Why Canvas 2D rather than WebGL

At the MVP's draw complexity — fewer than ten simple shapes — Canvas 2D's per-frame cost is
already an order of magnitude under budget, and it has more predictable frame pacing, no shader
compilation stall, no context-loss handling, and far less code. WebGL would add risk to the
component where risk is least acceptable. Recorded as ADR-005; revisited only if a test needs
genuine 3D depth cues.

---

## 30.3 Frame quality monitoring

Always on during scored trials.

```
per frame:  dt = now - lastFrameTime
            budget = 1000 / detectedRefreshHz
            late = dt > budget * 1.25
            hitch = dt > 100        -> invalidates the current trial
```

| Aggregate | Threshold | Consequence |
|---|---|---|
| Late-frame ratio in a trial | > 8% | Trial marked `degraded` (still scored, flagged) |
| Any hitch inside a measured window | ≥ 1 | Trial marked `invalid`, reason `frame_hitch`, replaced |
| Degraded trials in a round | > 20% | Round flagged; re-queued once if budget allows |
| Session-wide clean-frame fraction | < 0.90 | Quality warning screen (SCR-023) |
| Session-wide clean-frame fraction | any value | Feeds `C_env` in the confidence model (doc 15 §15.2) |

**Refresh-rate detection.** Measured during the environment check from the median frame interval
over 3 seconds, not assumed and not read from any API. Non-integer results (e.g. a 143.9 Hz
panel) are handled by using the measured median directly as the budget rather than snapping to a
nominal rate.

`SENS-BR-010` — degradation is always recorded and always surfaced. There is no code path that
silently absorbs it.

---

## 30.4 Environment check as a performance gate

Four probes (FR-029–033), run before any measurement:

| Probe | Method | Outcome |
|---|---|---|
| Pointer Lock support | Feature detection + an actual lock attempt | `blocked` if unavailable |
| Raw input | `requestPointerLock({unadjustedMovement:true})`, plus a movement-scale sanity probe where the API does not report effectiveness | `degraded` if unavailable |
| Frame stability | 3 s of rAF with an active canvas draw representative of a real trial | `pass` ≥ 95% on-budget, `degraded` 85–95%, offer Quick/abort below 85% |
| DPI plausibility | Cross-check against declared sensitivity and pad width (doc 11 §11.9.3) | Warn only |

The frame probe draws a representative scene rather than an empty canvas — an empty-canvas probe
would pass on machines that then fail during a real trial.

---

## 30.5 Application performance

| Surface | Budget | Mechanism |
|---|---|---|
| Landing | LCP ≤ 2.0 s, INP ≤ 200 ms at p75 on 4G/4× throttle | Static rendering, system-font-first paint, lazy canvas demos, ≤ 180 KB gz initial JS |
| Setup screens | INP ≤ 100 ms | Small client islands, native controls |
| Lab shell | Fully loaded before pointer lock | Route-level preload; **no dynamic import after entry** (`SENS-NFR-011`) |
| Results | Recommendation + response curve in the first payload | RSC; charts render from data already present, optional sections stream |
| History | ≤ 50 ms p95 query at 10 M trial rows | Aggregates only; no trial-level joins |
| Server actions | ≤ 300 ms p95 | Simple queries, no N+1 |
| Round ingest | ≤ 500 ms p95 at 1,000 concurrent | Single transaction, bulk inserts, ≤ 64 KB payload |

### Landing-page specifics

The landing page has an unusual problem: it wants five live canvas demos, which is exactly the
kind of thing that destroys a Lighthouse score.

- Demos mount on `IntersectionObserver` entry and **unmount** on exit.
- Capped at 30 fps.
- Paused when the tab is hidden.
- Replaced by a static still under `prefers-reduced-motion`, on touch, and when
  `navigator.hardwareConcurrency` is low or `navigator.connection.saveData` is set.
- At most one demo runs at a time.

---

## 30.6 Data-layer performance

- Indexes are defined from the query list in doc 20 §20.10, and every index has a named query
  that justifies it.
- Round ingest uses multi-row inserts, not per-row round trips: one round ≈ 3 statements
  (round, trials, metrics) regardless of trial count.
- The result page never reads `trial_metrics`; it reads `round_metrics`, `candidate_scores` and
  `recommendations`.
- History reads only `test_sessions` + `recommendations`.
- Recompute (the only trial-level read path) is an offline/background operation, not a request
  path.
- `EXPLAIN` output for every query on the critical path is reviewed once and re-checked when the
  volume fixture grows.

---

## 30.7 Client resource management

- IndexedDB drafts are pruned on session completion and on load if stale (doc 22 §22.8).
- Ring buffers are freed when the engine unmounts.
- Event listeners are registered on the engine's own lifecycle and removed on unmount; a leak
  here would survive route changes and degrade a later session.
- Long sessions are checked for memory growth in a manual soak test (a full Advanced session with
  a heap snapshot before and after) — an engine that leaks 1 MB per trial would still "work"
  while degrading the last rounds, which is precisely the invisible failure this product cannot
  afford.

---

## 30.8 Browser accuracy limitations — the honest list

Recorded here because performance and fidelity are the same subject for this product. All of this
is surfaced to users on the methodology page (FR-004) and summarised on result surfaces
(`SENS-BR-022`).

| Limitation | Effect | SensLab's response |
|---|---|---|
| **Pointer Lock deltas may pass through OS pointer processing** unless `unadjustedMovement` is granted | Acceleration or scaling distorts the measurement | Request raw input; detect; warn; penalise confidence; recommend disabling Enhance Pointer Precision. Never attempt to invert an unknown curve (doc 11 §11.8) |
| **Browser event timing has jitter** the game engine does not | Small noise on per-event timing | Metrics that depend on fine timing use aggregates over many trials; the noise is constant across candidates and therefore cancels in comparison |
| **The browser is not the game's render path** | Different frame pacing, different presentation latency | Latency is an approximately constant offset; it cancels in every comparison SensLab makes, and absolute reaction time is presented as "including system latency" |
| **Display latency is unmeasurable from the page** | Absolute reaction times include an unknown offset | Stated. Never subtracted with a guessed constant |
| **High-refresh displays differ from the game's frame rate** | Perceived target motion differs | Refresh rate is recorded with the session; comparisons across different refresh rates are flagged (`SENS-BR-019`) |
| **FOV, target size, contrast and depth cues differ from any real game** | Absolute performance is not comparable to in-game performance | SensLab measures *relative* performance across sensitivities, which is robust to this. Stated explicitly |
| **No weapon, no movement, no enemy behaviour, no pressure** | Real engagements involve more than aim | The recommendation is about the sensitivity, not about skill transfer. Stated |
| **DPI is self-reported** | Wrong DPI → wrong game numbers | counts/360 is canonical; provenance recorded; plausibility checked; settings reliability reported separately (doc 15 §15.5) |
| **Windows pointer speed / EPP may be active** | Distorted input | Detected indirectly; user asked; warned |
| **Sensor behaviour varies** (lift-off distance, angle snapping, smoothing, low-speed jitter) | Affects absolute precision | Constant within a session, so it cannot bias the candidate comparison. Affects absolute scores, which is one reason those are provisional |

The through-line: **SensLab's core claim is a within-session, within-player comparison**, and
almost every limitation above is a constant offset that cancels in exactly that comparison. The
things that do *not* cancel — a wrong DPI, an unstable environment, OS acceleration — are the
things SensLab detects, warns about, and prices into confidence. That is the whole argument for
why a browser measurement is legitimate, and it should be stated in those terms on the
methodology page.

---

## 30.9 Performance regression protection

| Guard | Trigger |
|---|---|
| Frame-budget assertion in the headless engine run | Every CI run |
| React render-count assertion | Every CI run |
| Bundle size limits per route | Every CI run |
| Lighthouse budgets on the landing page | Every CI run |
| Query benchmark against the volume fixture | Every CI run |
| Manual allocation profile on the reference machine | Every release |
| Memory soak test | Every release |
| Load test | Pre-launch and per major change |

A performance regression in the lab route is treated as a **correctness** bug, not a polish
issue, and blocks release.
