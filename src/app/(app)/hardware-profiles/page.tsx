import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { HardwareProfilesView } from "@/features/hardware/profiles-view";
import { listProfiles } from "@/services/hardware-service";
import { getActor } from "@/services/session-context";

/**
 * SCR-043 — Hardware profiles (doc 24, FR-094).
 *
 * A guest can hold an ad-hoc profile but has nowhere to keep a list of them, so the page is
 * for signed-in users; a guest is sent to sign in rather than shown a list that expires.
 */

export const metadata: Metadata = {
  title: "Hardware profiles",
  description: "The setups your calibrations run on, and which one is the default.",
};

export default async function HardwareProfilesPage() {
  const actor = await getActor();
  if (actor.kind !== "user") redirect("/auth/sign-in?next=/hardware-profiles");
  return <HardwareProfilesView profiles={await listProfiles(actor)} />;
}
