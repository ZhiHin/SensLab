"use client";

import Link from "next/link";

/**
 * The route-level error boundary (doc 22 §22.6, `SENS-SEC-016`).
 *
 * ## What it may say
 *
 * Nothing about the failure. `error.message` is deliberately not rendered: a server error
 * reaching a client boundary can carry a query fragment, a constraint name or an id, and this
 * screen is the one place where such a string would be shown to whoever triggered it. Next.js
 * already replaces production messages with a generic string and supplies `digest` for
 * correlation, so the digest is the only thing worth putting on screen — it is what turns "it
 * broke" into a specific line in the server log.
 *
 * The digest is shown rather than logged to the console: the server already holds the real
 * record, and the reference on screen is what lets a player quote it in a report.
 *
 * ## Why retry is a button and not a redirect
 *
 * Most failures here are transient — a dropped database connection, a timeout. `reset()`
 * re-renders the segment without discarding the rest of the app, so a player who was midway
 * through something does not lose their place. A session that was actually measuring is a
 * different matter: the engine records its own quality flags, and an interrupted round is
 * resumed from the stored audit rather than from this screen.
 */

export default function RouteError({
  error,
  reset,
}: {
  readonly error: Error & { readonly digest?: string };
  readonly reset: () => void;
}) {
  return (
    <main
      id="main"
      className="flex min-h-[70vh] flex-col items-start justify-center gap-6 px-6 py-20"
    >
      <div className="mx-auto w-full max-w-[720px]">
        <p className="type-label text-text-3">Error</p>
        <h1 className="mt-4 type-display-m text-text-1">SOMETHING BROKE.</h1>
        <p className="mt-6 max-w-[52ch] text-text-2">
          This is on us, not on you. Nothing you had already finished has been lost — completed
          sessions and results are stored as they are measured.
        </p>
        {error.digest === undefined ? null : (
          <p className="mt-4 type-data-s text-text-3">
            Reference <span data-testid="error-digest">{error.digest}</span>
          </p>
        )}
        <div className="mt-10 flex flex-wrap items-center gap-6">
          <button
            type="button"
            onClick={reset}
            className="border border-accent bg-accent px-6 py-3 type-label text-void transition-colors duration-[var(--duration-micro)] hover:border-accent-dim hover:bg-accent-dim"
          >
            Try again
          </button>
          <Link href="/" className="type-label text-text-3 hover:text-text-1">
            Back to the start →
          </Link>
        </div>
      </div>
    </main>
  );
}
