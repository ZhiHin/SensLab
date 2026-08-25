# Email transport — follow-up to Phase 11

Not a phase. The plan in `docs/phase-0/` ends at Phase 11; this closes one of the two launch
blockers that report identified.

**Supersedes** `phase-11-completion.md` §10.3 and the second bullet of §11. The Phase 11 report
is left intact as a point-in-time record — this note is the correction, not an edit to it.

---

## 1. What was blocking

`src/lib/email.ts` shipped an interface and a console transport. In production that transport
reported `delivered: false` and logged an error on every send. Account verification and password
reset composed correct messages that went nowhere.

The interface was honest about it, which is why this was a gap rather than a bug.

## 2. What was built

Two provider transports behind the existing `EmailTransport` interface, selected by
configuration:

| `EMAIL_TRANSPORT`   | Behaviour                                                                  |
| ------------------- | -------------------------------------------------------------------------- |
| `console` (default) | stdout in development; refuses to pretend in production, exactly as before |
| `resend`            | `POST https://api.resend.com/emails`                                       |
| `postmark`          | `POST https://api.postmarkapp.com/email`, `outbound` stream                |

**No new dependency.** Both providers are a single JSON `POST`, so `fetch` is the whole
integration. An SDK would have added a dependency, a release cadence and a supply-chain surface
to save roughly fifteen lines, against a codebase that ships nine runtime dependencies in total.
The runtime dependency count is unchanged.

Providers differ only in a descriptor — endpoint, headers, body shape, error-id extraction.
Timeouts, retry policy, error classification and what may be logged are shared, because that is
where the behaviour that matters lives.

### Configuration fails at startup, not mid-flow

`EMAIL_API_KEY` and `EMAIL_FROM` are required whenever the transport is not `console`, enforced
by a cross-field rule in `env.ts`. Selecting a provider without credentials is refused at
startup rather than discovered during somebody's password reset.

```
Invalid environment configuration:
  - EMAIL_API_KEY: is required when EMAIL_TRANSPORT is "resend"
  - EMAIL_FROM: is required when EMAIL_TRANSPORT is "resend"
```

### The body is a secret

Every message carries a **live single-use token**. No failure path logs the message, and a test
proves it: the leak test drives a real failure, asserts the log line _was_ written — so the
assertion is not vacuous — and then asserts it contains neither the token, nor the body, nor the
recipient, nor the API key. Failure logs carry provider, HTTP status, attempt number and the
provider's own error id, which is what correlates with their dashboard.

### Retry policy is deliberately small

Delivery is awaited **inside a server action**, so every millisecond is someone watching a
spinner. Two attempts, 5-second per-attempt timeout, retrying only transient classes:

| Response                  | Retried | Why                                                                                              |
| ------------------------- | ------- | ------------------------------------------------------------------------------------------------ |
| 429, 5xx, network/timeout | Yes     | A blip or a rate-limit burst                                                                     |
| 401, 403, 422, other 4xx  | No      | A bad key or an unverified sender fails identically every time; retrying is a slower way to fail |

This does **not** survive a provider outage. That needs a queue and a worker, and none is
pretended at — stated plainly in the deployment guide rather than left to be discovered.

## 3. Two honesty decisions at the call sites

Delivery can now genuinely fail, and the two flows must react **differently**:

- **Sign-up surfaces it.** "Check your email to finish setting up your account" is a claim, and
  it is false if nothing was sent. Registration already returns a session and sign-in does not
  gate on verification, so the accurate message is that the account is ready and signed in but
  the confirmation email did not go out.
- **Password reset stays silent.** That screen must answer identically whether or not an account
  exists (`SENS-SEC-010`). A delivery-failure message would appear only when a send was
  attempted, which announces that an account does exist. The failure is logged; the sentence
  never changes.

The second is the one worth pausing on: the obvious "improvement" of reporting failure
consistently across both flows would have introduced an account-existence oracle.

## 4. Files

**Created**

- `tests/unit/lib/env-template.test.ts` — 3 tests holding `.env.example` to the schema
- `tests/unit/lib/email-transport.test.ts` — 11 tests: both providers, retry classification, the
  attempt budget, honest reporting across eight status codes, and the token-leak guard.

**Modified**

- `src/lib/email.ts` — provider descriptors, `createHttpTransport`, config-driven selection
- `src/lib/env.ts` — `EMAIL_TRANSPORT`, `EMAIL_API_KEY`, `EMAIL_FROM` with cross-field validation
- `src/features/auth/actions.ts` — sign-up reacts to the outcome; reset documented as not doing so
- `tests/integration/auth-flows.test.ts` — 3 tests through the real flows via `setEmailTransport`
- `.gitignore` — `!.env.example`, so the template is actually in the repository
- `.env.example`, `.env.local` — documented with defaults
- `docs/operations/deployment.md` — new §8; removed from "what is not included"
- `docs/operations/troubleshooting.md` — replaced "no transport wired in" with real diagnosis

## 4b. A defect found while documenting this

`.env.example` was **never in the repository**. `.gitignore` line 34 ignores `.env*`, which
caught the template too, so:

- `cp .env.example .env.local` — step three of the README setup — could not work on a fresh
  clone;
- every variable documented there was documented on one machine only, including
  `TRUSTED_PROXY_HOPS` from Phase 11 and the `EMAIL_*` variables added here;
- the Phase 11 release checklist item "`.env.example` lists every variable the new code reads"
  was unenforceable.

Fixed with a `!.env.example` exception. The file carries only `replace-me` placeholders and the
local docker credentials already committed in `src/db/sql/010-roles.sql` and
`.github/workflows/ci.yml`, so committing it exposes nothing new — and the schema rejects
`replace-me` values, so a copied but unedited file cannot boot.

`tests/unit/lib/env-template.test.ts` now holds the template to the schema: every one of the
twelve variables `env.ts` reads must appear in it, secrets must be placeholders, and
`EMAIL_API_KEY` must be present but unset.

## 5. Testing

| Gate                      | Result                               |
| ------------------------- | ------------------------------------ |
| `npm run verify`          | exit 0 — **1,228 passed** / 61 files |
| Integration               | **144 passed** / 13 files            |
| E2E                       | **87 passed**                        |
| Lint / typecheck / format | clean                                |

Startup guard verified by hand: selecting `resend` with no credentials produces the error above.

## 6. What is still open

- **`EV-001` — CS2 model verification** remains the launch gate, unchanged. It needs measurement
  in the actual game; the harness that records and replays that evidence already exists and
  refuses adapters without it.
- **No resend-confirmation flow.** A lost verification email is not blocking — the account works
  and sign-in does not gate on it — but the link cannot currently be reissued.
- **No delivery queue.** A provider outage loses the message. See §2.
- The remaining limitations in `phase-11-completion.md` §10 (flat-response rate, provisional
  reference distributions, `unadjustedMovement` matrix, Chromium-only automation) are unchanged.

## 7. Readiness

Still `READY WITH KNOWN LIMITATIONS`, now with **one** launch blocker instead of two: no game
sensitivity model has been externally verified. The product measures and reports honestly in
cm/360° and refuses to convert without evidence, which is correct behaviour and a deliberate
gate — but it is the gate, and only `EV-001` opens it.

---

## Repository status

**No commit created. No push performed.**

```bash
git status
git diff

git add .
git commit -m "feat: wire email transport"
git push origin main
```
