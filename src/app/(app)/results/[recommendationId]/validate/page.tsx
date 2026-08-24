import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ValidationSurface } from "@/features/validate/validation-surface";
import { getRecommendation } from "@/services/recommendation-service";
import { validationOfferFor } from "@/services/validation-service";
import { getActor } from "@/services/session-context";

/**
 * SCR-033 — the validation run (doc 24).
 *
 * The offer is re-checked on the server: a result whose recommendation is within the interval
 * of the player's current sensitivity has nothing to compare, and a 404 is the honest answer
 * to a URL typed for one.
 */

interface PageProps {
  readonly params: Promise<{ readonly recommendationId: string }>;
}

export const metadata: Metadata = {
  title: "Validate your result",
  description:
    "A blinded, counterbalanced comparison of your original and recommended sensitivity.",
};

export default async function ValidatePage({ params }: PageProps) {
  const { recommendationId } = await params;
  const actor = await getActor();
  const [view, offer] = await Promise.all([
    getRecommendation(actor, recommendationId),
    validationOfferFor(actor, recommendationId),
  ]);
  if (view === null || offer === null || !offer.offered) notFound();

  return (
    <ValidationSurface
      recommendationId={recommendationId}
      framing={offer.reason === "offered_vs_starting_point" ? "vs_starting_point" : "vs_current"}
      blocks={view.mode === "quick" ? 4 : 8}
    />
  );
}
