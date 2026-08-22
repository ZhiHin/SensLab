# Phase 5 Completion Report — Verified Game Profiles & Conversion

**Phase:** 5 of 11
**Scope:** game-specific output, only where evidence has been independently verified
**Source of truth:** [`36-external-verification-register.md`](../phase-0/36-external-verification-register.md) · [`12-game-adapter-architecture.md`](../phase-0/12-game-adapter-architecture.md) · [`11-canonical-sensitivity-model.md`](../phase-0/11-canonical-sensitivity-model.md) · [`08-supported-games.md`](../phase-0/08-supported-games.md)
**Date:** 2026-08-23

---

## 1. Status

**Complete — with zero verified games, by design.**

The phase prompt says: _"If a game remains unverified: DO NOT provide converted numbers. Keep
that adapter unavailable. This does NOT block the phase if the documentation explicitly
permits partial verified support."_ Doc 36 §36.7 permits exactly that: _"status `rejected`, the
adapter stays gated, the UI shows the honest empty state, and the canonical cm/360 and
counts/360 targets are offered instead. This is a supported, designed outcome — not a failure
of the product."_

The register was the first thing read in this phase. It records **15 open items, 0 verified**.
That has not changed, because no one has performed SensLab's own measurement procedure
(doc 08 §8.5) for any game, and the standing rule is absolute: **no verified evidence = no
number.** A forum, a calculator, an AI answer or a value that "looks correct" is not evidence
(phase prompt, "CRITICAL RULE"), and this phase did not consult any of them. No real game
constant appears anywhere in `src/`.

What the phase therefore built is everything _around_ the constant: both model forms, the
quantisation, the ADS/scope family, the verification gate, the construction checks, the
re-check mechanism, the conformance suite, the conversion service and the settings surface —
all exercised end to end against openly fictional fixtures. The deliverable is a system in
which a real game can be added by closing a register entry and nothing else, and in which a
constant **cannot** be merged without closing one.

**A user with a calibrated canonical sensitivity can safely obtain settings for verified
adapters** (the exit criterion). There are none, so they safely obtain their canonical targets
and a named reason, which is the honest state doc 04 §4.4.11 designs for.

---

## 2. What was built

### The register, in code

`src/game-adapters/verification/register.ts` carries doc 36 §36.6 as data. A document cannot
stop a constant from being merged; this module can. `createVerifiedAdapter` refuses to build a
scope whose governing entry is not closed, and `AdapterRegistry.register` refuses a scope that
cites an entry that does not exist or claims more than it authorises. A pull request that adds
a yaw constant therefore cannot pass CI without also flipping the entry that authorises it —
which is the reviewable moment `SENS-SEC-023` asks for.

A test reads doc 36 and asserts the two registers agree on every id and on the summary line
_"15 open items. 0 verified. 0 rejected."_ Closing an entry changes that line and that
assertion, deliberately.

### Two model forms, no default

| Form             | Module                | Property                                                                                                                 |
| ---------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| A — `linear_yaw` | `model/linear-yaw.ts` | Exactly invertible. The constant is a measured input; the module never supplies one                                      |
| B — `table`      | `model/table.ts`      | Fritsch–Carlson monotone cubic on log–log axes. Cannot overshoot between anchors. **Refuses to extrapolate**             |
| C — `piecewise`  | _absent_              | Doc 12 §12.5 requires an individually reviewed module with a documented derivation; it arrives with a game that needs it |

The union has no fallback variant. "Assume linear" is the guess `SENS-BR-013` forbids and the
one doc 08 §8.3.3 names as the most likely way to ship a silently wrong number.

### The construction checks — the substance of the phase

`createVerifiedAdapter` fails at module load, before any test runs, when:

1. the scope's register entry is not closed;
2. the evidence carries fewer than two measurements at distinct settings (doc 08 §8.5 step 2 —
   two points test a form, one cannot);
