"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Callout, Panel } from "@/components/primitives";
import type { FineTuneView } from "@/services/fine-tune-service";
import { recordPreferenceAction } from "./actions";

/**
 * SCR-034 — the fine-tune reveal (doc 17 §17.7–§17.8, FR-089).
 *
 * The labels appear **here and only here**: during the run every candidate was a letter. The
 * outcome is stated before anything is asked of the player, because "your recommendation held
 * up" is the common and legitimate result and burying it under a question would misrepresent
 * it.
 *
 * The preference question comes after the reveal, is optional, and **never changes a stored
 * value** (`SENS-BR-002`). When preference and measurement disagree the page says so
 * neutrally: both are inside the comfort range, either is defensible.
 */

const fmt = (value: number): string => value.toFixed(1);

export function FineTuneResult({ view }: { view: FineTuneView }) {
  const [chosen, setChosen] = useState<string | null>(view.preference?.candidateId ?? null);
  const [pending, startTransition] = useTransition();
  const measuredBest = view.preference?.measuredBest ?? null;

  const choose = (candidateId: string) => {
    startTransition(async () => {
      const result = await recordPreferenceAction({ sessionId: view.sessionId, candidateId });
      if (result.ok) setChosen(candidateId);
    });
  };

  const duelPair = view.candidates.filter((candidate) => candidate.inDuel);

  return (
    <main id="main" className="mx-auto flex w-full max-w-[900px] flex-col gap-8 px-6 py-12">
      <header>
        <span className="type-label">Fine-tune</span>
        <h1 className="type-display-s" data-testid="fine-tune-headline">
          {view.heldUp ? "YOUR RECOMMENDATION HELD UP" : "REFINED"}
        </h1>
      </header>

      {view.heldUp ? (
        <p className="max-w-[64ch] text-text-2" data-testid="held-up">
          Nothing changed. The refined estimate still puts your optimum where the calibration did —{" "}
          {fmt(view.originalCm360)} cm/360 — so no new recommendation was written. Five neighbouring
          sensitivities were measured and none of them beat it by more than this session could
          detect.
        </p>
      ) : (
        <div className="flex flex-col gap-3" data-testid="refined">
          <p className="flex items-baseline gap-3">
            <span className="type-display-l text-result" data-testid="refined-cm">
              {fmt(view.refinedCm360 ?? view.originalCm360)}
            </span>
            <span className="type-label text-text-3">cm / 360°</span>
          </p>
          <p className="max-w-[64ch] text-text-2">
            The refined estimate moved from {fmt(view.originalCm360)} cm/360, far enough that the
            original sits outside the new interval. Your earlier result is kept and marked as
            superseded — history shows the sequence rather than a number that silently changed.
          </p>
          {view.newRecommendationId !== null && (
            <Link
              href={`/results/${view.newRecommendationId}`}
              className="self-start border border-text-1 px-6 py-3 type-label"
              data-testid="see-refined-result"
            >
              See the refined result →
            </Link>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------ the reveal */}
      <Panel title="What each letter was">
        <div className="overflow-x-auto">
          <table
            className="w-full min-w-[520px] border-collapse"
            data-testid="fine-tune-candidates"
          >
            <thead>
              <tr className="border-b border-hairline text-left">
                <th className="py-2 type-label text-text-3">Shown as</th>
                <th className="py-2 type-label text-text-3">Was</th>
                <th className="py-2 type-label text-text-3">cm/360</th>
                <th className="py-2 type-label text-text-3">Head-to-head</th>
              </tr>
            </thead>
            <tbody>
              {view.candidates.map((candidate) => (
                <tr
                  key={candidate.candidateId}
                  className="border-b border-hairline"
                  data-testid={`candidate-${candidate.blindLabel}`}
                >
                  <td className="py-2 type-data-s">{candidate.blindLabel}</td>
                  <td className="py-2 type-label">{candidate.revealLabel}</td>
                  <td className="py-2 type-data-s">{fmt(candidate.cm360)}</td>
                  <td className="py-2 text-sm text-text-3">
                    {candidate.inDuel ? "went through" : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-xs text-text-3">
          Screening ranked the five; the top two ran{" "}
          {view.duel.quartets === 1 ? "one set" : `${view.duel.quartets} sets`} of counterbalanced
          blocks
          {view.duel.reason === "interval_excludes_zero"
            ? ", stopping as soon as the difference was clear."
            : view.duel.reason === "budget_reached"
              ? ", to the full budget without separating them."
              : "."}
        </p>
      </Panel>

      {/* ------------------------------------------------------------ preference */}
      {duelPair.length > 0 && (
        <section className="flex flex-col gap-4" data-testid="preference-question">
          <h2 className="type-label">Which of these felt best to you?</h2>
          <p className="max-w-[62ch] text-sm text-text-3">
            Optional, and recorded only. Your answer never changes the recommendation — it exists so
            you can notice when your preference disagrees with your measurement.
          </p>
          <div className="flex flex-wrap gap-3">
            {view.candidates.map((candidate) => (
              <button
                key={candidate.candidateId}
                type="button"
                className="border border-hairline px-5 py-3 type-label disabled:opacity-50 data-[chosen=true]:border-text-1"
                data-chosen={chosen === candidate.candidateId}
                disabled={pending}
                onClick={() => choose(candidate.candidateId)}
                data-testid={`prefer-${candidate.blindLabel}`}
              >
                {candidate.blindLabel} · {fmt(candidate.cm360)} cm
              </button>
            ))}
          </div>
          {chosen !== null && measuredBest === false && (
            <Callout tone="neutral" title="Your pick and your measurement disagree">
              You picked one option, but you measured better on another. Both are inside your
              comfort range — either is a defensible choice.
            </Callout>
          )}
          {chosen !== null && measuredBest === true && (
            <p className="text-sm text-text-3" data-testid="preference-agrees">
              Your pick matches what you measured best on.
            </p>
          )}
        </section>
      )}

      <Link href={`/results/${view.recommendationId}`} className="type-label underline">
        Back to your result
      </Link>
    </main>
  );
}
