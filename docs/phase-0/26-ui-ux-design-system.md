# 26 — UI/UX Design System

Related: [25-wireframes.md](25-wireframes.md) · [27-motion-and-interaction.md](27-motion-and-interaction.md) · [28-responsive-accessibility.md](28-responsive-accessibility.md)

**ID format:** `SENS-UX-###`.

---

## 26.1 Design thesis

SensLab is a **calibration laboratory**, not a gaming website.

The reference points are optical bench equipment, oscilloscopes, spectrometers and metrology
reports: instruments whose visual language communicates *this thing measures accurately*. The
aesthetic goal is **earned precision** — every element should look like it exists because
something needs to be read off it.

Three words to design against: **precise, quiet, confident.**
Three words to design away from: **hype, decoration, aggression.**

The emotional arc: the setup is calm and clinical, the test is empty and focused, and the result
is the only moment of drama — one reveal, well earned, then straight back to data.

---

## 26.2 Explicit prohibitions

| Prohibited | Because |
|---|---|
| Permanent left sidebar navigation | It is the visual signature of an admin dashboard, and SensLab has ~6 destinations, not 40 |
| Card grids as the default layout | Cards fragment attention; SensLab's screens each have one job |
| RGB gradients, rainbow accents, neon glow stacks | Reads as a peripheral vendor site; destroys the instrument metaphor |
| Angular "esports" shapes, italic slabs, aggressive skews | Reads as an esports-betting site |
| Drop shadows for elevation | Instruments do not float. Use hairlines and value steps |
| Heavy glassmorphism | Reserved for exactly one surface: the pause overlay |
| Stock photography, 3D render heroes, mascots | — |
| Progress gamification: XP, streaks, badges, ranks | `SENS-BR-036`; SensLab is not a trainer (doc 01 §1.5) |
| Emoji in product UI | Undermines the instrument register |

`SENS-UX-001` — The application shall not use a permanent sidebar, card-grid default layout, or
RGB/neon accent treatment.

---

## 26.3 Colour

Dark-only at MVP. A light theme is not planned: the product's core surface is a dark test
environment, and a light theme would either be a second design or a bad one.

### Palette

| Token | Value | Role |
|---|---|---|
| `--void` | `#08090B` | Page background, test canvas background |
| `--surface` | `#0E1014` | Panels, elevated regions |
| `--surface-2` | `#14171C` | Inset regions, table stripes |
| `--hairline` | `#20242B` | 1px borders, grid lines, dividers |
| `--hairline-strong` | `#2C323B` | Focused/active borders |
| `--text-1` | `#E8EAED` | Primary text |
| `--text-2` | `#9AA1AC` | Secondary text |
| `--text-3` | `#7A828E` | Tertiary labels (verified ≥ 4.5:1 on `--surface`) |
| `--accent` | `#31E2C4` | **Trace Cyan** — live data, instruments, primary action |
| `--accent-dim` | `#1E8F7C` | Accent at rest, inactive traces |
| `--result` | `#FFC46B` | **Filament** — the result, and only the result |
| `--critical` | `#FF5C5C` | Errors, blocked states, "worse" verdicts |
| `--caution` | `#FFB020` | Warnings, degraded states, unverified adapters |
| `--positive` | `#31E2C4` | Same as accent — improvement is "live data", not a separate colour |

### Rules

`SENS-UX-002` — Exactly **two** accent hues exist: Trace Cyan (measurement) and Filament
(result). They may not both appear at full saturation in the same region except in the result
reveal, where the contrast between them *is* the design.

`SENS-UX-003` — Filament is reserved for the recommendation itself. It never appears on a button,
a link, a nav item, or a chart series. Its scarcity is what makes the reveal land.

`SENS-UX-004` — Total saturated-accent coverage on any screen stays under ~5% of visible area.

`SENS-UX-005` — Status is never encoded by hue alone. Every state also carries a glyph, a
position, or a label (doc 28 §28.6).

`SENS-UX-006` — Text contrast: ≥ 4.5:1 for body, ≥ 3:1 for large text and for meaningful UI
boundaries. Verified by an automated contrast audit over the token combinations in CI, not by
eye.

