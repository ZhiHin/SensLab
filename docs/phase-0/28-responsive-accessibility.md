# 28 — Responsive Behaviour and Accessibility

Related: [24-screen-inventory.md](24-screen-inventory.md) · [26-ui-ux-design-system.md](26-ui-ux-design-system.md) · [27-motion-and-interaction.md](27-motion-and-interaction.md)

---

## 28.1 Responsive strategy

SensLab has two fundamentally different classes of surface, and they get different treatments:

| Class | Screens | Strategy |
|---|---|---|
| **Reading surfaces** | Landing, methodology, results, game settings, history, comparison, profiles, settings, auth | Fully responsive, mobile-first, all breakpoints |
| **Measurement surfaces** | Setup steps, environment check, the entire lab | Desktop-class only. Gated below the threshold (`SENS-BR-023`) |

The product is honest about this rather than shipping a degraded touch calibration
(doc 01 §1.7, doc 04 §4.4.8).

### Breakpoints

| Name | Width | Notes |
|---|---|---|
| `xs` | < 480 | Single column, 16 px gutters |
| `sm` | 480–767 | |
| `md` | 768–1023 | Two-column where content supports it |
| `lg` | 1024–1439 | Full desktop layout |
| `xl` | ≥ 1440 | Max content width; extra space becomes margin, not wider text |

### Calibration gate

`SENS-UX-026` — Calibration is offered only when **all** of the following hold: a fine pointer is
available (`(pointer: fine)`), hover is supported (`(hover: hover)`), the viewport is at least
1024 × 640 CSS px, and Pointer Lock is present. Otherwise SCR-050 is shown.

The gate is capability-based, not user-agent-based: a tablet with a real mouse attached passes,
and a small-window desktop is asked to enlarge rather than blocked outright.

**Window too small on desktop:** a distinct state — "make this window bigger to start" with the
current and required sizes shown — rather than the mobile gate, which would be confusing.

---

## 28.2 Per-screen responsive behaviour

| Screen | `xs`–`sm` | `md` | `lg`+ |
|---|---|---|---|
| Landing | Single column; canvas demos become static stills; hero type scales to 40 px | Demos active at reduced fidelity | Full narrative |
| Methodology | Single column, in-page TOC becomes a collapsible | Sidebar TOC | Sidebar TOC |
| Game selection | Gate to SCR-050 (it is part of the calibration flow) | Gate unless a fine pointer is present | 2×3 tile grid |
| Hardware setup | Gated | Gated | Two-column optional section |
| Results | Full support. Hero stacks; response curve becomes horizontally scrollable within its own container; Aim DNA scales down and its labels move outside the plot | Two-column below the fold | Full layout |
| Game settings | Full support. Output-game switcher becomes a horizontally scrolling chip row | | Full |
| History | Cards instead of a table row layout | Table | Table |
| Comparison | Stacked A/B sections | Side by side | Side by side |
| Settings / profile | Single column | | Two column |

`SENS-UX-027` — Wide content (the response curve, settings tables, comparison tables) scrolls
horizontally **inside its own container**. The page body never scrolls horizontally at any
breakpoint.

---

## 28.3 Touch behaviour on reading surfaces

- Minimum touch target 44 × 44 px.
- Hover-only affordances have a tap equivalent; tooltips become tap-to-open popovers.
- Copy buttons use the async clipboard API with a visible confirmation, since a silent copy is
  unverifiable on touch.
- Charts: tap a candidate dot to pin its readout; tap elsewhere to dismiss. No hover dependence.
- No `:hover`-only information anywhere.

---

## 28.4 Accessibility posture

**Target: WCAG 2.2 Level AA** for everything outside an active test (`SENS-NFR-044`).

The lab is a special case and is treated explicitly rather than exempted (§28.8).

---

## 28.5 Keyboard

`SENS-UX-028` — Every interactive control outside an active test is reachable and operable by
keyboard, in a logical order, with a visible focus indicator.

| Concern | Implementation |
|---|---|
| Focus indicator | The reticle form (doc 26 §26.5): four corner ticks, `--accent`, never `outline: none` without a replacement |
| Focus order | DOM order matches visual order; no positive `tabindex` |
| Skip link | "Skip to content" as the first focusable element on every page |
| Modals | Focus trapped, Escape closes, focus restored to the trigger |
| The pause overlay | Fully keyboard operable — it is the escape hatch from the one non-keyboard surface |
| Charts | The response curve is focusable; arrow keys move between candidate points; each announces its values |
| Custom controls | Native elements wherever possible. The mode switch is a radio group, the game tiles are a radio group, the output-game switcher is a tab list |
| Shortcuts | Only ESC (pause). No single-character shortcuts that could fire during typing |

---

