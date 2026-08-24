# Phase 9 Completion Report — Accounts, History & Hardware Profiles

**Phase:** 9 of 11
**Scope:** the persistent personal platform Phase 0 assigns to this phase (FR-090 – FR-098, SCR-041 – SCR-045)
**Source of truth:** [`17-validation-and-fine-tuning.md`](../phase-0/17-validation-and-fine-tuning.md) §17.9 · [`20-data-model.md`](../phase-0/20-data-model.md) §20.6–§20.8 · [`23-security-and-privacy.md`](../phase-0/23-security-and-privacy.md) §23.4, §23.11 · [`24-screen-inventory.md`](../phase-0/24-screen-inventory.md) · [`25-wireframes.md`](../phase-0/25-wireframes.md) §25.12
**Date:** 2026-08-24

---

## 1. Status

**Complete.** A registered user has a persistent SensLab profile: a history of every
calibration with the evidence each one produced, a comparison between any two of them that
refuses to call a change real unless the measurement supports it, hardware profiles that give a
result the context it belongs to, and the privacy controls — export everything, delete
everything — that make the account theirs rather than ours.

Guest-first survives intact. No account is needed to calibrate (`SENS-BR-001`), and the guest
claim built in Phase 1 is now covered end to end: a guest's sessions and profiles move to the
account that claims them, and a second account attempting the same claim is refused.

**Every history and profile read is scoped in SQL, not in the UI.** The cross-tenant tests
assert that another user's history is _empty_ and their profile is _not found_ — not filtered,
not hidden. That is doc 23 §23.12's first checklist item, and it is the property this phase
would be most damaging to get wrong.

---

## 2. What was built

### 2.1 The comparison rules (doc 17 §17.9) — `core/comparison`

The piece Phase 8 deferred, and the statistical heart of this phase.

**Comparability first.** Hardware profile, DPI, environment class, mode and all three algorithm
versions must match; any mismatch produces a flagged comparison naming specifically what
differed (`SENS-BR-019`). Two _ad-hoc_ sessions with no profile count as a difference rather
than a match — "both unknown" is exactly where a false match would be most tempting.

**The conservative rule.** A change is meaningful only when the two high-performance ranges do
not overlap, and touching ranges count as overlapping. Non-overlap of two 90% intervals is
stricter than a formal test of the difference; the asymmetry is deliberate, because the error
this guards against — telling a player they improved when the measurement cannot support it —
is the one with a reward attached.

**Dimension deltas.** Doc 17 requires each labelled meaningful or within-noise but gives no
rule. The score is `centre + perSigma · z̄` over `n` trials, so the displayed score's standard
error is `perSigma / √n`, and a delta is meaningful when it exceeds the combined error of both
sessions at the session's own level. The unit-spread premise is stated as an `ASSUMPTION` in
the module (§5 deviation 1); it errs toward _not_ calling a change.

### 2.2 History — `history-repo.ts`, `history-service.ts`

One joined query per screen rather than one per row: game, hardware profile, recommendation,
validation verdict and all three version labels arrive with the session. The DPI shown is read
from the session's **immutable snapshot**, never from the profile, so editing a profile cannot
rewrite what a past session ran at (`SENS-BR-035`).

**What history lists** is a session that produced a recommendation of its own, or a calibration
that did not. A validation session, and a fine-tune whose candidates held up, produce no
recommendation — they are steps in another session's story and a row for one reads as a failed
calibration (§4.1). A fine-tune that _did_ supersede has a recommendation and appears, which is
what makes history the honest sequence doc 16 §16.9 describes.

### 2.3 Hardware profiles — `hardware-service.ts`, SCR-043

The Phase 1 repository gained a service and a screen: create, edit, set default, soft-delete.
The first profile becomes the default, because a lone profile that is not the default is a
setting with no alternative. Deletion is soft and the page says why — sessions keep the
profile's name so an old result stays legible.

Sessions are now **attributed** to a profile (FR-095): `/calibrate` offers the saved profiles,
prefills DPI and pad width from the chosen one, and records which profile the session ran at.
A profile id the actor does not own resolves to null rather than borrowing someone else's
hardware.

### 2.4 Account and privacy — `account-service.ts`, `export-repo.ts`, SCR-044, SCR-045

