"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Callout, Panel } from "@/components/primitives";
import type { AccountView } from "@/services/account-service";
import type { Preferences } from "@/services/preferences-service";
import {
  cancelDeletionAction,
  exportAccountAction,
  requestDeletionAction,
  setPreferencesAction,
} from "./actions";

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

/** A labelled group of mutually exclusive choices, as squares rather than a rounded switch. */
function ChoiceRow<T extends string>({
  label,
  hint,
  value,
  options,
  disabled,
  onChange,
  testId,
}: {
  readonly label: string;
  readonly hint: string;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly disabled: boolean;
  readonly onChange: (value: T) => void;
  readonly testId: string;
}) {
  return (
    <fieldset className="flex flex-col gap-2" data-testid={testId}>
      <legend className="type-label">{label}</legend>
      <span className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-center gap-2 border px-4 py-2 type-label data-[on=true]:border-text-1 data-[on=false]:border-hairline"
            data-on={value === option.value}
          >
            <input
              type="radio"
              name={testId}
              value={option.value}
              checked={value === option.value}
              disabled={disabled}
              onChange={() => onChange(option.value)}
              data-testid={`${testId}-${option.value}`}
            />
            {option.label}
          </label>
        ))}
      </span>
      <span className="max-w-[62ch] text-xs text-text-3">{hint}</span>
    </fieldset>
  );
}

export function SettingsView({
  account,
  deletionWindowDays,
  preferences,
}: {
  readonly account: AccountView;
  readonly deletionWindowDays: number;
  readonly preferences: Preferences;
}) {
  const router = useRouter();
  const [prefs, setPrefs] = useState<Preferences>(preferences);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [pending, startTransition] = useTransition();

  const savePreference = (update: Partial<Preferences>) => {
    setError(null);
    setSaved(false);
    const optimistic = { ...prefs, ...update };
    setPrefs(optimistic);
    startTransition(async () => {
      const result = await setPreferencesAction(update);
      if (result.ok) {
        // The control is optimistic, so the confirmation is what tells the user the change
        // actually reached the server — and it is what a test can wait on rather than
        // guessing at a duration.
        //
        // No `router.refresh()`: refreshing re-renders this page from the server and discards
        // the confirmation the user is meant to read. Every other surface reads the preference
        // when it is next requested, which is the only place the change has anything to do.
        setSaved(true);
      } else {
        setPrefs(prefs);
        setError(result.message);
      }
    });
  };

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

      <Panel title="Display">
        <div className="flex flex-col gap-6">
          <p className="type-label text-text-3" aria-live="polite" data-testid="preferences-status">
            {pending ? "Saving…" : saved ? "Saved" : ""}
          </p>
          <ChoiceRow
            label="Units"
            hint="Changes how distances are shown and nothing else. Your result is measured in counts; centimetres and inches are two ways of reading the same measurement."
            value={prefs.unit}
            disabled={pending}
            onChange={(unit) => savePreference({ unit })}
            testId="unit-preference"
            options={[
              { value: "metric", label: "Centimetres" },
              { value: "imperial", label: "Inches" },
            ]}
          />
          <ChoiceRow
            label="Motion"
            hint="“System” follows your operating system. Choose “Reduced” for less movement everywhere, or “Full” to keep SensLab's transitions even when your system asks for less."
            value={prefs.motion}
            disabled={pending}
            onChange={(motion) => savePreference({ motion })}
            testId="motion-preference"
            options={[
              { value: "system", label: "System" },
              { value: "reduced", label: "Reduced" },
              { value: "full", label: "Full" },
            ]}
          />
          <ChoiceRow
            label="Language"
            hint="Game settings and game names always come from the game itself, so they stay in the language that game uses."
            value={prefs.locale}
            disabled={pending}
            onChange={(locale) => savePreference({ locale })}
            testId="locale-preference"
            options={[
              { value: "en", label: "English" },
              { value: "zh-Hans", label: "简体中文" },
            ]}
          />
        </div>
      </Panel>

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
    </main>
  );
}
