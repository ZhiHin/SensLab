# Phase 10 Completion Report — UI/UX Polish & Responsive Experience

**Phase:** 10 of 11
**Scope:** the visual and interaction layer Phase 0 assigns to this phase (FR-100 – FR-103, FR-105, SCR-001, SCR-050, SCR-051, `SENS-UX-001` – `SENS-UX-034`)
**Source of truth:** [`26-ui-ux-design-system.md`](../phase-0/26-ui-ux-design-system.md) · [`27-motion-and-interaction.md`](../phase-0/27-motion-and-interaction.md) · [`28-responsive-accessibility.md`](../phase-0/28-responsive-accessibility.md) · [`25-wireframes.md`](../phase-0/25-wireframes.md) §25.1 · [`24-screen-inventory.md`](../phase-0/24-screen-inventory.md)
**Date:** 2026-08-24

---

## 1. Status

**Complete.** SensLab now reads as the instrument it claims to be: a landing page with a
five-act scroll narrative rather than a stack of feature cards, a capability gate that is
honest about where the measurement cannot run, display preferences that change what a number
is _labelled_ without touching what it _is_, Simplified Chinese on the surfaces a player takes
into a game, and an accessibility scan over every page on every run.

Three defects surfaced that had been shipping since Phase 1 and were invisible to every
existing test: a component style that silently overrode colour utilities across the whole
application, a type class used on nine screens that the stylesheet never defined, and duration
claims written down rather than derived (`SENS-BR-024`). §4.

---

## 2. What was built

### 2.1 The landing page (SCR-001, doc 25 §25.1)

Act 0 is the hero: the headline, the three load-bearing qualifiers, and a pointer-reactive
field of measurement grid and reticle marks that parallaxes by **at most 8 px** — off entirely
under reduced motion and on any device without a fine pointer.

Acts 1–5 are `REACT → FLICK → TRACK → CONTROL → OPTIMIZE`, one sequence driven by scroll
_position_ rather than five stacked cards (doc 26 §26.2 prohibits the card grid as a default).
Progress is **observed** with an `IntersectionObserver` and never driven: the page scrolls at
exactly the speed the browser scrolls it, which is what FR-102 requires and what keeps the
narrative from becoming the decoration the design system argues against.

Act 6 closes with the call to action and the browser-limitation caveat — on the landing page,
before a visitor spends twenty minutes, rather than on the result where it would read as an
excuse (`SENS-BR-022`).

### 2.2 The calibration gate (SCR-050, SCR-051, FR-100, `SENS-UX-026`)

```
fine pointer  ∧  hover  ∧  viewport ≥ 1024 × 640  ∧  Pointer Lock
```

Capability-based, never user-agent-based, and re-evaluated on resize. A tablet with a mouse
passes; a phone is shown the explanation and a hand-off; a desktop in a small window is asked
to enlarge — a **distinct** state, because the mobile explanation would be advice its reader
cannot follow. A browser without Pointer Lock gets its own screen naming that specifically.

The reason is stated rather than implied: a touchscreen reports positions where SensLab counts
physical movement, so a touch calibration would be a different measurement wearing this one's
name (`SENS-BR-023`).

### 2.3 Display preferences (FR-103) — `core/preferences`, `services/preferences-service`

| Preference | Behaviour                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Units      | cm or inches, converted at the formatter and nowhere else — the stored value, every range and every comparison stay in centimetres derived from counts |
| Motion     | `system` / `reduced` / `full`, overriding the OS **in both directions** (`SENS-UX-023`)                                                                |
| Language   | English or Simplified Chinese                                                                                                                          |

Resolution is account → cookie → `Accept-Language`. A signed-in user's choice follows them
between browsers, and a stale cookie on a shared machine never wins over the account. Guests
get working preferences without one, because a preference about how a number is _shown_ needs
no identity.

Inches are shown to two decimals rather than one: at 30 cm/360 an inch reading is ~11.8, and
matching the digit count would make the imperial reading the coarser of the two.

### 2.4 Internationalisation (FR-105, doc 28 §28.10)

A message catalogue with English and Simplified Chinese for the **game-facing surfaces** — the
screens where a player reads a number and takes it into a game. Two categories are excluded on
purpose and the exclusion is the interesting part:

- **Game setting names come from the adapter** (doc 08 §8.7). The label must match the game's
  own menu in the player's language; a translation here would be a second, wrong answer.
- **Game names come from the game record.** The Chinese client calls Delta Force 三角洲行动;
  that is a fact about the game, not a UI string. The landing page shows a game's name in the
  reader's language _and_ its native name with its own `lang`, so a screen reader pronounces it
  correctly and the two Delta Force builds stay visibly distinct (`SENS-BR-015`).

