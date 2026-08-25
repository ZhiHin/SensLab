"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Callout, Panel } from "@/components/primitives";
import {
  MIN_VIEWPORT_HEIGHT,
  MIN_VIEWPORT_WIDTH,
  evaluateGate,
  type GateResult,
} from "@/core/environment/capability";

/**
 * SCR-050 / SCR-051 — the calibration gate (FR-100, `SENS-UX-026`, `SENS-BR-023`).
 *
 * Capability-based and re-evaluated on resize, so a desktop user who enlarges a small window
 * sees the gate disappear rather than having to reload. The measurement itself is never
 * offered in a degraded form: there is no touch calibration behind any of these screens.
 *
 * Renders its children only once every requirement is met. Until the first client evaluation
 * it renders nothing — a flash of the calibration form on a phone would be an offer the
 * product cannot honour.
 */

function detect(): GateResult {
  return evaluateGate({
    finePointer: window.matchMedia("(pointer: fine)").matches,
    hover: window.matchMedia("(hover: hover)").matches,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    pointerLock: "requestPointerLock" in Element.prototype,
  });
}

export function CapabilityGate({ children }: { readonly children: ReactNode }) {
  const [gate, setGate] = useState<GateResult | null>(null);

  useEffect(() => {
    const update = () => setGate(detect());
    update();
    window.addEventListener("resize", update);
    const fine = window.matchMedia("(pointer: fine)");
    fine.addEventListener("change", update);
    return () => {
      window.removeEventListener("resize", update);
      fine.removeEventListener("change", update);
    };
  }, []);

  if (gate === null) return null;
  if (gate.verdict === "ready") return <>{children}</>;

  return (
    <main id="main" className="mx-auto flex w-full max-w-[760px] flex-col gap-8 px-6 py-12">
      {gate.verdict === "needs_desktop" && <NeedsDesktop />}
      {gate.verdict === "window_too_small" && <WindowTooSmall />}
      {gate.verdict === "browser_unsupported" && <BrowserUnsupported />}
    </main>
  );
}

/* ------------------------------------------------------------------ SCR-050 */

function NeedsDesktop() {
  // Read once at mount rather than from an effect: the URL does not change under this screen,
  // and the initialiser runs on the client because the gate only renders after hydration.
  const [href] = useState(() => window.location.href);
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-col gap-8" data-testid="gate-needs-desktop">
      <header>
        <span className="type-label">Calibration</span>
        <h1 className="type-display-s">THIS ONE NEEDS A MOUSE</h1>
      </header>

      <p className="max-w-[62ch] text-text-2">
        SensLab measures counts of physical mouse movement, and a touchscreen reports positions
        instead. There is no honest way to run this test with a finger — so rather than give you a
        worse measurement wearing the same name, we do not offer one.
      </p>

      <Panel title="What you need">
        <ul className="flex flex-col gap-2 text-text-2">
          <li>A mouse or trackpad — anything the browser reports as a fine pointer.</li>
          <li>
            A window at least {MIN_VIEWPORT_WIDTH} × {MIN_VIEWPORT_HEIGHT} pixels.
          </li>
          <li>A browser with Pointer Lock, which every current desktop browser has.</li>
        </ul>
      </Panel>

      <div className="flex flex-col gap-3">
        <span className="type-label">Send this to your desktop</span>
        <span className="flex flex-wrap items-center gap-3">
          <code className="max-w-full overflow-x-auto border border-hairline bg-surface-2 px-3 py-2 type-data-s">
            {href}
          </code>
          <button
            type="button"
            className="border border-hairline px-4 py-2 type-label"
            onClick={() => {
              void navigator.clipboard.writeText(href).then(() => setCopied(true));
            }}
            data-testid="copy-link"
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </span>
      </div>

      <Callout tone="neutral" title="Everything else works here">
        Your results, history, game settings and account all read perfectly on this device — it is
        only the measurement that needs a mouse.
      </Callout>

      <div className="flex flex-wrap gap-4">
        <Link href="/results" className="type-label underline" data-testid="gate-results-link">
          Your results
        </Link>
        <Link href="/history" className="type-label underline">
          History
        </Link>
        <Link href="/" className="type-label underline">
          What SensLab measures
        </Link>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ small window */

function WindowTooSmall() {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const update = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return (
    <div className="flex flex-col gap-6" data-testid="gate-window-too-small">
      <header>
        <span className="type-label">Calibration</span>
        <h1 className="type-display-s">MAKE THIS WINDOW BIGGER</h1>
      </header>
      <p className="max-w-[62ch] text-text-2">
        The test needs room: targets are placed at real angles, and a small window would either push
        them off-screen or shrink them into a different task than the one being measured.
      </p>
      <dl className="flex flex-wrap gap-x-10 gap-y-2">
        {/* A `<dl>` may group a pair in a `<div>`; a `<span>` breaks the structure that makes
            it a description list to a screen reader. */}
        <div>
          <dt className="type-label text-text-3">This window</dt>
          <dd className="type-data-m" data-testid="current-size">
            {size.width} × {size.height}
          </dd>
        </div>
        <div>
          <dt className="type-label text-text-3">Needed</dt>
          <dd className="type-data-m">
            {MIN_VIEWPORT_WIDTH} × {MIN_VIEWPORT_HEIGHT}
          </dd>
        </div>
      </dl>
      <p className="text-sm text-text-3">This page updates as you resize — no need to reload.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ SCR-051 */

function BrowserUnsupported() {
  return (
    <div className="flex flex-col gap-6" data-testid="gate-browser-unsupported">
      <header>
        <span className="type-label">Calibration</span>
        <h1 className="type-display-s">THIS BROWSER CANNOT LOCK THE POINTER</h1>
      </header>
      <p className="max-w-[62ch] text-text-2">
        A 360° turn needs more mouse movement than a screen has room for, so the test asks the
        browser for Pointer Lock — the same mechanism a game uses. This browser does not offer it,
        and without it the measurement would silently stop at the edge of the window.
      </p>
      <Panel title="What works">
        <p className="text-text-2">
          Current versions of Chrome, Edge, Firefox and Safari on a desktop all support it. If you
          are in a private or embedded window, try a normal one — some restrict Pointer Lock.
        </p>
      </Panel>
      <Link href="/" className="type-label underline">
        What SensLab measures
      </Link>
    </div>
  );
}
