# 24 — Screen Inventory

Related: [04-user-journeys.md](04-user-journeys.md) · [25-wireframes.md](25-wireframes.md) · [28-responsive-accessibility.md](28-responsive-accessibility.md)

**Auth column:** `guest` = works with no account · `either` = works either way ·
`user` = requires an account.
**Chrome column:** `full` = header + footer · `minimal` = logo + exit only · `none` = fullscreen lab.

---

## 24.1 Marketing and information

| ID | Screen | Route | Auth | Chrome | Pri | Purpose and key states |
|---|---|---|---|---|---|---|
| SCR-001 | Landing | `/` | guest | full | MVP | Hero, scroll narrative (REACT/FLICK/TRACK/CONTROL/OPTIMIZE), primary CTA. States: default, reduced-motion, touch |
| SCR-002 | How It Works / Methodology | `/how-it-works` | guest | full | MVP | The document P4 reads first. Measurement method, search method, confidence definition, browser limitations, per-game verification table |
| SCR-003 | Privacy Policy | `/privacy` | guest | full | MVP | |
| SCR-004 | Terms | `/terms` | guest | full | MVP | |
| SCR-005 | Not Found / Error | `*` | guest | full | MVP | Includes an expired-guest-result variant |

---

## 24.2 Calibration setup

| ID | Screen | Route | Auth | Chrome | Pri | Purpose and key states |
|---|---|---|---|---|---|---|
| SCR-010 | Game Selection | `/calibrate/game` | guest | minimal | MVP | Five tiles + "I play several / not listed". Each tile shows verification state. States: default, unverified-selected, generic-selected |
| SCR-011 | Hardware Setup | `/calibrate/hardware` | guest | minimal | MVP | DPI required; everything else behind one optional disclosure. States: fresh, prefilled-from-profile, DPI-unknown helper (3 branches), validation errors |
| SCR-012 | Environment Check | `/calibrate/environment` | guest | minimal | MVP | Four probes. States: probing, pass, degraded (warn + continue), blocked (pointer lock unavailable), DPI-inconsistent warning |
| SCR-013 | Test Introduction | `/calibrate/intro` | guest | minimal | MVP | Computed duration range, blinding disclosure, motion advisory, mode switch (Quick/Standard/Advanced) |

---

## 24.3 The lab (fullscreen, no chrome)

All lab screens live under one route, `/(lab)/run/[sessionId]`, and are **engine stages**, not
separate pages (doc 18 §18.8). They have IDs because they are distinct designed states.

| ID | Stage | Auth | Chrome | Pri | Purpose and key states |
|---|---|---|---|---|---|
| SCR-014 | Practice | either | none | MVP | Unscored. States: free-aim, guided practice, "more practice" offer |
| SCR-015 | Baseline | either | none | MVP | Container for the two sensitivity-independent tests: Reaction and 360 Comfort |
| SCR-016 | Reaction Test | either | none | MVP | States: waiting, target shown, premature click, complete |
| SCR-017 | Flick Test | either | none | MVP | States: reset target, inter-trial, active, timeout |
| SCR-018 | Micro Adjustment Test | either | none | MVP | |
| SCR-019 | Tracking Test | either | none | MVP | States: pre-roll, tracking (button held), button-released warning |
| SCR-020 | Target Switching Test | either | none | MVP | |
| SCR-021 | Precision Test | either | none | MVP | One-shot rule made explicit |
| SCR-022 | Pause Overlay | either | none | MVP | Resume / restart round / abort. Reached by ESC, lock loss, blur |
| SCR-023 | Quality Warning | either | none | MVP | Continue with reduced confidence / switch to Quick / abort |
| SCR-024 | 360 Comfort Test | either | none | MVP | Three sub-tasks; heavy instruction; "enter pad width instead" is equally prominent |
| SCR-025 | Wide Flick Test | either | none | POST | |
| SCR-026 | Strafe / Slide Tracking | either | none | POST | |
| SCR-027 | Recoil Control Test | either | none | POST | |
| SCR-028 | ADS Test | either | none | POST | |
| SCR-029 | Scope Calibration | either | none | POST | Only scopes the selected game actually has |

**Universal lab constraints** (`SENS-BR-007`, `SENS-BR-021`):
no navigation, no score, no accuracy, no candidate identity, no streak, no animation beyond the
restricted renderer set. HUD shows round, progress, and `ESC — PAUSE`, drawn on canvas.

---

## 24.4 Analysis and results

| ID | Screen | Route | Auth | Chrome | Pri | Purpose and key states |
|---|---|---|---|---|---|---|
| SCR-030 | Analysis | `/(lab)/run/[id]/analysis` | either | none | MVP | "ANALYZING YOUR AIM" with real stage progress; minimum 1.2 s hold |
| SCR-031 | Results | `/results/[recommendationId]` | either | full | MVP | **States: `peak_found`, `indistinguishable`, `insufficient_data`, guest-expiring, superseded** |
| SCR-032 | Game Settings | `/results/[id]/settings` | either | full | MVP | States: verified, partial, unverified, generic (no game). Output-game switcher, conversion-method selector, copy controls |
| SCR-033 | Validation Test | `/(lab)/run/[id]?stage=validation` | either | none | MVP | Blind A/B; result states: improved, no measurable difference, worse |
| SCR-034 | Fine Tune | `/(lab)/run/[id]?stage=finetune` | either | none | MVP | Blind five-candidate refinement; reveal after completion; optional preference question |
| SCR-035 | Shared Result (read-only) | `/r/[shareToken]` | guest | full | POST | Public view; owner-revocable |

