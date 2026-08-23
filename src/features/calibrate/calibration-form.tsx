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
 * The polished hardware-setup screen with saved profiles is Phase 9/10. This is the honest
 * minimum that lets a session start with what the engine needs.
 */

export interface CalibrationFormValues {
  readonly mode: SessionMode;
  readonly dpi: number;
  readonly dpiSource: DpiSource;
  readonly currentCmPer360: number | null;
  readonly padWidthCm: number | null;
  readonly gameId: string | null;
  readonly aspectRatio: number;
}

export interface CalibrationFormProps {
  readonly games: readonly { readonly gameId: string; readonly displayName: string }[];
  readonly busy: boolean;
  readonly error: string | null;
  readonly onSubmit: (values: CalibrationFormValues) => void;
}

const MODE_COPY: Readonly<
  Record<"quick" | "standard" | "advanced", { label: string; detail: string }>
> = {
  quick: { label: "Quick", detail: "3 tests · 3 sensitivities · 2 rounds · about 10 minutes" },
  standard: {
    label: "Standard",
    detail: "5 tests · 3 sensitivities · 3 rounds · about 20 minutes",
  },
  advanced: {
    label: "Advanced",
    detail: "10 tests · 4 sensitivities · 4 rounds · 40 minutes or more",
  },
};

const input =
  "w-full border border-hairline-strong bg-surface-2 px-3 py-2 type-data-s text-text-1 disabled:opacity-40";

export function CalibrationForm({ games, busy, error, onSubmit }: CalibrationFormProps) {
  const [mode, setMode] = useState<"quick" | "standard" | "advanced">("standard");
  const [dpi, setDpi] = useState("800");
  const [dpiKnown, setDpiKnown] = useState(true);
  const [currentCm, setCurrentCm] = useState("");
  const [padWidth, setPadWidth] = useState("");
  const [gameId, setGameId] = useState("");

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
            <span className="text-sm text-text-3">{MODE_COPY[key].detail}</span>
          </label>
        ))}
      </fieldset>

      <fieldset className="grid gap-6 sm:grid-cols-2">
        <legend className="type-label mb-2">Your mouse</legend>

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
