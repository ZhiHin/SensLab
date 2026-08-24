"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Callout, Panel } from "@/components/primitives";
import type { AccountView } from "@/services/account-service";
import { cancelDeletionAction, exportAccountAction, requestDeletionAction } from "./actions";

/**
 * SCR-045 — Settings: export and deletion (doc 24, FR-098, `SENS-SEC-020`, `SENS-SEC-021`).
 *
 * ## Export
 *
 * One JSON document with everything the account owns, produced on request and downloaded from
 * the browser. Nothing is emailed and no link is stored, so there is no export sitting
 * somewhere waiting to be found.
 *
 * ## Deletion
 *
 * Scheduled, not immediate: the account is marked for deletion, every session is signed out,
 * and the data is purged after the window. The window is stated in days on the button itself
 * — a deletion that claimed to be instant while a backup still held the data would be a lie
 * told for reassurance.
 */

export function SettingsView({
  account,
  deletionWindowDays,
}: {
  readonly account: AccountView;
  readonly deletionWindowDays: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [pending, startTransition] = useTransition();

  const download = () => {
    setError(null);
    startTransition(async () => {
      const result = await exportAccountAction();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      // Built in the browser from the response: the file never exists on a server, so there
      // is no window in which someone else could fetch it.
      const blob = new Blob([result.data.json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.data.filename;
      link.click();
      URL.revokeObjectURL(url);
    });
  };

  const requestDeletion = () => {
    setError(null);
    startTransition(async () => {
      const result = await requestDeletionAction({ currentPassword: password });
      // Every session was revoked, so the only page left is sign-in.
      if (result.ok) router.push("/auth/sign-in?deleted=scheduled");
      else setError(result.message);
    });
  };

  const cancelDeletion = () => {
    setError(null);
    startTransition(async () => {
      const result = await cancelDeletionAction();
      if (result.ok) router.refresh();
      else setError(result.message);
    });
  };

  return (
    <main id="main" className="mx-auto flex w-full max-w-[820px] flex-col gap-8 px-6 py-12">
      <header className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <span className="type-label">Account</span>
          <h1 className="type-display-s">SETTINGS</h1>
        </div>
        <Link href="/profile" className="type-label underline">
          Profile
        </Link>
      </header>

      {error !== null && (
        <p className="text-critical" role="alert" data-testid="settings-error">
          {error}
        </p>
      )}

      {account.deletionScheduledAt !== null && (
        <Callout tone="caution" title="Your account is scheduled for deletion">
          <span data-testid="deletion-scheduled">
            Everything will be permanently removed on{" "}
            {new Date(account.deletionScheduledAt).toLocaleDateString()}. Until then nothing has
            been deleted and you can stop it.
          </span>{" "}
          <button
            type="button"
            className="underline"
            disabled={pending}
            onClick={cancelDeletion}
            data-testid="cancel-deletion"
          >
            Keep my account
          </button>
        </Callout>
      )}

      <Panel title="Your data">
        <p className="mb-4 max-w-[64ch] text-sm text-text-2">
          Everything this account owns, as one JSON file: your profile, your hardware setups, every
          session with its environment and quality flags, every round, trial and metric, every
          recommendation with its breakdown, and every validation run. Your password is not included
          — exporting a credential would only be a new way to lose one.
        </p>
        <button
          type="button"
          className="border border-hairline px-6 py-3 type-label disabled:opacity-40"
          disabled={pending}
          onClick={download}
          data-testid="export-data"
        >
          {pending ? "Preparing…" : "Download my data"}
        </button>
      </Panel>

      <Panel title="Delete your account">
        <p className="mb-4 max-w-[64ch] text-sm text-text-2">
          Deletion is scheduled rather than instant. You are signed out everywhere immediately and
          sign-in stops working; the data is permanently removed {deletionWindowDays} days later,
          and ages out of backups within 60 days. During the window you can change your mind. This
          removes your sessions, results and hardware profiles — not just your login.
        </p>

        {confirming ? (
          <div className="flex flex-col gap-3" data-testid="deletion-confirm">
            <label className="flex flex-col gap-1">
              <span className="type-label">Confirm with your password</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full max-w-sm border border-hairline-strong bg-surface-2 px-3 py-2 type-data-s"
                data-testid="deletion-password"
              />
            </label>
            <span className="flex gap-3">
              <button
                type="button"
                className="border border-critical px-6 py-3 type-label text-critical disabled:opacity-40"
                disabled={pending || password === ""}
                onClick={requestDeletion}
                data-testid="confirm-deletion"
              >
                {pending ? "Scheduling…" : `Delete in ${deletionWindowDays} days`}
              </button>
              <button
                type="button"
                className="type-label underline"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </button>
            </span>
          </div>
        ) : (
          <button
            type="button"
            className="border border-hairline px-6 py-3 type-label"
            onClick={() => setConfirming(true)}
            disabled={account.deletionScheduledAt !== null}
            data-testid="start-deletion"
          >
            Delete my account
          </button>
        )}
      </Panel>

      <p className="text-xs text-text-3">
        Units, motion preference, locale and research-consent controls arrive with the settings work
        in Phase 10; the values behind them are already stored per account.
      </p>
    </main>
  );
}
