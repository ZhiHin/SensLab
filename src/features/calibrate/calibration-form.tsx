"use client";

import { useState } from "react";
import type { DpiSource, SessionMode } from "@/core/types/vocabulary";

/**
 * The minimal hardware and mode setup (doc 04 stage 3, FR-018–FR-021).
 *
 * DPI is the only required field (`SENS-BR-004`), and where it came from is recorded
 * (`SENS-BR-005`): a DPI the player did not actually know changes what the game numbers mean,
 * and the result page says so. The current sensitivity centres the search; the pad width
 * bounds it. Both optional, both explained, neither blocking.
 *
 * A signed-in user with saved hardware profiles picks one and the fields prefill from it
 * (FR-094, FR-095); the session records which profile it ran at, and the values are still
 * submitted as a snapshot, so editing the profile later cannot rewrite this session
 * (`SENS-BR-035`). A guest, or a user with no profiles, types the same fields by hand.
 */

export interface CalibrationFormValues {
  readonly mode: SessionMode;
  readonly dpi: number;
  readonly dpiSource: DpiSource;
  readonly currentCmPer360: number | null;
  readonly padWidthCm: number | null;
  readonly gameId: string | null;
  readonly hardwareProfileId: string | null;
  readonly aspectRatio: number;
}

/** What the form needs from a saved profile: the fields it prefills. */
export interface HardwareProfileOption {
  readonly id: string;
  readonly name: string;
  readonly dpi: number;
  readonly dpiSource: DpiSource;
  readonly mousepadWidthMm: number | null;
  readonly isDefault: boolean;
}

export interface CalibrationFormProps {
  readonly games: readonly { readonly gameId: string; readonly displayName: string }[];
  readonly profiles: readonly HardwareProfileOption[];
  /** Minutes per mode, computed from the trial budget on the server (`SENS-BR-024`). */
  readonly estimatedMinutes: Readonly<Record<Mode, number>>;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onSubmit: (values: CalibrationFormValues) => void;
}

type Mode = "quick" | "standard" | "advanced";

/**
 * What each mode runs. The shape is described here; **the duration is not** — it arrives
 * derived from the trial budget (`SENS-BR-024`), because a written-down "about 20 minutes"
 * becomes false the first time the budget changes and nothing fails.
 */
const MODE_COPY: Readonly<Record<Mode, { label: string; detail: string }>> = {
  quick: { label: "Quick", detail: "3 tests · 3 sensitivities · 2 rounds" },
  standard: { label: "Standard", detail: "5 tests · 3 sensitivities · 3 rounds" },
  advanced: { label: "Advanced", detail: "10 tests · 4 sensitivities · 4 rounds" },
};

const input =
  "w-full border border-hairline-strong bg-surface-2 px-3 py-2 type-data-s text-text-1 disabled:opacity-40";

