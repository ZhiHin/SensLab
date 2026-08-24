"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Callout, Panel, StatusPill } from "@/components/primitives";
import type { AccountView } from "@/services/account-service";
import { changePasswordAction, updateDisplayNameAction } from "./actions";

/**
 * SCR-044 — Profile (doc 24, FR-097).
 *
 * Display name, email and password. Changing the password requires the current one even
 * though the caller is signed in, and it signs every session out — including this one. Both
 * are stated on the form before it is submitted, because a security measure that surprises
 * the user reads as a bug (doc 23 §23.4).
 */

const input =
  "w-full max-w-sm border border-hairline-strong bg-surface-2 px-3 py-2 type-data-s text-text-1";

export function ProfileView({ account }: { account: AccountView }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(account.displayName ?? "");
  const [nameSaved, setNameSaved] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const saveName = () => {
    setError(null);
    setNameSaved(false);
    startTransition(async () => {
      const result = await updateDisplayNameAction({ displayName });
      if (result.ok) setNameSaved(true);
      else setError(result.message);
    });
  };

  const savePassword = () => {
    setError(null);
    startTransition(async () => {
      const result = await changePasswordAction({ currentPassword, newPassword });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      // Every session was revoked, this one included: the page the user lands on is sign-in.
      router.push("/auth/sign-in?changed=password");
    });
  };

  return (
    <main id="main" className="mx-auto flex w-full max-w-[820px] flex-col gap-8 px-6 py-12">
      <header className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <span className="type-label">Account</span>
          <h1 className="type-display-s">YOUR PROFILE</h1>
        </div>
        <Link href="/settings" className="type-label underline">
          Settings
        </Link>
      </header>

      {error !== null && (
        <p className="text-critical" role="alert" data-testid="profile-error">
          {error}
        </p>
      )}

      <Panel title="Identity">
        <dl className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <dt className="type-label text-text-3">Email</dt>
          <dd className="type-data-s" data-testid="account-email">
            {account.email}{" "}
            {account.emailVerified ? (
              <StatusPill tone="verified">verified</StatusPill>
            ) : (
              <StatusPill tone="caution">not verified</StatusPill>
            )}
          </dd>
          <dt className="type-label text-text-3">Member since</dt>
          <dd className="type-data-s">{new Date(account.createdAt).toLocaleDateString()}</dd>
        </dl>

        <label className="mt-6 flex flex-col gap-2">
          <span className="type-label">Display name</span>
          <input
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value);
              setNameSaved(false);
            }}
            maxLength={64}
            placeholder="Optional"
            className={input}
            data-testid="display-name"
          />
          <span className="flex items-center gap-3">
            <button
              type="button"
              className="border border-hairline px-5 py-2 type-label disabled:opacity-40"
              disabled={pending}
              onClick={saveName}
              data-testid="save-display-name"
            >
              Save
            </button>
            {nameSaved && (
              <span className="text-sm text-text-3" data-testid="display-name-saved">
                Saved.
              </span>
            )}
          </span>
        </label>
      </Panel>

      <Panel title="Password">
        <p className="mb-4 max-w-[62ch] text-sm text-text-3">
          Changing your password signs out every session, including this one, and cancels any reset
          link already in flight. That is deliberate: a password change is usually made because
          someone else might have access.
        </p>
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="type-label">Current password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              className={input}
              data-testid="current-password"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="type-label">New password</span>
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className={input}
              data-testid="new-password"
            />
            <span className="text-xs text-text-3">At least 12 characters.</span>
          </label>
          <button
            type="button"
            className="self-start border border-text-1 px-6 py-3 type-label disabled:opacity-40"
            disabled={pending || currentPassword === "" || newPassword.length < 12}
            onClick={savePassword}
            data-testid="save-password"
          >
            {pending ? "Changing…" : "Change password and sign out everywhere"}
          </button>
        </div>
      </Panel>

      {account.status === "pending_deletion" && (
        <Callout tone="caution" title="This account is scheduled for deletion">
          Nothing has been removed yet. You can stop it from{" "}
          <Link href="/settings" className="underline">
            settings
          </Link>
          .
        </Callout>
      )}
    </main>
  );
}