---

## 24.5 Account, history, profiles

| ID | Screen | Route | Auth | Chrome | Pri | Purpose and key states |
|---|---|---|---|---|---|---|
| SCR-040 | Save Your Result | modal on SCR-031 | guest | — | MVP | Guest-only. "This result disappears in 7 days." Sign up / sign in / dismiss |
| SCR-041 | History | `/history` | user | full | MVP | Date, game, DPI, cm/360, score, confidence, profile. States: empty, single-session, many, filtered by hardware profile |
| SCR-042 | Session Comparison | `/history/compare?a=&b=` | user | full | MVP | States: comparable, flagged-incomparable, meaningful change, within-noise |
| SCR-043 | Hardware Profiles | `/hardware-profiles` | user | full | MVP | List, create, edit, set default, soft-delete. States: empty, one, many |
| SCR-044 | Profile | `/profile` | user | full | MVP | Display name, email, password change |
| SCR-045 | Settings | `/settings` | user | full | MVP | Units, motion preference, locale, consents, export, delete account |

---

## 24.6 Authentication

| ID | Screen | Route | Auth | Chrome | Pri | Purpose and key states |
|---|---|---|---|---|---|---|
| SCR-060 | Sign Up | `/auth/sign-up` | guest | minimal | MVP | States: default, with-guest-session-to-claim, errors |
| SCR-061 | Sign In | `/auth/sign-in` | guest | minimal | MVP | Same, plus generic failure message (`SENS-SEC-010`) |
| SCR-062 | Verify Email | `/auth/verify` | either | minimal | MVP | States: pending, success, expired, already-verified |
| SCR-063 | Reset Password | `/auth/reset` | guest | minimal | MVP | Request and set-new states |

---

## 24.7 Platform gates

| ID | Screen | Route | Auth | Chrome | Pri | Purpose |
|---|---|---|---|---|---|---|
| SCR-050 | Desktop Required | any `/calibrate/*` or lab route on touch-only | guest | full | MVP | Explains why, offers "send to my desktop" (link/QR), shows a sample result, offers a preview of the test. **Never offers a touch calibration** (`SENS-BR-023`) |
| SCR-051 | Browser Not Supported | environment check `blocked` | guest | full | MVP | Per-browser guidance; capability-based, not UA-sniffed |

---

## 24.8 Screen → journey → requirement map

| Screen | Journey stage | Key requirements |
|---|---|---|
| SCR-001 | J-01 S1 | FR-001, FR-002, FR-003 |
| SCR-002 | J-01 S1 | FR-004, FR-005, BR-022 |
| SCR-010 | J-01 S2 | FR-010–016 |
| SCR-011 | J-01 S3 | FR-018–028 |
| SCR-012 | J-01 S4, J-X1, J-X2 | FR-029–034, BR-023 |
| SCR-013 | J-01 S5 | FR-037–040, BR-024 |
| SCR-014 | J-01 S6 | FR-036, BR-011 |
| SCR-015/016/024 | J-01 S7 | FR-057, BR-006 |
| SCR-017–021 | J-01 S8 | FR-041, FR-042, FR-053–060, BR-007 |
| SCR-022 | J-X1, J-X5 | FR-043, FR-044, FR-046 |
| SCR-023 | J-X6 | FR-048, BR-010 |
| SCR-030 | J-01 S9 | UX-021 |
| SCR-031 | J-01 S10, J-X9 | FR-070, FR-082–084, BR-017, BR-027 |
| SCR-032 | J-01 S11, J-X11 | FR-078–081, FR-085, BR-013, BR-014 |
| SCR-033 | J-01 S12, J-X10 | FR-086–088, BR-016 |
| SCR-034 | J-01 S13 | FR-089 |
| SCR-040 | J-01 S14, J-02 | FR-092, BR-001, BR-003 |
| SCR-041 | J-04 | FR-090 |
| SCR-042 | J-04, J-06 | FR-093, FR-095, BR-019 |
| SCR-043 | J-06 | FR-094, BR-018 |
| SCR-045 | — | FR-103, SEC-020, SEC-021, SEC-022 |
| SCR-050 | J-X8 | FR-100, BR-023 |
| SCR-060–063 | J-03 | FR-097, SEC-003, SEC-010, SEC-011 |

---

## 24.9 Global UI elements

| Element | Present on | Notes |
|---|---|---|
| Header | `full` chrome screens | Logo, "How it works", account menu or sign-in. **No permanent left navigation** (doc 26 §26.2) |
| Footer | `full` chrome screens | Legal, methodology, algorithm version line |
| Custom scrollbar | Everywhere except the lab | Styling only; native behaviour preserved (FR-102) |
| Toast / status region | App screens | ARIA live region; used for copy confirmations and save states |
| Confidence caveat | Every result surface | `SENS-BR-022`, `SENS-NFR-043` |
| Version footer line | Result surfaces | Scoring / calibration / confidence / adapter versions (FR-006) |

---

## 24.10 Screen count summary

| Group | MVP | Post-MVP | Total |
|---|---|---|---|
| Marketing / info | 5 | 0 | 5 |
| Setup | 4 | 0 | 4 |
| Lab | 11 | 5 | 16 |
| Results | 5 | 1 | 6 |
| Account / history | 6 | 0 | 6 |
| Auth | 4 | 0 | 4 |
| Platform gates | 2 | 0 | 2 |
| **Total** | **37** | **6** | **43** |
