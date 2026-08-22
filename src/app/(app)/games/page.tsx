import Link from "next/link";
import type { Metadata } from "next";
import { Callout, Panel, Readout, StatusPill } from "@/components/primitives";
import { STATUS_COPY } from "@/features/game-settings/copy";
import { verificationTransparency } from "@/services/verification-service";

/**
 * The verification table (doc 24 SCR-002, doc 08 §8.2).
 *
 * Every value on this page is read from the verification register and the adapter registry.
 * Nothing is written as copy, so the page cannot claim a game is verified while the code
 * refuses to convert it — the two most common ways a table like this goes stale are a
 * hardcoded badge and a hand-maintained list, and this is neither.
 *
 * Publishing the open items rather than hiding them is the point. A converter that shows
 * numbers for five games and says nothing about where they came from is easy to build and
 * impossible to check.
 */
export const metadata: Metadata = {
  title: "Game verification",
  description: "What SensLab has measured for each game, and what it has not.",
};

export default function GamesPage() {
  const { summary, open, adapters } = verificationTransparency();

  return (
    <main id="main" className="mx-auto w-full max-w-[900px] px-6 py-12">
      <header className="mb-8 flex flex-col gap-2">
        <span className="type-label">Game support</span>
        <h1 className="type-display-s">WHAT WE HAVE MEASURED</h1>
        <p className="max-w-[64ch] text-text-2">
          SensLab prints a game setting only after measuring that game itself, against a specific
          build, with the measurements recorded and signed off. Until then it shows you your
          sensitivity in centimetres and refuses to guess the rest.
        </p>
      </header>

      <div className="mb-8">
        <Panel title="Verification register">
          <div className="grid grid-cols-3 gap-6">
            <Readout label="Items tracked" value={String(summary.total)} />
            <Readout label="Verified" value={String(summary.verified)} />
            <Readout label="Still open" value={String(summary.open)} />
          </div>
          {summary.verified === 0 && (
            <div className="mt-5">
              <Callout tone="unverified" title="No game is verified yet">
                Nothing here has been through our measurement procedure, so no game setting is
                available anywhere in the product. Calibration itself is unaffected: it measures
                your aim, not a game.
              </Callout>
            </div>
          )}
        </Panel>
      </div>

      <section className="mb-10">
        <h2 className="type-label mb-3">Games</h2>
        <ul className="flex flex-col gap-3">
          {adapters.map((adapter) => {
            const status = STATUS_COPY[adapter.status];
            return (
              <li key={adapter.gameId}>
                <Link
                  href={`/games/${adapter.gameId}`}
                  className="flex flex-col gap-2 border border-hairline p-5 hover:border-text-3"
                  data-testid={`game-link-${adapter.gameId}`}
                >
                  <span className="flex flex-wrap items-center justify-between gap-3">
                    <span className="type-label text-text-1">{adapter.displayName}</span>
                    <StatusPill tone={status.tone}>{status.label}</StatusPill>
                  </span>
                  <span className="text-sm text-text-2">{status.summary}</span>
                  {adapter.openRegisterEntries.length > 0 && (
                    <span className="type-label text-text-3">
                      Outstanding: {adapter.openRegisterEntries.join(", ")}
                    </span>
                  )}
                  {adapter.lastVerifiedAt !== null && (
                    <span className="type-label text-text-3">
                      Last verified {adapter.lastVerifiedAt.slice(0, 10)} against build{" "}
                      {adapter.verifiedAgainstBuild}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2 className="type-label mb-3">Open items</h2>
        <p className="mb-4 max-w-[64ch] text-sm text-text-3">
          Each entry names something about a third-party product that SensLab would have to depend
          on, and what stays unavailable until it is established. They are ordered by how much they
          block.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-hairline-strong">
                <th className="type-label py-2 pr-4 font-normal">Item</th>
                <th className="type-label py-2 pr-4 font-normal">Subject</th>
                <th className="type-label py-2 font-normal">Blocks</th>
              </tr>
            </thead>
            <tbody>
              {open.map((entry) => (
                <tr key={entry.id} className="border-b border-hairline align-top">
                  <td className="type-data-s py-3 pr-4 text-text-2">{entry.id}</td>
                  <td className="py-3 pr-4 text-text-1">{entry.subject}</td>
                  <td className="py-3 text-text-3">{entry.blocks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
