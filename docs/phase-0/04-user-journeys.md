# 04 — User Journeys

Related: [03-personas.md](03-personas.md) · [24-screen-inventory.md](24-screen-inventory.md) · [25-wireframes.md](25-wireframes.md) · [07-business-rules.md](07-business-rules.md)

Screen IDs (`SCR-###`) are defined in [24-screen-inventory.md](24-screen-inventory.md).

---

## 4.1 Journey map — the primary flow (J-01)

**Actor:** any user, guest or registered. **Mode:** Standard. **Goal:** obtain a validated,
converted sensitivity recommendation.

```
 STAGE 1  ENTRY                 SCR-001 Landing
   |                            Scroll narrative: REACT / FLICK / TRACK / CONTROL / OPTIMIZE
   |                            CTA: START CALIBRATION
   v
 STAGE 2  INTENT                SCR-010 Game Selection
   |                            Pick primary game (drives OUTPUT only, never the engine)
   |                            "Not listed / I play several" -> generic path, cm/360-only result
   v
 STAGE 3  SETUP                 SCR-011 Hardware Setup
   |                            REQUIRED: DPI  (escape hatch: "I don't know my DPI")
   |                            OPTIONAL: current sens, mousepad, monitor, polling, grip, OS
   |                            -> starting bracket derived here (doc 13 s13.3)
   v
 STAGE 4  ENVIRONMENT           SCR-012 Environment Check
   |                            Pointer lock support + unadjustedMovement + refresh rate
   |                            + 3s frame-stability probe + DPI plausibility cross-check
   |                            Outcome: PASS | DEGRADED (warn, continue) | BLOCKED
   v
 STAGE 5  ORIENTATION           SCR-013 Test Introduction
   |                            What will happen, how long (COMPUTED), motion warning,
   |                            ESC = pause, blinding explained ("we hide which is which")
   v
 STAGE 6  PRACTICE              SCR-014 Practice        [UNSCORED - BR-011]
   |                            Free-aim + 6 practice flicks at bracket centre
   |                            Exists to burn off first-contact learning effects
   v
 STAGE 7  BASELINE              SCR-015 Calibration / Baseline
   |                            Reaction Test (baseline only - BR-006)
   |                            360 Comfort Test -> HARD low-sens constraint
   v
 STAGE 8  ADAPTIVE CALIBRATION  SCR-016..SCR-021  (blinded, interleaved)
   |        ROUND 1             candidates A/B/C, order counterbalanced
   |          block: Flick -> Micro -> Tracking -> Switching -> Precision
   |          (block order per candidate randomised; candidate identity hidden)
   |        -> fit response surface -> narrow
   |        ROUND 2             candidates recentred, spread halved
   |        ROUND 3             ... until a stopping condition fires (doc 13 s13.6)
   v
 STAGE 9  ANALYSIS              SCR-030 Processing / Analysis
   |                            "ANALYZING YOUR AIM" - real work, real progress
   |                            normalise -> dimensions -> fit -> confidence -> profile
   v
 STAGE 10 RESULT                SCR-031 Results
   |                            YOUR TRUE SENS  31.2 CM/360
   |                            range 29.7-32.4 | confidence 91 | BALANCED PRECISION
   |                            RESPONSE CURVE (the evidence) + AIM DNA + breakdown
   v
 STAGE 11 CONVERSION            SCR-032 Game Settings
   |                            Selected game first; switch output game freely
   |                            Verified adapters only (BR-014). Copy buttons.
   v
 STAGE 12 VALIDATION (opt)      SCR-033 Validation Test
   |                            Blind A/B: original vs recommended, paired blocks
   |                            Verdict: improved | no measurable difference | worse
   v
 STAGE 13 FINE TUNE (opt)       SCR-034 Fine Tune
   |                            Blind, narrow, 5 candidates around the recommendation
   v
 STAGE 14 KEEP                  SCR-040 Save / Sign Up  (guest)  or auto-saved (registered)
                                -> SCR-041 History
```

---

## 4.2 Stage-by-stage detail

### Stage 1 — Entry (SCR-001)
- No account wall, no cookie wall beyond what law requires, no email capture before value.
- The scroll narrative is the *explanation*, not decoration: each act shows a live canvas
  demonstration of the corresponding test at a plausible sensitivity.
- Secondary CTA "HOW IT WORKS" → SCR-002, which is the methodology page P4 reads first.

