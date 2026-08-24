import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { FineTuneResult } from "@/features/fine-tune/fine-tune-result";
import { getFineTune } from "@/services/fine-tune-service";
import { getActor } from "@/services/session-context";

/** SCR-034 — the fine-tune reveal (doc 24, doc 17 §17.7–§17.8). */

interface PageProps {
  readonly params: Promise<{
    readonly recommendationId: string;
    readonly sessionId: string;
  }>;
}

export const metadata: Metadata = {
  title: "Fine-tune result",
  description: "What each blinded candidate was, and whether your recommendation held up.",
};

export default async function FineTuneResultPage({ params }: PageProps) {
  const { recommendationId, sessionId } = await params;
  const view = await getFineTune(await getActor(), sessionId);
  if (view === null || view.recommendationId !== recommendationId) notFound();
  return <FineTuneResult view={view} />;
}
