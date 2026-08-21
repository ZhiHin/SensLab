# 12 — Game Adapter Architecture

Related: [11-canonical-sensitivity-model.md](11-canonical-sensitivity-model.md) · [08-supported-games.md](08-supported-games.md) · [36-external-verification-register.md](36-external-verification-register.md) · [20-data-model.md](20-data-model.md)

---

## 12.1 Purpose and position in the system

The adapter layer is the **only** place in SensLab that knows a game exists.

```
                 game-independent                    |   game-specific
  ---------------------------------------------------+------------------------
  test-engine -> metrics -> scoring -> calibration    |
                                          |           |
                                   counts_per_360  ---+--> GameAdapter --> settings
                                          ^           |
                          hardware(DPI) ---+           |
```

Two hard boundaries, both machine-enforced (doc 18 §18.5):

1. **Nothing in `core/` may import `game-adapters/`.** The calibration engine, scoring model,
   metrics and test engine cannot reference a game. Enforced by an ESLint zone rule and a CI
   boundary test.
2. **No game name, constant, multiplier, or setting label may appear outside `game-adapters/`
   and the database.** Enforced by a grep-based CI check with a small, reviewed allowlist for
   marketing copy and route slugs.

If those two rules hold, adding a game is data plus one module, forever.

---

## 12.2 Design goals

| Goal | Mechanism |
|---|---|
| A game can be added without touching the engine | Registry + interface, no engine branch on game |
| Conversions are versionable | Adapters are keyed by `(game, version)`, not by game |
| Unverified conversions are impossible to emit | The adapter's conversion method **throws** unless verification status permits (§12.6) |
| A recommendation stays correct after a game patch | Only `counts_per_360` is authoritative; settings are regenerable (`SENS-BR-025`) |
| Wrong conversions are detectable | Round-trip property tests + recorded verification evidence |
| The UI never hardcodes a game's fields | Adapters declare their scope roster and field labels as data |

---

## 12.3 The adapter contract

Expressed as a TypeScript-shaped description. **This is a specification, not code**; Phase 1 will
refine names during implementation, and deviations must be recorded.

```
GameAdapter
  identity
    gameId            stable slug, e.g. "cs2"
    gameVersionId     the specific build/patch this adapter is valid for
    adapterVersion    semver of the adapter module itself
    displayName       localised map { en, zh-Hans, ... }
    region            "global" | "cn" | ...

  capability
    scopes            ScopeDefinition[]         // what this game actually has
    verification      per-scope VerificationStatus
    sourceRefs        evidence pointers recorded at verification time
    lastVerifiedAt    timestamp
    verifiedAgainstBuild  string

  model (per scope)
    form              "linear_yaw" | "table" | "piecewise"
    params            form-specific, immutable
    settingRange      { min, max, step, decimals, roundingMode }
    settingLabel      localised in-game label, e.g. { en: "Sensitivity", zh-Hans: "灵敏度" }
    adsModel          "raw_multiplier" | "internally_fov_scaled" | "unknown"
    fovAxis           "horizontal" | "vertical" | null
    fovScaling        declared convention | null
    fovRange          { min, max } | null

  conversion
    toCanonical(setting, ctx)   -> { countsPer360 }        // throws if unverified
    fromCanonical(countsPer360, ctx) -> ConversionResult   // throws if unverified
    validate(setting, ctx)      -> ValidationResult

  ctx = { dpi, scopeKey, fovDeg?, aspectRatio?, matchCriterion? }

  ConversionResult
    idealSetting        number          // before quantisation
    setting             number          // after clamp + quantise
    achievedCountsPer360 number         // recomputed from `setting`
    achievedCmPer360     number
    quantisationErrorPct number
    clamped             boolean
    criterion           MatchCriterion | null   // for scoped values
    adapterVersion, gameVersionId, verification
```

**Notable properties of this contract:**

- `fromCanonical` returns the *achieved* values, not just the setting (doc 11 §11.4). Callers
  render the achieved value; the ideal is available for diagnostics.