### Stage 2 — Game selection (SCR-010)
- Five launch tiles. Each tile shows its adapter's verification state honestly.
- **Critical rule:** selecting a game changes *nothing* about the calibration that follows.
  It selects the default output adapter and the default weight profile only
  (doc 14 §14.6). Stated to the user in one line so the blinding claim stays credible.
- "I play several / not listed" is a first-class option producing a cm/360-only result.

### Stage 3 — Hardware setup (SCR-011)
- DPI is the only required field (`SENS-BR-004`).
- Optional fields are collapsed behind a single "Add setup details (optional)" disclosure so the
  form reads as one question, not fourteen.
- Entering current game + current sensitivity converts to a cm/360 **anchor** which centres the
  search bracket. If the game is unverified, the value is accepted but not converted, and the
  bracket falls back to the default (doc 13 §13.3).
- Mousepad width, if given, sets the comfort constraint before the 360 Comfort Test even runs.

### Stage 4 — Environment check (SCR-012)
Four probes, each with its own outcome (doc 30 §30.4):

| Probe | Pass | Degraded | Blocked |
|---|---|---|---|
| Pointer Lock API present | continue | — | hard block, show guidance |
| `unadjustedMovement: true` granted | continue | continue + warn "OS pointer settings may affect measurement" + confidence penalty | — |
| Refresh rate + frame stability (3 s probe) | ≥ 95% frames on budget | 85–95% → warn | < 85% → offer Quick mode or block |
| DPI plausibility (vs current sens / pad width) | consistent | inconsistent → "double-check your DPI" | — |

Degraded outcomes are recorded on the session and feed the confidence index (doc 15 §15.5).
They never silently pass.

### Stage 5 — Introduction (SCR-013)
- Computes and shows an estimated duration **range** from the actual configured trial budget
  (`SENS-BR-024`). Never a hardcoded "20 minutes".
- Discloses blinding: "You will test several sensitivities. We won't tell you which is which
  until the end — that's what makes the result trustworthy."
- Motion/vestibular warning before pointer lock (`SENS-UX-024`).
- Mode switch (Quick / Standard / Advanced) is available here, last chance before commitment.

### Stage 6 — Practice (SCR-014)
- Unscored, cannot fail, cannot be "done badly".
- Ends when the user has produced ≥ 6 practice acquisitions **and** clicks continue — so a user
  who wants more practice can have it (`SENS-FR-036`).

### Stage 7 — Baseline (SCR-015)
- Reaction: establishes the player's reaction floor, used to *decompose* acquisition time
  (doc 10 §10.4) — never to pick a sensitivity.
- 360 Comfort: measures the largest turn the player can execute in one motion, converted to a
  physical distance; combined with declared pad width to bound the low-sensitivity end of the
  search (doc 13 §13.4).

### Stage 8 — Adaptive calibration (SCR-016..021)
- HUD shows round, progress, and pause hint only. Never the candidate, never a running score
  (`SENS-BR-007`).
- Between blocks: a 3–5 s neutral interstitial with a fixed crosshair, no score, no feedback.
  This both prevents score-chasing and gives the sensitivity change a moment to not feel jarring.
- ESC pauses (SCR-022 overlay), releasing pointer lock. Resume requires a re-lock and a 3-2-1
  countdown.

### Stage 9 — Analysis (SCR-030)
- Real computation, mostly client-side, with the persisted aggregate written server-side.
- The progress display animates *actual* stages (normalising → fitting → validating fit →
  classifying), not a fake timer. If it finishes in 400 ms, it holds for a minimum 1.2 s for
  legibility and then completes — a deliberate, disclosed floor, not a fake delay
  (`SENS-UX-021`).

### Stage 10 — Result (SCR-031)
Information hierarchy is fixed:
1. The number and its unit.
2. The range, the confidence, the profile name.
3. **The response curve** — the evidence.
4. Aim DNA.
5. Dimension breakdown with strengths / improvement areas.
6. Game settings entry point.
7. Validation CTA.
8. Methodology / versions footer.

### Stage 11 — Conversion (SCR-032)
- Output game switcher does not re-run anything; it re-projects the stored cm/360.
- Conversion method selector (360-distance / monitor-distance coefficient) with a one-line
  explanation and a sensible default per scope (doc 11 §11.7).
- Copy per field and copy-all; for CS2 also an optional console-command form.

### Stage 12 — Validation (SCR-033)
- Blind paired A/B, ~4–6 minutes.
- Verdict wording is constrained by `SENS-BR-016`; "no measurable difference" is a normal,
  well-designed outcome, not an error state.