3. the declared model fails to reproduce its own recorded readings within **±0.5%**, which
   doc 08 §8.5 step 7 defines as meaning _the model form is wrong, not that the constants need
   nudging_.

Check 3 is the one that matters. Round-trip, boundary, quantisation and monotonicity tests all
compare an adapter against itself, and a uniformly wrong constant satisfies every one of them.
Only replaying the measurements compares it against reality. Doc 12 §12.8 calls that test "easy
to skip"; here it is a precondition of the object existing.

### Quantisation (doc 11 §11.4)

Clamp → quantise → **recompute the achieved value through the model** → report the signed
error. The achieved cm/360 is what renders. Where the error exceeds 1.5% (`TUNABLE`), the
adapter computes a DPI at which an achievable setting is exact, from the model's own grid.

### ADS and scopes (doc 11 §11.6)

The maths was already in `core/sensitivity/fov`. What this phase adds is the game-dependent
part: a mandatory per-scope `adsModel` where `unknown` emits nothing; a `ScopeOptics`
description that distinguishes a _measured_ half-FOV from a magnification that carries the
tangent-space assumption; the doc 11 §11.6.3 default criteria, labelled as opinions and
overridable (FR-085). `internally_fov_scaled` bypasses the criterion entirely — applying it
would leave hipfire correct and every scoped value wrong by exactly the game's own factor.

### Verification decay (doc 08 §8.6)

`evaluateRecheck` applies the four triggers. Staleness, a game update or a menu change
downgrade a `verified` scope to `needs_recheck`, where it keeps serving behind a "last verified
against build X on date Y" disclosure. A confirmed mismatch drops it to `unverified`, where it
serves nothing. `withVerificationOverlay` produces a **new adapter** — the original is
immutable (`SENS-BR-029`) — whose conversion functions refuse, so no surface can opt out. The
registry replaces the registration in place; there is no second resolution path to the
original. `runVerificationRecheck` persists the downgrade so the boot check stays green.

### The conformance suite

`tests/helpers/adapter-conformance.ts` implements all eight test classes of doc 12 §12.8 once
and runs them over **every** registered adapter. A game added tomorrow is covered tonight.

### The surface

`/games` publishes the register and every adapter's state, all read from code, none written as
copy. `/games/[gameId]` converts a canonical sensitivity server-side and renders the canonical
targets **first and always**, then either the data-driven settings block (FR-080) or the named
refusal with its register entry. The components take a `GameSettingsView` and nothing else, so
Phase 7 can mount them inside the results screen unchanged.

---

## 3. Files created / modified

### Created — `src/` (14 files)

```
src/game-adapters/verification/register.ts    doc 36 as data; the authority
src/game-adapters/verification/staleness.ts   re-check triggers and the downgrade ladder
src/game-adapters/verification/overlay.ts     downgrade as a new adapter, never an edit
src/game-adapters/verification/index.ts
src/game-adapters/model/linear-yaw.ts         Form A
src/game-adapters/model/table.ts              Form B
src/game-adapters/model/quantise.ts           clamp, quantise, achieved value, DPI suggestion
src/game-adapters/model/errors.ts
src/game-adapters/model/index.ts              the closed union, no default
src/game-adapters/scoped.ts                   adsModel, optics, criterion defaults
src/game-adapters/verified-adapter.ts         the builder and its construction checks
src/game-adapters/advice.ts                   DPI suggestion from the scope's own grid
src/services/conversion-service.ts            server-side conversion; canonical always present
src/services/verification-service.ts          persisted re-check; transparency data
src/features/game-settings/{contracts,copy}.ts, settings-block.tsx
src/app/(app)/games/page.tsx, [gameId]/page.tsx
```

### Created — tests (12 files, 136 new cases)

