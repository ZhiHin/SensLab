# 22 — Telemetry Strategy

Related: [19-test-engine-architecture.md](19-test-engine-architecture.md) · [20-data-model.md](20-data-model.md) · [23-security-and-privacy.md](23-security-and-privacy.md)

"Telemetry" here means three genuinely different things that must not share a pipeline:

| Kind | Volume | Destination | Default |
|---|---|---|---|
| **A. Raw pointer stream** | ~1.5 M samples per session | Nowhere (device memory only) | Discarded |
| **B. Derived measurement data** | ~5 K rows per session | PostgreSQL | Always stored |
| **C. Product analytics** | ~15 events per session | Analytics store | Always stored |

Conflating A with B is how a product accidentally builds a petabyte-scale ingestion problem to
answer questions it could have answered with a kilobyte. Conflating A with C is how it
accidentally ships biometric-adjacent data to a third party.

---

## 22.1 The pipeline

```
pointermove (up to 8000/s)
   |
   v
[ ring buffer, typed arrays, device memory ]        A - raw
   |
   |  (per trial, in the inter-trial interval)
   v
[ metric derivation ]  ------> ~12 metric values per trial
   |
   |  (per round)
   v
[ round aggregation ] --------> medians, rates, robust SD, CIs, sample counts
   |
   |  HTTPS POST, idempotent, <= 64 KB
   v
[ PostgreSQL ]                                      B - derived
   |
   v
[ scoring / calibration / recommendation ]

   ( A is overwritten by the next trial and never leaves the device,
     unless research consent is explicitly granted - s22.4 )
```

---

## 22.2 Raw pointer data — the default is to discard it

`SENS-BR-032`. Reasons, in order of weight:

1. **It is not needed.** Every quantity the recommendation depends on is derived on the device.
   Storing the raw stream would let SensLab recompute metrics with a future algorithm — a real
   but modest benefit that does not justify the other three points.
2. **Volume.** ~1.5 M samples per session at ~24 bytes each ≈ 36 MB before compression, ~8–12 MB
   after. At 100,000 sessions that is a petabyte-adjacent problem in the first year for a
   product that does not need it.
3. **Privacy.** A high-resolution stream of a person's hand movements is a behavioural biometric.
   It is plausibly identifying and it is not the kind of data to collect casually.
4. **Cost of carelessness.** Data that exists gets used, leaked, subpoenaed, and migrated. Data
   that was never collected does none of those things.

**Explicitly prohibited:** any code path that transmits per-event pointer data as part of normal
operation, to SensLab's own servers or to any third party (`SENS-NFR-022`, `SENS-FR-104`).
Enforced by a schema-level size check on the ingest payload and a CI check on the analytics
event contract.

---

## 22.3 In-memory buffering

Detailed in doc 19 §19.7. Summary:

- Pre-allocated typed arrays sized from the plan's worst-case trial.
- Reused between trials — zero allocation in steady state.
- Overflow drops the oldest **frame** samples, never input samples or button events, and raises a
  `buffer_overflow` quality flag.
- Nothing is copied, serialised, or transferred during a trial.

**Sampling policy inside the buffer:** none. Input samples are recorded at full rate. Downsampling
would corrupt path length, correction counting and jitter — the metrics that matter most. Full
rate is affordable precisely because the data never leaves memory.

---

## 22.4 Optional raw retention for research

Consent-gated, off by default, and separated from operational data (`SENS-BR-033`).

**Flow:**
1. The user opts in explicitly (Settings, or a one-time prompt after a completed session — never
   a pre-checked box, never bundled into the terms).
2. A `research_consents` row is written with the policy version.
3. During subsequent sessions, per-round raw buffers are quantised and compressed on the device:
   timestamps as deltas, angles as fixed-point at 0.001° resolution, delta-encoded, then
   `CompressionStream('gzip')`. Expected ~1.5–3 MB per session.
4. Uploaded to **object storage**, never to PostgreSQL. A `telemetry_batches` row stores the
   pointer, the sample count, the consent id and `retention_expires_at`.
5. Retention: 30 days by default; the object-store lifecycle rule is the backstop and the
   database sweep is the primary mechanism.
6. Revocation deletes the objects and the rows within 7 days, and is available in Settings with
   no friction.

**Constraints on use:** research telemetry may be used to improve algorithms and to fit reference
distributions. It may not be used to identify a user, may not be shared with third parties, and
may not be joined to marketing data. Stated in the privacy policy, not just here.

**Debugging use:** a support engineer can request a one-session telemetry capture from a user
reporting a problem, with a separate, explicit, single-session consent and a 7-day retention.
This is the only path by which raw data is ever viewed by a human.

---

## 22.5 What is actually sent to the server per round

