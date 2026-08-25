# Phase 11 Completion Report — Hardening, Audit & Production Readiness

**Production readiness: `READY WITH KNOWN LIMITATIONS`.**

The reasons are in §11. In short: the product is correct, tested and operable, and two things
it needs before it can serve real users are absent by design rather than by oversight — no game
sensitivity model has been externally verified, and there is no email transport. Both are
stated on screen and enforced in code, so neither can mislead anyone; both must be closed
before launch.

---

## 1. Status

Phase 11 audited the work of Phases 1–10 rather than extending it. Every gate is green:

| Gate                 | Result                                                              |
| -------------------- | ------------------------------------------------------------------- |
| `prettier --check .` | clean                                                               |
| `eslint .`           | clean, no warnings                                                  |
| `tsc --noEmit`       | clean                                                               |
| `check:boundaries`   | clean                                                               |
| `check:secrets`      | clean                                                               |
| Unit + architecture  | **1,214 passed** / 59 files                                         |
| Integration          | **141 passed** / 13 files                                           |
| E2E (Playwright)     | **87 passed**                                                       |
| `next build`         | clean, no warnings                                                  |
| `npm audit`          | **0 vulnerabilities**                                               |
| Coverage             | 96.50% statements · 90.49% branch · 98.73% functions · 98.43% lines |

No test is skipped, `.only` appears nowhere, and no failure was resolved by re-running.

The audit found **nine defects — all fixed** — and corrected two tests that had been passing
while asserting something untrue. It also quantified one limitation that is a property of the
statistical design rather than a defect: it was reduced by more than half and documented rather
than hidden. Details in §4; the limitation is §10.1.

Three of the nine were in the calibration search itself, and one of those had been silently
distorting every calibration test in the repository. They were found by simulation, not by
reading — which is the argument for §3 existing at all.

---

## 2. What the audit covered

| Area                  | Method                                                                                                                            | Outcome                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Statistical behaviour | New property/simulation suite over randomised populations, 100-player runs for rate measurements                                  | 3 defects found and fixed; 1 limitation quantified |
| Database              | Catalogue queries against `pg_constraint`/`pg_index`, plan inspection, retention review                                           | 1 defect found and fixed; permanent guard added    |
| Security              | Manual review of every server action, repository and auth path; framework CSRF guarantees read from the pinned version's own docs | 2 defects found and fixed                          |
| Error handling        | Inventory against the phase brief's list                                                                                          | 1 gap found (no error boundaries) and fixed        |
| Accessibility         | axe WCAG 2.1 A + AA over every page state, extended to the new error surfaces                                                     | No violations                                      |
| Performance           | Bundle measurement, dependency review, in-product instrumentation review                                                          | No action needed; numbers in §7                    |
| Dependencies          | `npm audit`                                                                                                                       | 4 moderate → 0, via a scoped override              |
| Documentation         | Written against the phase brief's list                                                                                            | 4 new documents; README updated                    |
| External verification | Every one of the 15 items classified with evidence                                                                                | 15 remain open; reasoning in §8                    |

---

## 3. Statistical verification

This was the largest piece of work in the phase and produced the most significant findings.

### The new suite

`tests/unit/calibration/properties.test.ts` runs **populations** of randomised synthetic players
through the real engine and asserts over the distribution of outcomes. It exists because the
pinned-fixture suite (`recovery.test.ts`) proves a property _can_ hold but cannot distinguish a
property that holds from a seed that happened to be kind — and that distinction matters most for
the claims the product makes loudest.

Twelve properties: reproducibility, interval coverage, recovery error, flat-player behaviour,
noisy-player behaviour, round budget, finite MDE, nested ranges, MDE shrinking with sample,
drift recovery, and drift reporting.

It immediately failed in ways that turned out to be real (§4.1–§4.3).

### Measured behaviour after the fixes

100 simulated players per population, full three-round Standard sessions:

| Population                                   | Peak found | Median recovery error |
| -------------------------------------------- | ---------- | --------------------- |
| Genuine peak (curvature 0.8–2.0)             | 100 / 100  | 0.042 log2 (≈ 3%)     |
| Exactly flat (curvature 0)                   | 11 / 100   | —                     |
| Variance-limited (low curvature, high noise) | 5 / 16     | —                     |