- Conversion is **total in its failure mode**: it either returns a fully-attributed result or
  throws a typed `UnverifiedConversionError`. There is no "best effort" return.
- The adapter never formats for display and never touches the database. It is a pure function of
  its inputs plus its immutable model data.
- `validate` exists separately so the hardware-setup form can tell a user "3.5 is outside CS2's
  range" without performing a conversion.

---

## 12.4 Registry and resolution

```
AdapterRegistry
  register(adapter)
  resolve(gameId, at?: Date | versionId) -> GameAdapter
  listSupported(filter) -> AdapterSummary[]
```

- Resolution is by `(gameId, gameVersionId)`. When a caller does not pin a version, the registry
  returns the version marked current for that game at the requested time.
- **Historical recommendations always pin the version they were generated with**, so re-rendering
  an old result uses the old adapter, and a "re-convert with the current model" action is an
  explicit, visible user choice.
- The registry is populated from the database at boot and validated against the compiled adapter
  modules; a mismatch (a DB row for an adapter module that does not exist, or vice versa) is a
  startup error, not a runtime surprise.

---

## 12.5 Model forms in the adapter

### Form A — `linear_yaw`
`params = { yawDegPerCountAtSensOne }`. Conversion per doc 11 §11.2.

### Form B — `table`
```
params = {
  anchors: [{ setting, countsPer360 }, ...],   // measured, >= 5 points, monotone
  interpolation: "monotone_cubic_loglog",
  extrapolation: "refuse"
}
```
Requirements enforced by adapter tests:
- Anchors must be strictly monotone in `setting` and in `countsPer360`.
- At least five anchors spanning the game's usable range.
- `fromCanonical` outside the anchored range **refuses** rather than extrapolating, and the UI
  reports "outside the range we have measured for this game".
- Each anchor records the measurement that produced it in the verification register.

### Form C — `piecewise`
A declared function with named parameters and explicit breakpoints. Requires an individually
reviewed module and a documented derivation. Used only when a game genuinely needs it.

---

## 12.6 Verification gating — the mechanism

```
VerificationStatus = "verified" | "needs_recheck" | "partial" | "unverified"
```

Behaviour, per `(gameVersion, scope)`:

| Status | `toCanonical` / `fromCanonical` | UI |
|---|---|---|
| `verified` | Returns a result | Shows the value |
| `needs_recheck` | Returns a result | Shows the value **plus** "last verified against build X on date Y" |
| `partial` | Verified scopes convert; unverified scopes throw | Shows verified scopes only |
| `unverified` | **Throws `UnverifiedConversionError`** | Shows the verification state and the canonical targets; **no numeric setting anywhere** |

The gate lives inside the adapter, not in the UI. This is deliberate: a UI-level gate can be
bypassed by a new screen, a new API route, an export, or a share card. A gate inside the pure
conversion function cannot.

**Test that enforces it:** for every registered adapter and every scope with status
`unverified`, calling `fromCanonical` must throw. This test enumerates the registry, so a newly
added unverified adapter is covered automatically without anyone remembering to write a test.

---

## 12.7 Versioning rules

| Change | Requires |
|---|---|
| A game patch alters sensitivity behaviour | New `game_version` row + new adapter registration + fresh verification |
| A new measurement corrects a constant | New `adapterVersion`; the old one remains resolvable for historical results |
| A new scope is verified | Status change on that scope only; `partial` → `verified` when all are done |
| A default match criterion changes | New `adapterVersion` (it changes emitted numbers) |
| A display label or localisation changes | Patch-level `adapterVersion`; does not invalidate historical results |

`SENS-BR-029` applies: released adapter parameter sets are immutable. Corrections are new
versions, never edits.

**Consequence for the user:** when a game is re-verified and the model changes, historical
recommendations still render with their original converted values *and* offer a one-click
"update to the current model for <game>" that recomputes from the stored `counts_per_360`. The
old value is retained for comparison. This is only possible because the canonical value is
physical (`SENS-BR-025`).

