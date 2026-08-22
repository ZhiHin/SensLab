import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Panel } from "@/components/primitives";
import { countsPer360FromCm } from "@/core/sensitivity/canonical";
import { parseSettingsQuery } from "@/features/game-settings/contracts";
import { CanonicalBlock, ScopeList, SettingsBlock } from "@/features/game-settings/settings-block";
import { gameAdapterRegistry } from "@/game-adapters";
import { convertForGame } from "@/services/conversion-service";

/**
 * Settings for one game, from a canonical sensitivity.
 *
 * ## Why the inputs arrive in the URL
 *
 * The conversion is a pure read. Keeping it in the query string makes the result linkable and
 * back-buttonable, keeps the page fully server-rendered, and means the adapter never reaches
 * the browser — which matters because the emitted number is one a player types into their
 * game and trusts (`SENS-BR-034`).
 *
 * ## Where this ends up
 *
 * Phase 7 mounts the same two components inside the results screen (doc 24 SCR-032), where
 * the canonical value comes from a completed calibration instead of a form field. The
 * components take a `GameSettingsView` and nothing else, so that move needs no changes here.
 */

interface PageProps {
  readonly params: Promise<{ readonly gameId: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { gameId } = await params;
  const adapter = gameAdapterRegistry.resolve(gameId);
  return {
    title: adapter === null ? "Game settings" : `${adapter.identity.displayName.en} settings`,
    description: "Convert a calibrated sensitivity into this game's settings, when we can.",
  };
}

export default async function GameSettingsPage({ params, searchParams }: PageProps) {
  const { gameId } = await params;
  if (gameAdapterRegistry.resolve(gameId) === null) notFound();

  const { query } = parseSettingsQuery(await searchParams);
  const view = convertForGame({
    gameId,
    scopeKey: query.scope,
    countsPer360: countsPer360FromCm(query.cm360, query.dpi),
    dpi: query.dpi,
    ...(query.halfFov === undefined ? {} : { hipfireHalfFovDegrees: query.halfFov }),
  });

  const scopeOptions = view.game?.scopes ?? [];

  return (
    <main id="main" className="mx-auto flex w-full max-w-[900px] flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-2">
        <Link href="/games" className="type-label text-text-3 hover:text-text-1">
          ← All games
        </Link>
        <h1 className="type-display-s">{view.game?.displayName.en ?? "Game settings"}</h1>
      </header>

      <Panel title="Your sensitivity">
        <form method="get" className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1">
            <span className="type-label">Distance / 360°</span>
            <span className="flex items-baseline gap-2">
              <input
                type="number"
                name="cm360"
                step="0.1"
                min="1"
                max="500"
                defaultValue={query.cm360}
                className="w-28 border border-hairline-strong bg-surface-2 px-3 py-2 type-data-s text-text-1"
                data-testid="input-cm360"
              />
              <span className="type-label text-text-3">cm</span>
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="type-label">Mouse DPI</span>
            <input
              type="number"
              name="dpi"
              step="50"
              min="50"
              max="64000"
              defaultValue={query.dpi}
              className="w-28 border border-hairline-strong bg-surface-2 px-3 py-2 type-data-s text-text-1"
              data-testid="input-dpi"
            />
          </label>

          {scopeOptions.length > 1 && (
            <label className="flex flex-col gap-1">
              <span className="type-label">Scope</span>
              <select
                name="scope"
                defaultValue={query.scope}
                className="border border-hairline-strong bg-surface-2 px-3 py-2 text-sm text-text-1"
                data-testid="input-scope"
              >
                {scopeOptions.map((scope) => (
                  <option key={scope.scopeKey} value={scope.scopeKey}>
                    {scope.displayName.en}
                  </option>
                ))}
              </select>
            </label>
          )}

          <button
            type="submit"
            className="border border-text-1 px-5 py-2 type-label text-text-1 hover:bg-surface-3"
            data-testid="convert"
          >
            Convert
          </button>
        </form>
        <p className="mt-3 max-w-[64ch] text-sm text-text-3">
          A calibration session produces these two numbers for you. Entering them by hand here is
          for checking what a given sensitivity would look like in this game.
        </p>
      </Panel>

      <CanonicalBlock view={view} />
      <SettingsBlock view={view} />
      <ScopeList view={view} />
    </main>
  );
}
