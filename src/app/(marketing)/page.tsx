import Link from "next/link";
import type { Metadata } from "next";
import { StatusPill } from "@/components/primitives";
import { STATUS_COPY } from "@/features/game-settings/copy";
import { CURRENT_VERSIONS } from "@/core/params";
import { ActSequence, type Act } from "@/features/landing/act-sequence";
import { HeroField } from "@/features/landing/hero-field";
import { listGameOptions } from "@/services/game-service";
import { getPreferences } from "@/services/preferences-service";
import { estimatedSessionMinutes } from "@/services/recommendation-service";
import { getActor } from "@/services/session-context";

/**
 * SCR-001 — Landing (doc 25 §25.1, doc 26).
 *
 * The register is a calibration laboratory: near-black, hairline structure, uppercase
 * micro-labels, two accent hues and no card grid. The narrative is one sequence of five acts
 * driven by scroll position rather than five stacked feature cards (doc 26 §26.2).
 *
 * ## What the page promises
 *
 * The three qualifiers under the call to action are load-bearing — they pre-empt the three
 * commonest reasons to leave — and the duration among them is **computed from the trial
 * budget** (`SENS-BR-024`), so it cannot drift away from what the product actually does.
 *
 * The browser-limitation caveat sits here, before a visitor spends twenty minutes, rather than
 * on the result where it would read as an excuse (`SENS-BR-022`).
 */

export const metadata: Metadata = {
  title: "SensLab — find your true sens",
  description:
    "SensLab measures how you actually aim across several mouse sensitivities and finds the " +
    "range where you perform best. Not a converter — a calibration.",
};

const ACTS: readonly Act[] = [
  {
    index: "01",
    title: "REACT",
    lead: "Everything starts with a baseline.",
    body: [
      "We measure your reaction floor first — how long it takes you to respond to something appearing, with the mouse doing nothing at all.",
      "Reaction never decides your sensitivity. It is measured so the other tests can separate being slow to start from being slow to arrive.",
    ],
    readout: { label: "Measures", value: "Onset", unit: "ms" },
  },
  {
    index: "02",
    title: "FLICK",
    lead: "Large movements, measured at real angles.",
    body: [
      "Targets appear at known angular distances and you take them as you would in a game. What is recorded is where your first shot landed and how long the movement took, with your reaction time already removed.",
      "The same targets appear at every sensitivity being tested, in the same order, so the comparison is between the sensitivities rather than between two runs of luck.",
    ],
    readout: { label: "Measures", value: "Error", unit: "° from centre" },
  },
  {
    index: "03",
    title: "TRACK",
    lead: "Holding a moving target is a different skill.",
    body: [
      "A target moves unpredictably and you stay on it. Tracking rewards a slower sensitivity than flicking usually does, which is exactly why a single number copied from someone else rarely fits.",
      "Time on target and the error while off it are both recorded — one says whether you were there, the other says how badly you were not.",
    ],
    readout: { label: "Measures", value: "Time on target", unit: "fraction" },
  },
  {
    index: "04",
    title: "CONTROL",
    lead: "Overshoot is the signature of too fast.",
    body: [
      "Small corrections, recoil compensation and the return to centre after a wide turn all read the same underlying thing: whether the sensitivity is inside what your hand can stop precisely.",
      "This is where a sensitivity that felt fast and fun starts to cost measurable accuracy.",
    ],
    readout: { label: "Measures", value: "Overshoot", unit: "rate" },
  },
  {
    index: "05",
    title: "OPTIMIZE",
    lead: "A curve, not a number.",
    body: [
      "Every trial feeds one response curve: performance against sensitivity, with the uncertainty drawn on it. Where the curve peaks is your recommendation; how sharply it peaks is how much the recommendation is worth.",
      "If the curve is flat, SensLab says so and gives you a range. It will not invent a peak that the measurement does not contain.",
    ],
    readout: { label: "Produces", value: "cm / 360°", unit: "with an interval" },
  },
];

