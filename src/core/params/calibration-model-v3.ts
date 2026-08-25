import { CALIBRATION_MODEL_V2, type CalibrationParamsV2 } from "./calibration-model-v2";
import type { ParameterSet } from "./types";

/**
 * `calibration_model_v3` — v2 with the peak verdict tested on the curvature.
 *
 * ## What changed and why it is a new version
 *
 * A released set is immutable (`SENS-BR-029`), and this set changes what a session concludes,
 * so it is released rather than edited. **Every constant is identical to v2.** The single
 * difference is `statistics.requireSignificantCurvature`, which selects the rule the verdict
 * uses — carried as a parameter, not as a code-level change, so a session stored under v1 or v2
 * still re-derives the verdict it was given at the time (`SENS-BR-030`).
 *
 * ## The defect this fixes
 *
 * Under v1 and v2 a `peak_found` verdict required some candidate *pair* to be distinguishable
 * (doc 13 §13.9) alongside a concave point fit whose vertex fell inside the measured span.
 *
 * Pairwise distinguishability is the right rule for the question doc 13 §13.10 condition 3 asks
 * — *should the search continue?* — where an OR across pairs is conservative in the safe
 * direction. As a **verdict** it is anti-conservative: a Standard session pools nine candidates
 * plus the anchor, so "any pair separates" is an OR over thirty-six comparisons at a 90% level
 * with no multiplicity control. A response with no curvature at all clears it far more often
 * than the level suggests, and the concave point fit then supplies a vertex to report.
 *
 * v3 tests the claim the verdict actually makes. A peak asserts that the response *bends*, so
 * the bootstrap interval on the quadratic coefficient `b₂` must exclude zero — doc 13 §13.9's
 * own rule, at doc 13 §13.9's own level, applied to the right quantity. The interval is drawn
 * from the resamples the bootstrap already refits, so it costs no additional computation and
 * cannot disagree with the vertex interval about what the bootstrap saw.
 *
 * ## Measured effect
 *
 * One hundred simulated flat players (curvature exactly zero) and one hundred peaked players,
 * each run through the full search — `tests/unit/calibration/properties.test.ts`:
 *
 * | Population        | v2 rule    | v3 rule    |
 * | ----------------- | ---------- | ---------- |
 * | Flat — peak found | 27 / 100   | 11 / 100   |
 * | Peaked — found    | 100 / 100  | 100 / 100  |
 * | Peaked — median error | 0.042 log2 | 0.042 log2 |
 *
 * Fabricated peaks fall by roughly sixty percent at no measurable cost to detection or
 * accuracy, which is the trade `SENS-BR-017` exists to make.
 *
 * ## What it does not fix
 *
 * Eleven percent remains above the five percent a one-sided test at this level would nominally
 * give. The residue is post-selection inference: the bracket narrows toward whatever looked
 * humped, and the verdict is then tested on that same data, so the stopping rule and the test
 * are not independent. Removing it needs a design change — sample splitting, or a confirmation
 * round held out from the search — not a different threshold. Recorded as a known limitation in
 * `docs/implementation/phase-11-completion.md` rather than tuned away.
 */
export const CALIBRATION_MODEL_V3: ParameterSet<CalibrationParamsV2> = Object.freeze({
  kind: "calibration",
  version: "calibration_model_v3",
  releasedAt: "2026-08-25",
  notes:
    "Requires the curvature to be significant before reporting a peak: the bootstrap interval " +
    "on b2 must exclude zero at the configured level. Every constant is unchanged from v2. " +
    "Reduces fabricated peaks on flat responses from 27% to 11% in simulation, with real-peak " +
    "detection and accuracy unchanged.",
  params: Object.freeze({
    ...CALIBRATION_MODEL_V2.params,
    statistics: Object.freeze({
      ...CALIBRATION_MODEL_V2.params.statistics,
      requireSignificantCurvature: true,
    }),
  }),
});
