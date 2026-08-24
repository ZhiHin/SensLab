"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Callout, StatusPill } from "@/components/primitives";
import { GRIPS, OS_FAMILIES } from "@/core/types/vocabulary";
import type { HardwareProfileView } from "@/services/hardware-service";
import {
  createProfileAction,
  deleteProfileAction,
  setDefaultProfileAction,
  updateProfileAction,
} from "./actions";

/**
 * SCR-043 — Hardware profiles (doc 24, FR-094, `SENS-BR-018`).
 *
 * A profile is the context a measurement was taken in: mouse, DPI, pad, monitor, OS pointer
 * settings. Only the name and the DPI are required, because the DPI is the only field the
 * measurement needs (`SENS-BR-004`) and a form that demanded the rest would be abandoned.
 *
 * Deleting is a soft delete and the page says so: past sessions keep the profile's name so an
 * old result stays legible, and nothing they measured changes.
 */

const input =
  "w-full border border-hairline-strong bg-surface-2 px-3 py-2 type-data-s text-text-1 disabled:opacity-40";

interface DraftFields {
  readonly name: string;
  readonly dpi: string;
  readonly dpiKnown: boolean;
  readonly mouseModel: string;
  readonly pollingRateHz: string;
  readonly grip: string;
  readonly mousepadWidthMm: string;
  readonly mousepadHeightMm: string;
  readonly monitorWidthPx: string;
  readonly monitorHeightPx: string;
  readonly refreshRateHz: string;
  readonly osFamily: string;
  readonly windowsPointerSpeed: string;
  readonly enhancePointerPrecision: boolean;
}

const EMPTY: DraftFields = {
  name: "",
  dpi: "800",
  dpiKnown: true,
  mouseModel: "",
  pollingRateHz: "",
  grip: "",
  mousepadWidthMm: "",
  mousepadHeightMm: "",
  monitorWidthPx: "",
  monitorHeightPx: "",
  refreshRateHz: "",
  osFamily: "",
  windowsPointerSpeed: "",
  enhancePointerPrecision: false,
};

function draftFrom(profile: HardwareProfileView): DraftFields {
  const text = (value: number | null): string => (value === null ? "" : String(value));
  return {
    name: profile.name,
    dpi: String(profile.dpi),
    dpiKnown: profile.dpiSource === "known",
    mouseModel: profile.mouseModel ?? "",
    pollingRateHz: text(profile.pollingRateHz),
    grip: profile.grip ?? "",
    mousepadWidthMm: text(profile.mousepadWidthMm),
    mousepadHeightMm: text(profile.mousepadHeightMm),
    monitorWidthPx: text(profile.monitorWidthPx),
    monitorHeightPx: text(profile.monitorHeightPx),
    refreshRateHz: text(profile.refreshRateHz),
    osFamily: profile.osFamily ?? "",
    windowsPointerSpeed: text(profile.windowsPointerSpeed),
    enhancePointerPrecision: profile.enhancePointerPrecision ?? false,
  };
}

function payloadFrom(draft: DraftFields) {
  const number = (value: string): number | null => (value.trim() === "" ? null : Number(value));
  return {
    name: draft.name,
    dpi: Number(draft.dpi),
    dpiSource: draft.dpiKnown ? ("known" as const) : ("assumed" as const),
    pollingRateHz: number(draft.pollingRateHz),
    mouseModel: draft.mouseModel.trim() === "" ? null : draft.mouseModel.trim(),
    grip: draft.grip === "" ? null : draft.grip,
    mousepadWidthMm: number(draft.mousepadWidthMm),
    mousepadHeightMm: number(draft.mousepadHeightMm),
    monitorWidthPx: number(draft.monitorWidthPx),
    monitorHeightPx: number(draft.monitorHeightPx),
    refreshRateHz: number(draft.refreshRateHz),
    osFamily: draft.osFamily === "" ? null : draft.osFamily,
    windowsPointerSpeed: number(draft.windowsPointerSpeed),
    enhancePointerPrecision: draft.enhancePointerPrecision,
  };
}

