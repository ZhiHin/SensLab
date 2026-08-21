# 08 — Supported Games

Related: [11-canonical-sensitivity-model.md](11-canonical-sensitivity-model.md) · [12-game-adapter-architecture.md](12-game-adapter-architecture.md) · [36-external-verification-register.md](36-external-verification-register.md)

---

## 8.0 The rule that governs this entire document

> **SensLab does not guess game constants.**

A game is *supported for calibration* the moment it appears in the game selector — because the
calibration is game-independent. A game is *supported for conversion* only when its sensitivity
model has been verified against an authoritative source and validated empirically. These are
two different states and the product must show the difference.

Nothing in this document is a shipped constant. Every numeric claim about a third-party game is
either absent or carries an `EV-###` verification id. The register in
[36-external-verification-register.md](36-external-verification-register.md) is the single
source of truth for status.

---

## 8.1 Launch roster

| Slug | Display name | Region / build | Engine family | Calibration | Conversion status at Phase 0 |
|---|---|---|---|---|---|
| `cs2` | Counter-Strike 2 | Global | Source 2 | Supported | **Unverified** — model hypothesis documented, `EV-001` |
| `apex-legends` | Apex Legends | Global | Source-derived | Supported | **Unverified** — `EV-002` |
| `pubg` | PUBG: BATTLEGROUNDS | Global | Unreal Engine | Supported | **Unverified** — `EV-003` |
| `delta-force-global` | Delta Force | Global | — | Supported | **Unverified** — `EV-004` |
| `delta-force-cn` | 三角洲行动 | China | — | Supported | **Unverified** — `EV-005` |
| `generic` | I play several / not listed | — | — | Supported | N/A — cm/360 output only |

"Unverified" here is a statement about **SensLab's own verification process**, not a claim that
the information is unknowable. Several of these games have well-established, publicly discussed
sensitivity models. The point is that SensLab has not yet performed and recorded its own
verification, and until it does, the adapter refuses to produce a number
(`SENS-BR-013`, `SENS-BR-014`).

---

## 8.2 What "verified" requires

An adapter reaches `verified` for a given `(game_version, scope)` only when **all** of the
following are recorded in the verification register:

1. **Model form identified** — linear yaw-constant, lookup table, piecewise, or other — with the
   evidence for that form.
2. **Constants captured** with their source (official documentation, in-game config file, a
   reproducible measurement, or a named community reference of established reliability).
3. **Empirical confirmation** — an in-game measurement performed by SensLab or a trusted
   contributor: set the game to sensitivity *S* at DPI *D*, execute a known number of counts,
   and confirm the resulting rotation matches the model within tolerance (§8.5).
4. **Range and granularity** captured — the minimum, maximum, and step of the in-game setting,
   so SensLab never emits an unenterable value.
5. **Version pinned** — the game build/patch the verification was performed against, plus a
   re-check trigger.
6. **Two-person sign-off** recorded on the register entry.

Anything less is `partial` (some scopes verified, others not) or `unverified`.

---

## 8.3 Model hypotheses per game

These are *hypotheses to be tested during verification*, recorded here so the verification work
has a starting point. They are explicitly **not** approved for implementation.

### 8.3.1 Counter-Strike 2 — `EV-001`
- **Hypothesis:** a linear yaw-constant model, i.e. `degrees_per_count = sensitivity × yaw`,
  where `yaw` is a fixed engine constant, matching long-standing Source-engine behaviour where
  the console variable `m_yaw` supplies that constant and defaults to a documented value.
- **To verify:** the constant's exact value in the current CS2 build; whether the shipped default
  is still user-modifiable; whether zoomed weapon states use a separate multiplier setting; the
  valid range and step of the in-game sensitivity slider; the behaviour of "raw input" and
  whether any Windows pointer setting can influence it.
- **Scopes:** hipfire plus zoom states. CS2 exposes a zoom sensitivity multiplier
  concept — its exact semantics (which zoom levels it covers, and what "1.0" means relative to
  hipfire) must be verified before any ADS number is emitted.
- **Why this is the first adapter:** best-documented model, most testable, and it is the launch
  gate (doc 02 §2.7).

### 8.3.2 Apex Legends — `EV-002`
- **Hypothesis:** a linear yaw-constant model from the same engine lineage as CS2.
- **To verify:** whether the yaw constant is identical to CS2's or differs; how the per-optic
  ADS sensitivity settings behave (Apex exposes both a global ADS multiplier and per-optic
  values, plus a "per-optic ADS" toggle); the game's FOV setting range and whether it is
  horizontal or vertical at a given aspect ratio; whether the ADS multiplier is FOV-dependent
  (this determines whether SensLab must apply a monitor-distance model or the game already
  performs one internally — a critical distinction).
- **Risk:** Apex's per-optic system is the most complex of the five. Ship hipfire first;
  per-optic is a separate verification item.

### 8.3.3 PUBG — `EV-003`
- **Hypothesis:** **not** a simple linear yaw constant. PUBG exposes several separate
  sensitivity settings (general, targeting/ADS, and per-scope values) and the relationship
  between the setting number and the resulting rotation may be non-linear.
- **To verify:** the functional form itself, before any constants. If the relationship is not
  linear, the adapter must use a `table` or `piecewise` model with measured anchor points and
  documented interpolation — see doc 12 §12.5.
- **Explicit warning:** this is the game most likely to be silently wrong if a linear model is
  assumed. Do not implement PUBG with a yaw constant until §8.3.3's form question is answered.

