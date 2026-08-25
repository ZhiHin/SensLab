# Production deployment

What a production instance of SensLab needs, and what will go wrong if it does not have it.

This is deliberately specific about the two things that are easy to get subtly wrong — the
database roles and the proxy configuration — because both fail silently. A misconfigured role
does not surface until a migration runs as the application user; a misconfigured proxy does not
surface at all, it just quietly disables rate limiting.

---

## 1. Runtime

| Requirement   | Value                               | Note                                                                                                         |
| ------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Node.js       | 20.11+ (22 recommended)             | The build and the server both run on Node; there is no edge runtime.                                         |
| PostgreSQL    | 16+                                 | Uses `uuid`-typed keys, `jsonb`, partial and expression indexes, and check constraints.                      |
| Process model | One or more stateless app processes | All shared state is in PostgreSQL, including rate-limit counters, so instances need nothing from each other. |
| TLS           | Terminated upstream                 | The app sets `Secure` cookies and expects to be reached over HTTPS.                                          |

The application holds no in-memory session state. Scaling out is adding processes; there is no
sticky-session requirement and no cache to warm.

---

## 2. Environment

Every variable is validated at first use by `src/lib/env.ts`, and an invalid value is a startup
failure rather than a default. `.env.example` is the authoritative list; this section covers
what production needs beyond a copy of it.

### Secrets

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

- `AUTH_SECRET` — signs session cookies. Rotating it signs every user out; it does not
  invalidate stored data.
- `ABUSE_HASH_SALT` — keys the digest used for abuse fingerprints on auth events **and** for
  rate-limit bucket names. Rotating it resets every in-flight rate-limit window and makes
  historical fingerprints incomparable with new ones. Rotate deliberately, not routinely.

Both must be at least 32 characters and must not start with `replace-me`; the schema rejects
the placeholder values, so an unedited `.env.example` cannot boot.

### `TRUSTED_PROXY_HOPS`

**Set this to match the deployment. The default of `1` is a guess about your topology.**

`X-Forwarded-For` is a list that each hop _appends_ to:

```
X-Forwarded-For: <what the client sent>, <what proxy 1 saw>, <what proxy 2 saw>
```

Only the rightmost entries were written by infrastructure you control. Everything to their left
was supplied by the caller, who can write anything there. The client address is read from this
many places from the right.

| Topology                                                           | Value |
| ------------------------------------------------------------------ | ----- |
| One reverse proxy or load balancer (nginx, Caddy, ALB, Cloudflare) | `1`   |
| CDN in front of a load balancer, both yours                        | `2`   |
| App exposed directly, nothing rewrites the header                  | `0`   |

Getting it **too high** is the safe direction — the reader falls back to the leftmost entry
rather than trusting a forged one. Getting it too low means the value an attacker chose is
treated as their address, and since that value keys the per-IP limits on registration, sign-in
and password reset, varying it per request defeats all three.

With `0` the header is ignored entirely and per-IP limits collapse into one shared bucket. That
is a real limitation — five registrations per hour for the whole world — so `0` is only correct
when nothing is in front of the app, and such a deployment should add a limiter upstream.

### Framework settings read by Next.js, not by `env.ts`

Two settings belong to the framework and are therefore **not** validated at startup — nothing
will tell you they are missing.

- **`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`** — Next.js encrypts variables captured by inline
  Server Actions. The key is derived at build time, so several instances running _the same
  build artifact_ agree. Set it explicitly to a stable, shared value whenever that assumption
  does not hold: instances built separately, or a rolling deploy where two builds serve traffic
  at once. The symptom otherwise is intermittent action failures during deploys that vanish
  once the rollout completes, which is exactly the kind of fault nobody diagnoses.
- **`serverActions.allowedOrigins`** in `next.config.ts` — the CSRF check compares `Origin`
  against `Host`/`X-Forwarded-Host`. If the proxy presents a different host than the browser
  used, legitimate actions are rejected. Add the public origins there rather than relaxing the
  check.

---

## 3. Database roles

Four roles, created by `npm run db:roles`:

| Role               | Used by                  | Can                                                                                   |
| ------------------ | ------------------------ | ------------------------------------------------------------------------------------- |
| `senslab_owner`    | Nothing at runtime       | Everything. Owns the schema.                                                          |
| `senslab_migrator` | `DATABASE_MIGRATION_URL` | DDL. Used by `db:migrate` only.                                                       |
| `senslab_app`      | `DATABASE_URL`           | `select`/`insert`/`update`/`delete` on data tables. No DDL, no `truncate`, no `drop`. |
| `senslab_readonly` | Analysts, DBeaver        | `select`.                                                                             |

The application must run as `senslab_app`. Pointing `DATABASE_URL` at the owner role works and
is exactly the mistake this separation exists to prevent — `tests/integration/database-integrity.test.ts`
asserts the runtime role _cannot_ create, truncate or drop, and those assertions pass
vacuously if the role is over-privileged.