| Piece                     | Behaviour                                                                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Profile (SCR-044)         | Email with its verification state, display name, password change                                                                                                                                                    |
| Password change           | Requires the current password even when signed in, then revokes **every** session and any reset link in flight                                                                                                      |
| Export (`SENS-SEC-020`)   | One JSON document: account, profile, hardware, sessions, rounds, trials, metrics, recommendations, validations, preferences, consents — built in the browser from the response, so no export file waits on a server |
| Deletion (`SENS-SEC-021`) | Re-authenticated, then `pending_deletion` + a 30-day purge date, every session revoked, sign-in refused; cancellable inside the window                                                                              |
| Retention sweep           | Purges accounts past their window and expired unclaimed guest sessions (`SENS-BR-003`) in one pass                                                                                                                  |

The export deliberately omits the password digest: exporting a credential is only a new way to
lose one, and it is not the user's data in any useful sense.

### 2.5 The shell

`(app)/layout.tsx` — a link bar, not a dashboard. FR-090's history is not a feature if nothing
routes to it; the landing and navigation design is Phase 10's work and this is the minimum that
makes the screens reachable.

---

## 3. Files created / modified

### Created — `src/` (14 files)

| File                             | Purpose                                              |
| -------------------------------- | ---------------------------------------------------- |
| `core/comparison/index.ts`       | Comparability, the overlap rule, dimension deltas    |
| `repositories/history-repo.ts`   | The joined history read and the two comparison sides |
| `repositories/export-repo.ts`    | The full account export document                     |
| `services/history-service.ts`    | History and comparison view models                   |
| `services/hardware-service.ts`   | Profile CRUD, defaults, validation                   |
| `services/account-service.ts`    | Profile, password, export, deletion, retention sweep |
| `features/history/*` (2)         | SCR-041 list, SCR-042 comparison                     |
| `features/hardware/*` (3)        | Schema, actions, SCR-043                             |
| `features/account/*` (3)         | Actions, SCR-044, SCR-045                            |
| `app/(app)/layout.tsx`           | The signed-in link bar                               |
| `app/(app)/history`, `/compare`  | SCR-041, SCR-042                                     |
| `app/(app)/hardware-profiles`    | SCR-043                                              |
| `app/(app)/profile`, `/settings` | SCR-044, SCR-045                                     |

### Created — tests (3 files, 39 new cases)

| File                                         | Cases | Covers                                                                                             |
| -------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------- |
| `tests/unit/comparison/comparison.test.ts`   | 14    | Comparability, the overlap rule, touching ranges, dimension tolerances                             |
| `tests/integration/accounts-history.test.ts` | 17    | Profiles, history, comparison, guest claiming, password, export, deletion, retention, cross-tenant |
| `tests/e2e/accounts.spec.ts`                 | 8     | All four screens, the prefill, the 404, the signed-out redirect                                    |

### Modified

| File                                      | Change                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| `repositories/user-repo.ts`               | Account read, display name, password digest lookup, deletion scheduling, purge |
| `services/calibration-session-service.ts` | Sessions attributed to an owned hardware profile                               |
| `features/calibrate/*`                    | Profile picker and prefill on the calibration form                             |
| `app/(app)/calibrate/page.tsx`            | Loads the user's saved profiles                                                |
| `scripts/e2e-fixtures.ts`                 | The fixture account gets a hardware profile, and its sessions are attributed   |
| `README.md`                               | Status, phase table, testing notes                                             |

---

## 4. Defects and design problems found

**4.1 History listed validation sessions as failed calibrations.** A validation session is a
real `test_sessions` row with a game and a DPI but no recommendation of its own, so it appeared
in history as a completed session with no result — indistinguishable from a calibration that
produced nothing. Found by an E2E assertion that read the top row and got "no single peak" with
no confidence. History now lists a session that produced a recommendation, or a calibration
that did not (§2.2).

**4.2 The export crashed on any account with a session.** `test_sessions.seed` is a 64-bit
`bigint` and `JSON.stringify` throws on one — so the export worked only for an account that had
never calibrated, which is the one account that does not need it. Seeds are now written as
decimal strings, the same form the engine accepts, so an exported session can be replayed
(`SENS-BR-031`). Caught by the integration test, which is exactly the case a UI smoke test
would have missed.

