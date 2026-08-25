import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The design system as an enforced contract (doc 26).
 *
 * These catch the class of defect a screenshot review finds late and a type checker never
 * finds at all: a class used across the application that the stylesheet does not define, or a
 * component style that silently beats the utility meant to override it. Both render as
 * *something*, which is exactly why they survive.
 *
 * Two of these were written after finding the defect they describe (§4 of the Phase 10
 * report), which is the only reason to trust that they would catch it again.
 */

const CSS = readFileSync("src/app/globals.css", "utf8");

function sourceFiles(directory: string, extension: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path, extension);
    return path.endsWith(extension) ? [path] : [];
  });
}

const TSX = sourceFiles("src", ".tsx").map((path) => ({
  path: path.replaceAll("\\", "/"),
  content: readFileSync(path, "utf8"),
}));

describe("the type scale — doc 26 §26.4", () => {
  it("defines every `type-*` class the application uses", () => {
    const used = new Set<string>();
    for (const file of TSX) {
      for (const match of file.content.matchAll(/\btype-[a-z-]+\b/g)) used.add(match[0]);
    }
    expect(used.size).toBeGreaterThan(4);

    const missing = [...used].filter((name) => !CSS.includes(`.${name} {`));
    expect(missing).toEqual([]);
  });

  it("keeps the type styles in a layer so a utility can still set the colour", () => {
    // `.type-label { color: … }` outside a layer beats every Tailwind colour utility on source
    // order, so `type-label text-text-1` rendered as `text-3` everywhere it appeared. The
    // layer is what makes the two composable.
    const layerStart = CSS.indexOf("@layer components {");
    expect(layerStart).toBeGreaterThan(-1);
    expect(CSS.indexOf(".type-label {")).toBeGreaterThan(layerStart);
  });

  it("marks every measured value with tabular numerals — SENS-UX-007", () => {
    for (const name of ["type-data-l", "type-data-m", "type-data-s"]) {
      const start = CSS.indexOf(`.${name} {`);
      expect(CSS.slice(start, CSS.indexOf("}", start))).toContain("tabular-nums");
    }
  });
});

describe("the palette — doc 26 §26.3", () => {
  it("defines every colour token the design system names", () => {
    for (const token of [
      "--color-void",
      "--color-surface",
      "--color-surface-2",
      "--color-hairline",
      "--color-hairline-strong",
      "--color-text-1",
      "--color-text-2",
      "--color-text-3",
      "--color-accent",
      "--color-accent-dim",
      "--color-result",
      "--color-critical",
      "--color-caution",
    ]) {
      expect(CSS).toContain(`${token}:`);
    }
  });

  it("keeps Filament for the recommendation alone — SENS-UX-003", () => {
    // The accent may appear anywhere; the result colour may not. Its scarcity is what makes
    // the reveal land, and a `text-result` on a button or a chart series would spend it.
    //
    // The allowlist is the set of surfaces that display a *recommendation*: the results page
    // and the fine-tune reveal, which shows a refined one. It is written out rather than
    // inferred from a path so that adding a third place is a decision someone makes here.
    const allowed = new Set([
      "src/features/results/results-view.tsx",
      "src/features/fine-tune/fine-tune-result.tsx",
    ]);
    const offenders = TSX.filter((file) => file.content.includes("text-result"))
      .filter((file) => !allowed.has(file.path))
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it("has no shadow utilities — depth is value steps and hairlines, doc 26 §26.6", () => {
    const offenders = TSX.filter((file) =>
      /className="[^"]*\bshadow-(?!none)/.test(file.content),
    ).map((file) => file.path);
    expect(offenders).toEqual([]);
  });
});

describe("motion — FR-101, SENS-UX-023", () => {
  it("honours the OS preference and the in-product override in both directions", () => {
    expect(CSS).toContain("@media (prefers-reduced-motion: reduce)");
    // "full" opts back in even when the OS asks for less; "reduced" opts out even when it does
    // not. Both directions are the point of the setting existing at all.
    expect(CSS).toContain('html:not([data-motion="full"])');
    expect(CSS).toContain('html[data-motion="reduced"]');
  });

  it("keeps the lab free of decoration — SENS-BR-021", () => {
    const labBlock = CSS.slice(CSS.indexOf('[data-surface="lab"]'));
    expect(labBlock).toContain("transition: none !important");
    expect(labBlock).toContain("animation: none !important");
  });
});

describe("the custom scrollbar — SENS-UX-012, FR-102", () => {
  it("styles the native scrollbar rather than replacing scrolling", () => {
    expect(CSS).toContain("::-webkit-scrollbar");
    expect(CSS).toContain("scrollbar-width");
    // A JavaScript scroll hijack is what FR-102 forbids; nothing in the app may listen for
    // wheel events to move the page itself.
    const hijackers = TSX.filter((file) => /addEventListener\(\s*"wheel"/.test(file.content)).map(
      (file) => file.path,
    );
    expect(hijackers).toEqual([]);
  });
});