### Stage 13 — Fine tune (SCR-034)
- Five blinded candidates around the recommendation; reuses the calibration machinery.

### Stage 14 — Keep (SCR-040 / SCR-041)
- Guest: a persistent but non-blocking banner "This result disappears in 7 days unless you save
  it." Sign-up claims the guest session server-side (doc 23 §23.6).
- Registered: already saved; goes to history.

---

## 4.3 Alternate journeys

### J-02 Guest, never registers
Completes J-01 through Stage 11. Result stored against a guest session with a 7-day TTL
(`SENS-BR-003`). Result page is reachable via an unguessable URL held in an HttpOnly cookie plus
a shareable read-only token if they choose to copy the link. On expiry, a friendly "this result
has expired" page with an offer to re-run.

### J-03 Registered user, first calibration
Same as J-01, plus: hardware profile is created or selected before Stage 3, session is written
against `user_id` from creation, autosave at every round boundary so a crash loses at most one
block.

### J-04 Returning user, re-calibration
Entry from SCR-041 History → "Re-calibrate". Prefills hardware profile and prior recommendation.
The prior recommendation seeds the starting bracket (a *much* tighter bracket than a cold start,
so re-calibration is materially shorter). On completion, SCR-042 Session Comparison opens
automatically showing old vs new with an explicit "is this change meaningful?" statistical
verdict (doc 17 §17.9).

### J-05 Multi-game user (P3)
J-01 with heavy use of Stage 11. Registers at Stage 14 specifically to keep the settings block.

### J-06 Advanced user with two hardware profiles (P4)
Runs J-01 twice, once per profile. Session comparison across *different* hardware profiles is
allowed but is flagged: "these sessions used different hardware; differences may reflect the
setup rather than you" (`SENS-BR-019`).

---

## 4.4 Exception and failure journeys

Each is a designed flow, not an error toast.

### 4.4.1 J-X1 — Pointer Lock denied or exited unexpectedly
**Trigger:** user denies the permission, the browser blocks it, or lock exits mid-trial
(alt-tab, OS notification, Esc on some browsers).

- Mid-trial exit → current trial immediately marked `invalid` with reason `pointer_lock_lost`,
  the session auto-pauses, SCR-022 shows "Pointer lock was released. Click to resume."
- Denial at Stage 4 → hard block with per-browser guidance and a "test with limited accuracy"
  path is **not** offered; without pointer lock the measurement is not meaningful
  (`SENS-BR-023`).
- Repeated loss (≥ 3 in one round) → suggest fullscreen, and flag the session
  `quality_flag: unstable_pointer_lock`.

### 4.4.2 J-X2 — `unadjustedMovement` unavailable
**Trigger:** browser/OS combination does not support raw pointer movement (see `EV-010`).

- Continue, but: banner on the test screen, `environment.unadjusted_movement = false` stored,
  confidence multiplier applied (doc 15 §15.5), and the result page explains that OS pointer
  acceleration may have influenced the measurement and recommends disabling Enhance Pointer
  Precision before re-running.

### 4.4.3 J-X3 — User does not know their DPI
**Trigger:** the "I don't know my DPI" escape hatch.

Ordered helper, cheapest first:
1. **Look it up** — mouse software / model lookup guidance, with common defaults by brand.
2. **Common default** — offer 800 (the most common configured value) as an explicit
   *assumption*, recorded as `dpi_source = 'assumed'`.
3. **Consistency estimate** — if the user knows their current game sensitivity *and* can
   estimate their 360 swipe distance on the pad, solve for DPI (doc 11 §11.9) and present it as
   an estimate, `dpi_source = 'estimated'`.