export function CalibrationForm({
  games,
  profiles,
  estimatedMinutes,
  busy,
  error,
  onSubmit,
}: CalibrationFormProps) {
  const preselected = profiles.find((profile) => profile.isDefault) ?? profiles[0] ?? null;
  const [mode, setMode] = useState<"quick" | "standard" | "advanced">("standard");
  const [profileId, setProfileId] = useState(preselected?.id ?? "");
  const [dpi, setDpi] = useState(String(preselected?.dpi ?? 800));
  const [dpiKnown, setDpiKnown] = useState(
    preselected === null || preselected.dpiSource === "known",
  );
  const [currentCm, setCurrentCm] = useState("");
  const [padWidth, setPadWidth] = useState(
    preselected?.mousepadWidthMm === null || preselected?.mousepadWidthMm === undefined
      ? ""
      : String(preselected.mousepadWidthMm / 10),
  );
  const [gameId, setGameId] = useState("");

  /** Prefills from the chosen profile; every field stays editable afterwards. */
  function chooseProfile(id: string) {
    setProfileId(id);
    const profile = profiles.find((candidate) => candidate.id === id);
    if (profile === undefined) return;
    setDpi(String(profile.dpi));
    setDpiKnown(profile.dpiSource === "known");
    if (profile.mousepadWidthMm !== null) setPadWidth(String(profile.mousepadWidthMm / 10));
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const dpiValue = Number(dpi);
    const cm = currentCm.trim() === "" ? null : Number(currentCm);
    const pad = padWidth.trim() === "" ? null : Number(padWidth);
    onSubmit({
      mode,
      dpi: dpiValue,
      dpiSource: dpiKnown ? "known" : "assumed",
      currentCmPer360: cm !== null && Number.isFinite(cm) && cm > 0 ? cm : null,
      padWidthCm: pad !== null && Number.isFinite(pad) && pad > 0 ? pad : null,
      gameId: gameId === "" ? null : gameId,
      hardwareProfileId: profileId === "" ? null : profileId,
      aspectRatio: window.innerWidth / Math.max(1, window.innerHeight),
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-8" data-testid="calibration-form">
      <fieldset className="flex flex-col gap-3">
        <legend className="type-label mb-2">Session</legend>
        {(Object.keys(MODE_COPY) as (keyof typeof MODE_COPY)[]).map((key) => (
          <label
            key={key}
            className={`flex cursor-pointer items-baseline gap-4 border p-4 ${
              mode === key ? "border-text-1" : "border-hairline"
            }`}
          >
            <input
              type="radio"
              name="mode"
              value={key}
              checked={mode === key}
              onChange={() => setMode(key)}
              className="translate-y-[2px]"
              data-testid={`mode-${key}`}
            />
            <span className="type-label text-text-1">{MODE_COPY[key].label}</span>
            <span className="text-sm text-text-3">
              {MODE_COPY[key].detail} · about {estimatedMinutes[key]} minutes
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className="grid gap-6 sm:grid-cols-2">
        <legend className="type-label mb-2">Your mouse</legend>

        {profiles.length > 0 && (
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="type-label">Hardware profile</span>
            <select
              value={profileId}
              onChange={(event) => chooseProfile(event.target.value)}
              className="border border-hairline-strong bg-surface-2 px-3 py-2 text-sm text-text-1"
              data-testid="input-hardware-profile"
            >
              <option value="">Not one of my saved profiles</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name} · {profile.dpi} DPI{profile.isDefault ? " (default)" : ""}
                </option>
              ))}
            </select>
            <span className="text-xs text-text-3">
              Fills in what it knows and records which setup this session ran on, so history can
              tell two setups apart. Editing the profile later never changes what a past session
              measured.
            </span>
          </label>
        )}

        <label className="flex flex-col gap-1">
          <span className="type-label">Mouse DPI</span>
          <input
            type="number"
            inputMode="numeric"
            min={100}
            max={32000}
            step={50}
            value={dpi}
            onChange={(event) => setDpi(event.target.value)}
            required
            className={input}
            data-testid="input-dpi"
          />
          <label className="mt-1 flex items-center gap-2 text-sm text-text-3">
            <input
              type="checkbox"
              checked={!dpiKnown}
              onChange={(event) => setDpiKnown(!event.target.checked)}
              data-testid="dpi-unknown"
            />
            I am not sure — assume this value
          </label>
          <span className="text-xs text-text-3">
            Your result is measured in counts, which does not depend on DPI. DPI only affects how it
            is expressed in centimetres and in game settings.
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="type-label">Current sensitivity (optional)</span>
          <span className="flex items-baseline gap-2">
            <input
              type="number"
              inputMode="decimal"
              min={1}
              max={499}
              step={0.1}
              value={currentCm}
              onChange={(event) => setCurrentCm(event.target.value)}
              placeholder="e.g. 30"
              className={input}
              data-testid="input-current-cm"
            />
            <span className="type-label text-text-3">cm/360°</span>
          </span>
          <span className="text-xs text-text-3">
            Centres the search on what you use now. Leave blank to start from the middle of the
            usable range.
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="type-label">Mousepad width (optional)</span>
          <span className="flex items-baseline gap-2">
            <input
              type="number"
              inputMode="decimal"
              min={5}
              max={299}
              step={1}
              value={padWidth}
              onChange={(event) => setPadWidth(event.target.value)}
              placeholder="e.g. 45"
              className={input}
              data-testid="input-pad-width"
            />
            <span className="type-label text-text-3">cm</span>
          </span>
          <span className="text-xs text-text-3">
            Keeps the search inside what you can physically reach. The 360 Comfort test measures
            this too.
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="type-label">Game (optional)</span>
          <select
            value={gameId}
            onChange={(event) => setGameId(event.target.value)}
            className="border border-hairline-strong bg-surface-2 px-3 py-2 text-sm text-text-1"
            data-testid="input-game"
          >
            <option value="">No particular game</option>
            {games.map((game) => (
              <option key={game.gameId} value={game.gameId}>
                {game.displayName}
              </option>
            ))}
          </select>
          <span className="text-xs text-text-3">
            Changes nothing about the measurement. It decides which game&rsquo;s settings the result
            tries to show you — and only verified games get a number.
          </span>
        </label>
      </fieldset>

      {error !== null && (
        <p className="text-critical" role="alert" data-testid="form-error">
          {error}
        </p>
      )}

      <button
        type="submit"
        className="self-start border border-hairline px-6 py-3 type-label disabled:opacity-40"
        disabled={busy}
        data-testid="start-calibration"
      >
        {busy ? "Preparing…" : "Start calibration"}
      </button>
    </form>
  );
}
