import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Callout, Panel, StatusPill } from "@/components/primitives";
import { SCOPE_KEYS, type ScopeKey } from "@/core/types/vocabulary";
import { STATUS_COPY } from "@/features/game-settings/copy";
import { CanonicalBlock, ScopeList, SettingsBlock } from "@/features/game-settings/settings-block";
import { CopyButton } from "@/features/results/copy-button";
import {
  canonicalTargetCm,
  getRecommendation,
  outputGameOptions,
  settingsForRecommendation,
} from "@/services/recommendation-service";
import { getPreferences } from "@/services/preferences-service";
import { getActor } from "@/services/session-context";
import { formatDistance, intlLocale, per360Label } from "@/core/preferences";
import { translator } from "@/lib/i18n/messages";

/**
 * SCR-032 — Game Settings (doc 25 §25.10, FR-078–FR-081, FR-085).
 *
 * The output game is a query parameter, so switching it re-derives the settings from the
 * stored canonical value and nothing else: no test re-runs, no write to the session. Every
 * displayed value has a copy control, and a game without a verified model shows the
 * verification state and the canonical targets instead of a number (`SENS-BR-014`).
 *
 * This is the surface FR-105 names: the one a player reads a number off and takes into a
 * game. Its labels come from the message catalogue and its distances from the unit
 * preference, while the **game's own** name and setting labels stay in the language that game
 * uses (doc 08 §8.7) — a translated setting name would not match the menu the player is
 * looking at.
 */

interface PageProps {
  readonly params: Promise<{ readonly recommendationId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export const metadata: Metadata = {
  title: "Your game settings",
  description: "Your calibrated sensitivity expressed for a game, where the game is verified.",
};

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export default async function SettingsPage({ params, searchParams }: PageProps) {
  const { recommendationId } = await params;
  const query = await searchParams;
  const actor = await getActor();
  const [view, preferences] = await Promise.all([
    getRecommendation(actor, recommendationId),
    getPreferences(actor),
  ]);
  if (view === null || view.verdict === "insufficient_data") notFound();
  const t = translator(preferences.locale);
  const distance = (cm: number) => formatDistance(cm, preferences.unit, preferences.locale);

  const games = outputGameOptions();
  const requestedGame = first(query.game) ?? null;
  const gameId = games.some((game) => game.gameId === requestedGame) ? requestedGame : null;
  const requestedScope = first(query.scope);
  const scopeKey: ScopeKey = (SCOPE_KEYS as readonly string[]).includes(requestedScope ?? "")
    ? (requestedScope as ScopeKey)
    : "hipfire";

  const settings = settingsForRecommendation(view, gameId, scopeKey);
  const targetCm = canonicalTargetCm(view);
  const counts = Math.round(settings.canonical.countsPer360);

  const target = distance(targetCm);

  return (
    <main
      id="main"
      lang={intlLocale(preferences.locale)}
      className="mx-auto flex w-full max-w-[900px] flex-col gap-6 px-6 py-12"
    >
      <header className="flex flex-col gap-2">
        <Link href={`/results/${view.id}`} className="type-label text-text-3 hover:text-text-1">
          ← Your result
        </Link>
        <h1 className="type-display-s">{t("settings.title")}</h1>
        {view.verdict === "indistinguishable" && (
          <p className="max-w-[64ch] text-sm text-text-2">
            No single sensitivity won, so these settings target the centre of your comfort range,{" "}
            {target.text}/360. Anything in the range is fine.
          </p>
        )}
      </header>

      <Panel title={t("settings.convertTo")}>
        <nav className="flex flex-wrap gap-2" aria-label="Output game" data-testid="game-switcher">
          <Link
            href={`/results/${view.id}/settings`}
            className={`border px-4 py-2 type-label ${gameId === null ? "border-text-1" : "border-hairline"}`}
            aria-current={gameId === null ? "page" : undefined}
          >
            No game
          </Link>
          {games.map((game) => (
            <Link
              key={game.gameId}
              href={`/results/${view.id}/settings?game=${game.gameId}`}
              className={`flex items-center gap-2 border px-4 py-2 type-label ${
                gameId === game.gameId ? "border-text-1" : "border-hairline"
              }`}
              aria-current={gameId === game.gameId ? "page" : undefined}
              data-testid={`switch-${game.gameId}`}
            >
              {game.displayName}
              <StatusPill
                tone={STATUS_COPY[game.status as keyof typeof STATUS_COPY]?.tone ?? "neutral"}
              >
                {STATUS_COPY[game.status as keyof typeof STATUS_COPY]?.label ?? game.status}
              </StatusPill>
            </Link>
          ))}
        </nav>
        <p className="mt-3 text-sm text-text-3">
          Changing the game changes nothing upstream: the settings are re-derived from the same
          measured value.
        </p>
      </Panel>

      <Panel title="What you can use anywhere">
        <dl className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-4 border-b border-hairline pb-3">
            <dt className="type-label text-text-2">{t("settings.target")}</dt>
            <dd className="flex items-center gap-3">
              <span className="type-data-l text-text-1" data-testid="settings-target-cm">
                {target.value.toFixed(preferences.unit === "imperial" ? 2 : 1)}
              </span>
              <span className="type-label text-text-3">{per360Label(preferences.unit)}</span>
              <CopyButton
                value={target.value.toFixed(preferences.unit === "imperial" ? 2 : 1)}
                label="target cm per 360"
              />
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 border-b border-hairline pb-3">
            <dt className="type-label text-text-2">At {view.hardware.dpi} DPI</dt>
            <dd className="flex items-center gap-3">
              <span className="type-data-l text-text-1">{counts.toLocaleString()}</span>
              <span className="type-label text-text-3">counts / 360°</span>
              <CopyButton value={String(counts)} label="counts per 360" />
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="type-label text-text-2">DPI</dt>
            <dd className="flex items-center gap-3">
              <span className="type-data-l text-text-1">{view.hardware.dpi}</span>
              <CopyButton value={String(view.hardware.dpi)} label="DPI" />
            </dd>
          </div>
        </dl>
        {view.settingsReliability !== "normal" && (
          <div className="mt-4">
            <Callout tone="caution" title="These game values assume your DPI">
              Your DPI was {view.settingsReliability === "assumed_dpi" ? "assumed" : "estimated"}{" "}
              rather than known. If it is wrong, any game number is wrong by the same proportion.
              Your cm/360 and counts/360 results are unaffected.
            </Callout>
          </div>
        )}
      </Panel>

      <CanonicalBlock view={settings} />
      <SettingsBlock view={settings} />
      <ScopeList view={settings} />

      <Panel title="Matching method for scoped aim">
        <p className="max-w-[64ch] text-sm text-text-2">
          When a game&rsquo;s scopes are verified, scoped values are derived from your hipfire
          result by a matching criterion — 360 distance, monitor distance at a chosen fraction of
          the screen, or focal length. There is no single correct one; the default is documented and
          yours to change. No launch game has a verified scope yet, so no scoped value is shown.
        </p>
      </Panel>
    </main>
  );
}