Released algorithm parameter rows are protected by an insert-only trigger, so even the owner
cannot edit a released set in place (`SENS-BR-029`).

---

## 4. Deploy sequence

```bash
npm ci
npm run db:migrate    # as senslab_migrator
npm run db:seed       # insert-only; safe to re-run
npm run build
npm start
```

`db:seed` uses `on conflict do nothing` for parameter sets, so re-running it never rewrites a
released row. If the values in code have diverged from the database, the seed stays silent and
the **boot check** reports it — loudly — which is the intended division of labour.

### Order matters

Migrate before deploying code that depends on the new schema, and seed before serving traffic:
a request that reaches a missing `algorithm_versions` row fails the parameter integrity check
and the instance reports itself unhealthy.

---

## 5. Health and readiness

`GET /api/health` compares the compiled parameter sets and game adapters against what the
database recorded.

| Status                          | Meaning                                                               | What a load balancer should do     |
| ------------------------------- | --------------------------------------------------------------------- | ---------------------------------- |
| `200 {"status":"ok"}`           | Code and database agree.                                              | Serve traffic.                     |
| `503 {"status":"degraded",...}` | A parameter hash or adapter registration disagrees with the database. | Take the instance out of rotation. |
| `503` with no body detail       | The check itself threw — usually the database is unreachable.         | Take the instance out of rotation. |

A degraded instance is not merely slow: it means the running code and the stored results
disagree about what produced them, so every recommendation it serves would be unexplainable.
Failing closed is the correct behaviour, and the response body names only the _category_ of
problem — the detail goes to the structured log (`SENS-SEC-016`).

Use it as both liveness and readiness. It is `force-dynamic` and does no caching.

---

## 6. Scheduled work

One job must run on a schedule; nothing else does.

```bash
npm run sweep    # retention sweep
```

It performs three jobs defined by doc 23 §23.11 and `SENS-BR-003`:

- deletes guest sessions past their seven-day window, cascading their measurements;
- completes account deletions whose 30-day grace period has elapsed (`SENS-SEC-021`);
- drops rate-limit counters for closed windows.

Daily is sufficient. It is idempotent and safe to run concurrently with traffic. Skipping it
does not corrupt anything — it means data outlives its stated retention, which is a compliance
problem rather than a correctness one.

---

## 7. Logging

Structured JSON on stdout, level from `LOG_LEVEL`. A redactor runs over every field of every
call rather than relying on call sites, covering keys matching `password`, `secret`, `token`,
`authorization`, `cookie`, `email`, `hash`, `salt`, `credential` and `apikey`.

Ship stdout wherever you collect logs. Nothing writes to disk and nothing is emitted to a third
party from the browser.

---

## 8. Email

Verification and password-reset messages. Configured by three variables; `env.ts` refuses to
start if a provider is selected without them.

| `EMAIL_TRANSPORT`   | Behaviour                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `console` (default) | Writes to stdout in development. **In production it reports a failed delivery and logs an error on every send** — it never pretends. |
| `resend`            | `POST https://api.resend.com/emails`                                                                                                 |
| `postmark`          | `POST https://api.postmarkapp.com/email`, on the `outbound` transactional stream                                                     |

`EMAIL_FROM` must be on a domain the provider has verified. Providers reject unverified senders
outright, so a wrong value fails every send rather than degrading quietly.

**No SDK is used.** Both providers are one JSON `POST`, so `fetch` is the whole integration and
the dependency count stays where it is. Adding a third provider means adding a descriptor —
endpoint, headers, body shape — to `PROVIDERS` in `src/lib/email.ts`; the timeout, retry and
logging behaviour is shared.

### What it will and will not survive

Delivery is attempted **inline in the request**, with a 5-second per-attempt timeout and at most
two attempts, retrying only transient failures (429 and 5xx). That covers a blip or a rate-limit
burst. It does **not** survive a provider outage: there is no queue and no worker, and none is
pretended at. If a send fails, `deliver()` returns `delivered: false`, the failure is logged with
the provider, the status and the provider's own error id, and:

- **Sign-up** tells the person the truth — their account is ready and they are signed in, but the
  confirmation email did not go out. Sign-in does not gate on verification, so nothing is blocked.
- **Password reset** says exactly what it always says. The screen must answer identically whether
  or not an account exists (`SENS-SEC-010`), so a delivery-failure message there would announce
  that an account does. The failure is logged instead.

Message bodies carry live single-use tokens and are never logged on any path (`SENS-SEC-024`).

There is no "resend confirmation" flow. If a verification email is lost the account still works,
but the link cannot currently be reissued.

---

## 9. What is not included

Stated plainly so nobody assumes otherwise:

- **No CDN or asset host configuration.** Fonts are self-hosted through `next/font`; there are
  no external asset requests to configure.
- **No backup or restore procedure.** Standard PostgreSQL practice applies; nothing in the
  schema needs special handling beyond the insert-only trigger on `algorithm_versions`.
- **No horizontal-scale tuning.** `DATABASE_POOL_MAX` defaults to 10 per process; size it to
  your connection budget.
