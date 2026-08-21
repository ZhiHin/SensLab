# 36 — External Verification Register

Related: [08-supported-games.md](08-supported-games.md) · [12-game-adapter-architecture.md](12-game-adapter-architecture.md) · [11-canonical-sensitivity-model.md](11-canonical-sensitivity-model.md)

---

## 36.1 Purpose

Every factual claim about a third-party game, browser, or operating system that SensLab would
need to *depend on* is recorded here with a status and an owner. Nothing in this register may be
implemented as a constant until its status is `verified`.

This is the single source of truth for verification state. Inline `REQUIRES_EXTERNAL_VERIFICATION`
marks elsewhere in Phase 0 link here by ID.

**Status vocabulary**

| Status | Meaning | Consequence in code |
|---|---|---|
| `open` | Not yet investigated | Feature blocked |
| `investigating` | Work started, no conclusion | Feature blocked |
| `verified` | Confirmed by SensLab's own procedure, with recorded evidence and sign-off | May ship |
| `needs_recheck` | Was verified; a trigger has fired | Ships with a "last verified" disclosure |
| `rejected` | Investigated and found to be unavailable/unknowable | Feature permanently gated with an honest explanation |

**Every entry is `open` at the end of Phase 0.** That is the correct and honest state: Phase 0
produced no measurements.

---

## 36.2 Game sensitivity models

### EV-001 — Counter-Strike 2: hipfire sensitivity model
**Status:** `open` · **Blocks:** the CS2 adapter, and therefore the launch gate (doc 02 §2.7) ·
**Area:** Game adapters

**What must be established**
1. The model form — is `degrees_per_count = setting × constant` exactly true across the range?
2. The value of that constant in the current build, and whether it is user-modifiable.
3. The valid range, step and decimal precision of the in-game sensitivity setting.
4. Whether any in-game or OS setting (raw input toggle, Windows pointer speed) alters the
   relationship.
5. The exact in-game label of the setting, in en and zh-Hans.

**Method:** doc 08 §8.5, using the 360° alignment measurement at two widely separated sensitivity
values (two points are required to test linearity; one cannot).
**Acceptance:** model prediction within ±0.5% of measured cm/360 at both points.
**Priority:** **Highest.** Start in Phase 1 (doc 34, J1).

---

### EV-002 — Apex Legends: hipfire sensitivity model
**Status:** `open` · **Blocks:** the Apex adapter · **Area:** Game adapters

As EV-001, plus: whether the yaw constant is identical to CS2's or differs — this must be
**measured, not inferred from a shared engine lineage.** Also: the FOV setting's range, and
whether the stated FOV is horizontal or vertical at a given aspect ratio (see EV-014).

---

### EV-003 — PUBG: sensitivity model **form**
**Status:** `open` · **Blocks:** the PUBG adapter · **Area:** Game adapters

**The form question comes first.** PUBG exposes several separate sensitivity settings and the
relationship between the setting number and the resulting rotation may not be linear.

**What must be established**
1. Whether the relationship is linear. Requires **at least five** measurement points across the
   range, not two.
2. If non-linear: measured anchor points sufficient for a `table` model (doc 12 §12.5), with a
   documented interpolation method and a refusal to extrapolate.
3. Which named setting controls hipfire rotation, and how the general/targeting/per-scope
   settings interact.
4. Setting range, step, and whether values are percentages or scalars.

**Explicit warning recorded here:** implementing PUBG with an assumed linear yaw constant is the
most likely way for this project to ship a silently wrong number. Do not.

---

### EV-004 — Delta Force (Global): sensitivity model
**Status:** `open` · **Blocks:** the Delta Force Global adapter · **Area:** Game adapters

Nothing is assumed: model form, constants, setting representation (scalar or percentage), range,
step, and the exact setting labels all require establishment from zero.

---

### EV-005 — 三角洲行动 (China): sensitivity model
**Status:** `open` · **Blocks:** the 三角洲行动 adapter · **Area:** Game adapters

**Independently** required (`SENS-BR-015`). This entry may not be closed by reference to EV-004.

Additional requirements specific to this entry:
- The build identifier of the China client at verification time, recorded separately from the
  Global build.
- The exact zh-Hans setting labels, since a copyable value is useless if the user cannot find the
  field.
- An explicit finding on whether the two builds agree — recorded as a *result* on both EV-004 and
  EV-005, for that build pair only.

---

## 36.3 ADS, scope and FOV models

### EV-006 — CS2: zoom / scoped sensitivity model
**Status:** `open` · **Blocks:** CS2 ADS and per-scope output

Establish: which zoom states exist; whether a zoom sensitivity multiplier applies uniformly
across them; what a value of 1.0 means relative to hipfire; and critically, whether the game
already applies its own FOV-dependent scaling (`ads_model`, doc 11 §11.6.4).

### EV-007 — Apex Legends: per-optic ADS model
**Status:** `open` · **Blocks:** Apex ADS and per-optic output

The most structurally complex of the five. Establish: the relationship between the global ADS
multiplier and the per-optic values; the effect of the per-optic toggle; whether values are
FOV-compensated internally; and which optics map to which magnifications.
Consequence for the adapter contract: `fromCanonical` may need to return a **set** of settings
for one scope state (doc 12 §12.11).

### EV-008 — PUBG: per-scope models
**Status:** `open` · **Blocks:** PUBG ADS and per-scope output

Establish the form and constants for each scope magnification independently. Per-scope
verification granularity means PUBG may reach `partial` with hipfire verified and scopes not.

### EV-009 — Delta Force (Global and China): ADS and scope models
**Status:** `open` · **Blocks:** ADS/scope output for both builds