**Data-visualisation palette.** Charts do not use the semantic palette. A separate 6-step
sequence derived from Trace Cyan through a neutral to Filament is used for the six dimensions, so
the Aim DNA is legible as a set without any axis reading as "good" or "bad".

---

## 26.4 Typography

| Role | Family | Notes |
|---|---|---|
| Display / headings | **Space Grotesk** | Geometric with genuine character in the digits and the `a`/`g`. Avoids both generic-grotesk anonymity and gamer-font aggression |
| UI / body | **Inter** | Neutral, exceptional at small sizes, wide weight range |
| Data / numerals / code | **JetBrains Mono** | Tabular by construction; used for every measured value, every setting, every count |

`SENS-UX-007` — Every numeric value that a user may compare against another numeric value is set
with `font-variant-numeric: tabular-nums`. Non-negotiable: jittering digits in an instrument
readout is the fastest way to look imprecise.

`SENS-UX-008` — Fonts are self-hosted, preloaded, and `font-display: swap` is **disabled** on the
lab route (`SENS-NFR-011`); the lab uses a metric-compatible fallback measured at init if a font
is not ready.

### Scale

| Token | Size / line height | Use |
|---|---|---|
| `display-xl` | 112 / 0.92, Space Grotesk 500, tight tracking | The result number |
| `display-l` | 72 / 0.95 | Landing hero |
| `display-m` | 44 / 1.05 | Section heads |
| `title` | 28 / 1.2 | Screen titles |
| `subtitle` | 20 / 1.3 | |
| `body` | 16 / 1.55 Inter | Default |
| `body-s` | 14 / 1.5 | Secondary |
| `label` | 12 / 1.3, +0.08em tracking, uppercase | Instrument labels — the most characteristic type style in the product |
| `data-l` | 32 / 1.1 JetBrains Mono | Prominent readouts |
| `data-m` | 18 / 1.3 JetBrains Mono | Table values, settings |
| `data-s` | 13 / 1.4 JetBrains Mono | Dense data, chart axes |

`SENS-UX-009` — Uppercase micro-labels (`label`) mark every measured quantity. This single
convention carries most of the instrument character; it must be applied consistently or not at
all.

---

## 26.5 Motifs

The visual identity is built from four motifs, used sparingly.

**1. The reticle.** A crosshair is the product's core symbol. It appears as: the logo mark, the
focus indicator (four corner ticks rather than a rectangle), the loading indicator, the
landing-page hero element, and — actually functional — the crosshair in the test.

`SENS-UX-010` — Focus indicators use the reticle form: four corner ticks in `--accent`, 2 px,
offset 3 px, with a 3:1 minimum contrast against the adjacent surface.

**2. The measurement grid.** A 1 px grid in `--hairline` at 4% opacity, 48 px pitch, on hero and
result surfaces. It sits *behind* content and never crosses it.