Reproducibility, drift handling, anchor behaviour, stopping conditions and bootstrap coverage
all hold; the golden session still reproduces bit for bit.

---

## 4. Defects found and fixed

### 4.1 The search placed candidates outside the admissible domain — **fixed**

`decideNextBracket` clipped the next bracket's **centre** to the domain and constraint, then
built the bracket around that centre. Candidates are generated at the bracket's _ends_
(doc 13 §13.5), so `centre − halfWidth` fell outside the bound and the session measured
sensitivities the product documents as inadmissible — then fitted a curve across them.

Found by a diagnostic that printed candidate positions: x ≈ 10.80 against a domain floor of
x ≈ 11.3 (8 cm/360).

Fixed by sliding the whole bracket inside the bounds with `clipBracket`, which already existed
for exactly this purpose and is what `initialBracket()` uses. Doc 13 §13.3 specifies the
bracket is "intersected with the admissible domain and with the physical constraint" — the
intersection, not the centre.

`src/core/calibration/response-surface.ts`

### 4.2 Every calibration simulation in the repository was running one round — **fixed**

The consequence of §4.1's fix was worse than the defect: four `recovery.test.ts` tests began
failing. Investigating showed why.

`tests/helpers/simulate-calibration.ts` built its domain by restating the conversion instead of
calling the shared `domainBounds()`, and had **`low` and `high` transposed**. With the bounds
inverted, `clipBracket` correctly collapsed the bracket to a single point, so every simulated
session stopped after round 0 with `stop_converged`.

Under the previous centre-only clipping the inversion was invisible, so it had been there all
along. The effect on every calibration test in the repository:

|                             | Before              | After                |
| --------------------------- | ------------------- | -------------------- |
| Rounds per session          | 1                   | 3                    |
| Candidates in the fit       | 3                   | 6–10                 |
| Residual degrees of freedom | **0** (saturated)   | 3–7                  |
| Adjusted R²                 | `null` on every fit | present on every fit |
| Anchor                      | never ran           | runs                 |
| Drift identified            | never               | yes                  |
| Median recovery error       | ~0.3 log2           | **0.042 log2**       |

A quadratic through exactly three points fits them exactly and is concave or convex by
accident, which is why flat players appeared to get peaks so often. The fixtures had been
validated against a degenerate configuration.

Production was unaffected — `calibration-service.ts` uses `domainBounds()` correctly, and the
golden session builds its domain correctly too, which is why it kept passing. This was a test
harness defect that was hiding the engine's real behaviour, in both directions.

The helper now calls `domainBounds()` and runs the shipping parameter set.

### 4.3 The peak verdict was anti-conservative — **fixed, `calibration_model_v3`**

A `peak_found` verdict required _some candidate pair_ to be distinguishable (doc 13 §13.9) plus
a concave point fit with its vertex inside the measured span.

Pairwise distinguishability is the right rule for doc 13 §13.10 condition 3 — _should the search
continue?_ — where an OR across pairs errs safely. As a **verdict** it is anti-conservative: a
Standard session pools nine candidates plus the anchor, making it an OR over thirty-six
comparisons at a 90% level with no multiplicity control.

v3 tests the claim the verdict actually makes. A peak asserts the response _bends_, so the
bootstrap interval on the quadratic coefficient `b₂` must exclude zero — doc 13 §13.9's own
rule, at its own level, applied to the right quantity. The interval comes from resamples the
bootstrap already refits, so it costs nothing.

| Population (n=100)    | v2 rule | v3 rule |
| --------------------- | ------- | ------- |
| Flat — peak found     | 27      | **11**  |
| Peaked — peak found   | 100     | 100     |
| Peaked — median error | 0.042   | 0.042   |

Fabricated peaks fall by roughly sixty percent at no measurable cost to detection or accuracy.

**Released as a version, and the rule is a parameter.** `statistics.requireSignificantCurvature`
is set only on v3, so a session stored under v1 or v2 still re-derives the verdict it was
originally given (`SENS-BR-029`, `SENS-BR-030`). This is why the golden session — which pins v1
— still reproduces bit for bit and needed no regeneration. v2 moves to
`HISTORICAL_PARAMETER_SETS` and remains compiled.

