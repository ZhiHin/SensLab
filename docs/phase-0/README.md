# SensLab — Phase 0 Specification

**Status:** Complete — awaiting approval before Phase 1
**Phase:** 0 (Product Specification & Engineering Foundation)
**Contains application code:** No. This directory is documentation only.

---

## What this is

This directory is the complete product, UX, mathematical and engineering specification for
**SensLab**, a browser-based gaming mouse sensitivity *calibration* platform.

It is written so that a senior engineer who has never spoken to the product owner can begin
Phase 1 without guessing any major architectural, mathematical, or business decision.

Everything that cannot be determined without external confirmation is explicitly marked
`REQUIRES_EXTERNAL_VERIFICATION` and centrally tracked in
[36-external-verification-register.md](36-external-verification-register.md).

---

## How to read this

**If you are implementing Phase 1**, read in this order:

1. [01-product-vision.md](01-product-vision.md) — what we are building and why
2. [02-scope.md](02-scope.md) — what is in the MVP and what is deliberately not
3. [11-canonical-sensitivity-model.md](11-canonical-sensitivity-model.md) — the mathematical core
4. [18-system-architecture.md](18-system-architecture.md) — module boundaries
5. [20-data-model.md](20-data-model.md) — the schema
6. [34-phase-1-backlog.md](34-phase-1-backlog.md) — your actual work list

**If you are reviewing the science**, read 09 → 10 → 13 → 14 → 15 → 16 → 17 in order.
They form a single chain: tests produce metrics, metrics produce scores, scores drive the
search, the search produces a recommendation, the recommendation is validated.

**If you are designing**, read 21 (in-doc) → 24 → 25 → 26 → 27 → 28.

---

## Document index

| # | Document | Purpose |
|---|----------|---------|
| 00 | [Completion Report](00-completion-report.md) | Phase 0 summary, verification performed |
| 01 | [Product Vision](01-product-vision.md) | Problem, differentiation, MVP/long-term vision |
| 02 | [Scope](02-scope.md) | MVP / Post-MVP / Future, explicit non-goals |
| 03 | [Personas](03-personas.md) | Four primary personas + anti-persona |
| 04 | [User Journeys](04-user-journeys.md) | Primary flow + 12 alternate/failure flows |
| 05 | [Functional Requirements](05-functional-requirements.md) | `SENS-FR-*` with acceptance criteria |
| 06 | [Non-Functional Requirements](06-non-functional-requirements.md) | `SENS-NFR-*` |
| 07 | [Business Rules](07-business-rules.md) | `SENS-BR-*` — the invariants |
| 08 | [Supported Games](08-supported-games.md) | Game roster + what is and is not known |
| 09 | [Test Catalogue](09-test-catalogue.md) | All 14 aim tests, fully specified |
| 10 | [Measurement Methodology](10-measurement-methodology.md) | Every metric: definition, unit, formula |
| 11 | [Canonical Sensitivity Model](11-canonical-sensitivity-model.md) | cm/360, FOV, ADS/scope math |
| 12 | [Game Adapter Architecture](12-game-adapter-architecture.md) | Versioned, verifiable conversion layer |
| 13 | [Calibration Algorithm](13-calibration-algorithm.md) | Adaptive blind sensitivity search |
| 14 | [Scoring Model](14-scoring-model.md) | Normalization → dimensions → candidate score |
| 15 | [Confidence Model](15-confidence-model.md) | How confidence is actually computed |
| 16 | [Recommendation Model](16-recommendation-model.md) | Result object + aim profile classification |
| 17 | [Validation & Fine-Tuning](17-validation-and-fine-tuning.md) | Blind A/B, honest reporting |
| 18 | [System Architecture](18-system-architecture.md) | Next.js structure, module boundaries |
| 19 | [Test Engine Architecture](19-test-engine-architecture.md) | The Canvas runtime |
| 20 | [Data Model](20-data-model.md) | Tables, columns, keys, indexes, ERD |
| 21 | [Database Strategy](21-database-strategy.md) | Migrations, roles, retention, growth |
| 22 | [Telemetry Strategy](22-telemetry-strategy.md) | Buffering, sampling, retention, consent |
| 23 | [Security & Privacy](23-security-and-privacy.md) | `SENS-SEC-*`, authz, CSRF, deletion |
| 24 | [Screen Inventory](24-screen-inventory.md) | Every screen, route, state, auth level |
| 25 | [Wireframes](25-wireframes.md) | Low-fidelity layouts for key screens |
| 26 | [UI/UX Design System](26-ui-ux-design-system.md) | Tokens, type, colour, motifs |
| 27 | [Motion & Interaction](27-motion-and-interaction.md) | Motion spec + reduced-motion rules |
| 28 | [Responsive & Accessibility](28-responsive-accessibility.md) | Breakpoints, WCAG posture |
| 29 | [Testing Strategy](29-testing-strategy.md) | Unit / integration / E2E / engine harness |
| 30 | [Performance Strategy](30-performance-strategy.md) | Frame budget, quality gating |
| 31 | [Risk Register](31-risk-register.md) | 24 risks with probability/impact/mitigation |
| 32 | [Decision Log](32-decision-log.md) | ADR-001 … ADR-022 |
| 33 | [Requirement Traceability](33-requirement-traceability.md) | Requirement → rule → screen → table → test |
| 34 | [Phase 1 Backlog](34-phase-1-backlog.md) | Ordered, estimated, with exit criteria |
| 35 | [Glossary](35-glossary.md) | Shared vocabulary |
| 36 | [External Verification Register](36-external-verification-register.md) | Every unverified fact, centralised |