```
tests/helpers/adapter-conformance.ts          doc 12 §12.8, all eight classes, parameterised
tests/unit/game-adapters/conformance.test.ts  runs it over the registry + both fixtures
tests/unit/game-adapters/verification.test.ts register ↔ doc 36, construction checks, decay
tests/unit/game-adapters/models.test.ts       Form A invertibility; Form B monotonicity, refusal
tests/unit/game-adapters/quantise.test.ts     achieved ≠ ideal; grid; DPI suggestion
tests/unit/game-adapters/scoped.test.ts       adsModel gate, optics, criterion ordering
tests/unit/game-adapters/refusals.test.ts     every path to "no number"
tests/unit/game-adapters/advice.test.ts
tests/unit/features/game-settings-query.test.ts
tests/integration/game-verification.test.ts   boot consistency; DB ↔ registry ↔ register
tests/e2e/game-settings.spec.ts               the honest empty state, in a browser
```

### Modified

| File                                        | Change                                                                                                     |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/game-adapters/types.ts`                | `VerificationMeasurement`; `evidence.measurements` required; `model`, `optics` on scopes; `canonicalBasis` |
| `src/game-adapters/registry.ts`             | Register-backed integrity checks; `applyOverlay`, `runRecheck`; richer summaries                           |
| `src/game-adapters/unverified.ts`           | Declares `model: null`, `optics: null`                                                                     |
| `src/game-adapters/index.ts`                | Exports                                                                                                    |
| `src/repositories/game-repo.ts`             | `downgradeVersionVerification` — downgrade only                                                            |
| `src/app/(marketing)/page.tsx`              | Link to `/games`                                                                                           |
| `tests/helpers/fixture-adapter.ts`          | Now built by `createVerifiedAdapter` (see §4.1); table fixture added                                       |
| `tests/unit/game-adapters/registry.test.ts` | Register-aware assertions                                                                                  |
| `README.md`                                 | Phase 5 status; "How a constant gets shipped"                                                              |

---

## 4. Defects and design problems found

**4.1 The fixture adapter was a parallel implementation.** The Phase 1 fixture reimplemented
the conversion logic by hand, so the registry tests were testing a copy that could diverge from
production without any test noticing. It is now built by `createVerifiedAdapter` — the function
a real adapter would use — so the conformance suite exercises production code. The change
immediately paid for itself (§4.2).

**4.2 The fixture's ADS scope claimed verification on hipfire's readings.** Promoting the ADS
scope to verified for the scoped-conversion tests reused the hipfire evidence. Construction
check 2 rejected it: zero distinct measured settings _for that scope_. That is exactly the
class of mistake the check exists for — a scope asserting a model established by readings that
never touched it — and it was caught on the first run.

**4.3 Round-tripping a scope applied the criterion twice.** `fromCanonical(scopeKey: "ads")`
treated its input as a hipfire target and applied the matching ratio, which is the product's
case (doc 11 §11.7: scoped values are _derived_). But `toCanonical` on the same scope returns the
scope's _own_ target, so feeding it back applied the ratio a second time and the round-trip
test failed. Resolved with `ConversionContext.canonicalBasis: "hipfire" | "scope"`, defaulting
to hipfire. It is a statement about the input's meaning, not a way around the gate — an
unverified scope refuses under either basis. Doc 12 §12.3 did not anticipate this; recorded as
deviation §5.2.

**4.4 The table model refused its own endpoint anchors.** `exp(log(x))` is not always `x`, so
evaluating the interpolant at an anchor could land one ulp outside the measured range and be
refused as extrapolation. A relative tolerance of 1e-12 on the bound check — far below any
measurement precision — distinguishes float noise from a genuine extrapolation. The interpolant
output is additionally clamped to the anchor box, which monotone interpolation guarantees
mathematically and floating point does not.

**4.5 The "no numeric leak" test rejected a legitimate version label.** The Phase 1 assertion
`JSON.stringify(error)` must not match `\d+\.\d+` fails the moment an adapter has a version
label like `1.0`. Replaced with: no field of the failure is of type `number`, and the `detail`
prose carries no decimal. The intent — no value a surface could render — is preserved; the
false positive is gone.

**4.6 `verificationStatus()` was vacuously `verified` on an empty scope list.** "Every scope is
verified" is true of no scopes. An adapter with an empty roster now reports `unverified`, and
`openRegisterEntries` is declarable independently of the scope list so the adapter can still
say what is outstanding.

---

## 5. Deviations from Phase 0

**5.1 Test-fixture entries in the register.** Doc 36 lists fifteen entries. The code register
carries two more, `EV-FIXTURE` (closed) and `EV-FIXTURE-ADS` (open), marked
`governs: "test_fixture"`. Without a closed entry the verified path through the gate cannot be
tested at all, and the alternative — letting tests bypass the register — would put a hole in
the one mechanism this phase provides. Fixture entries are excluded from every count the product
reports, no production adapter may cite them (asserted), and the fictional constant lives in the
test helper, so nothing in `src/` carries a number that could be mistaken for a real one.

**5.2 `canonicalBasis` on the conversion context.** See §4.3. Doc 12 §12.3's `ctx` has no such
field. It defaults to the documented behaviour, so no caller written against the spec changes
meaning.

**5.3 `VerificationEvidence.measurements` is required.** Doc 12 §12.3 lists `sourceRefs` as
"evidence pointers". This phase requires the raw readings themselves, because the golden-vector
test (doc 12 §12.8 req. 6) cannot replay a pointer. This is stricter than the spec, not looser.

**5.4 `ads_model = internally_fov_scaled` ignores a caller-supplied criterion** rather than
erroring. Doc 11 §11.6.4 says the MDC family "is not applied"; silently not applying it and
reporting `conversionMethod: "direct"` is the reading taken, since the criterion is a preference
and the ADS model is a fact about the game. Recorded so it can be revisited if the UI wants to
warn instead.

**5.5 Form C is not implemented.** Deliberate, per doc 12 §12.5. Adding a variant to the
`SensitivityModel` union is the extension point.

---

## 6. Testing

| Layer       | Result                                                              |
| ----------- | ------------------------------------------------------------------- |
| Lint        | clean, `--max-warnings 0`                                           |
| Typecheck   | clean, strict                                                       |
| Unit + arch | **43 files, 930 passed** (Phase 4: 775)                             |
| Coverage    | **90.73% branches** (gate 90%); `game-adapters/` 91.41%             |
| Integration | **7 files, 94 passed** (Phase 4: 87)                                |
| E2E         | **35 passed** (Phase 4: 29) — 6 new, `chromium` project             |
| Build       | ✓ Compiled successfully; `/games` static, `/games/[gameId]` dynamic |
| Boundaries  | ok — no violations                                                  |
| Secrets     | ok                                                                  |

The conformance suite runs 52 cases: the five launch adapters (gate, labels, unsupported-scope
semantics) and three fixture configurations (linear, linear with verified ADS, table) through
all eight classes including the golden-vector replay.

**Required per-converter test classes (phase prompt):** known fixtures ✓ (§12.8 req. 6),
round-trip ✓ (req. 1–2), boundary ✓ (req. 3), precision ✓ (req. 4), version ✓ (registry
keeps historical versions resolvable; overlay refuses upgrades), verification-gate ✓ (req. 5,
enumerated over the registry).

---

## 7. Phase boundary verification

No work belonging to Phase 6 (advanced tests) or Phase 7 (results experience) was started. The
settings components are mounted on a standalone page with a form, not on a results screen; no
`recommendations` row is read or written; no confidence index or aim profile is computed. The
`/games/[gameId]` page exists so that the conversion path can be exercised in a browser today,
and its components are designed to be lifted into SCR-032 without change.

---

## 8. Deferred items

| Item                                                       | Where it lands                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Closing any register entry                                 | A verification campaign, not a code phase. Doc 08 §8.5 is the procedure              |
| Form C (`piecewise`)                                       | With the first game that needs it                                                    |
| Apex-style settings _sets_ (global multiplier + per-optic) | `EmittedSetting[]` already supports it; the adapter that needs it is gated on EV-007 |
| Mounting the settings block on the results screen          | Phase 7 (SCR-032)                                                                    |
| The "re-convert with the current model" user action        | Phase 7/9; `resolve(gameId, versionLabel)` already pins                              |
| Scheduling `runVerificationRecheck`                        | Phase 11 (operations)                                                                |
| Localised `zh-Hans` labels on real scopes                  | With each adapter's verification; the conformance suite accepts `requiredLocales`    |

---

## 9. Risks and known limitations

**9.1 The launch gate (doc 02 §2.7) is not met.** CS2 hipfire (EV-001, priority 1) is the
launch gate and remains open. This phase cannot close it — it needs a measurement campaign
with a controlled-DPI mouse against a recorded build. Everything is in place to accept the
result in one pull request.

**9.2 A register entry can be flipped dishonestly.** The code enforces that a closed entry
exists and that the model reproduces the supplied readings. It cannot verify that the readings
are real. That is what two-person sign-off and review are for (`SENS-SEC-023`), and the
`governs` field makes the fixture case visibly distinct from a real one.

**9.3 Verification decay is evaluated on demand, not on a schedule.** `runVerificationRecheck`
exists and is tested; nothing calls it yet. Until Phase 11 wires a scheduler, a stale adapter
stays `verified`. Moot while nothing is verified.

**9.4 `needs_recheck` persistence flattens `partial`.** An adapter rolled up as `partial`
after a downgrade is stored as `needs_recheck` (the state that governs serving). The per-scope
truth lives in the adapter; the `game_versions` column is a summary. If the boot check ever
needs scope-level agreement, `game_sensitivity_models` rows are the place.

**9.5 The half-FOV for scoped conversion is a query parameter.** The results screen will have it
from the session's recorded FOV (doc 09 §9.0.1); the standalone page asks for it. A missing value
produces a `MISSING_CONTEXT` refusal, never a default.

---

## 10. Exit criteria

| Criterion (phase prompt)                                                              | State                                                            |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Read the verification register before implementation                                  | ✓ First action of the phase                                      |
| Never mark an item verified from a forum, calculator, AI answer or "looks right"      | ✓ Nothing marked verified; no such source consulted              |
| Unverified game → no converted numbers, adapter unavailable                           | ✓ All five; asserted in unit, integration and E2E                |
| Versioned hipfire conversion, inverse, validation, bounds, version metadata           | ✓ `createVerifiedAdapter`; exercised via fixtures                |
| Scopes only where formula, conventions, FOV behaviour and scale are verified          | ✓ Per-scope gate; `adsModel: unknown` emits nothing              |
| Mechanism to invalidate/deprecate adapters when verification goes stale               | ✓ `evaluateRecheck`, `withVerificationOverlay`, persisted        |
| Fixtures, round-trip, boundary, precision, version, verification-gate tests           | ✓ Conformance suite over the registry                            |
| A user with a calibrated sensitivity can safely obtain settings for verified adapters | ✓ (vacuously — none verified; canonical targets always returned) |
| No verified evidence = no number                                                      | ✓                                                                |

---

## 11. Readiness for Phase 6

Phase 6 (advanced tests) does not depend on this phase. Phase 7 depends on the settings
components and `convertForGame`, both of which are in place and take only a `GameSettingsView`.

---

## Repository status

**Branch:** `main`
**No commit and no push were performed.** The working tree holds every change described above.

### Recommended review commands

```bash
git status
git diff
git diff --stat
```

### Recommended commit commands

```bash
git add .
git commit -m "feat: complete phase 5 verified game adapters"
git push origin main
```

### Next phase

Phase 6 — Advanced Tests. **Not started.**