---

## 12.8 Adapter testing requirements

Every adapter, without exception, ships with:

1. **Round-trip property test.** For 1,000 seeded settings across the valid range:
   `toCanonical → fromCanonical` returns the original within one quantisation step.
2. **Canonical round-trip.** For 1,000 seeded `counts_per_360` values in the admissible domain:
   `fromCanonical → toCanonical` returns the original within 1e-9 relative, before quantisation.
3. **Boundary tests.** `setting_min`, `setting_max`, one step beyond each; clamping behaviour and
   the `clamped` flag.
4. **Quantisation tests.** Achieved vs ideal difference is computed correctly and the reported
   error percentage matches.
5. **Verification gate test.** Unverified scopes throw (§12.6).
6. **Golden vector tests.** A table of `(dpi, setting, expected counts_per_360)` triples taken
   *directly from the recorded verification measurements*, not generated from the model. This is
   the test that catches a wrong constant — a self-consistent adapter passes every other test
   while being uniformly wrong.
7. **Table-form monotonicity and anchor-count tests** where applicable.
8. **Localised label presence test** for every declared locale.

Requirement 6 is the important one and is easy to skip. It is the only test in the suite that
compares the model against reality rather than against itself.

---

## 12.9 What an adapter must never do

- Never call a network service, read the database, or perform I/O of any kind.
- Never format numbers for display or contain user-facing prose beyond declared labels.
- Never reference another adapter (`SENS-BR-015` — in particular, the 三角洲行动 adapter must
  not delegate to the Delta Force Global adapter; enforced by a test).
- Never accept a "force" or "approximate" flag that bypasses verification.
- Never mutate its own parameters at runtime.
- Never depend on the calibration engine, scoring, or any session state beyond the `ctx` it is
  given.

---

## 12.10 Adding a game — the full checklist

1. Create `games` and `game_versions` rows (migration or seed).
2. Perform the verification procedure (doc 08 §8.5) and record evidence in the register.
3. Create `game_sensitivity_models` and `game_scopes` rows for each supported scope.
4. Implement the adapter module under `game-adapters/<slug>/`, declaring form, params, ranges,
   labels, ADS model, and FOV conventions.
5. Register it in the adapter registry.
6. Write the eight test classes from §12.8, including golden vectors from the measurements.
7. Add localised setting labels.
8. Set the verification status and the re-check trigger.
9. Add the game tile asset and selection copy.

Steps 1–3 and 6 are the substance; steps 4–5 and 9 are mechanical. **Nothing in this list touches
the calibration engine, the scoring model, the test engine, or the schema.** That is the test of
whether this architecture actually works, and it is asserted by a CI check that fails if a diff
adding a game touches `core/`.

---

## 12.11 Anticipated per-game complications

Recorded now so they are designed for rather than discovered later.

| Game | Complication | Design accommodation |
|---|---|---|
| CS2 | Zoom sensitivity is a multiplier with specific semantics; behaviour across zoom levels must be verified | Per-scope models; `ads_model` declaration |
| Apex Legends | Per-optic ADS values plus a global multiplier plus a toggle between the two modes | Scope roster is data; the adapter may declare a `mode` context field and emit a settings *set*, not a single number |
| PUBG | Multiple independent sensitivity settings (general / targeting / per-scope), possibly non-linear | Form B/C; `game_scopes` with `has_separate_setting` |
| Delta Force Global | Unknown; may express sensitivity as a percentage | Form determined by verification; percentage handled by `settingRange` + `decimals` |
| 三角洲行动 | Independent verification; Chinese setting labels are essential for the value to be usable | Localised `settingLabel` is a required field, not optional |

The Apex case is the one that shapes the contract: `fromCanonical` must be able to return a
**set of settings** for one scope state (e.g. a global multiplier *and* a per-optic value), not
a single scalar. The `ConversionResult` above is therefore modelled per-scope, and the UI renders
whatever set the adapter declares — which is why the settings block is data-driven (FR-080).