## 28.6 Colour, contrast, and non-colour encoding

`SENS-UX-029` — No information is conveyed by colour alone.

| Where colour could be the only signal | Additional encoding |
|---|---|
| Hit / miss in the lab | Shape: an expanding ring for a hit, a small cross tick for a miss |
| Adapter verification state | A glyph plus the word (`verified` / `unverified`) |
| Validation improved / worse | Sign and arrow on the number, plus the explicit interval, plus the verdict word |
| Environment pass / degraded / blocked | Icon plus label plus placement |
| Aim DNA axes | Labelled axes; the palette is a neutral sequence, not good-to-bad |
| Required form fields | The word "required", not a red asterisk alone |

Contrast is verified by an automated audit of token pairs in CI (`SENS-UX-006`), plus a manual
review of the two canvas surfaces, which automation cannot check.

**Canvas contrast:** target-to-background contrast in the lab is held at ≥ 4.5:1 and is a
**fixed, non-configurable** property of the test — changing it would change the measurement. A
high-contrast option increases the target's outline weight and adds a centre dot without altering
the hit radius or the fill contrast (doc 09 §9.3).

---

## 28.7 Forms

`SENS-UX-030` — Every input has a persistently visible label (not a placeholder-as-label),
programmatically associated, with errors linked by `aria-describedby` and announced.

- Error messages are specific and actionable: "DPI must be between 100 and 32000" — not "invalid".
- Errors appear on blur and on submit, never on every keystroke.
- Autocomplete attributes on email and password fields.
- The optional-details disclosure is a native `<details>`-equivalent with correct expanded state.
- Units are shown in the field, not only in the label.

---

## 28.8 The lab and accessibility

The test canvas requires precise physical mouse movement. That is the measurement, and it cannot
be made keyboard-operable without ceasing to be a measurement. SensLab handles this honestly:

`SENS-UX-031` — Every test is preceded by a complete text description of the task, its controls,
its duration and its termination condition, available to screen readers and readable without
starting the test.

`SENS-UX-032` — The canvas element carries an accessible name and a live description of the
current stage. Stage transitions (round start, round complete, paused) are announced through a
polite live region.

`SENS-UX-033` — Pause (ESC) is always available, is announced, and the pause overlay is fully
accessible.

`SENS-UX-034` — Test results are fully accessible: every value on the results page is available
as text, the response curve has a keyboard-navigable data representation, and a "view as table"
affordance exposes all candidate data.

**What is honestly stated:** SensLab's calibration requires precise mouse control and is
therefore not usable by everyone. The product says so plainly on the methodology page rather than
implying universal usability. Everything *around* the test — understanding it, reading a result,
comparing sessions, managing an account — meets AA.

---

## 28.9 Screen reader specifics

| Element | Treatment |
|---|---|
| Result hero | An `aria-label` giving the complete statement: "Recommended sensitivity 31.2 centimetres per 360 degrees, high-performance range 29.7 to 32.4, confidence 79 out of 100, aim profile Balanced Precision" |
| Animated numbers | Final value present in the DOM from the start; the animation is `aria-hidden` |
| Response curve | `role="img"` with a descriptive label, plus a visually-hidden table of the candidate data |
| Aim DNA | Same pattern |
| Confidence breakdown | A definition list, not a bar chart alone |
| Status pills | Text content, not icon-only |
| Toasts | `role="status"`, polite |
| Progress in the lab | Polite live region, updated at round boundaries only — never per trial, which would flood the user |

---

## 28.10 Internationalisation

- en and zh-Hans at MVP (FR-105).
- All UI strings in message catalogues; no concatenated sentences.
- **Game setting names come from the adapter, not the UI catalogue** (doc 08 §8.7) — the label
  must match what the user sees in the game's own menu in their language.
- Numbers, dates and units formatted with `Intl`; the unit preference (cm/in) is independent of
  locale, because a user may prefer metric measurements in an English interface.
- Layout tested at +40% string length; no fixed-width text containers.
- `lang` attribute set correctly, including on mixed-language content such as the 三角洲行动
  game name inside English copy.

---

## 28.11 Accessibility verification

| Method | Scope | Frequency |
|---|---|---|
| Automated axe scan | Every page, every state fixture | Every CI run |
| Contrast audit over token pairs | Design system | Every CI run |
| Reduced-motion audit | Whole app | Every CI run |
| Keyboard walkthrough | Every screen | Per release |
| Screen reader pass (NVDA + VoiceOver) | Key flows: setup, result, settings, history | Per release |
| Zoom to 200% and 400% | All reading surfaces | Per release |
| Manual canvas contrast check | Lab | On any renderer change |

Automated tooling catches perhaps half of what matters here; the manual passes are the ones that
find the real problems, and they are scheduled, not optional.
