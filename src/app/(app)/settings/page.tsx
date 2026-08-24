import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { SettingsView } from "@/features/account/settings-view";
import { DELETION_WINDOW_DAYS, getAccount } from "@/services/account-service";
import { getActor } from "@/services/session-context";

/** SCR-045 — Settings: data export and account deletion (doc 24, FR-098). */

export const metadata: Metadata = {
  title: "Settings",
  description: "Export everything this account holds, or delete it.",
};

export default async function SettingsPage() {
  const actor = await getActor();
  if (actor.kind !== "user") redirect("/auth/sign-in?next=/settings");
  const account = await getAccount(actor);
  if (account === null) notFound();
  return <SettingsView account={account} deletionWindowDays={DELETION_WINDOW_DAYS} />;
}
