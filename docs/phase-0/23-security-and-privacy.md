# 23 — Security and Privacy

Related: [18-system-architecture.md](18-system-architecture.md) · [20-data-model.md](20-data-model.md) · [22-telemetry-strategy.md](22-telemetry-strategy.md) · [31-risk-register.md](31-risk-register.md)

**ID format:** `SENS-SEC-###`.

---

## 23.1 Threat model

| Asset | Threat | Impact |
|---|---|---|
| User accounts | Credential stuffing, weak passwords, session theft | Account takeover |
| Session/measurement data | Cross-tenant access via IDOR | Privacy breach; low sensitivity data but high trust cost |
| Recommendations | Tampering to fabricate results | Undermines the product's only real asset — credibility |
| Raw telemetry (when consented) | Exfiltration | Behavioural biometric exposure |
| Email addresses | Enumeration, harvesting | Spam, phishing |
| The ingest endpoint | Abuse, resource exhaustion, junk data poisoning aggregates | Cost, corrupted reference distributions |
| Adapter data | Malicious or careless modification | **Wrong sensitivity values shipped to users** |

The last one is unusual for a web product and is worth naming: for SensLab, a data-integrity
failure in the adapter layer is a more serious incident than most confidentiality failures,
because it silently gives every user a wrong answer. It is treated as a security concern, not
merely a correctness one.

**Out of scope at MVP:** a hostile insider with database access, nation-state adversaries,
and denial-of-service beyond what the platform's edge absorbs.

---

## 23.2 Requirements

| ID | Requirement |
|---|---|
| SENS-SEC-001 | All traffic over TLS; HSTS enabled with a preload-eligible policy |
| SENS-SEC-002 | Passwords hashed with Argon2id using reviewed parameters; never logged, never returned |
| SENS-SEC-003 | Session tokens are opaque, ≥ 256 bits from a CSPRNG, stored only as a hash |
| SENS-SEC-004 | Session cookies are `HttpOnly`, `Secure`, `SameSite=Lax`, host-scoped, with a `__Host-` prefix |
| SENS-SEC-005 | Authorisation is enforced server-side on every request from the authenticated actor; client-supplied owner identifiers are never trusted (`SENS-BR-034`) |
| SENS-SEC-006 | Every mutation validates its input against a Zod schema before any side effect |
| SENS-SEC-007 | Mutating requests verify the `Origin`/`Sec-Fetch-Site` headers |
| SENS-SEC-008 | Authentication endpoints are rate-limited per IP and per account |
| SENS-SEC-009 | The ingest endpoint is rate-limited per session and bounded in payload size |
| SENS-SEC-010 | Authentication responses do not reveal whether an account exists |
| SENS-SEC-011 | Verification and reset tokens are single-use, hashed at rest, and short-lived |
| SENS-SEC-012 | Sessions are rotated on privilege change and invalidated on password change |
| SENS-SEC-013 | A strict Content-Security-Policy is served with no `unsafe-inline` for scripts |
| SENS-SEC-014 | Secrets are validated at startup and never exposed to the client bundle |
| SENS-SEC-015 | The database application role has no DDL privileges |
| SENS-SEC-016 | Server errors never leak stack traces, SQL, or internal identifiers to clients |
| SENS-SEC-017 | Dependencies are pinned, audited in CI, and updated on a schedule |
| SENS-SEC-018 | Guest sessions are identified by a server-issued opaque cookie token, never by a client-supplied id, and expire |
| SENS-SEC-019 | Submitted measurement data is semantically validated; physically impossible values are rejected |
| SENS-SEC-020 | Users can export all of their data in a machine-readable format |
| SENS-SEC-021 | Users can delete their account, with a documented purge window |
| SENS-SEC-022 | Raw telemetry requires explicit, revocable, versioned consent |
| SENS-SEC-023 | Adapter parameter changes require review and are traceable to a verification record |
| SENS-SEC-024 | Security-relevant events are logged without logging secrets |
| SENS-SEC-025 | Shared result links use unguessable tokens and are revocable |

---

## 23.3 Authentication

**Method: email + password**, with email verification. Chosen over magic links for MVP because
magic links make every sign-in dependent on email deliverability, which is a poor experience at
the start of a twenty-minute test. Architected so that magic links and OAuth are additive
(doc 20 §20.3).

| Aspect | Decision |
|---|---|
| Hash | Argon2id. `ASSUMPTION` (`TUNABLE`): 64 MiB memory, t=3, p=1 — to be re-benchmarked on the actual production instance during Phase 1 and tuned to ~250 ms per hash |
| Password policy | Minimum 10 characters; checked against a compromised-password list; **no composition rules** (they reduce entropy and annoy users) |
| Verification | Required before a session can be claimed to the account; unverified accounts can sign in but see a persistent prompt |
| Reset | Single-use token, 30-minute expiry, invalidates all sessions on use |
| Enumeration | Registration, login and reset all return the same shape and timing regardless of account existence (`SENS-SEC-010`) |
| MFA | Not at MVP. The data is low-sensitivity and MFA would be disproportionate friction. Reassess if the product ever holds anything more sensitive |