export default async function LandingPage() {
  const actor = await getActor();
  const [games, preferences] = await Promise.all([listGameOptions(), getPreferences(actor)]);
  const minutes = estimatedSessionMinutes("standard");
  // "Verified" is the adapter's own state, not a label the page chooses (`SENS-BR-014`).
  const verified = games.filter((game) => game.canConvert).length;

  return (
    <div className="relative">
      <div className="instrument-noise pointer-events-none fixed inset-0" aria-hidden="true" />

      <header className="relative z-20 flex items-center justify-between border-b border-hairline px-6 py-4">
        <span className="type-label text-text-1">SENSLAB</span>
        <nav className="flex items-center gap-6" aria-label="Main">
          <Link href="#how-it-works" className="type-label text-text-3 hover:text-text-1">
            How it works
          </Link>
          {actor.kind === "user" ? (
            <Link href="/history" className="type-label text-text-3 hover:text-text-1">
              Your sessions
            </Link>
          ) : (
            <Link href="/auth/sign-in" className="type-label text-text-3 hover:text-text-1">
              Sign in
            </Link>
          )}
        </nav>
      </header>

      <main id="main" className="relative">
        {/* ------------------------------------------------------------ act 0: hero */}
        <section className="relative flex min-h-[86vh] items-center overflow-hidden px-6">
          <HeroField />

          <div className="relative mx-auto w-full max-w-[1100px] py-20">
            <h1 className="type-display-l text-text-1">
              FIND YOUR
              <br />
              TRUE SENS.
            </h1>

            <p className="mt-8 max-w-[46ch] text-text-2">
              Stop copying someone else&rsquo;s settings. Find the sensitivity your hands actually
              perform best with.
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-6">
              <Link
                href="/calibrate"
                className="border border-accent bg-accent px-8 py-4 type-label text-void transition-colors duration-[var(--duration-micro)] hover:bg-accent-dim hover:border-accent-dim"
                data-testid="start-calibration-link"
              >
                Start calibration
              </Link>
              <Link href="#how-it-works" className="type-label text-text-2 hover:text-text-1">
                How it works →
              </Link>
            </div>

            <p className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 type-label text-text-3">
              {/* Derived from the trial budget, never written down (`SENS-BR-024`). */}
              <span data-testid="duration-estimate">~{minutes} min</span>
              <span aria-hidden="true">·</span>
              <span>No account needed</span>
              <span aria-hidden="true">·</span>
              <span>Mouse required</span>
            </p>
          </div>
        </section>

        {/* ------------------------------------------------------ acts 1–5: narrative */}
        <ActSequence acts={ACTS} />

        {/* ------------------------------------------------------------ games */}
        <section className="mx-auto w-full max-w-[1100px] px-6 py-20" aria-labelledby="games">
          <h2 id="games" className="type-label text-text-3">
            Games
          </h2>
          <p className="mt-4 max-w-[56ch] text-text-2">
            Your result is measured in cm/360° and belongs to you rather than to a game. Turning it
            into an in-game number needs a sensitivity model we have verified against the game
            itself — and we publish which ones we have.
          </p>
          <ul className="mt-8 flex flex-wrap gap-3" data-testid="game-list">
            {games.map((game) => (
              <li
                key={game.slug}
                className="flex items-center gap-3 border border-hairline px-4 py-3"
              >
                {/* A game's name belongs to the game, not to the interface. It is shown in the
                    reader's language where it has one, and the native name is shown alongside
                    with its own `lang` so a screen reader pronounces it correctly and the two
                    Delta Force builds stay visibly distinct (`SENS-BR-015`, doc 28 §28.10). */}
                <span className="type-label text-text-1">
                  {game.displayNameLocalized[preferences.locale] ?? game.displayName}
                </span>
                {game.displayNameLocalized["zh-Hans"] !== undefined &&
                  game.displayNameLocalized["zh-Hans"] !==
                    (game.displayNameLocalized[preferences.locale] ?? game.displayName) && (
                    <span lang="zh-Hans" className="type-label text-text-3">
                      {game.displayNameLocalized["zh-Hans"]}
                    </span>
                  )}
                {/* The adapter's own state, in the same words every other surface uses. A
                    label the landing page chose for itself could disagree with the settings
                    screen, and the disagreement would be invisible. */}
                <StatusPill
                  tone={STATUS_COPY[game.verificationStatus].tone}
                  status={game.verificationStatus}
                >
                  {STATUS_COPY[game.verificationStatus].label}
                </StatusPill>
              </li>
            ))}
          </ul>
          <p className="mt-6 max-w-[56ch] text-sm text-text-3" data-testid="verified-count">
            {verified === 0
              ? "None of these has a verified model yet, so none of them gets a number from us. You still get your full result in cm/360°."
              : `${verified} of ${games.length} have a verified model today.`}
          </p>
        </section>

        {/* ------------------------------------------------------------ act 6: close */}
        <section className="relative overflow-hidden border-t border-hairline px-6 py-28">
          <div className="instrument-grid pointer-events-none absolute inset-0" aria-hidden />
          <div className="relative mx-auto flex w-full max-w-[1100px] flex-col items-start gap-8">
            <h2 className="type-display-m text-text-1">
              YOUR AIM HAS A PEAK.
              <br />
              LET&rsquo;S FIND IT.
            </h2>
            <Link
              href="/calibrate"
              className="border border-accent bg-accent px-8 py-4 type-label text-void transition-colors duration-[var(--duration-micro)] hover:bg-accent-dim hover:border-accent-dim"
              data-testid="start-calibration-close"
            >
              Start calibration
            </Link>
            <p className="max-w-[60ch] text-sm text-text-3" data-testid="browser-caveat">
              SensLab runs in your browser and is not the game engine. Results are estimates with a
              stated confidence, and every one of them shows the evidence it was drawn from.
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-hairline px-6 py-8">
        <div className="mx-auto flex w-full max-w-[1100px] flex-wrap items-center gap-x-8 gap-y-3">
          <span className="type-label text-text-3">SENSLAB</span>
          <Link href="/games" className="type-label text-text-3 hover:text-text-1">
            Game verification
          </Link>
          <Link href="/auth/sign-in" className="type-label text-text-3 hover:text-text-1">
            Sign in
          </Link>
          <span className="type-data-s text-text-3" data-testid="algorithm-versions">
            {CURRENT_VERSIONS.scoring} · {CURRENT_VERSIONS.calibration} ·{" "}
            {CURRENT_VERSIONS.confidence}
          </span>
        </div>
      </footer>
    </div>
  );
}
