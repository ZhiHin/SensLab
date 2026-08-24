import Link from "next/link";
import { Callout, Panel, Readout, StatusPill } from "@/components/primitives";
import { dimensionLabel, explainStrengths, strengthsAndAreas } from "@/core/recommendation";
import { AIM_PROFILE_RULES_V1 } from "@/core/params";
import type { DimensionKey } from "@/core/types/vocabulary";
import type { RecommendationView } from "@/services/recommendation-service";
import type { ValidationOffer } from "@/core/validation";
import { AimDna } from "./aim-dna";
import { ConfidenceBreakdown } from "./confidence-breakdown";
import { CopyButton } from "./copy-button";
import { ResponseCurveChart } from "./response-curve";

/**
 * SCR-031 — the results page (doc 25 §25.8, doc 16 §16.4, FR-082).
 *
 * Three verdicts, three layouts. `peak_found` leads with the number; `indistinguishable`
 * leads with the comfort range and **no point value** (`SENS-BR-017`) — the hero is
 * restructured, not re-worded, because "no single sensitivity won" is a finding, not an error;
 * `insufficient_data` leads with what went wrong and offers a re-run.
 *
 * The response curve is the centrepiece on every verdict. A visibly flat curve is the most
 * convincing possible presentation of a flat result.
 */

const fmt = (value: number, decimals = 1): string => value.toFixed(decimals);

function relativeStatement(view: RecommendationView): string | null {
  const current = view.hardware.currentCmPer360;
  const recommended = view.canonical.cmPer360;
  if (current === null || recommended === null) return null;
  const ratio = recommended / current;
  const pct = Math.round(Math.abs(ratio - 1) * 100);
  if (pct < 3)
    return `You were at ${fmt(current)}. Your measured peak is within a few percent of that — you were already close.`;
  return `You were at ${fmt(current)}. Your measured peak is about ${pct}% ${ratio > 1 ? "slower" : "faster"} than that.`;
}

export interface ResultsViewProps {
  readonly view: RecommendationView;
  /**
   * Whether a validation is offered, and why not when it is not (doc 17 §17.2). Resolved on
   * the server so the page can state the reason rather than hiding the control.
   */
  readonly validation: {
    readonly offer: ValidationOffer;
    readonly outcome: ValidationOutcomeSummary | null;
  };
}

export interface ValidationOutcomeSummary {
  readonly verdict: "improved" | "no_measurable_difference" | "worse";
  readonly confidenceBefore: number;
  readonly confidenceAfter: number;
  readonly accepted: "recommended" | "original" | null;
}

const VALIDATION_HEADLINE: Readonly<Record<ValidationOutcomeSummary["verdict"], string>> = {
  improved: "Validated — the recommendation performed better",
  no_measurable_difference: "Validated — no measurable difference between the two",
  worse: "Validated — your original performed better",
};