```
POST /api/sessions/:id/rounds
Idempotency-Key: <sessionId>:<presentationOrder>

{
  presentationOrder, blockIndex, candidateId | null, testDefinitionId,
  scopeKey, isPractice, startedAt, completedAt,
  trials: [ {
      trialIndex, isPractice, validity, invalidReason | null, isReplacement,
      startOffsetMs, durationMs, hit, shots,
      targetAngularRadiusDeg, targetDistanceDeg, targetDirectionDeg,
      stimulusSeed, cleanFrameFraction, qualityFlags[],
      metrics: { metricKey: value, ... }        // ~12 entries
  } ],
  roundMetrics: { metricKey: { value, nValid, nInvalid, nDegraded, robustSd, ciLow, ciHigh } },
  qualitySummary: { lateFrameRatio, hitchCount, lockLossCount }
}
```

Roughly 30–55 KB for a 12-trial round; the ceiling is 64 KB (`SENS-NFR-014`) and the server
rejects anything larger rather than truncating.

**Server-side validation:** the same Zod schema the client used, plus semantic checks — trial
count within the definition's bounds, `invalid_reason` present iff invalid, metric keys all
present in `metric_definitions`, values finite and within physically possible ranges. A payload
failing semantic validation invalidates the round and is logged; it does not silently pass
(doc 23 §23.10).

---

## 22.6 Product analytics

Events (FR-104), with their properties:

| Event | Properties |
|---|---|
| `calibration_started` | mode, gameSlug, isGuest, hasCurrentSens, dpiSource |
| `environment_checked` | class, unadjustedMovement, lateFrameRatioBucket |
| `practice_completed` | practiceTrials |
| `round_completed` | roundIndex, blockIndex, testKey, validRatio |
| `test_abandoned` | **stage, roundIndex**, elapsedSeconds — the key funnel event (`SENS-NFR-035`) |
| `calibration_completed` | mode, roundCount, stopReason, verdict, confidenceBucket |
| `recommendation_generated` | verdict, confidenceBucket, aimProfileKey, deltaFromCurrentBucket |
| `game_settings_viewed` | gameSlug, verificationStatus |
| `game_settings_copied` | gameSlug, scopeKey |
| `output_game_switched` | fromSlug, toSlug |
| `validation_started` / `validation_completed` | verdict |
| `fine_tune_started` / `fine_tune_completed` | movedFromRecommendation (bool) |
| `sensitivity_accepted` | source (recommended / original / fine-tuned) |
| `recalibration_requested` | reason |
| `account_created` | fromGuestSession (bool) |

**Rules:**
- Continuous values are **bucketed** before emission (confidence to deciles, deltas to bands).
  Raw precise values are not needed for funnel analysis and increase re-identification risk.
- No event carries a metric array, a pointer sample, an email, or a raw recommendation value.
- The event contract is a typed schema; a CI test asserts no property is an array of numbers
  longer than 8 and no property name matches a telemetry pattern.
- Events are emitted **outside** the test loop — queued and flushed at stage boundaries, never
  during a trial (`SENS-NFR-002` protection, FR-104).
- `sendBeacon` is used for `test_abandoned` on unload.

**Destination:** a first-party endpoint writing to `analytics_events`, at MVP. If a third-party
analytics tool is adopted later, the same contract applies and the bucketing rule becomes a hard
requirement rather than a good practice.

---

## 22.7 Aggregate quality monitoring

Derived from B and C, for the team rather than the user (`SENS-NFR-036`):

| Dashboard | Purpose |
|---|---|
| Confidence distribution over time | Detects a regression in measurement quality |
| `indistinguishable` verdict rate | If this climbs, the trial budget or the metric set is too weak |
| Validation verdict mix (improved / no-difference / worse) | **The single most important product-truth metric.** If `worse` is common, the calibration is wrong and must be fixed, not spun |
| Invalid/degraded trial rates by browser and OS | Finds environment problems |
| `unadjustedMovement` grant rate by browser | Feeds `EV-010` |
| Abandonment by stage | Where the funnel actually breaks |
| Session duration vs. estimate | Feeds the computed-duration estimator (`SENS-BR-024`) |
| Adapter verification staleness | Feeds doc 08 §8.6 |

The validation verdict mix deserves emphasis: it is the closest thing SensLab has to a ground
truth about whether its core algorithm works. It must be reviewed regularly, and a rising `worse`
rate is a stop-and-fix signal, not a metric to optimise away by weakening the validation test.

---

## 22.8 Local persistence on the device

- Completed round aggregates are written to **IndexedDB** before transmission
  (`SENS-NFR-018`), keyed by `(sessionId, presentationOrder)`, and deleted on server
  acknowledgement.
- Raw buffers are never written to disk.
- Local data is cleared when a session completes or is abandoned, and on sign-out.
- A stale local draft older than 24 hours is discarded on load.

---

## 22.9 What is never collected

- Keystrokes outside the test's own button events.
- Clipboard contents.
- Any page content, cursor position, or interaction outside SensLab's own surfaces.
- Precise geolocation.
- Raw IP addresses in persistent storage (salted hash only, 30 days — doc 23 §23.9).
- Device fingerprinting signals beyond the measurement-relevant environment fields
  (doc 20 §20.12).
- Any third-party tracker, advertising pixel, or session-replay tool. Session replay in
  particular is prohibited: it would capture the test canvas and defeat every guarantee in this
  document.