**4.3 A recommendation could be compared with itself.** `/history/compare?a=X&b=X` produced a
comparison of a session against itself, which is always "no change" and is meaningless.
Refused at the service.

**4.4 A dimension delta of −0.4 rendered as "−0".** A minus sign in front of nothing reads as a
decline that was not measured. Rounded first, then signed; an unchanged dimension reads "0".
Caught by screenshot.

**4.5 Two duplications caught in review before they shipped.** `zForLevel` was written a second
time inside `core/comparison` when `core/statistics` already exports it, and the band-threshold
logic was reimplemented in the history service instead of calling `sensitivityBand`. Both
replaced with the existing function — the second was also _wrong_, reading the threshold fields
under names the parameter set does not use.

---

## 5. Deviations from Phase 0

| #   | Phase 0 says                                                                                                            | Implementation                                                        | Why                                                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | §17.9: dimension deltas "each labelled meaningful or within-noise"                                                      | Threshold derived from `perSigma / √n` at the credible-interval level | No rule is given. The derivation composes constants already in released sets — no new parameter set — and its unit-spread premise is stated as an `ASSUMPTION` in the module.                                           |
| 2   | FR-103 / SCR-045: units, motion preference, locale, consent management                                                  | Settings ships export and deletion only                               | FR-103 sits in doc 05 §5.12 (platform and settings), which the execution prompt assigns to Phase 10. The columns already exist and the page says where the controls arrive.                                             |
| 3   | FR-096: store per-game settings derived from a recommendation                                                           | Not built                                                             | Nothing can be derived: no adapter has closed its verification entry, so `recommendation_game_settings` is empty by design (`SENS-BR-014`). Building a store for numbers that cannot exist would be building a lie. §8. |
| 4   | FR-099: Google and Discord sign-in                                                                                      | Not built                                                             | Tagged **POST** in doc 05.                                                                                                                                                                                              |
| 5   | doc 23 §23.11: export "generated asynchronously for large accounts and delivered as a download link valid for 24 hours" | Generated synchronously, downloaded from the browser                  | At current data volumes the document is small and synchronous is _safer_: no link exists to leak and nothing is stored. Revisit when an account's export is large enough to time out.                                   |
| 6   | Phase 8 deferred §17.9 to "Phase 9, with history"                                                                       | Built here                                                            | This is that phase.                                                                                                                                                                                                     |

---

## 6. Testing

| Layer       | Result                                    |
| ----------- | ----------------------------------------- |
| Lint        | clean, `--max-warnings 0`                 |
| Typecheck   | clean, strict                             |
| Unit + arch | **55 files, 1166 passed** (Phase 8: 1152) |
| Coverage    | **90.26% branches** (gate 90%)            |
| Integration | **11 files, 128 passed** (Phase 8: 111)   |
| E2E         | **59 passed** (Phase 8: 51) — 8 new       |
| Build       | ✓ Compiled successfully                   |
| Boundaries  | ok — no violations                        |
| Secrets     | ok                                        |
| Prettier    | clean                                     |

**Authorization is asserted, not assumed.** Every owned resource this phase touches has a
cross-tenant test: another user's history is empty, their profile update and delete throw,
their comparison is not found, and their data never appears in an export. The signed-out E2E
case checks all four screens redirect to sign-in rather than rendering an empty version.

**The privacy paths are verified end to end** against a real database: the export contains the
account's sessions and no one else's and no credential material; deletion re-authenticates,
locks sign-in, leaves the data recoverable, cancels cleanly, and the retention sweep purges the
account and everything cascading from it once the window elapses.

**Visual check.** History, comparison, hardware profiles, settings, and history at 390 px. One
fix came out of it (§4.4).

---

## 7. Phase boundary verification

No Phase 10 work: no landing redesign, no unit/motion/locale controls, no mobile gate screen,
no custom scrollbar, no i18n. The `(app)` navigation bar is a link list, added because the
screens must be reachable to be tested at all, and is explicitly Phase 10's to design. No Phase
11 work: no rate-limit tuning, no observability dashboards, no release checklist.

---

## 8. Deferred items

