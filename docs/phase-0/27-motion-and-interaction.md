# 27 — Motion and Interaction

Related: [26-ui-ux-design-system.md](26-ui-ux-design-system.md) · [30-performance-strategy.md](30-performance-strategy.md) · [28-responsive-accessibility.md](28-responsive-accessibility.md)

---

## 27.1 The governing rule

`SENS-BR-021` — **No visual effect may affect measurement.** Where a motion idea conflicts with
measurement fidelity, the motion is cut. Not reduced, not made optional — cut.

This produces a hard split in the product:

| Zone | Motion budget |
|---|---|
| Marketing, setup, results, history, account | Rich. Motion is part of the product's quality |
| **The lab route** | Near-zero. A restricted renderer with a fixed effect allowlist |

The split is architectural, not a guideline: the lab route uses a different renderer with a
different, small set of drawing operations (doc 19 §19.13).

---

## 27.2 Motion principles

1. **Motion explains, it does not decorate.** Every animation answers "where did this come from"
   or "what changed".
2. **Instruments settle, they do not bounce.** No overshoot easing, no spring bounce, no
   elastic. Values *arrive*; they do not wobble into place.
3. **Fast in, considered out.** Entrances 180–260 ms, exits 120–180 ms.
4. **One focal motion at a time.** Never two competing animations in the viewport.
5. **Everything is interruptible.** A scroll or a click cancels any running animation rather than
   queuing behind it.

### Easing tokens

| Token | Curve | Use |
|---|---|---|
| `ease-instrument` | `cubic-bezier(0.2, 0, 0, 1)` | Default. Fast start, long settle — reads as damped, not springy |
| `ease-out-quick` | `cubic-bezier(0.3, 0, 0.2, 1)` | Small state changes |
| `ease-linear` | `linear` | Progress, traces, anything representing time |
| **Never** | any curve with overshoot | — |

### Duration tokens

| Token | ms | Use |
|---|---|---|
| `dur-micro` | 120 | Hover, focus, toggle |
| `dur-short` | 200 | Enter/exit, tooltips |
| `dur-medium` | 320 | Panel transitions, chart draw-in |
| `dur-long` | 640 | Result reveal segments |
| `dur-reveal` | 1400 | The full result reveal sequence |

---

## 27.3 Interaction catalogue

| Interaction | Behaviour | Constraints |
|---|---|---|
| **Hover — buttons** | Border/fill shift over `dur-micro`; corner reticle ticks fade in | No scale transform on primary actions (it shifts the click target) |
| **Button magnetism** | Primary CTAs only (landing hero, "Start calibration"). Max 6 px displacement, `dur-micro`, released instantly on pointer-out | Never on a control inside a form flow — a moving target is a usability defect. Disabled under reduced motion and on touch |
| **Mouse-follow field** | Landing hero only. Background grid parallax ≤ 8 px, driven by a throttled rAF read of pointer position | Off under reduced motion and on touch |
| **Crosshair cursor** | On the landing hero and game tiles the cursor becomes a small reticle | Never replaces the cursor where precise pointing matters (forms, tables) |
| **Scroll transitions** | Landing acts driven by scroll progress; content transforms and opacity only | No scroll hijacking, no scroll-jacked snap, no fake momentum (FR-102) |
| **Page transitions** | 180 ms cross-fade with a 6 px rise. Between setup steps, a horizontal 24 px slide indicating direction | Never blocks input; never delays the next screen's first paint |
| **Animated numbers** | Count-up over `dur-medium` with `ease-instrument`, tabular numerals so width never changes | Only on first reveal, never on re-render. The final value is in the DOM from the start for screen readers |
| **Chart draw-in** | Response curve: axis → candidate dots (staggered 40 ms) → fitted curve traced left to right → credible band fades in | Total ≤ 900 ms. Static under reduced motion |
| **Aim DNA reveal** | Radial bands grow outward from centre, staggered 60 ms | Static under reduced motion |
| **Tooltips** | 120 ms fade, 300 ms open delay on hover, **0 ms on focus** | Keyboard-accessible, dismissible with Escape |
| **Skeletons** | Hairline blocks with a slow, low-contrast sweep | Only where a real wait exists; never as a fake delay |
| **Toasts** | Rise 12 px + fade, `dur-short`; dwell 4 s; pause on hover/focus | ARIA live region |
| **Copy confirmation** | The copy control's label swaps to "COPIED" for 1.6 s with no layout shift | Also announced to screen readers |
| **Selection feedback** | Game tiles and mode switches: border to `--accent`, corner ticks, 120 ms | No scale, no glow bloom |

---

## 27.4 The result reveal

The one deliberately dramatic moment in the product. Sequenced, total ≈ 2.4 s from the end of
analysis, and **skippable** by any input.

```
t=0      SCR-030 analysis stages complete; screen darkens to --void over 400ms
t=400    "CALIBRATION COMPLETE" in `label` type, --text-3, fades in
t=900    Label fades; the value counts up from a low anchor to 31.2 in --result
         over dur-long, with the unit CM/360 fixed beneath it
t=1600   Range, confidence and profile fade in, staggered 80ms
t=2000   The page scroll unlocks; the response curve draws in as it enters view
```