**3. Tick marks and scales.** Ruled ticks along container edges, calibrated to real values where
possible (a range indicator's ticks correspond to actual cm/360 values, not decoration).

`SENS-UX-011` — Where a tick scale is rendered, its ticks correspond to real values. Decorative
scales that imply measurement without measuring anything are prohibited — they are the exact
dishonesty the product exists to oppose.

**4. Fine noise.** A static SVG `feTurbulence` overlay at 2–3% opacity, tiled, giving surfaces a
photographic grain that keeps large dark areas from looking flat. **Never animated**, never on the
lab route.

---

## 26.6 Elevation and surfaces

No shadows. Depth comes from three tools only:

1. **Value steps** — `--void` → `--surface` → `--surface-2`.
2. **Hairlines** — a single 1 px `--hairline` border defines an edge.
3. **Inner accent glow** — a 1 px inset `--accent` at low alpha, on active/measuring elements
   only.

The one exception: the pause overlay uses a backdrop blur, because it is genuinely covering
something the user must not act on.

---

## 26.7 Components

| Component | Character |
|---|---|
| **Primary button** | Solid `--accent`, `--void` text, 2 px radius, uppercase `label` type. Corner ticks on hover |
| **Secondary button** | Transparent, `--hairline-strong` border, `--text-1`. Border brightens to `--accent-dim` on hover |
| **Ghost / text button** | `--text-2`, underline offset on hover |
| **Input** | `--surface-2` fill, 1 px `--hairline` bottom border only (not a full box), `--accent` on focus, JetBrains Mono for numeric fields |
| **Select** | Native element, restyled; never a custom listbox unless a native one cannot do the job |
| **Toggle / radio** | Square with a reticle-dot fill, not a rounded switch |
| **Panel** | `--surface`, 1 px hairline, corner ticks in `--hairline-strong`, `label`-typed header |
| **Readout** | `label` above, `data-l` value, unit in `--text-3`. The most repeated composition in the product |
| **Range bar** | A horizontal rule with real ticks, the range as a bracket, the point value as a filled marker |
| **Status pill** | `label` type, 1 px border in the semantic colour, a glyph, transparent fill |
| **Table** | Hairline rows, no vertical borders, `--surface-2` on hover, tabular numerals |
| **Tooltip** | `--surface-2`, hairline, small radius, `body-s`. Keyboard-accessible |
| **Toast** | Bottom-centre, hairline, auto-dismiss with a pause-on-hover, ARIA live |

Radii are 2 px throughout, 0 px on data surfaces. Rounded, friendly shapes work against the
register.

---

## 26.8 Custom scrollbar

`SENS-UX-012` — A custom scrollbar is applied to the document and to internally scrolling
regions: 10 px track in `--void`, 4 px thumb in `--hairline-strong`, widening to 6 px and
`--accent-dim` on hover, no arrow buttons, 2 px radius.

**Constraints (FR-102):**
- Implemented with native `::-webkit-scrollbar` and `scrollbar-color`/`scrollbar-width`, never
  a JavaScript scroll hijack.
- Native scrolling, momentum, keyboard scrolling, scroll anchoring and `scrollIntoView` all
  behave normally.
- On platforms with overlay scrollbars, the platform behaviour wins — no attempt to force a
  visible bar.
- The scrollbar is not applied inside the lab route.

---

## 26.9 Result-experience rules

`SENS-UX-013` — The result number is the largest element on the page and is the only use of
`--result`.

`SENS-UX-014` — The response curve appears **above the fold on desktop**, immediately below the
headline block. The evidence is not a "learn more" (doc 01 §1.9).

`SENS-UX-015` — Confidence is displayed adjacent to the recommendation, never in a footnote, and
always links to its breakdown.

`SENS-UX-016` — The `indistinguishable` result is a designed screen with its own hierarchy, not
the `peak_found` layout with different copy (doc 16 §16.4).

`SENS-UX-017` — Provisional absolute scores are labelled provisional wherever they appear, for as
long as the reference distribution is provisional (doc 14 §14.4).

`SENS-UX-018` — Strengths and improvement areas are worded factually and constructively. At most
two improvement areas, each stated with its measurement and one concrete implication. No ranking
against other users, no discouraging framing, no gamified failure states (`SENS-BR-036`).

`SENS-UX-019` — The browser-limitation caveat and the algorithm version line appear on every
result surface (`SENS-BR-022`, FR-006).

---

## 26.10 Voice and tone

| Principle | Example |
|---|---|
| State the measurement, not a verdict about the person | "Your flicks past 28° landed further from centre" — not "your long flicks are weak" |
| Numbers carry their uncertainty | "31.2 cm/360, range 29.7–32.4" — not "31.2" |
| Say "we don't know" plainly | "We don't have a verified model for this game yet. We won't guess." |
| No hype | Never "perfect", "optimal", "unlock", "dominate", "pro-level" |
| Short sentences in the lab, longer ones in explanations | The test screen has at most seven words on it |
| Second person, present tense | "You were at 27.4." |
| Technical terms are used and then explained, not avoided | cm/360 is used from the second screen onward, with a definition one click away |

The tone that fits: a good lab technician handing you a report. Interested, precise, not
impressed by itself, and completely unwilling to overstate what the instrument showed.

---

## 26.11 Token implementation

- All tokens are CSS custom properties on `:root`, consumed by Tailwind via its theme extension.
- **The canvas reads the same tokens** (`getComputedStyle`) at engine init, so the test
  environment and the UI cannot drift apart.
- A token may not be overridden inline; a component needing a new value gets a new token and a
  review.
- Tokens are documented in a single generated reference page in the repository.
