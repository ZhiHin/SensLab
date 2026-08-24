"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Callout, Panel } from "@/components/primitives";
import type { ValidationView } from "@/services/validation-service";
import { decideValidationAction } from "./actions";

/**
 * SCR-033 — the validation result (doc 25 §25.11, doc 17 §17.4–§17.6, `SENS-BR-016`).
 *
 * The verdict determines the layout. Every metric row carries its interval, and a row whose
 * interval spans zero sits **in the same list at the same weight**, labelled "not
 * measurable" — cherry-picking the significant rows into a highlight reel is prohibited.
 *
 * The `worse` case is designed first-class: stated plainly, numbers in the same format as a
 * win, the original retained, confidence reduced, two causes given equal weight, three
 * concrete next steps — and nothing pushes the player toward adopting B.
 */

const fmt = (value: number, decimals = 1): string => value.toFixed(decimals);

function formatDelta(metric: ValidationView["metrics"][number]): string {
  if (metric.unit === "ms")
    return `${metric.delta >= 0 ? "+" : "−"}${Math.abs(metric.delta).toFixed(0)} ms`;
  // Dimensionless rates and scores read best as percentage points.
  const points = metric.delta * 100;
  return `${points >= 0 ? "+" : "−"}${Math.abs(points).toFixed(1)} pp`;
}

function formatInterval(metric: ValidationView["metrics"][number]): string {
  const scale = metric.unit === "ms" ? 1 : 100;
  const digits = metric.unit === "ms" ? 0 : 1;
  return `[ ${(metric.ciLow * scale).toFixed(digits)} , ${(metric.ciHigh * scale).toFixed(digits)} ]`;
}

const HEADLINE: Record<ValidationView["verdict"], string> = {
  improved: "THE RECOMMENDATION PERFORMED BETTER",
  worse: "YOUR ORIGINAL PERFORMED BETTER",
  no_measurable_difference: "NO MEASURABLE DIFFERENCE",
};

