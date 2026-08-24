import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { HistoryList } from "@/features/history/history-view";
import { getHistory } from "@/services/history-service";
import { getActor } from "@/services/session-context";

/**
 * SCR-041 — History (doc 24, FR-090).
 *
 * A guest has no history to speak of: their work lives in one cookie and expires, so the page
 * sends them to sign in rather than showing an empty list that will never fill.
 */

interface PageProps {
  readonly searchParams: Promise<{ readonly profile?: string }>;
}

export const metadata: Metadata = {
  title: "History",
  description: "Every calibration you have run, with the evidence each one produced.",
};

export default async function HistoryPage({ searchParams }: PageProps) {
  const actor = await getActor();
  if (actor.kind !== "user") redirect("/auth/sign-in?next=/history");
  const { profile } = await searchParams;
  const view = await getHistory(actor, profile === undefined ? {} : { hardwareProfileId: profile });
  return <HistoryList view={view} />;
}
