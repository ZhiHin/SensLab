import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ResultsView } from "@/features/results/results-view";
import { getRecommendation } from "@/services/recommendation-service";
import { getValidation, validationOfferFor } from "@/services/validation-service";
import { getPreferences } from "@/services/preferences-service";
import { getActor } from "@/services/session-context";

/**
 * SCR-031 — Results (doc 24).
 *
 * Reachable only by the session's owner: the lookup composes the ownership predicate, so an
 * unguessable id is not the protection — the cookie is. Anyone else sees a 404, which says
 * nothing about whether the id exists.
 */

interface PageProps {
  readonly params: Promise<{ readonly recommendationId: string }>;
}

export const metadata: Metadata = {
  title: "Your result",
  description: "Your measured sensitivity, the evidence behind it, and your aim profile.",
};

export default async function ResultsPage({ params }: PageProps) {
  const { recommendationId } = await params;
  const actor = await getActor();
  const view = await getRecommendation(actor, recommendationId);
  if (view === null) notFound();
  const [offer, validation, preferences] = await Promise.all([
    validationOfferFor(actor, recommendationId),
    getValidation(actor, recommendationId),
    getPreferences(actor),
  ]);
  if (offer === null) notFound();

  return (
    <ResultsView
      view={view}
      unit={preferences.unit}
      validation={{
        offer,
        outcome:
          validation === null
            ? null
            : {
                verdict: validation.verdict,
                confidenceBefore: validation.confidenceBefore,
                confidenceAfter: validation.confidenceAfter,
                accepted: validation.accepted,
              },
      }}
    />
  );
}