**Sessions:** opaque server-side sessions, not JWTs (ADR-016). The deciding factor is revocation:
password change and account deletion must invalidate access immediately, and a stateless token
cannot do that without a revocation list — which is a session store with extra steps.

- 30-day sliding expiry, 90-day absolute cap.
- Rotated on sign-in and on password change.
- `last_seen_at` updated at most once per hour to avoid a write per request.

---

## 23.4 Authorisation

**Rule:** authorisation is a property of the data-access layer, not of the route.

```
every repository function:   fn(actor: Actor, ...args)
every owned-resource query:  WHERE user_id = ${actor.userId}
                             or WHERE guest_session_id = ${actor.guestSessionId}
```

- `Actor` is resolved once per request from the session cookie. There is no code path that
  constructs an `Actor` from a request body or query parameter.
- A resource the actor does not own returns **404, not 403** — existence is not disclosed.
- A **cross-tenant test suite** enumerates every owned resource type and asserts that user B
  cannot read, update or delete user A's resource through any exposed route or action. This suite
  is generated from the route/action manifest so a new endpoint is covered without anyone
  remembering.

---

## 23.5 CSRF

Server Actions and route handlers both mutate state, so both are protected:

1. `SameSite=Lax` cookies, which blocks cross-site POST by default.
2. **Origin / `Sec-Fetch-Site` verification** on every mutating request; a mismatch is rejected
   before any handler runs, implemented in middleware so it cannot be forgotten per-route.
3. Next.js Server Actions include their own origin checking. `REQUIRES_EXTERNAL_VERIFICATION`
   (**EV-013**) — the exact guarantees of the framework version selected in Phase 1 must be
   confirmed from its documentation rather than assumed; the middleware check in (2) exists so
   that the protection does not depend solely on framework behaviour.
4. No mutation is ever performed on a `GET`.

---

## 23.6 Guest sessions and the claim flow

The risky operation is "this anonymous session is now mine". Done wrong, it is an account
takeover of someone else's data.

```
1. First guest visit: server issues an opaque 256-bit token,
   sets __Host-slgs cookie (HttpOnly, Secure, SameSite=Lax, 7-day),
   inserts guest_sessions { token_hash, expires_at }.
2. All guest-owned rows reference guest_session_id.
3. On registration or sign-in while holding a guest cookie:
     - server reads the cookie ONLY (never a body field)
     - resolves guest_sessions by token_hash
     - checks not expired and claimed_by_user_id IS NULL
     - in ONE transaction: set claimed_by_user_id, claimed_at;
       reassign owned test_sessions and hardware_profiles to user_id
     - clears the guest cookie
4. A second claim attempt on the same guest session is a no-op.
```

- The client cannot influence which guest session is claimed (`SENS-SEC-018`).
- Claiming is idempotent and transactional.
- An expired guest session cannot be claimed; the user is told the result expired
  (`SENS-BR-003`).

---

## 23.7 Input validation

- One Zod schema per boundary, shared by client and server (`SENS-NFR-029`); the server never
  trusts the client's validation.
- Numeric inputs carry explicit ranges: DPI 100–32000, polling rate 125–8000, refresh rate
  24–1000, sensitivity within the adapter's declared range, mousepad dimensions 50–2000 mm.
- Free-text fields (profile names, mouse model) are length-bounded and stored as text; they are
  rendered as text, never as HTML.
- Enum-valued fields are validated against the enum, not against a string.
- The ingest payload gets an additional **semantic** validation pass (doc 22 §22.5).

---

## 23.8 Rate limiting

| Endpoint | Limit | Key |
|---|---|---|
| Sign-in | 10 / 15 min, then exponential backoff | IP + account |
| Registration | 5 / hour | IP |
| Password reset request | 3 / hour | IP + account |
| Email verification resend | 3 / hour | account |
| Session creation | 20 / hour | IP or guest session |
| Round ingest | 3× the plan's expected round count per session | session |
| Analytics ingest | 200 / hour | session |

Implementation: a Postgres table with an atomic upsert of a fixed-window counter, at MVP
(doc 18 §18.11). Volumes do not justify Redis, and a database-backed limiter has the advantage
of being correct across instances without extra infrastructure. Revisit when contention appears.

**Failure mode:** if the limiter itself errors, requests are **allowed** for read paths and
**denied** for auth paths. Locking users out because of an infrastructure fault is worse than a
brief loss of throttling on reads; the reverse is true for authentication.

---

## 23.9 Data inventory and minimisation

