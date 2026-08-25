# Release checklist

Run in order. Anything that fails stops the release; nothing here is advisory.

The list is short because most of what would otherwise be on it is enforced by `npm run verify`
and by tests that fail on their own. What remains are the checks a machine cannot make.

---

## 1. Gates

```bash
npm run verify              # format, lint, typecheck, boundaries, secrets, unit + architecture, build
npm run test:integration    # needs the database running
npm run test:e2e            # builds and starts the production server itself
npm audit                   # expect: 0 vulnerabilities
```

- [ ] All four pass with **no** skipped or `.only` tests.
- [ ] No new lint or build warnings. A warning that is genuinely acceptable is documented in
      the phase report, not left to accumulate.
- [ ] `npm audit` reports zero. If a transitive advisory cannot be resolved, pin an override
      and record why — see `overrides` in `package.json` for the existing precedent.

## 2. Algorithm versions

- [ ] If any calibration, scoring, confidence, aim-profile or reference parameter **value**
      changed, a **new version** was released rather than an existing one edited
      (`SENS-BR-029`). Released sets are immutable and the database enforces it.
- [ ] If a decision _rule_ changed such that stored trials would now produce a different
      verdict, that rule is selected by a parameter on the new version — so a session stored
      under the old version still re-derives its original answer (`SENS-BR-030`).
      `calibration_model_v3` is the worked example.
- [ ] `tests/unit/calibration/golden-session.test.ts` passes, or its fixture was regenerated
      **deliberately** with `UPDATE_GOLDEN=1`, the diff was read, and the change is recorded in
      the phase report.
- [ ] The superseded set is still compiled and listed in `HISTORICAL_PARAMETER_SETS`. Results
      generated under it must keep rendering.

## 3. Database

- [ ] Migrations apply cleanly to a copy of production, not only to a fresh database.
- [ ] `npm run db:seed` runs after migrating. It is insert-only; it will not rewrite a
      released row.
- [ ] Every new foreign key with `on delete cascade` or `set null` has an index on the
      referencing column. `tests/integration/database-integrity.test.ts` asserts this — the
      point of the checklist item is to notice it before the test does.
- [ ] Roles unchanged, or `npm run db:roles` re-applied. The application connects as
      `senslab_app`, never as the owner.

## 4. Configuration

- [ ] `.env.example` lists every variable the new code reads, with a comment saying what it is
      for and what happens at the default.
- [ ] `TRUSTED_PROXY_HOPS` matches the deployment topology. Wrong here silently disables per-IP
      rate limiting; see `docs/operations/deployment.md` §2.
- [ ] Secrets are real, at least 32 characters, and not carried over from a previous
      environment.

## 5. Verification honesty

The claims that would embarrass this product most are the ones nobody re-checks.

- [ ] Every game adapter's verification state in the database reflects **current** evidence.
      An adapter whose evidence has gone stale is `needs_recheck`, not `verified`
      (`SENS-BR-014`).
- [ ] No adapter returns a number without verified evidence. Unverified adapters return
      `EXTERNAL_VERIFICATION_REQUIRED` and the UI says so.
- [ ] The external verification register in the phase report is current: every item is
      `verified`, `unresolved`, or `rejected/deprecated`, with evidence. An item nobody looked
      at is `unresolved`, never `verified`.

## 6. After deploying

- [ ] `GET /api/health` returns `200 {"status":"ok"}` on every instance. A `503` means the
      code and the database disagree about what produced stored results — roll back rather
      than investigate in production.
- [ ] The retention sweep (`npm run sweep`) is scheduled and has run at least once.
- [ ] Structured logs are arriving and contain no `email`, `token`, `password` or `hash`
      values. The redactor covers these by key name; a new field with an unusual name is the
      way that could break.
