import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { FineTuneSurface } from "@/features/fine-tune/fine-tune-surface";
import { getRecommendation } from "@/services/recommendation-service";
import { getActor } from "@/services/session-context";

/**
 * SCR-034 — the fine-tune run (doc 24).
 *
 * Only a point recommendation can be refined: five candidates *around x\** need an x\* to be
 * around. An indistinguishable result offers a re-run instead.
 */

interface PageProps {
  readonly params: Promise<{ readonly recommendationId: string }>;
}

export const metadata: Metadata = {
  title: "Fine-tune your result",
  description: "Blinded refinement inside the uncertainty around your recommendation.",
};

export default async function FineTunePage({ params }: PageProps) {
  const { recommendationId } = await params;
  const view = await getRecommendation(await getActor(), recommendationId);
  if (view === null || view.verdict !== "peak_found" || view.supersededById !== null) notFound();
  return <FineTuneSurface recommendationId={recommendationId} />;
}