export function ValidationResult({ view }: { view: ValidationView }) {
  const [decided, setDecided] = useState<ValidationView["accepted"]>(view.accepted);
  const [pending, startTransition] = useTransition();

  const decide = (choice: "accept_recommended" | "keep_original") => {
    startTransition(async () => {
      const result = await decideValidationAction({
        recommendationId: view.recommendationId,
        choice,
      });
      if (result.ok) setDecided(choice === "accept_recommended" ? "recommended" : "original");
    });
  };

  return (
    <main id="main" className="mx-auto flex w-full max-w-[900px] flex-col gap-8 px-6 py-12">
      <header>
        <span className="type-label">Validation</span>
        <h1 className="type-display-s" data-testid="validation-headline">
          {HEADLINE[view.verdict]}
        </h1>
      </header>

      <section
        className="flex flex-wrap items-baseline gap-x-10 gap-y-3"
        data-testid="validation-arms"
      >
        <div>
          <p className="type-label text-text-3">Your original</p>
          <p className="type-data-l">
            {fmt(view.baselineCm360)} <span className="type-label text-text-3">cm/360</span>
          </p>
        </div>
        <span className="type-label text-text-3">vs</span>
        <div>
          <p className="type-label text-text-3">Recommended</p>
          <p className="type-data-l">
            {fmt(view.candidateCm360)} <span className="type-label text-text-3">cm/360</span>
          </p>
        </div>
        <p className="basis-full text-sm text-text-3">
          {view.blocks} counterbalanced blocks, paired at the stimulus level. Blind labels were
          revealed only after the analysis.
        </p>
      </section>

      {/* ------------------------------------------------------------ metric table */}
      <Panel title="What was measured">
        {/* Narrow screens scroll the table rather than the page (doc 24's mobile rule). */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse" data-testid="validation-metrics">
            <thead>
              <tr className="border-b border-hairline text-left">
                <th className="py-2 type-label text-text-3">Metric</th>
                <th className="py-2 type-label text-text-3">Change</th>
                <th className="py-2 type-label text-text-3">90% interval</th>
                <th className="py-2 type-label text-text-3">Reading</th>
              </tr>
            </thead>
            <tbody>
              {view.metrics.map((metric) => (
                <tr
                  key={metric.key}
                  className="border-b border-hairline"
                  data-testid={`metric-${metric.key}`}
                >
                  <td className="py-2 type-label">{metric.label}</td>
                  <td className="py-2 type-data-s">{formatDelta(metric)}</td>
                  <td className="py-2 type-data-s text-text-3">{formatInterval(metric)}</td>
                  <td className="py-2 text-sm">
                    {metric.significant ? (
                      <span>
                        measurable
                        {metric.favoursCandidate
                          ? " — favoured the recommendation"
                          : " — favoured your original"}
                      </span>
                    ) : (
                      <span className="text-text-3" data-testid={`not-measurable-${metric.key}`}>
                        not measurable
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-xs text-text-3">
          The headline verdict comes from the composite score the calibration optimised — never from
          any single row. Positive change means a higher value; “measurable” means the interval
          excludes zero.
        </p>
      </Panel>

      {/* ------------------------------------------------------------ confidence */}
      <p className="type-label" data-testid="confidence-updated">
        Confidence updated: {view.confidenceBefore} → {view.confidenceAfter}
      </p>

      {/* ------------------------------------------------------------ verdict-specific */}
      {view.verdict === "no_measurable_difference" && (
        <Callout tone="neutral" title="What this means">
          Neither sensitivity clearly outperformed the other in this comparison. That usually means
          the difference is small enough that comfort should decide — or that a longer test is
          needed to resolve it.
        </Callout>
      )}

      {view.verdict === "worse" && (
        <section className="flex flex-col gap-4" data-testid="worse-explanation">
          <Callout tone="neutral" title="Two plausible causes, given equal weight">
            <span className="block">
              <strong>Familiarity.</strong> You have many hours at your original sensitivity and
              roughly twenty minutes at the new one; short tests favour the familiar.
            </span>
            <span className="mt-2 block">
              <strong>The estimate may simply be wrong.</strong> The calibration could have been
              misled by noise, fatigue, or an unlucky candidate arrangement.
            </span>
          </Callout>
          <p className="max-w-[64ch] text-text-2">
            Your original stands as the recommendation. Nothing was deleted — the calibration’s
            estimate is kept alongside this comparison. Three ways forward: fine-tune between the
            two values, re-run the calibration with a wider search, or keep what you have and
            re-check in a week.
          </p>
        </section>
      )}

      {view.familiarityAdvisory && view.verdict !== "worse" && (
        <Callout tone="caution" title="A large change takes adapting to">
          The recommendation is {Math.abs(Math.round(view.changePct))}%{" "}
          {view.changePct > 0 ? "slower" : "faster"} than what you are used to. Expect it to feel
          wrong for a few days. The measured advantage is real for this session, but the honest
          advice after a change this size is: switch, play for a week, then re-validate.
        </Callout>
      )}

      {/* ------------------------------------------------------------ actions */}
      <div className="flex flex-wrap items-center gap-3" data-testid="validation-actions">
        {view.verdict !== "worse" && (
          <button
            type="button"
            className="border border-text-1 px-6 py-3 type-label disabled:opacity-50"
            disabled={pending || decided === "recommended"}
            onClick={() => decide("accept_recommended")}
            data-testid="accept-recommended"
          >
            {decided === "recommended" ? "✓ Accepted" : `Accept ${fmt(view.candidateCm360)}`}
          </button>
        )}
        <Link
          href={`/fine-tune/${view.recommendationId}`}
          className="border border-hairline px-6 py-3 type-label"
          data-testid="go-fine-tune"
        >
          Fine-tune further
        </Link>
        <button
          type="button"
          className="border border-hairline px-6 py-3 type-label disabled:opacity-50"
          disabled={pending || decided === "original"}
          onClick={() => decide("keep_original")}
          data-testid="keep-original"
        >
          {decided === "original" ? "✓ Keeping your original" : "Keep my original"}
        </button>
        <Link href={`/results/${view.recommendationId}`} className="type-label underline">
          Back to the result
        </Link>
      </div>
    </main>
  );
}
