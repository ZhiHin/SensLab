import Link from "next/link";
import { Callout, Panel, StatusPill } from "@/components/primitives";
import { listGameOptions } from "@/services/game-service";
import { getActor } from "@/services/session-context";
import { CURRENT_VERSIONS } from "@/core/params";

/**
 * Phase 1 application shell.
 *
 * **This is not the landing page.** The premium scroll narrative, the interactive field and
 * the five-act story are Phase 10 (doc 25 §25.1). What this page does is prove the foundation
 * is real end to end: it reads the actor from the session cookie, reads the game roster from
 * the database, and renders each game's honest verification state straight from the adapter
 * registry rather than from hardcoded copy.
 *
 * The verification states it shows are the true ones: every launch adapter is unverified,
 * which is exactly what doc 36 records.
 */
export default async function ShellPage() {
  const [actor, games] = await Promise.all([getActor(), listGameOptions()]);

  return (
    <div className="relative min-h-dvh">
      <div className="instrument-grid pointer-events-none absolute inset-0" aria-hidden="true" />
      <div className="instrument-noise pointer-events-none absolute inset-0" aria-hidden="true" />

      <header className="relative flex items-center justify-between border-b border-hairline px-6 py-4">
        <span className="type-label text-text-1">SENSLAB</span>
        <nav className="flex items-center gap-6">
          {actor.kind === "user" ? (
            <span className="type-label text-accent">Signed in</span>
          ) : (
            <Link href="/auth/sign-in" className="type-label">
              Sign in
            </Link>
          )}
        </nav>
      </header>

      <main id="main" className="relative mx-auto w-full max-w-[1200px] px-6 py-16">
        <div className="flex flex-col gap-4">
          <span className="type-label">Phase 1 · Foundation</span>
          <h1 className="type-display-m">
            FIND YOUR
            <br />
            TRUE SENS.
          </h1>
          <p className="max-w-[52ch] text-text-2">
            SensLab measures how you actually aim across several mouse sensitivities and finds the
            range where you perform best. The calibration engine, the aim tests and the results
            experience arrive in later phases — this build is the foundation they sit on.
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          <Panel title="Supported games">
            <ul className="flex flex-col gap-3">
              {games.map((game) => (
                <li key={game.slug} className="flex items-center justify-between gap-4">
                  <span className="flex flex-col">
                    <span className="text-text-1">{game.displayName}</span>
                    {game.displayNameLocalized["zh-Hans"] !== undefined && (
                      <span lang="zh-Hans" className="type-body-s text-text-3">
                        {game.displayNameLocalized["zh-Hans"]}
                      </span>
                    )}
                  </span>
                  <StatusPill tone={game.canConvert ? "verified" : "unverified"}>
                    {game.canConvert ? "verified" : "unverified"}
                  </StatusPill>
                </li>
              ))}
            </ul>

            <div className="mt-5 flex flex-col gap-4">
              <Callout tone="caution" title="No verified conversions yet">
                Every launch adapter is still unverified, so SensLab will not print an in-game
                sensitivity number for any of them. That is deliberate: an incorrect converted value
                is worse than none, because it gets copied into a game and trusted.
              </Callout>
              <Link href="/games" className="type-label text-text-2 hover:text-text-1">
                See exactly what has been measured →
              </Link>
            </div>
          </Panel>

          <Panel title="Active algorithm versions">
            <dl className="flex flex-col gap-3">
              {Object.entries(CURRENT_VERSIONS).map(([kind, version]) => (
                <div key={kind} className="flex items-baseline justify-between gap-4">
                  <dt className="type-label">{kind.replace(/_/g, " ")}</dt>
                  <dd className="type-data-s text-text-2">{version}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-5 type-body-s text-text-3">
              Every result records the versions that produced it, so a recommendation stays
              explainable after the models change.
            </p>
          </Panel>
        </div>

        <p className="mt-12 max-w-[64ch] type-body-s text-text-3">
          SensLab runs in a browser and is not the game engine. Results are estimates with a stated
          confidence.
        </p>
      </main>
    </div>
  );
}
