"use client";

import { useState } from "react";

/**
 * A copy control (FR-081).
 *
 * Writes exactly the value it is given, never a formatted variant: a player pastes this into a
 * game's settings field, and a thousands separator or a unit suffix there is a wrong number.
 */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), 1600);
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="border border-hairline px-3 py-1 type-label hover:border-text-3"
      aria-label={`Copy ${label}`}
      data-testid={`copy-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}
    </button>
  );
}