Two independent entries in practice; tracked together only for convenience. Establish the scope
roster each build actually offers before assuming any ladder of magnifications.

### EV-014 — FOV axis and scaling conventions per game
**Status:** `open` · **Blocks:** every ADS/scope conversion

For each game: is the stated FOV horizontal or vertical? At what reference aspect ratio? How does
it scale on ultrawide (Hor+, Vert−, or otherwise)? What is the settable range?

Getting this wrong leaves hipfire correct and silently corrupts every scoped value — a
particularly hard failure to notice, which is why it is a separate tracked entry rather than a
line item inside each game.

### EV-015 — Setting ranges, steps and precision per game and scope
**Status:** `open` · **Blocks:** quantisation correctness (doc 11 §11.4)

Without these, SensLab can emit a value the game cannot accept, or misreport the achieved
cm/360. Required for every `(game_version, scope)` before that scope ships.

---

## 36.4 Platform and browser

### EV-010 — `unadjustedMovement` support matrix
**Status:** `open` · **Blocks:** the browser support matrix, the environment-check design, and
possibly onboarding copy · **Area:** Engineering · **Priority: highest non-game item**

**What must be established**
1. Which browser/OS combinations honour `requestPointerLock({ unadjustedMovement: true })`.
2. How a refusal presents — promise rejection, silent downgrade, or a thrown error.
3. Whether the *effective* state can be read back, and if not, whether a movement-scale probe can
   detect it reliably.
4. Whether OS pointer speed and Enhance Pointer Precision are genuinely bypassed when it is
   granted.

**Why it is high priority:** it determines `SENS-NFR-037`, the environment-check outcomes, the
`C_env` confidence penalty, and risk R-04. It requires no application code, so it can be resolved
in Phase 1 with a small probe page (doc 34, J2).

### EV-012 — Windows pointer-speed multiplier table
**Status:** `open` · **Blocks:** nothing (context only) · **Area:** Engineering

The multipliers associated with the 11 pointer-speed steps, and the precise conditions under
which they affect a browser's `movementX/Y`.

**Important:** SensLab does **not** use these values as multipliers in any calculation
(doc 11 §11.8). They are collected as context for warnings and support diagnosis. This entry
exists so that no one later "improves" the product by applying a folklore table to correct
measurements — which would be worse than the problem.

### EV-013 — Server Actions CSRF guarantees for the chosen framework version
**Status:** `open` · **Blocks:** nothing (defence in depth) · **Area:** Security

The exact origin-checking behaviour of Server Actions in the Next.js version selected in Phase 1,
confirmed from that version's documentation. SensLab's own middleware origin check
(doc 23 §23.5) exists so that protection does not depend solely on framework behaviour; this
entry confirms whether that check is redundancy or the primary defence.

---

## 36.5 Methodology naming

### EV-011 — Third-party naming of FOV-matching criteria
**Status:** `open` · **Blocks:** UI labelling of conversion methods · **Area:** Product

SensLab's ADS/scope maths is derived from first principles (doc 11 §11.6) and does not depend on
any third-party convention. However, the *labels* SensLab uses ("monitor distance 50%", "focal
length") are shared vocabulary with well-known community calculators, and a mismatch in meaning
would mislead users comparing tools.

**What must be established:** what widely-used calculators mean by each label, particularly
whether "0% monitor distance" denotes the focal-length limit or something else.
**Outcome if ambiguous:** SensLab uses its own unambiguous descriptions ("matched at the screen
centre", "matched halfway across the screen") and does not adopt the contested label.

---

## 36.6 Register summary

| ID | Subject | Status | Blocks | Priority |
|---|---|---|---|---|
| EV-001 | CS2 hipfire model | open | CS2 adapter, launch gate | **1** |
| EV-010 | `unadjustedMovement` matrix | open | Support matrix, env check | **2** |
| EV-002 | Apex hipfire model | open | Apex adapter | 3 |
| EV-015 | Setting ranges and steps | open | Quantisation correctness | 3 |
| EV-014 | FOV axis and scaling | open | All scoped conversion | 4 |
| EV-003 | PUBG model form | open | PUBG adapter | 4 |
| EV-006 | CS2 zoom model | open | CS2 scoped output | 5 |
| EV-004 | Delta Force Global model | open | DF Global adapter | 5 |
| EV-005 | 三角洲行动 model | open | 三角洲行动 adapter | 5 |
| EV-007 | Apex per-optic model | open | Apex scoped output | 6 |
| EV-008 | PUBG per-scope models | open | PUBG scoped output | 6 |
| EV-009 | Delta Force ADS/scope | open | DF scoped output | 6 |
| EV-011 | Criterion naming | open | UI labels only | 7 |
| EV-013 | Server Actions CSRF | open | Defence in depth | 7 |
| EV-012 | Windows pointer table | open | Nothing (context) | 8 |

**15 open items. 0 verified. 0 rejected.**

---

## 36.7 Process

**Per entry, on completion, record:** the method used, the raw measurements, the build/version
identifier, the date, the resulting model and constants, the residual against acceptance
tolerance, two sign-offs, and the re-check trigger.

**Re-check triggers** (doc 08 §8.6): a major game update, a reported settings-menu change, a user
mismatch report, or 6 months elapsed.

**Governance:** adapter parameter changes require review and must be traceable to a register entry
(`SENS-SEC-023`). A parameter change without a corresponding register update is rejected in
review.

**What "we could not verify this" looks like:** status `rejected`, the adapter stays gated, the
UI shows the honest empty state, and the canonical cm/360 and counts/360 targets are offered
instead. This is a supported, designed outcome — not a failure of the product
(doc 04 §4.4.11, doc 25 §25.10).