### 2.5 Accessibility (doc 28 §28.4–§28.9, `SENS-UX-028`–`SENS-UX-034`)

An **axe scan at WCAG 2.1 A and AA over every page and every result state, every run** — doc 28
§28.11 asks for exactly that, and a scan that only runs before a release finds a month of
accumulated defects at the worst possible moment. Alongside it: a keyboard walk to the call to
action, one `h1` and one `main` per page, a visible focus indicator, and the canvas description.

The canvas now carries an accessible name and a live status (`SENS-UX-032`). The status is
deliberately **procedural** — "measuring", "get ready", "paused" — and never a running
commentary of performance, which would be feedback a sighted player does not get and would make
the two measurements different (`SENS-BR-007`).

### 2.6 The design system, enforced

`tests/unit/design/tokens.test.ts` turns doc 26 into assertions: every `type-*` class used
anywhere is defined, the type styles live in a layer so a utility can still set colour, every
data style carries tabular numerals (`SENS-UX-007`), every palette token exists, Filament
appears only where a recommendation is displayed (`SENS-UX-003`), no shadow utilities
(§26.6), the motion override works in both directions, the lab stays free of decoration, and
nothing hijacks the wheel (FR-102).

Two of those tests exist because they caught the defect they describe.

---

## 3. Files created / modified

### Created — `src/` (8 files)

| File                                     | Purpose                                           |
| ---------------------------------------- | ------------------------------------------------- |
| `core/preferences/index.ts`              | Units, locale tags, the motion resolution         |
| `core/environment/capability.ts`         | The calibration gate's rule                       |
| `lib/i18n/messages.ts`                   | The en / zh-Hans catalogue                        |
| `lib/motion.ts`                          | The resolved motion preference on the client      |
| `services/preferences-service.ts`        | Account → cookie → header resolution, and storage |
| `features/landing/hero-field.tsx`        | The pointer-reactive hero field                   |
| `features/landing/act-sequence.tsx`      | The five-act scroll narrative                     |
| `features/calibrate/capability-gate.tsx` | SCR-050, SCR-051 and the small-window state       |

### Created — tests (8 files, 55 new cases)

| File                                          | Cases | Covers                                                             |
| --------------------------------------------- | ----- | ------------------------------------------------------------------ |
| `tests/unit/design/tokens.test.ts`            | 9     | The design system as a contract                                    |
| `tests/unit/presentation/preferences.test.ts` | 19    | Units, locale, motion override, the gate, the catalogue            |
| `tests/integration/preferences.test.ts`       | 8     | Preference storage, precedence, locale negotiation                 |
| `tests/integration/landing-claims.test.ts`    | 3     | `SENS-BR-024` — the duration is derived, not written               |
| `tests/e2e/accessibility.spec.ts`             | 9     | Axe over every page, keyboard, landmarks, focus, canvas            |
| `tests/e2e/responsive.spec.ts`                | 2     | No sideways scroll at five breakpoints; the curve scrolls in place |
| `tests/e2e/touch-gate.spec.ts`                | 2     | SCR-050 on an emulated phone, and results still readable there     |
| `tests/e2e/preferences.locked.spec.ts`        | 3     | Units, Chinese, and the motion override end to end                 |

### Modified

| File                                      | Change                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| `app/(marketing)/page.tsx`                | The landing page, rewritten from the Phase 1 shell                            |
| `app/globals.css`                         | Type styles moved into `@layer components`; `type-display-s` defined (§4.1–2) |
| `app/layout.tsx`                          | `lang` and `data-motion` stamped from the resolved preferences                |
| `components/primitives.tsx`               | `StatusPill` reports the state, not only the tone                             |
| `features/account/*`                      | The unit, motion and language controls, with a save confirmation              |
| `features/calibrate/calibration-form.tsx` | Mode durations derived rather than written (§4.3)                             |
| `features/test-run/measuring-layer.tsx`   | Canvas name and live procedural status                                        |
| `features/results/*`, `history/*`         | Unit preference applied; a disabled control instead of a dimmed link          |
| `repositories/user-repo.ts`               | `updatePreferences`                                                           |
| `services/recommendation-service.ts`      | `estimatedSessionMinutes`                                                     |
| `scripts/e2e-fixtures.ts`                 | Resets the fixture account's preferences each run (§4.6)                      |

---

## 4. Defects and design problems found

**4.1 A component style silently overrode every colour utility, application-wide.**
`.type-label { color: var(--color-text-3) }` sat outside any Tailwind layer, so it beat
`text-text-1` on source order alone. Every `type-label text-text-1` in the codebase — including
the primary call to action, whose dark-on-cyan text rendered as dim cyan-on-cyan — had been
rendering in the wrong colour since Phase 1. Type styles now live in `@layer components`, and a
test asserts they stay there. Found by looking at a screenshot.