---

## Deviations from the requested structure

Two documents were added beyond the requested 35-file layout. Both are additions, not
substitutions — every requested file exists with the requested number.

**`35-glossary.md`** — The specification uses a large amount of precise vocabulary
(cm/360, counts, yaw constant, monitor distance coefficient, candidate, block, trial,
degraded vs. invalid). Several terms have colliding everyday meanings — most dangerously
"sensitivity" (physical vs. in-game number) and "test" (an aim test vs. a unit test).
A single normative glossary prevents the documents from drifting apart and prevents
Phase 1 code from picking inconsistent identifiers.

**`36-external-verification-register.md`** — Section 37 of the Phase 0 brief requires that
unverified game facts be labelled, and Section 8 requires documentation of exactly what must
be verified before implementation. Those items are individually marked inline throughout
docs 08, 11 and 12, but they are also *blocking* for Phase 5 and need a single owner-assignable
worklist. Scattering them across three documents would have made it impossible to answer
"are we ready to ship the Apex adapter?" without re-reading everything. The register is the
single source of truth for verification status; inline marks link to it by ID (`EV-###`).

No requested document was merged, dropped, or reduced to a stub.

---

## Conventions used throughout

- **Requirement IDs** are stable and never reused. See [33-requirement-traceability.md](33-requirement-traceability.md).
- **`REQUIRES_EXTERNAL_VERIFICATION`** marks a factual claim about a third-party game, browser,
  or platform that SensLab must confirm from an authoritative source before shipping code that
  depends on it. Each carries an `EV-###` id.
- **`ASSUMPTION`** marks a product or design choice made in the absence of data. Assumptions are
  ours to change; verification items are not.
- **`TUNABLE`** marks a numeric constant that is deliberately a configuration value, expected to
  change after pilot data, and therefore must live in a versioned parameter set rather than in code.
- Units are always explicit. Angles in degrees, distances in centimetres, time in milliseconds.

---

## Phase 0 boundary

No file in this repository outside `docs/` was created during Phase 0. There is no
`package.json`, no `node_modules`, no migration, and no source file. Phase 1 begins only on
explicit approval.
