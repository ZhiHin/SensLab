import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ValidationResult } from "@/features/validate/validation-result";
import { getValidation } from "@/services/validation-service";
import { getActor } from "@/services/session-context";

/** SCR-033 — the validation result (doc 24, doc 25 §25.11). */

interface PageProps {
  readonly params: Promise<{ readonly recommendationId: string }>;
}

export const metadata: Metadata = {
  title: "Validation result",
  description: "Whether the recommended sensitivity beat the one you came in with.",
};

export default async function ValidationResultPage({ params }: PageProps) {
  const { recommendationId } = await params;
  const view = await getValidation(await getActor(), recommendationId);
  if (view === null) notFound();
  return <ValidationResult view={view} />;
}
