import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { ProfileView } from "@/features/account/profile-view";
import { getAccount } from "@/services/account-service";
import { getActor } from "@/services/session-context";

/** SCR-044 — Profile (doc 24, FR-097). */

export const metadata: Metadata = {
  title: "Your profile",
  description: "Your email, display name and password.",
};

export default async function ProfilePage() {
  const actor = await getActor();
  if (actor.kind !== "user") redirect("/auth/sign-in?next=/profile");
  const account = await getAccount(actor);
  if (account === null) notFound();
  return <ProfileView account={account} />;
}