Rules:
- The reveal is **not** a loading screen. Analysis has already finished; this is presentation.
- Any click, key, or scroll skips to the end state immediately.
- Under `prefers-reduced-motion`, the entire sequence collapses to a single 200 ms fade to the
  final state.
- `SENS-UX-021` — The analysis screen holds for a **minimum of 1.2 s** so its stages are
  readable, even when the computation is faster. This floor is disclosed in the methodology page
  as a presentation choice; it is the only place in the product where a delay is added
  deliberately, and it is never presented as computation time.
- The reveal never gamifies the outcome. A low-confidence or `indistinguishable` result gets the
  **same** reveal treatment — SensLab does not celebrate good results and bury bad ones
  (`SENS-BR-036`).

`SENS-UX-020` — The result reveal is skippable, respects reduced motion, and is identical in
treatment regardless of the verdict or confidence.

---

## 27.5 Motion in the lab

The restricted set. Anything not on this list is prohibited on the lab route.

| Permitted | Why it is safe |
|---|---|
| Target appear/disappear: instant, or ≤ 60 ms opacity | Must not delay the perceptual onset; instant preferred for the Reaction test, where onset timing is the measurement |
| Hit feedback: a 120 ms ring expansion at the hit point, drawn once | Post-hoc; cannot affect the measured event |
| Miss feedback: a 100 ms tick at the shot location | As above |
| HUD progress: a value change, no transition | |
| Inter-block interstitial: a 300 ms fade of the neutral field | Between measurements, not during |
| Countdown on resume: 3-2-1, one glyph per second | Between measurements |

| Prohibited in the lab | Reason |
|---|---|
| Any background animation, parallax, or drifting element | Adds render cost and visual noise to a measurement |
| Any easing on target position | Target motion is analytic; easing would corrupt it (doc 19 §19.6) |
| Camera shake, screen effects, damage vignettes | Would corrupt the angular measurement |
| Particle effects, trails, motion blur | Render cost, and they change perceived target position |
| Score pop-ups, combo counters, streak effects | `SENS-BR-007` |
| Any DOM animation over the canvas | Compositing cost and potential main-thread work |
| CSS transitions on the canvas element | Would resample the backing store |

`SENS-UX-022` — The lab renderer exposes a fixed effect allowlist. Adding to it requires an ADR
and a frame-budget measurement.

---

## 27.6 `prefers-reduced-motion`

`SENS-UX-023` — The preference is honoured globally, and users may additionally override it in
Settings (some users want reduced motion in their OS but full motion in a specific product, and
vice versa).

| Effect | Under reduced motion |
|---|---|
| Mouse-follow field | Removed; static composition |
| Button magnetism | Removed |
| Scroll-driven act transitions | Replaced by immediate state changes at scroll thresholds |
| Page transitions | 100 ms opacity only |
| Animated numbers | Final value rendered immediately |
| Chart draw-in | Final state rendered immediately |
| Aim DNA reveal | Final state |
| Result reveal | Single 200 ms fade |
| Skeleton sweep | Static block |
| Toasts | Fade only, no translation |
| Lab effects | **Unchanged** — they are already minimal and are functional feedback, not decoration |

Implementation: a single `useReducedMotion` source of truth combining the media query and the
user setting, consumed by both the Motion configuration and the canvas renderers. Not scattered
media queries.

**Automated enforcement:** a test navigates the app with the media query forced and asserts that
no element has a running animation or transition outside the allowlist (FR-101 acceptance).

---

## 27.7 Motion discomfort

`SENS-UX-024` — Before the first pointer lock of a session, the user is shown a motion-comfort
advisory explaining that the test simulates a first-person camera, that this can cause discomfort
for some people, and that they can pause at any time with ESC and stop without losing what has
been recorded.

This cannot be solved by `prefers-reduced-motion`: the camera motion *is* the measurement. The
honest response is a warning, an easy exit, and — post-MVP — a reduced battery that omits the
continuous-tracking tests, with the confidence consequence stated (doc 09 §9.4).

`SENS-UX-025` — Pausing, aborting, and resuming are always available and always preserve
completed rounds. A user who stops mid-session never loses everything.

---

## 27.8 Performance rules for motion

- Animate `transform` and `opacity` only. No animation of `width`, `height`, `top`, `left`,
  `box-shadow`, or `filter` in any repeated animation.
- Pointer-driven effects read pointer position into a ref and apply it in a single rAF callback;
  never a state update per pointer event (this is the same discipline as the engine, applied to
  decoration).
- `will-change` is applied only for the duration of an animation and removed after.
- Landing canvas demos run at a capped 30 fps and pause entirely when out of view or when the tab
  is hidden.
- Any animation that cannot hold 60 fps on the minimum machine is cut, not degraded.
- Motion never blocks interaction: a user can click a CTA during its entrance animation.