**4.2 `type-display-s` was used on nine screens and defined nowhere.** Every screen title —
results, settings, profile, history, the games index — was rendering at inherited body size. It
is now defined at the scale doc 26 §26.4 implies for working surfaces, and a test asserts that
every `type-*` class used anywhere in the application exists in the stylesheet.

**4.3 Duration claims were written down, which `SENS-BR-024` forbids.** The calibration form
promised "about 20 minutes" and "40 minutes or more" as literal strings. Both are now derived
from the trial budget — and the derivation says Advanced is about 96 minutes, not 40, so the
old copy was already wrong. The rule's own required test ("a test asserts changing the budget
changes the displayed estimate") is now written.

**4.4 The scroll narrative's dimmed acts failed contrast.** Emphasising the active act by
dropping the others to 45% opacity put body text well below 4.5:1 (`SENS-UX-006`). Emphasis
moved to a hairline rule and the readout panel; the prose stays fully legible whether or not
it is the act in view. Found by the axe scan on its first run.

**4.5 Three markup defects the scan found.** `<dl>` elements whose children were `<span>`
wrappers or `Readout` components, which promises a description list the markup does not keep;
and a "Compare the two" link dimmed to 40% while disabled — a link that goes nowhere is still
announced as a link and still has to meet contrast. It is now a disabled button.

**4.6 The E2E fixture account carried preference state between runs.** A failed run left the
account on inches, so the next run's `.check()` on an already-checked radio was a no-op — which
fails as "the preference did not save" and sends the reader hunting in entirely the wrong
place. The fixture script now resets preferences, and the preference specs moved to the serial
`locked` project because they mutate account state other specs read in parallel.

**4.7 A save with no confirmation.** The preference controls are optimistic, so a click that
never reached the server looked identical to one that did. They now show "Saving…" then
"Saved" — which is also what the browser tests wait on, rather than guessing a duration. The
`revalidatePath` and `router.refresh()` that were remounting the control (and discarding the
confirmation) are gone, with a comment saying why.

---

## 5. Deviations from Phase 0

| #   | Phase 0 says                                                                          | Implementation                                                                    | Why                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | doc 25 §25.1: each act carries "a real engine instance in a reduced, decorative mode" | Acts carry an instrument panel naming what that stage measures                    | A decorative engine instance on the landing page would be an animated demo that measures nothing while looking exactly like the thing that does. doc 26 §26.5 prohibits scales that imply measurement without measuring; the same argument applies to a demo. Deferred rather than faked (§8). |
| 2   | doc 27 §27.3: button magnetism, custom cursor, animated numbers                       | Not implemented                                                                   | Each is listed as "where appropriate". Magnetism moves a click target, a custom cursor competes with the reticle the product already uses, and count-up numbers on a measured value read as theatre. Judged inappropriate here rather than skipped for time.                                   |
| 3   | doc 28 §28.10: "all UI strings in message catalogues"                                 | The catalogue covers the game-facing surfaces; other screens carry English inline | FR-105 requires en and zh-Hans "for game-facing surfaces at minimum", which is what shipped. Extending the catalogue is mechanical and additive; the structure that makes it possible — no concatenated sentences, named placeholders — is in place. §8.                                       |
| 4   | doc 28 §28.11: screen-reader and zoom passes                                          | Not performed                                                                     | They are manual and scheduled "per release" by doc 28 itself. The automated half runs every build; the manual half belongs to Phase 11's release checklist. §8.                                                                                                                                |
| 5   | Advanced mode's stated duration                                                       | ~96 minutes, derived                                                              | The previous copy said "40 minutes or more". The budget says otherwise, and the budget is the fact (§4.3).                                                                                                                                                                                     |

---

## 6. Testing

| Layer       | Result                                               |
| ----------- | ---------------------------------------------------- |
| Lint        | clean, `--max-warnings 0`                            |
| Typecheck   | clean, strict                                        |
| Unit + arch | **57 files, 1194 passed** (Phase 9: 1166)            |
| Coverage    | **90.33% branches** (gate 90%)                       |
| Integration | **13 files, 139 passed** (Phase 9: 128)              |
| E2E         | **86 passed** (Phase 9: 59) — 27 new                 |
| Axe         | 0 violations, WCAG 2.1 A + AA, across 11 page states |
| Build       | ✓ Compiled successfully                              |
| Boundaries  | ok — no violations                                   |
| Secrets     | ok                                                   |
| Prettier    | clean                                                |

**The responsive audit is a test, not a review.** Five breakpoints × six surfaces, each
asserting the page body never scrolls horizontally, plus a check that the response curve
scrolls inside its own container on a phone (`SENS-UX-027`). The touch gate runs on an
emulated Pixel 7 — real touch capabilities, not a narrow viewport — and asserts the
calibration form is _absent_ rather than merely hidden.