export function ResultsView({ view, validation }: ResultsViewProps) {
  const profileParams = AIM_PROFILE_RULES_V1.params;
  const dimensions = view.profile.dimensions.map((d) => ({
    dimension: d.dimension as DimensionKey,
    score: d.score,
    shape: d.shape,
    provisional: d.provisional,
    sampleCount: d.n,
    contributions: [],
    sufficient: d.n >= 8,
  }));
  const strengths = explainStrengths(strengthsAndAreas(dimensions, profileParams));
  const profileName =
    view.profile.key === null
      ? null
      : (profileParams.displayNames[
          `${view.profile.key}:${view.profile.explanation?.band ?? "mid"}`
        ] ?? view.profile.key);

  return (
    <main id="main" className="mx-auto flex w-full max-w-[1100px] flex-col gap-8 px-6 py-12">
      {view.supersededById !== null && (
        <Callout tone="caution" title="A newer result supersedes this one">
          This recommendation was refined later.{" "}
          <Link href={`/results/${view.supersededById}`} className="underline">
            See the current one
          </Link>
          . Nothing here was changed; history keeps the sequence.
        </Callout>
      )}

      {view.isGuest && view.guestExpiresAt !== null && (
        <Callout tone="neutral" title="This result is not saved to an account">
          Guest results disappear seven days after the session —{" "}
          {new Date(view.guestExpiresAt).toLocaleDateString()}. Sign up to keep it; nothing is
          re-run.{" "}
          <Link href="/auth/sign-up" className="underline" data-testid="save-result">
            Save your result
          </Link>
        </Callout>
      )}

      {/* ---------------------------------------------------------------- hero */}
      {view.verdict === "peak_found" && view.canonical.cmPer360 !== null && (
        <section className="flex flex-col gap-6" data-testid="hero-peak">
          <span className="type-label">Calibration complete</span>
          <div>
            <p className="type-label">Your true sens</p>
            <p className="flex items-baseline gap-3">
              <span className="type-display-l text-result" data-testid="recommended-cm">
                {fmt(view.canonical.cmPer360)}
              </span>
              <span className="type-label text-text-3">cm / 360°</span>
              <span className="ml-4 type-data-s text-text-3">
                = {Math.round(view.canonical.countsPer360 ?? 0).toLocaleString()} counts / 360°
              </span>
            </p>
          </div>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {view.ranges.highPerformance !== null && (
              <Readout
                label="High-performance range"
                value={`${fmt(view.ranges.highPerformance.low)} — ${fmt(view.ranges.highPerformance.high)}`}
                unit="cm/360"
              />
            )}
            <Readout
              label="Comfort range"
              value={`${fmt(view.ranges.comfort.low)} — ${fmt(view.ranges.comfort.high)}`}
              unit="cm/360"
            />
            {view.confidence !== null && (
              <Readout
                label="Confidence index"
                value={String(view.confidence.index)}
                unit="/ 100"
              />
            )}
            {profileName !== null && (
              <Readout label="Aim profile" value={profileName.toUpperCase()} />
            )}
          </dl>
          {relativeStatement(view) !== null && (
            <p className="max-w-[60ch] text-text-2" data-testid="relative-statement">
              {relativeStatement(view)}
            </p>
          )}
          <p className="max-w-[60ch] text-sm text-text-3">
            The high-performance range is where we are{" "}
            {Math.round((view.ranges.highPerformance?.level ?? 0.9) * 100)}% confident your peak
            lies. The comfort range is everything that performed about the same as the peak — pick
            what feels good inside it.
          </p>
        </section>
      )}

      {view.verdict === "indistinguishable" && (
        <section className="flex flex-col gap-6" data-testid="hero-indistinguishable">
          <span className="type-label">Calibration complete</span>
          <div>
            <p className="type-label">No single sensitivity won</p>
            <p className="flex items-baseline gap-3">
              <span className="type-display-l text-accent" data-testid="comfort-range">
                {fmt(view.ranges.comfort.low)} — {fmt(view.ranges.comfort.high)}
              </span>
              <span className="type-label text-text-3">cm / 360° · your comfort range</span>
            </p>
          </div>
          <dl className="grid gap-4 sm:grid-cols-2">
            {view.confidence !== null && (
              <Readout
                label="Confidence index"
                value={String(view.confidence.index)}
                unit="/ 100"
              />
            )}
            {profileName !== null && (
              <Readout label="Aim profile" value={profileName.toUpperCase()} />
            )}
          </dl>
          <p className="max-w-[64ch] text-text-2">
            Across everything we measured, no sensitivity in this range clearly outperformed the
            others for you. Your trial-to-trial variance was larger than the difference between
            sensitivities — which means your sensitivity probably isn&rsquo;t what&rsquo;s limiting
            you right now. That is useful information, not a failed test.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Panel title="What was measured">
              <p className="text-sm text-text-2">
                {view.responseCurve?.candidates.length ?? 0} sensitivities across{" "}
                {fmt(view.ranges.comfort.low)}–{fmt(view.ranges.comfort.high)} cm/360, in{" "}
                {view.mode} mode.
              </p>
            </Panel>
            <Panel title="Why we can't separate them">
              <p className="text-sm text-text-2">
                The smallest difference this session could have detected is larger than any
                difference it found. Below that resolution, ranking the candidates would be ranking
                noise.
              </p>
            </Panel>
            <Panel title="What you can do">
              <p className="text-sm text-text-2">
                Use anything in the range that feels good. If you want a finer answer, run a
                Standard or Advanced session — more trials shrink the resolution.
              </p>
            </Panel>
          </div>
        </section>
      )}

      {view.verdict === "insufficient_data" && (
        <section className="flex flex-col gap-6" data-testid="hero-insufficient">
          <span className="type-label">Calibration ended early</span>
          <h1 className="type-display-s">NOT ENOUGH CLEAN DATA FOR A RECOMMENDATION</h1>
          <p className="max-w-[64ch] text-text-2">
            Too few candidates reached the sample floor for a comparison, so there is no
            recommendation — a number from too little data would be worse than none. What was
            measured is kept below.
          </p>
          <Link
            href="/calibrate"
            className="self-start border border-hairline px-6 py-3 type-label"
          >
            Run again
          </Link>
        </section>
      )}

      {/* ---------------------------------------------------------------- evidence */}
      {view.responseCurve !== null && view.responseCurve.candidates.length > 0 && (
        <Panel title="Your response curve">
          <ResponseCurveChart curve={view.responseCurve} verdict={view.verdict} />
        </Panel>
      )}

      {view.confidence !== null && (
        <ConfidenceBreakdown
          index={view.confidence.index}
          components={view.confidence.components}
          verdictCapped={view.confidence.verdictCapped}
          ceiling={view.confidence.ceiling}
          indistinguishable={view.verdict === "indistinguishable"}
        />
      )}

      {/* ---------------------------------------------------------------- profile */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Aim DNA">
          <AimDna dimensions={view.profile.dimensions} />
        </Panel>

        <Panel title="Breakdown">
          {profileName !== null && (
            <div className="mb-5">
              <p className="type-label text-text-1" data-testid="profile-name">
                {profileName.toUpperCase()}
              </p>
              {view.profile.explanation !== null && (
                <p
                  className="mt-2 max-w-[60ch] text-sm text-text-2"
                  data-testid="profile-explanation"
                >
                  {view.profile.explanation.sentences.map((s) => s.text).join(" ")}
                </p>
              )}
            </div>
          )}

          {strengths.flatStatement !== null ? (
            <p className="text-sm text-text-2">{strengths.flatStatement}</p>
          ) : (
            <>
              {strengths.strengths.length > 0 && (
                <div className="mb-4">
                  <p className="type-label mb-2">Strongest</p>
                  <ul className="flex flex-col gap-2">
                    {strengths.strengths.map((item) => (
                      <li
                        key={item.dimension}
                        className="flex items-baseline justify-between gap-4"
                      >
                        <span className="text-sm text-text-2">
                          {dimensionLabel(item.dimension)}
                        </span>
                        <span className="type-data-s text-text-1">{Math.round(item.score)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {strengths.improvementAreas.length > 0 && (
                <div>
                  <p className="type-label mb-2">Improvement area</p>
                  <ul className="flex flex-col gap-3">
                    {strengths.improvementAreas.map((item) => (
                      <li key={item.dimension} className="text-sm text-text-2">
                        {item.text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          <p className="mt-5 text-xs text-text-3">
            Dimension scores are on a provisional scale: no population reference exists yet, so they
            are labelled as such and no percentile is shown. The profile shape — which dimensions
            stand out for you — is a within-session result and is not provisional.
          </p>
        </Panel>
      </div>

      {/* ------------------------------------------------------------- validation */}
      {validation.outcome !== null && (
        <Callout
          tone={validation.outcome.verdict === "worse" ? "caution" : "neutral"}
          title={VALIDATION_HEADLINE[validation.outcome.verdict]}
        >
          <span data-testid="validation-summary">
            Confidence moved {validation.outcome.confidenceBefore} →{" "}
            {validation.outcome.confidenceAfter}.
            {validation.outcome.accepted === "original"
              ? " Your original sensitivity is the standing recommendation."
              : validation.outcome.accepted === "recommended"
                ? " You accepted the measured value."
                : ""}
          </span>{" "}
          <Link
            href={`/results/${view.id}/validation`}
            className="underline"
            data-testid="see-validation"
          >
            See the comparison
          </Link>
        </Callout>
      )}

      {validation.outcome === null && validation.offer.reason === "within_mde" && (
        <Callout tone="neutral" title="Nothing to validate — you were already there">
          <span data-testid="within-mde-note">
            Your measured peak is inside the range this session could not separate from where you
            already play. A head-to-head comparison would be a test the calibration has already
            declined to call, so it is not offered.
          </span>
        </Callout>
      )}

      {/* ---------------------------------------------------------------- actions */}
      {view.verdict !== "insufficient_data" && (
        <div className="flex flex-wrap gap-3">
          {validation.offer.offered && (
            <Link
              href={`/results/${view.id}/validate`}
              className="border border-hairline px-6 py-3 type-label"
              data-testid="start-validation"
            >
              Validate it against your current sens
            </Link>
          )}
          {validation.outcome !== null && view.verdict === "peak_found" && (
            <Link
              href={`/fine-tune/${view.id}`}
              className="border border-hairline px-6 py-3 type-label"
              data-testid="start-fine-tune"
            >
              Fine-tune
            </Link>
          )}
          <Link
            href={`/results/${view.id}/settings`}
            className="border border-text-1 px-6 py-3 type-label"
            data-testid="see-settings"
          >
            See your game settings →
          </Link>
          <span className="flex items-center gap-2 border border-hairline px-4 py-2">
            <span className="type-label text-text-3">Target</span>
            <span className="type-data-s" data-testid="target-cm">
              {fmt(
                view.canonical.cmPer360 ?? (view.ranges.comfort.low + view.ranges.comfort.high) / 2,
              )}{" "}
              cm
            </span>
            <CopyButton
              value={fmt(
                view.canonical.cmPer360 ?? (view.ranges.comfort.low + view.ranges.comfort.high) / 2,
              )}
              label="cm per 360"
            />
          </span>
        </div>
      )}

      <footer className="flex flex-col gap-1 text-xs text-text-3">
        <p>
          SensLab runs in a browser and is not the game engine. This is an estimate with a stated
          confidence.
        </p>
        <p data-testid="algorithm-versions">
          {view.versions.scoring} · {view.versions.calibration} · {view.versions.confidence}
        </p>
        {view.settingsReliability !== "normal" && (
          <p>
            <StatusPill tone="caution">
              DPI {view.settingsReliability === "assumed_dpi" ? "assumed" : "estimated"}
            </StatusPill>
            <span className="ml-2">
              Your cm/360 and counts/360 results are unaffected; any game number would be wrong by
              the same proportion as the DPI.
            </span>
          </p>
        )}
      </footer>
    </main>
  );
}