Consequences of a non-`known` DPI source, applied automatically:
- Result is presented primarily in **counts/360** and *relative* terms ("about 15% lower than
  what you use now") in addition to cm/360.
- Confidence index takes a documented penalty.
- The game settings block still works, because the game sensitivity number depends on DPI — so
  a wrong DPI produces a wrong game number. The UI states this dependency explicitly.

### 4.4.4 J-X4 — User does not know their current sensitivity
Not a problem. The bracket falls back to the wide default (doc 13 §13.3), Round 1 uses a wider
spread, and the session budget adds one extra round in Standard/Advanced. The user is told the
calibration will take slightly longer because there is no starting point.

### 4.4.5 J-X5 — Test interruption (tab hidden, window blur, disconnect)
- `visibilitychange`/`blur` during a trial → trial `invalid`, reason `focus_lost`; session pauses.
- Client keeps a durable local draft (IndexedDB) of completed rounds; on reconnect it replays
  unsent round aggregates idempotently keyed by `(session_id, presentation_order)`.
- Server side, a session in `in_progress` with no activity for 45 minutes transitions to
  `abandoned` by a sweeper; resuming a session after that requires an explicit "resume anyway"
  and marks it `quality_flag: long_gap` because fatigue/warm-up state is no longer comparable.

### 4.4.6 J-X6 — Browser performance problem detected mid-session
- Per-trial: > 8% of frames over budget → trial `degraded` (kept, scored, flagged).
- Per-round: > 20% degraded trials → round flagged; the round is re-queued once if budget allows.
- Per-session: sustained degradation → SCR-023 "Test quality warning" offering (a) continue with
  reduced confidence, (b) switch to Quick mode, (c) abort and get advice.
- Never silently continue and never silently discard (`SENS-BR-010`).

### 4.4.7 J-X7 — Invalid trial
Reason codes: `premature_click`, `no_input`, `pointer_lock_lost`, `focus_lost`, `frame_hitch`,
`timeout`, `impossible_velocity` (anti-manipulation, doc 23 §23.10).
Behaviour: the trial is retained in the database, excluded from scoring, counted in the quality
report, and — if it was procedural rather than performance-related — **replaced** by an extra
trial so the sample size target is still met (`SENS-BR-009`).

### 4.4.8 J-X8 — Mobile / touch visitor
- Landing, methodology, results, history, profile, hardware, and shared results all work.
- Any attempt to start a calibration shows SCR-050: "Calibration needs a mouse", with (a) a
  "send this to my desktop" link/QR, (b) a preview of what the test looks like, (c) the option
  to browse a sample result. No degraded touch calibration is offered (`SENS-BR-023`).

### 4.4.9 J-X9 — Player is highly inconsistent (flat response curve)
A real and common outcome. The fit finds no significant curvature.
- Verdict: "No single sensitivity clearly outperformed the others for you."
- Output: the **comfort range** (the whole tested band) rather than a point, low confidence,
  and concrete advice: your current sensitivity is fine; consistency, not sensitivity, is your
  limiter. Optionally offer Advanced mode with more trials.
- This must be a well-designed screen, because it is the outcome that most tempts a product into
  lying (`SENS-BR-017`).

### 4.4.10 J-X10 — Recommendation loses the validation A/B
Covered in doc 17 §17.5. Summary: state it plainly, lower the confidence, keep the original as
the standing recommendation, offer fine-tune or re-calibration with a wider bracket, and explain
familiarity bias without using it as an excuse.

### 4.4.11 J-X11 — Unverified game adapter
The user selected 三角洲行动 (or any game whose constants are unverified).
- Calibration runs completely normally — it is game-independent.
- Result page shows cm/360, range, confidence, profile, response curve, everything.
- The game settings block for that game shows a verification state: "We don't have a verified
  sensitivity model for this game yet. We won't guess." plus what *is* actionable: the cm/360
  and counts/360 targets they can match by hand, and a notify-me option.
- Other verified games still convert normally.

### 4.4.12 J-X12 — Session abandoned mid-calibration
Partial data is retained (`status = abandoned`) and never used to generate a recommendation.
On next visit within 24 h, offer "resume where you left off" if the environment fingerprint
matches; otherwise offer to start fresh. Abandonment point is an analytics event
(`test_abandoned` with `stage`, `round_index`) — the single most important funnel metric.

---

## 4.5 Journey-level requirements this document generates

| Journey | Generates |
|---|---|
| J-01 | `SENS-FR-001..085` core flow |
| J-X1 | `SENS-FR-030`, `SENS-BR-023` |
| J-X2 | `SENS-FR-029`, `SENS-NFR-038`, `EV-010` |
| J-X3 | `SENS-FR-018..021`, `SENS-BR-005` |
| J-X5 | `SENS-FR-045..047`, `SENS-NFR-018` |
| J-X6 | `SENS-FR-048`, `SENS-BR-010`, `SENS-NFR-005` |
| J-X8 | `SENS-FR-100`, `SENS-BR-023`, `SENS-UX-026` |
| J-X9 | `SENS-FR-070`, `SENS-BR-017` |
| J-X11 | `SENS-FR-079`, `SENS-BR-014` |
