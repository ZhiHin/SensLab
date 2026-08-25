# Troubleshooting

Symptoms that have a specific cause, and how to tell them apart from the ones that look similar.

---

## Startup and configuration

### `EnvironmentError: Invalid environment configuration`

A variable is missing or fails validation. The message names each offending variable and what
was wrong with it. Two cases are worth calling out because the message is technically accurate
but easy to misread:

- **`must be replaced with a real secret`** — the value still starts with `replace-me`. An
  unedited copy of `.env.example` cannot boot, on purpose.
- **`must be at least 32 characters`** — a short secret is rejected rather than padded.

### `ParameterIntegrityError` at boot, or `/api/health` returns 503

The compiled parameter sets do not match the rows in `algorithm_versions`. This is a deliberate
hard failure: the running code and the stored results disagree about what produced them, so
every historical recommendation has become unexplainable.

| Cause                                                  | Fix                                                                                                 |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `db:seed` has not run since a new version was released | Run `npm run db:seed`. It is insert-only and safe.                                                  |
| A released parameter value was edited in place         | Revert the edit. Released sets are immutable (`SENS-BR-029`); a changed value is a **new version**. |
| Deployed against the wrong database                    | Check `DATABASE_URL`.                                                                               |

The one thing not to do is delete the `algorithm_versions` row to make the error go away — an
insert-only trigger will refuse, and it would orphan every result that cites it.

### Migrations fail with a permissions error

`db:migrate` must run as `senslab_migrator` via `DATABASE_MIGRATION_URL`. If only
`DATABASE_URL` is set, migrations run as `senslab_app`, which has no DDL rights. That is the
role separation working.

---

## Authentication and rate limiting

### Everyone is rate limited at once, or one person is never rate limited

Both are `TRUSTED_PROXY_HOPS` (see `docs/operations/deployment.md` §2).

| Symptom                                                             | Likely cause                                                                                        |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Unrelated users share a limit; five registrations per hour globally | Set to `0`, or no `X-Forwarded-For` arrives, so every request falls into one bucket.                |
| A single client never meets the per-IP limit                        | Set too low for the topology, so the attacker-supplied leftmost entry is being read as the address. |

The per-account limits on sign-in and password reset are unaffected either way — those key on
the email address, so targeted brute force stays limited even when the IP configuration is
wrong.

### Password reset or verification emails never arrive

Check `EMAIL_TRANSPORT` first.

| Value                    | What is happening                                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `console` in production  | Nothing is being sent. The transport reports a failed delivery and logs `no email provider is configured` on every send.                       |
| `console` in development | Working as intended — the message is printed to stdout, token and all. Read it there.                                                          |
| `resend` / `postmark`    | A real send was attempted. Look for `email delivery failed` in the logs; it carries the provider, the HTTP status and the provider's error id. |

Common causes when a provider is configured:

- **401 / 403** — wrong or revoked `EMAIL_API_KEY`. Not retried, because it will not fix itself.
- **422 (Resend) / ErrorCode 300 (Postmark)** — `EMAIL_FROM` is not on a domain the provider has
  verified, or the address is malformed. Also not retried.
- **429 or 5xx** — transient. Retried once; if both attempts fail the message is lost, because
  there is no queue. See `docs/operations/deployment.md` §8.

The message body is never logged on any path, so the token cannot be recovered from logs to work
around a failed send — that is deliberate (`SENS-SEC-024`).

A lost **verification** email is not blocking: registration signs the user in and sign-in does not
gate on verification. There is no resend flow, so the link itself cannot currently be reissued.

---

## Calibration and results

### A session ends with `indistinguishable` instead of a recommendation

Usually correct behaviour, not a fault. It means no candidate pair separated at the configured
level, so the product reports a comfort range and says why rather than inventing a point
(`SENS-BR-017`). Genuine causes, in order of frequency:

- **The player's response really is flat** over the range tested. Common and informative.
- **Variance is the limiter** — high trial-to-trial spread relative to the sensitivity effect.
  The confidence breakdown names consistency as the largest detractor.
- **Too few valid trials.** Candidates below the minimum are excluded rather than estimated
  (`SENS-BR-012`); with fewer than three usable candidates the verdict is `insufficient_data`,
  which is a different message.

### A session ends with `insufficient_data`

Fewer than three candidates met their minimum valid-trial count. Check the session quality
flags: `frame_degradation`, `unstable_pointer_lock`, `long_gap` and `high_invalid_rate` all
invalidate trials, and all four are recorded per session.

### The recommendation sits at exactly the pad-width ceiling

Expected. The recommendation is the _constrained_ optimum (doc 13 §13.13) — a sensitivity the
player cannot physically execute is not a recommendation. The unconstrained fitted optimum is
still stored on the calibration result as `xStar`.

### The same trials produce a different answer than they did before

They must not (`SENS-BR-030`). If they do:

1. Compare the `calibration_version` recorded on the two results. A different version is the
   expected explanation and is not a bug — v3 changed the peak verdict rule, for example.
2. If the versions match, this is a reproducibility defect. `golden-session.test.ts` is the
   test that should have caught it; run it first.

---

## Measurement environment

### Pointer lock keeps dropping

Recorded as `unstable_pointer_lock` and it reduces confidence. Common causes are the browser
revoking the lock on focus loss, an overlay (screen recorder, chat) stealing focus, or the
player pressing Escape. The engine pauses rather than continuing to record.

### Frame rate is fine but the session flags `frame_degradation`

The flag is about _pacing_, not average FPS. A display at a steady 240 Hz with occasional
long frames is worse for measurement than a steady 60 Hz, because the long frames land inside
individual trials. Check for background compositing work — recording software and browser
extensions are the usual culprits.

---

## Tests

### E2E tests fail to start the server

The Playwright config starts a production build on a port that must be free. Port 3000 is
commonly held by another project; override with `PLAYWRIGHT_PROD_PORT`:

```bash
PLAYWRIGHT_PROD_PORT=3517 npx playwright test
```

### Integration tests fail with a connection error

They need the database running (`npm run db:up`) and migrated (`npm run db:migrate`, then
`npm run db:seed`). They reset volatile tables between tests but do not create the schema.

### A preference or settings E2E test fails only when run in parallel

Those specs mutate shared account state and live in `*.locked.spec.ts`, which Playwright runs
in a dedicated project. Adding a state-mutating spec to the ordinary project reintroduces the
race.