| Item                                                        | Where it lands                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------ |
| Per-game saved settings (FR-096)                            | When an adapter's verification entry closes and a number can exist |
| Units, motion preference, locale, consent controls (FR-103) | Phase 10                                                           |
| OAuth sign-in (FR-099)                                      | POST                                                               |
| Asynchronous export with a signed link                      | When an account's export outgrows a synchronous response           |
| A scheduled runner for `runRetentionSweep`                  | Phase 11, with the rest of the operational schedule                |
| Sensitivity-history chart over time                         | Phase 10, with the visual language for it                          |

---

## 9. Risks and known limitations

**9.1 The dimension-delta threshold rests on an assumption.** §5 deviation 1. It is
conservative by construction, but it is not a measured sampling distribution, and it should be
re-derived once real repeat-session data exists.

**9.2 The retention sweep has no scheduler.** `runRetentionSweep` is written, tested and
idempotent, but nothing calls it on a timer yet — deletion is honoured on the next invocation,
not on the exact day. Phase 11 owns the operational schedule; until then a purge is a manual
run.

**9.3 Deletion is recoverable only by an operator.** The window is real and cancellation works
from the settings page — but only while the user can still reach it, and sign-in is refused
during the window. A user who signs out immediately after requesting deletion cannot cancel it
themselves. Doc 23 anticipates this ("recoverable by contacting support"); it is worth
revisiting whether a one-time cancellation link is better.

**9.4 History has no pagination.** It reads the most recent 50 sessions. Fine for a personal
tool at this stage, and the query is indexed on `(user_id, started_at DESC)`, but it is a limit
rather than a design.

**9.5 A comparison ignores which session is older.** It compares A to B in the order given, and
the page labels them by date, so a user who selects them in reverse sees a change stated
backwards. The verdict itself is symmetric, so nothing is misreported — but the phrasing
assumes A came first.

---

## 10. Exit criteria

| Criterion (phase prompt)                                                                              | State                                                                           |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Account creation, login, secure sessions, logout, management                                          | ✓ Phase 1 flows, plus profile, password change and deletion here                |
| Guest-first onboarding preserved                                                                      | ✓ Calibration still needs no account; claim covered end to end                  |
| Guest claiming, and preventing a claim of another user's guest data                                   | ✓ Cookie-driven; a second claim is refused and the first account keeps the data |
| Hardware profiles: mouse, DPI, polling, monitor, refresh, pad, more                                   | ✓ Every documented field, with only name and DPI required                       |
| Multiple profiles                                                                                     | ✓ With a default, and a filter on history                                       |
| History: date, game, hardware, range, recommendation, confidence, quality, profile, algorithm version | ✓ All present on the row or its subline                                         |
| Session detail with previous response curves                                                          | ✓ Each row opens its result page, which redraws the stored curve                |
| Comparison using statistically meaningful differences                                                 | ✓ Non-overlap rule, flagged comparability, per-dimension tolerances             |
| Never imply improvement from a higher arbitrary number                                                | ✓ Overlapping ranges say "within the noise of the method" in the headline       |
| Sensitivity history over time                                                                         | — Deferred to Phase 10 (§8): the list is chronological, the chart is a visual   |
| User game settings for supported games                                                                | — Nothing derivable while every adapter is unverified (§5 deviation 3)          |
| Export, deletion, account deletion, retention                                                         | ✓ All four, tested against a real database                                      |
| Server-side ownership on every history/profile endpoint                                               | ✓ Composed in SQL; cross-tenant tests assert empty/not-found, never filtered    |

---

## 11. Readiness for Phase 10

Phase 10 (UI/UX polish) inherits every screen it needs to dress: the landing page, the
calibration flow, results, validation, history, comparison, hardware, profile and settings.
The account already stores `locale`, `unit_preference` and `motion_preference`, so the settings
controls are a screen over columns that exist rather than a schema change.

---

## Repository status

**Branch:** `main`
**No commit created. No push performed.** The working tree holds every change described above.

### Recommended review commands

```bash
git status
git diff --stat
git diff src/services/calibration-session-service.ts src/repositories/user-repo.ts
```

### Recommended commit commands

```bash
git add .
git commit -m "feat: complete phase 9 accounts and history"
git push origin main
```

### Next phase

Phase 10 — UI/UX Polish & Responsive Product Experience. **Not started.**