### 8.3.4 Delta Force (Global) — `EV-004`
- **Hypothesis:** unknown. No model form is assumed.
- **To verify:** everything — model form, constants, setting ranges, ADS/scope behaviour,
  FOV semantics, and whether sensitivity is expressed as a percentage or a scalar.

### 8.3.5 三角洲行动 (China) — `EV-005`
- **Hypothesis:** unknown, and **independently unknown**. See §8.4.

---

## 8.4 Delta Force Global vs 三角洲行动 — treated as different games

`SENS-BR-015` forbids assuming these two are equivalent. The reasons are concrete:

- They are operated by different publishers in different regions and are patched on different
  cadences, so at any given moment they may be on different builds.
- Regional builds of live-service shooters routinely differ in settings menus, default values,
  option ranges, and localisation of setting names.
- Sensitivity-relevant behaviour (FOV limits, ADS models, available scopes, presence of a
  per-scope system) is exactly the class of thing that diverges between regional builds.

**Design consequence:** two `games` rows, two adapter registrations, two verification tracks,
two version histories. If verification later establishes that the two are identical on a given
build, that finding is recorded as a *result* on both register entries — the adapters still
remain separate rows, because the equality is a property of a build pair, not a permanent fact.

**Product consequence:** it is entirely acceptable for the Global adapter to reach `verified`
while the China adapter remains `unverified`, and the UI must handle that asymmetry gracefully
(doc 04 §4.4.11).

---

## 8.5 Empirical verification procedure

The procedure a verifier follows, recorded per game version:

1. **Fix the environment.** Known DPI (measured from the mouse's own software at a setting the
   mouse reports exactly), Windows pointer speed at the neutral step, Enhance Pointer Precision
   **off**, raw input **on** in-game where such a setting exists, and a documented FOV.
2. **Pick two sensitivity values** spanning the usable range (e.g. a low and a high setting) —
   two points test linearity, one point cannot.
3. **Execute a known count displacement.** Either with a controlled hardware jig, a mouse with
   a reliable count readout, or by using a fixed physical distance against a ruler with a
   verified-DPI mouse. Record the method.
4. **Measure the resulting rotation** using an in-game reference (a fixed world landmark and a
   known-angle sweep, or a 360° alignment test: swipe until the view returns exactly to the
   starting landmark, and record the distance).
5. **Compare against the hypothesised model.** Record the residual.
6. **Repeat for each scope state** to be supported.
7. **Record tolerance.** Acceptance threshold: model prediction within **±0.5%** of measured
   cm/360. Anything worse means the model form is wrong, not that the constants need nudging.
8. **Record the build identifier** and set a re-check trigger.

The 360° alignment method is the highest-value single measurement because it directly yields
counts/360, which is exactly SensLab's canonical unit — no intermediate angle estimation is
required.

---

## 8.6 Re-verification triggers

An adapter's `verified` status is **not permanent**. It reverts to `needs_recheck` when any of
these occur:

| Trigger | Detection |
|---|---|
| The game ships a major version/season update | Manual watch per game; recorded cadence in the register |
| A settings-menu change is reported | Community/report channel |
| A user reports a mismatch between SensLab's output and their in-game feel/measurement | In-product "this number seems wrong" report (POST-MVP) |
| More than 6 months since last verification | Automated register staleness check |

While `needs_recheck`, the adapter continues to serve values (it was verified once) but the UI
surfaces a "last verified against build X on date Y" line. If a mismatch is confirmed, the
status drops to `unverified` and values stop being served immediately.

`ASSUMPTION` — the 6-month staleness window is a starting policy, tunable once patch cadences
for the five launch games are observed.

---

## 8.7 Localisation obligations

| Game | Locale obligation |
|---|---|
| 三角洲行动 | zh-Hans is required for MVP on game selection, hardware setup, results, and game settings. Setting names must match the in-game Chinese names exactly, or the copy-paste value is useless. |
| All others | en for MVP; zh-Hans strongly preferred since the audiences overlap |

Setting **names** are part of the adapter data, not the UI translation layer: the adapter
declares what each field is called in-game, per locale, so that "Hipfire" maps to the exact
label the user will look for in that game's menu in their language. Getting this wrong is a
common and very annoying failure of existing converters.

---

## 8.8 Future games — the extension contract

Adding a game must require **zero** changes to the calibration engine, the scoring model, the
test engine, or the database schema. Concretely, adding a game is:

1. Insert `games` + `game_versions` rows.
2. Register an adapter module implementing the interface in doc 12 §12.3.
3. Complete a verification register entry.
4. Add localisation entries for setting names.
5. Add adapter unit tests including round-trip property tests.

Planned candidates, in rough order of audience value: Valorant, Overwatch 2, Rainbow Six Siege,
Call of Duty / Warzone, Battlefield, Marvel Rivals, Fortnite.

Each carries its own model-form question — several of these games are known in the community to
use distinctly different sensitivity representations (percentage sliders, in-game "eDPI"-style
scales, or per-weapon systems). None may be implemented on an assumed form.

---

## 8.9 What SensLab stores per game

Summarised here; full schema in doc 20 §20.4.

- `games` — identity, slug, localised display names, region, status, sort order.
- `game_versions` — the build/patch a model applies to, effective dates, verification status,
  source references.
- `game_sensitivity_models` — one row per `(game_version, scope_key)`: model form, parameters,
  setting min/max/step, FOV model, verification status.
- `game_scopes` — the scope roster for that version (hipfire, ADS, 1×–8×), with the in-game
  setting name per locale and whether the scope has an independent setting.

The separation of `game_versions` from `game_sensitivity_models` is deliberate: a patch may
change one scope's behaviour without changing the others, and verification status must be
tracked at scope granularity.