An earlier attempt applied the gate unconditionally in the engine; it was reverted in favour of
the parameterised form, which is the only version that preserves replayability.

### 4.4 The recommendation could exceed the player's physical reach — **fixed**

Doc 13 §13.13: "The recommendation is the constrained optimum, and the unconstrained optimum is
reported separately."

The headline recommendation came straight from `calibration.countsPer360`, unclipped. With a
pad-width ceiling of 30.19 cm/360 the product recommended 30.43 — a sensitivity the player had
just told it they cannot execute.

The magnitude is small because the engine already confines the search to the constraint and
refuses a peak beyond the measured span, so what remained was a vertex just inside the span and
just above the ceiling. It is still a number a player would type into a game and fail to
perform.

Fixed in the assembly layer (doc 16's concern), leaving `calibration.xStar` as the honest
unconstrained fit — which is also how "reported separately" stays satisfied.

`src/core/recommendation/assemble.ts`

### 4.5 Cascading deletes had no index to delete through — **fixed**

Postgres enforces `on delete cascade` and `set null` with a query against the child table for
every parent row removed. Without an index on the referencing column that query is a sequential
scan.

Eleven foreign keys had none, including `analytics_events.user_id`, `analytics_events.session_id`
and `telemetry_batches.round_id` — the highest-volume tables in the schema. The two operations
that delete in bulk are the two that must not be slow: account deletion (`SENS-SEC-021`) and the
retention sweep (`SENS-BR-003`). Account deletion latency would have grown linearly with total
telemetry volume.

Nine indexes added (`0003_foreign_key_indexes.sql`). The two skipped reference `game_versions`,
which is seeded reference data that is never deleted; an index there would only cost writes.

A permanent guard in `tests/integration/database-integrity.test.ts` now queries the catalogue
and fails on any cascading foreign key without a supporting index, so this cannot silently
return. It is invisible until the tables are large, which is the worst time to find it.

### 4.6 Two privacy and rate-limiting defects — **fixed**

**`X-Forwarded-For` was trusted at the wrong end.** The client address was read as the
_leftmost_ entry. `X-Forwarded-For` is appended to by each hop, so the leftmost value is the one
the caller wrote — and it keys the per-IP limits on registration, sign-in and password reset.
Varying it per request defeated all three.

Now read from the right, `TRUSTED_PROXY_HOPS` places from the right, misconfiguration falls back
to the furthest-upstream entry, and `0` ignores the header entirely rather than trusting it.
The per-account buckets were never affected, so targeted brute force was always limited.
`src/lib/client-address.ts`, seven tests.

**Rate-limit buckets stored plaintext email addresses.** Buckets were named
`signin-account:someone@example.com` and `register:198.51.100.4`, persisted in
`rate_limit_counters` — a table nothing joins to a user, so account deletion never reaches it.
It was a permanent record of who tried to sign in and when, readable by anything with database
access, while the same codebase deliberately hashes those identifiers for abuse fingerprints.

Bucket identifiers are now hashed with the existing keyed digest, the prefix stays readable, and
an integration test asserts no bucket contains an address.

### 4.7 The retention sweep had no way to run — **fixed**

`runRetentionSweep` was implemented and tested, but there was no script, route or entry point
to invoke it. Guest expiry (`SENS-BR-003`) and 30-day account deletion (`SENS-SEC-021`) are
promises made on screen that nothing could have kept in production.

`scripts/sweep.ts` (`npm run sweep`) performs the three deletes in one transaction. It calls
repositories rather than the service because the service layer imports `server-only`, which
throws outside the Next.js bundle by design — a scheduled job is not a reason to weaken that
guard.

### 4.8 No error boundaries anywhere — **fixed**

The App Router had no `error.tsx`, `global-error.tsx` or `not-found.tsx`. Every unhandled error
and every `notFound()` — which is how the product refuses a resource the actor does not own —
fell back to the framework's default screens.

Three boundaries added, in the product's own visual language. Neither error screen renders
`error.message`, only `digest` (`SENS-SEC-016`); a message reaching a client boundary can carry
a constraint name or an id. The 404 says the same thing whether the resource never existed or
simply is not the reader's, because saying anything else would make it an existence oracle
(`SENS-SEC-010`).

### 4.9 Two mis-specified tests — **corrected**

Found while fixing the above; recorded because both had been passing while asserting something
untrue.

- **"clips the comfort range at the pad-width ceiling, and nothing else"** asserted the
  constraint does not affect the estimator, citing `SENS-BR-012` — a rule about minimum sample
  size that says nothing about constraints. Doc 13 §13.3 and §13.8 both say the constraint
  _does_ bound the search. The test passed only because the ceiling it chose never bit while
  clipping was centre-only.
- **The "noisy player" population** paired high noise with strong curvature (0.8–2.0),
  describing a player whose sensitivity effect is large and easy to find — the opposite of the
  variance-limited player doc 04 §4.4.9 describes. Corrected to low curvature with high noise;
  peaks fell from 11/16 to 5/16, which is the intended behaviour.

---

## 5. Files created / modified

**Created**

| File                                                     | Purpose                                              |
| -------------------------------------------------------- | ---------------------------------------------------- |
| `src/core/params/calibration-model-v3.ts`                | The released set carrying the curvature verdict rule |
| `src/lib/client-address.ts`                              | `X-Forwarded-For` trust boundary                     |
| `src/app/error.tsx`, `global-error.tsx`, `not-found.tsx` | Error and 404 surfaces                               |
| `scripts/sweep.ts`                                       | Retention sweep entry point                          |
| `src/db/migrations/0003_foreign_key_indexes.sql`         | Nine indexes for cascading deletes                   |
| `tests/unit/calibration/properties.test.ts`              | Property/simulation suite                            |
| `tests/unit/lib/client-address.test.ts`                  | Proxy trust boundary tests                           |
| `docs/operations/deployment.md`                          | Production deployment                                |
| `docs/operations/release-checklist.md`                   | Release checklist                                    |
| `docs/operations/troubleshooting.md`                     | Troubleshooting                                      |
| `docs/methodology/calibration.md`                        | Calibration methodology                              |

**Modified (significant)**

| File                                                  | Change                                                         |
| ----------------------------------------------------- | -------------------------------------------------------------- |
| `src/core/calibration/response-surface.ts`            | Bracket placed inside the domain, not merely centred in it     |
| `src/core/calibration/significance.ts`                | Bootstrap credible interval on the curvature coefficient       |
| `src/core/calibration/engine.ts`                      | Verdict gated on significant curvature, selected by parameter  |
| `src/core/params/calibration-model-v1.ts`             | Optional `requireSignificantCurvature` on the params interface |
| `src/core/params/index.ts`                            | v3 current, v2 historical                                      |
| `src/core/recommendation/assemble.ts`                 | Recommendation clipped to the physical constraint              |
| `src/services/auth-service.ts`                        | Hashed rate-limit bucket identifiers                           |
| `src/features/auth/actions.ts`, `src/lib/env.ts`      | `TRUSTED_PROXY_HOPS`                                           |
| `src/db/schema/{telemetry,results,identity,games}.ts` | Foreign key indexes                                            |
| `tests/helpers/simulate-calibration.ts`               | Shared `domainBounds()`; runs the shipping model               |
| `package.json`                                        | `esbuild` override; `sweep` script                             |
| `README.md`                                           | Status; operations section                                     |

---

## 6. Deviations from Phase 0

1. **`calibration_model_v3` changes what a session concludes.** Doc 13 does not specify the
   predicate that separates `peak_found` from `indistinguishable`; §13.9 defines pairwise
   distinguishability and §13.10 uses it for _stopping_. v3 applies §13.9's rule and level to
   the curvature coefficient. This refines an unspecified point rather than contradicting a
   specified one, and the doc's own bootstrap produces the quantity used.

2. **`clipBracket` preserves `minHalfWidth` (0.10) when re-centring; doc 13 §13.3 names 0.20.**
   Pre-existing, and shared with `initialBracket()`. Not changed in this phase — altering it
   would change every search path for a reason unrelated to any defect found here. Recorded so
   it is a known discrepancy rather than an unnoticed one.

3. **The external verification register keeps all 15 entries `open`.** See §8.

---

## 7. Performance

No bottleneck required fixing. Measurements:

| Measure                             | Value                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| Total client JavaScript, all routes | 854 kB uncompressed / 30 chunks; largest 229 kB (framework)                      |
| Runtime dependencies                | 9                                                                                |
| History list query                  | Served by `test_sessions (user_id, started_at DESC)` — matches the query exactly |
| Retention sweep                     | Partial index `test_sessions_sweeper_idx` on the in-progress statuses            |

The dependency list carries no charting library, no UI framework and no utility library; the
response curve is hand-built. Frame pacing, pointer-lock stability, long gaps, window resizes
and DPI inconsistency are all instrumented **in-product** as session quality flags that feed the
confidence index, which is a stronger position than profiling in a lab: every real session
measures its own environment and prices it.

---

## 8. External verification register

All 15 items remain **unresolved**. Not one has been closed, and the report will not claim
otherwise.

| Items                      | Subject                                                  | Classification                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| EV-001–009, EV-014, EV-015 | Game hipfire/ADS models, FOV conventions, setting ranges | **Unresolved.** SensLab's own verification procedure (doc 08 §8.5) has not been performed against any game. No evidence exists, so no number is emitted: unverified adapters return `EXTERNAL_VERIFICATION_REQUIRED` and `createVerifiedAdapter` refuses to build a scope whose register entry is not closed.                                                                                          |
| EV-010                     | `unadjustedMovement` support matrix                      | **Unresolved, partial evidence.** Probed directly: Chromium 151 on Windows 11 exposes `requestPointerLock`, returns a Promise, and accepts `{unadjustedMovement: true}`. That is one cell, and _accepted_ is not _effective_ — proving acceleration is actually bypassed needs delta measurement against a physical mouse with OS acceleration toggled. Firefox, Safari, macOS and Linux are untested. |
| EV-011                     | Third-party naming of FOV-matching criteria              | **Unresolved.** Not investigated. Affects UI labelling only.                                                                                                                                                                                                                                                                                                                                           |
| EV-012                     | Windows pointer-speed multiplier table                   | **Unresolved.** Not investigated. Context only; blocks nothing.                                                                                                                                                                                                                                                                                                                                        |
| EV-013                     | Server Actions CSRF guarantees                           | **Unresolved as a register entry; the underlying question is answered.** Next.js 16.3.1's bundled documentation states the framework compares `Origin` against `Host`/`X-Forwarded-Host` and rejects mismatches, encrypts action ids, and strips unused server functions. `tests/e2e/smoke.spec.ts` asserts a cross-origin mutating request is rejected against the production build, and it passes.   |

**Why EV-013's entry was not flipped to `verified`.** The register's summary — asserted by test
against doc 36 — currently reads "15 open items. 0 verified. 0 rejected." That count is the
product's public statement about _game model_ verification, and the register's `status` field is
the gate that authorises an adapter to emit a number. Changing it to "1 verified" to record a
framework CSRF finding would make the count say something a reader would reasonably take to mean
a game had been verified. The evidence is therefore recorded here, in §4.6 and in
`docs/operations/deployment.md`, and the gate is left saying exactly what it means.

Two operational findings came out of reading the framework's guarantees, both now documented in
the deployment guide: `serverActions.allowedOrigins` must list public origins when a proxy
presents a different host, and `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` must be pinned when
instances do not share one build artifact.

---

## 9. No silent warnings

| Category                | State                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Build warnings          | None.                                                                                                                                                                                |
| Lint warnings           | None. `eslint .` is silent.                                                                                                                                                          |
| Vulnerable dependencies | **Resolved.** 4 moderate → 0 via `overrides: { "@esbuild-kit/core-utils": { "esbuild": "^0.25.12" } }`. Verified that `verify`, integration, `tsx` and `drizzle-kit` all still work. |
| Deprecated APIs         | None in use.                                                                                                                                                                         |
| Migration problems      | None; `0003` applies cleanly and was renamed to the repository's descriptive convention.                                                                                             |
| Accessibility failures  | None. axe WCAG 2.1 A + AA across every page state, now including the 404.                                                                                                            |

---

## 10. Known limitations

1. **Flat responses receive a peak in ~11% of sessions.** Above the 5% a one-sided test at the
   configured level nominally gives. The residue is **post-selection inference**: the bracket
   narrows toward whatever looked humped and the verdict is tested on that same data, so the
   stopping rule and the test are not independent. Removing it needs a design change — sample
   splitting, or a confirmation round held out from the search — not a tighter threshold.
   Deliberately not tuned away. Confidence on such sessions is correspondingly low, and the
   comfort range is always reported.

2. **No game sensitivity model is verified.** The product cannot convert a result into an
   in-game number for any game. It reports cm/360°, says which adapters are unverified, and
   refuses to guess. Correct behaviour, and a launch blocker.

3. **No email transport.** `src/lib/email.ts` logs instead of sending. Verification and
   password-reset flows do not work in production until one is wired in.

4. **Reference distributions are provisional.** `reference_dist_provisional_v2` is labelled as
   such wherever it is used.

5. **The `unadjustedMovement` matrix is one cell deep.** See §8.

6. **Browser coverage is Chromium-only in automation.** Playwright runs Chromium; Firefox and
   Safari have not been exercised. The engine's capability gate and quality flags are designed
   for this — they detect and penalise rather than assume — but the matrix is untested.

---

## 11. Production readiness

### `READY WITH KNOWN LIMITATIONS`

**Ready.** The application is correct, deterministic and reproducible; it refuses to state what
it cannot support; every gate passes with no suppressions; coverage is 96.5% statements / 90.5%
branch; authorization is enforced in SQL with cross-tenant tests; the runtime database role
cannot perform DDL and a test proves it; released algorithm parameters are immutable and
verified by hash at boot; secrets and personal data are kept out of logs and out of the
rate-limit table; accessibility passes WCAG 2.1 AA on every page state; and it is now
documented well enough for someone who did not build it to deploy, operate and debug it.

**With known limitations.** Two of the six in §10 must close before real users arrive:

- **No verified game model** (limitation 2). The product delivers its core promise — a measured
  cm/360° range with stated confidence — but the "turn this into my game's setting" half is
  gated shut. That is honest, not broken, and it is the launch gate doc 36 always said it was.
- **No email transport** (limitation 3). Account verification and password reset are
  non-functional in production.

The other four are properly characterised rather than hidden: the flat-response rate is
measured, explained and priced into confidence; the reference distributions are labelled
provisional; the browser matrix is stated as untested rather than assumed.

**Not `NOT READY`**, because nothing is broken, unmeasured or fabricated. **Not `READY`**,
because two things a real deployment needs are absent and saying otherwise would be exactly the
kind of unearned claim this product exists to avoid.

---

## 12. Exit criteria

| Criterion                              | State                                                                               |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| All test suites run and pass           | Yes — 1,214 unit/architecture, 141 integration, 87 E2E                              |
| Flaky tests investigated, not re-run   | Yes — every failure traced to a cause; three were real defects                      |
| Statistical verification performed     | Yes — §3, new property suite, 3 defects fixed                                       |
| Browser testing                        | Partial — Chromium verified; matrix stated as untested (§10.6)                      |
| Performance profiled                   | Yes — §7                                                                            |
| Database audited                       | Yes — §4.5, plus a permanent guard                                                  |
| Security audited                       | Yes — §4.6, plus review of every action and repository                              |
| Accessibility verified                 | Yes — axe WCAG 2.1 A + AA, no violations                                            |
| Error handling tested                  | Yes — §4.8; expiry, invalid guest, pointer lock, unverified adapter already covered |
| Documentation finalised                | Yes — 4 new documents, README updated                                               |
| External verification register updated | Yes — §8, all 15 classified with evidence                                           |
| No silent warnings                     | Yes — §9                                                                            |
| Production-readiness report            | This document                                                                       |

---

## Repository status

**No commit created. No push performed.**

### Review

```bash
git status
git diff
git diff --stat
```

### Commit

```bash
git add .
git commit -m "feat: complete phase 11 hardening"
git push origin main
```

### Verify

```bash
npm run verify
npm run test:integration
PLAYWRIGHT_PROD_PORT=3517 npx playwright test
npm audit
```

---

## Next

Phase 11 is the final phase of the plan in `docs/phase-0/`. The work that remains before launch
is not a phase — it is the two limitations in §11: perform SensLab's verification procedure
against at least Counter-Strike 2 (`EV-001`, the launch gate), and wire an email transport.