| Data | Sensitivity | Retention | Justification |
|---|---|---|---|
| Email | PII | Until deletion | Account identity, password reset |
| Password hash | Credential | Until deletion | Authentication |
| Display name | Low PII | Until deletion | Optional; defaults to empty |
| Hardware profile (DPI, mouse model, pad size, monitor) | Low | Until deletion | Required for the measurement |
| Measurement data (trials, metrics, recommendations) | Low, but behavioural | Until deletion | The product |
| Environment fingerprint | Low; mildly identifying in aggregate | With the session | Measurement quality (`SENS-NFR-033`) |
| `ip_hash`, `user_agent_hash` | Pseudonymous | 30 days | Abuse mitigation only |
| Raw telemetry | **Behavioural biometric** | 30 days, consent-gated | Research; opt-in only |
| Analytics events | Low, bucketed | 400 days | Product improvement |

**Minimisation decisions:**
- No IP address is stored in raw form — only a salted hash, with a salt rotated quarterly, for
  30 days.
- No raw user-agent string; browser name and major version only.
- No precise geolocation, ever.
- The environment fingerprint contains only fields with a stated measurement purpose
  (doc 20 §20.12). Adding a field to it requires a documented reason.

---

## 23.10 Measurement integrity and anti-manipulation

A user can always make their own result wrong. The concern is (a) results being *presented* as
credible when they were fabricated, and (b) junk data contaminating future reference
distributions.

| Control | Mechanism |
|---|---|
| The recommendation is computed server-side | The client cannot submit a recommendation (doc 18 §18.7) |
| Physical plausibility | Implied hand velocity above threshold → `impossible_velocity`, trial invalid (doc 10 §10.8) |
| Timing plausibility | Trial durations shorter than physically possible, reaction times below the human floor, and impossible inter-event gaps are rejected |
| Structural plausibility | Trial counts, presentation order and seeds must match the server-issued plan; mismatch invalidates the round |
| Statistical plausibility | Zero-variance metric streams and impossibly perfect scores flag the session `high_invalid_rate` / suspicious |
| Idempotency | Replays cannot inflate sample counts (`SENS-NFR-016`) |
| Reference-data hygiene | Only sessions with `environment_class = 'pass'`, no suspicious flags, and full sample compliance are eligible to contribute to future reference distributions |
| Shared results | Carry the confidence and quality flags; a manipulated session is visibly low-quality |

**What is deliberately not done:** no anti-cheat, no obfuscation, no attempt to detect automated
input at the driver level. That would be an arms race against the product's own users for no
benefit — a user who fakes their own calibration has only cheated themselves. The controls above
exist to protect *aggregate* data and to avoid presenting fabricated sessions as trustworthy.

---

## 23.11 Deletion and export

**Export (`SENS-SEC-020`).** A single JSON document containing: account, profile, hardware
profiles, all sessions with their environment and quality, all rounds, all trials, all metrics,
all recommendations with breakdowns and converted settings, validation runs, and consents.
Generated asynchronously for large accounts and delivered as a download link valid for 24 hours.

**Deletion (`SENS-SEC-021`).**

```
T+0    Request confirmed (re-authentication required)
       users.status = 'pending_deletion', deletion_scheduled_at = now + 30d
       All auth_sessions revoked; sign-in disabled
       Account is recoverable during this window by contacting support
T+30d  Hard purge:
         - users row and all cascading owned data deleted
         - telemetry objects deleted from object storage
         - analytics events: user_id nulled, session_id retained (already pseudonymous)
         - backups: covered by the 30-day PITR window, so the data ages out
T+60d  Confirmation that no backup older than the purge retains the data
```

The backup window is stated honestly in the privacy policy: deletion is complete in the live
system within 30 days and in backups within 60.

**Consent revocation** is separate and immediate: revoking research consent deletes telemetry
objects within 7 days without affecting the account.

---

## 23.12 Pre-launch security checklist

Signed off before MVP ships (doc 02 §2.7):

- [ ] Cross-tenant test suite covers every owned resource and passes
- [ ] All mutating routes and actions verified for origin checking
- [ ] Rate limits verified by test on every listed endpoint
- [ ] No secret in the client bundle (automated grep + bundle inspection)
- [ ] CSP served, no `unsafe-inline` for scripts, violation reporting enabled
- [ ] Security headers: HSTS, `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` minimal
- [ ] Argon2id parameters benchmarked on production hardware
- [ ] Enumeration resistance verified by timing test on register / login / reset
- [ ] Database roles verified: app role cannot DDL
- [ ] Deletion and export verified end to end against a real account
- [ ] Retention jobs verified to run and to be alerted on failure
- [ ] Dependency audit clean or with documented, reviewed exceptions
- [ ] Adapter parameter change process documented and access-controlled (`SENS-SEC-023`)
- [ ] Error responses inspected for leakage
- [ ] Logging inspected for secrets, tokens, and raw telemetry

---

## 23.13 Privacy posture summary

SensLab's privacy position is simple enough to state in the product:

> We need your email to give you an account, and your DPI to do the maths. We measure how you
> aim, and we keep the results so you can compare them later. We do not keep the raw movement of
> your hand unless you ask us to, and you can turn that off or delete everything at any time.

Every claim in that paragraph is enforced by a mechanism in this document.