function ProfileForm({
  draft,
  setDraft,
  onSubmit,
  onCancel,
  busy,
  submitLabel,
  testId,
}: {
  readonly draft: DraftFields;
  readonly setDraft: (draft: DraftFields) => void;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
  readonly busy: boolean;
  readonly submitLabel: string;
  readonly testId: string;
}) {
  const field = <K extends keyof DraftFields>(key: K, value: DraftFields[K]) =>
    setDraft({ ...draft, [key]: value });

  return (
    <form
      className="flex flex-col gap-6 border border-hairline p-6"
      data-testid={testId}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="type-label">Name</span>
          <input
            value={draft.name}
            onChange={(event) => field("name", event.target.value)}
            placeholder="Main gaming setup"
            required
            maxLength={64}
            className={input}
            data-testid="profile-name"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="type-label">Mouse DPI</span>
          <input
            type="number"
            min={100}
            max={32000}
            step={50}
            value={draft.dpi}
            onChange={(event) => field("dpi", event.target.value)}
            required
            className={input}
            data-testid="profile-dpi"
          />
          <label className="flex items-center gap-2 text-sm text-text-3">
            <input
              type="checkbox"
              checked={!draft.dpiKnown}
              onChange={(event) => field("dpiKnown", !event.target.checked)}
              data-testid="profile-dpi-unknown"
            />
            I am not sure — assume this value
          </label>
        </label>

        <label className="flex flex-col gap-1">
          <span className="type-label">Mouse (optional)</span>
          <input
            value={draft.mouseModel}
            onChange={(event) => field("mouseModel", event.target.value)}
            maxLength={80}
            className={input}
            data-testid="profile-mouse"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="type-label">Polling rate (optional)</span>
          <input
            type="number"
            min={50}
            max={8000}
            value={draft.pollingRateHz}
            onChange={(event) => field("pollingRateHz", event.target.value)}
            placeholder="1000"
            className={input}
            data-testid="profile-polling"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="type-label">Grip (optional)</span>
          <select
            value={draft.grip}
            onChange={(event) => field("grip", event.target.value)}
            className="border border-hairline-strong bg-surface-2 px-3 py-2 text-sm"
            data-testid="profile-grip"
          >
            <option value="">Not saying</option>
            {GRIPS.map((grip) => (
              <option key={grip} value={grip}>
                {grip}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="type-label">Mousepad, mm (optional)</span>
          <span className="flex items-center gap-2">
            <input
              type="number"
              min={50}
              max={2000}
              value={draft.mousepadWidthMm}
              onChange={(event) => field("mousepadWidthMm", event.target.value)}
              placeholder="450"
              className={input}
              data-testid="profile-pad-width"
            />
            <span className="type-label text-text-3">×</span>
            <input
              type="number"
              min={50}
              max={2000}
              value={draft.mousepadHeightMm}
              onChange={(event) => field("mousepadHeightMm", event.target.value)}
              placeholder="400"
              className={input}
              data-testid="profile-pad-height"
            />
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="type-label">Monitor, px (optional)</span>
          <span className="flex items-center gap-2">
            <input
              type="number"
              min={320}
              max={16000}
              value={draft.monitorWidthPx}
              onChange={(event) => field("monitorWidthPx", event.target.value)}
              placeholder="2560"
              className={input}
              data-testid="profile-monitor-width"
            />
            <span className="type-label text-text-3">×</span>
            <input
              type="number"
              min={240}
              max={16000}
              value={draft.monitorHeightPx}
              onChange={(event) => field("monitorHeightPx", event.target.value)}
              placeholder="1440"
              className={input}
              data-testid="profile-monitor-height"
            />
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="type-label">Refresh rate, Hz (optional)</span>
          <input
            type="number"
            min={24}
            max={1000}
            value={draft.refreshRateHz}
            onChange={(event) => field("refreshRateHz", event.target.value)}
            placeholder="240"
            className={input}
            data-testid="profile-refresh"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="type-label">Operating system (optional)</span>
          <select
            value={draft.osFamily}
            onChange={(event) => field("osFamily", event.target.value)}
            className="border border-hairline-strong bg-surface-2 px-3 py-2 text-sm"
            data-testid="profile-os"
          >
            <option value="">Not saying</option>
            {OS_FAMILIES.map((family) => (
              <option key={family} value={family}>
                {family}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="type-label">Windows pointer speed (optional)</span>
          <input
            type="number"
            min={1}
            max={11}
            value={draft.windowsPointerSpeed}
            onChange={(event) => field("windowsPointerSpeed", event.target.value)}
            placeholder="6"
            className={input}
            data-testid="profile-pointer-speed"
          />
          <label className="flex items-center gap-2 text-sm text-text-3">
            <input
              type="checkbox"
              checked={draft.enhancePointerPrecision}
              onChange={(event) => field("enhancePointerPrecision", event.target.checked)}
              data-testid="profile-epp"
            />
            Enhance pointer precision is on
          </label>
        </label>
      </div>

      <p className="max-w-[64ch] text-xs text-text-3">
        Pointer speed and acceleration are recorded as context, not used in the maths: SensLab
        measures raw counts, so an OS setting cannot change what your hand did — but it changes what
        the same setting means in a game, which is worth knowing later.
      </p>

      <div className="flex gap-3">
        <button
          type="submit"
          className="border border-text-1 px-6 py-3 type-label disabled:opacity-40"
          disabled={busy}
          data-testid="profile-save"
        >
          {busy ? "Saving…" : submitLabel}
        </button>
        <button type="button" className="type-label underline" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function HardwareProfilesView({
  profiles,
}: {
  readonly profiles: readonly HardwareProfileView[];
}) {
  const [draft, setDraft] = useState<DraftFields>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(profiles.length === 0);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const act = (work: () => Promise<{ ok: boolean; message?: string }>, done: () => void) => {
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (result.ok) done();
      else setError(result.message ?? "That did not work.");
    });
  };

  return (
    <main id="main" className="mx-auto flex w-full max-w-[900px] flex-col gap-8 px-6 py-12">
      <header className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <span className="type-label">Hardware</span>
          <h1 className="type-display-s">YOUR SETUPS</h1>
        </div>
        <Link href="/history" className="type-label underline">
          History
        </Link>
      </header>

      <p className="max-w-[66ch] text-text-2">
        A result belongs to the hardware that produced it. Keeping a profile per setup is what lets
        history tell two of them apart — and what stops a comparison across them reading as a change
        in you.
      </p>

      {error !== null && (
        <p className="text-critical" role="alert" data-testid="profiles-error">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-4" data-testid="profile-list">
        {profiles.map((profile) =>
          editing === profile.id ? (
            <ProfileForm
              key={profile.id}
              draft={draft}
              setDraft={setDraft}
              busy={pending}
              submitLabel="Save changes"
              testId={`profile-form-${profile.id}`}
              onCancel={() => setEditing(null)}
              onSubmit={() =>
                act(
                  () => updateProfileAction({ profileId: profile.id, ...payloadFrom(draft) }),
                  () => setEditing(null),
                )
              }
            />
          ) : (
            <article
              key={profile.id}
              className="flex flex-wrap items-baseline gap-x-6 gap-y-2 border border-hairline p-5"
              data-testid={`profile-${profile.id}`}
            >
              <span className="type-label text-text-1">{profile.name}</span>
              {profile.isDefault && <StatusPill tone="verified">default</StatusPill>}
              <span className="type-data-s text-text-3">{profile.dpi} DPI</span>
              {profile.dpiSource !== "known" && <StatusPill tone="caution">DPI assumed</StatusPill>}
              {profile.mouseModel !== null && (
                <span className="text-sm text-text-3">{profile.mouseModel}</span>
              )}
              {profile.mousepadWidthMm !== null && (
                <span className="text-sm text-text-3">
                  pad {(profile.mousepadWidthMm / 10).toFixed(0)} cm
                </span>
              )}
              {profile.refreshRateHz !== null && (
                <span className="text-sm text-text-3">{profile.refreshRateHz} Hz</span>
              )}

              <span className="flex flex-1 flex-wrap justify-end gap-3">
                {!profile.isDefault && (
                  <button
                    type="button"
                    className="type-label underline"
                    disabled={pending}
                    onClick={() =>
                      act(
                        () => setDefaultProfileAction({ profileId: profile.id }),
                        () => undefined,
                      )
                    }
                    data-testid={`set-default-${profile.id}`}
                  >
                    Make default
                  </button>
                )}
                <button
                  type="button"
                  className="type-label underline"
                  onClick={() => {
                    setDraft(draftFrom(profile));
                    setCreating(false);
                    setEditing(profile.id);
                  }}
                  data-testid={`edit-${profile.id}`}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="type-label underline"
                  disabled={pending}
                  onClick={() =>
                    act(
                      () => deleteProfileAction({ profileId: profile.id }),
                      () => undefined,
                    )
                  }
                  data-testid={`delete-${profile.id}`}
                >
                  Delete
                </button>
              </span>
            </article>
          ),
        )}
      </div>

      {creating ? (
        <ProfileForm
          draft={draft}
          setDraft={setDraft}
          busy={pending}
          submitLabel="Save profile"
          testId="profile-form-new"
          onCancel={() => setCreating(false)}
          onSubmit={() =>
            act(
              () => createProfileAction(payloadFrom(draft)),
              () => {
                setCreating(false);
                setDraft(EMPTY);
              },
            )
          }
        />
      ) : (
        <button
          type="button"
          className="self-start border border-hairline px-6 py-3 type-label"
          onClick={() => {
            setDraft(EMPTY);
            setEditing(null);
            setCreating(true);
          }}
          data-testid="add-profile"
        >
          Add a setup
        </button>
      )}

      <Callout tone="neutral" title="Deleting keeps your history readable">
        A deleted profile stops appearing here and stops being offered when you calibrate, but the
        sessions that ran on it keep its name and the exact hardware they measured at. A past result
        is never rewritten by a change made afterwards.
      </Callout>
    </main>
  );
}
