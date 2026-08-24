import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { SessionComparison } from "@/features/history/comparison-view";
import { compareSessions, type ComparisonView } from "@/services/history-service";
import { getActor } from "@/services/session-context";
import { isAppError } from "@/lib/errors";
import type { Actor } from "@/repositories/actor";

/** SCR-042 — Session comparison (doc 24, doc 17 §17.9). */

interface PageProps {
  readonly searchParams: Promise<{ readonly a?: string; readonly b?: string }>;
}

export const metadata: Metadata = {
  title: "Compare sessions",
  description: "Whether two calibrations differ by more than the noise of the method.",
};

/**
 * Both sides are looked up under the ownership predicate, so a session belonging to someone
 * else is not "hidden" from the comparison — it is not found, and a missing side is a 404.
 */
async function loadComparison(actor: Actor, a: string, b: string): Promise<ComparisonView | null> {
  try {
    return await compareSessions(actor, a, b);
  } catch (error: unknown) {
    if (isAppError(error) && error.code === "NOT_FOUND") return null;
    throw error;
  }
}

export default async function ComparePage({ searchParams }: PageProps) {
  const actor = await getActor();
  if (actor.kind !== "user") redirect("/auth/sign-in?next=/history");
  const { a, b } = await searchParams;
  if (a === undefined || b === undefined) notFound();

  const view = await loadComparison(actor, a, b);
  if (view === null) notFound();
  return <SessionComparison view={view} />;
}