**Visual check.** Landing at 1440 and 390, the act sequence mid-scroll, settings, and the gate.
Two defects came out of it (§4.1, §4.4 was the scan).

---

## 7. Phase boundary verification

No Phase 11 work: no rate-limit tuning, no load testing, no observability dashboards, no
release checklist, no dependency audit. Nothing in this phase changed a measurement, a
parameter set, or a stored value — the golden-session fixture is untouched, and the only
services that changed are the ones that decide how a number is _labelled_.

---

## 8. Deferred items

| Item                                                       | Where it lands                                                                                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Live engine demos in the landing acts                      | Post-MVP, if a demo can be honest about measuring nothing (§5 dev. 1)                                                                      |
| Extending the catalogue beyond the game-facing surfaces    | Incremental; the structure is in place                                                                                                     |
| Screen-reader (NVDA + VoiceOver) and 200%/400% zoom passes | Phase 11's release checklist, as doc 28 §28.11 schedules them                                                                              |
| Sensitivity-history chart over time                        | Post-MVP; deferred from Phase 9 and still a visual, not a measurement                                                                      |
| Result reveal sequencing beyond the current stage hold     | Post-MVP; doc 27 §27.4's full 2.4 s sequence is described, the honest parts (stage hold, Aim DNA draw-in, reduced-motion parity) are built |
| Research-consent controls on the settings screen           | With the telemetry work doc 22 describes                                                                                                   |

---

## 9. Risks and known limitations

**9.1 The axe scan covers about half of what matters.** Doc 28 §28.11 says so, and it is worth
repeating rather than letting a green run imply more than it does. No automated tool judges
whether the canvas description is _useful_, whether the reading order makes sense, or whether
the focus sequence is logical.

**9.2 Contrast is asserted by the scan, not by a token audit.** doc 26 §26.6 asks for an
automated audit over the token _combinations_; what runs today checks the combinations that
appear on a rendered page. A token pair introduced but not yet used would not be caught.

**9.3 The landing page's act panels are static.** They name a real quantity per stage, which is
honest, but they are not the live demos doc 25 describes (§5 deviation 1).

**9.4 The Chinese translation is unreviewed by a native speaker.** The catalogue is written to
be complete and to keep the honesty caveats intact in both languages — a test asserts they are
present and non-trivial in each — but no native reviewer has read it.

**9.5 Preference changes need a navigation to reach the whole page.** The control confirms the
save immediately and every surface reads the preference when next requested, but the `lang` and
`data-motion` attributes on the document update on the next navigation rather than in place.

---

## 10. Exit criteria

| Criterion (phase prompt)                                      | State                                                                                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Premium calibration-laboratory landing page                   | ✓ Hero, five-act narrative, close; no card grid                                                                                |
| Scroll storytelling around REACT/FLICK/TRACK/CONTROL/OPTIMIZE | ✓ One observed sequence, no hijacking                                                                                          |
| Interaction design used where appropriate                     | ✓ Mouse-reactive field, reticle motifs, hover, scroll reveals; magnetism and custom cursors judged inappropriate (§5 dev. 2)   |
| Gaming aesthetic without RGB                                  | ✓ Two accent hues, enforced by test                                                                                            |
| Custom scrollbar without breaking native behaviour            | ✓ Native styling only; a test asserts no wheel hijack                                                                          |
| Testing UI polished; scored screens stay visually quiet       | ✓ Briefings and interstitials carry the copy; the lab remains decoration-free                                                  |
| Result animations                                             | ✓ Stage hold and Aim DNA draw-in, reduced-motion parity; fuller sequence deferred (§8)                                         |
| Responsive: desktop, tablet, phone                            | ✓ Five breakpoints asserted; calibration gated with a stated reason                                                            |
| Accessibility pass                                            | ✓ Axe every run, keyboard, semantics, focus, contrast, reduced motion, canvas description; manual passes scheduled (§5 dev. 4) |

---

## 11. Readiness for Phase 11

Phase 11 is hardening and release readiness, and it inherits a suite that already runs the
audits it will need to sign off: axe over every page, a responsive assertion at five widths, a
design-system contract, and 1,419 tests across four layers. What remains for it is the manual
half of doc 28 §28.11, the performance and load work of doc 30, and the security checklist of
doc 23 §23.12.

---

## Repository status

**Branch:** `main`
**No commit created. No push performed.** The working tree holds every change described above.

### Recommended review commands

```bash
git status
git diff --stat
git diff src/app/globals.css
git diff src/features/calibrate/calibration-form.tsx
```

### Recommended commit commands

```bash
git add .
git commit -m "feat: complete phase 10 ui ux polish"
git push origin main
```

### Next phase

Phase 11 — Hardening & Release Readiness. **Not started.**
