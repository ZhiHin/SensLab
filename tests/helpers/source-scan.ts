import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * A small source scanner shared by the architecture tests and the CI boundary check.
 *
 * Architecture that is only documented decays. Docs 18 §18.5 and 12 §12.1 name specific
 * boundaries and specific mechanisms for enforcing them; this is one of those mechanisms.
 * It reads source text rather than building an AST because the rules are about *imports and
 * literals*, and a regex over import statements is both sufficient and impossible to
 * misconfigure silently.
 */

export const REPO_ROOT = new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

export interface SourceFile {
  /** Path relative to the repository root, with forward slashes. */
  readonly path: string;
  readonly absolutePath: string;
  readonly content: string;
}

export function listSourceFiles(directory: string, extensions = [".ts", ".tsx"]): SourceFile[] {
  const absoluteRoot = join(REPO_ROOT, directory);
  const out: SourceFile[] = [];

  const walk = (current: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry);
      const stats = statSync(full);
      if (stats.isDirectory()) {
        if (entry === "node_modules" || entry === "migrations" || entry.startsWith(".")) continue;
        walk(full);
        continue;
      }
      if (!extensions.some((extension) => entry.endsWith(extension))) continue;
      out.push({
        path: relative(REPO_ROOT, full).split(sep).join("/"),
        absolutePath: full,
        content: readFileSync(full, "utf8"),
      });
    }
  };

  walk(absoluteRoot);
  return out;
}

/**
 * Removes comments while preserving string and template literals.
 *
 * Necessary because the rules below are about *code*, not prose. This file's own
 * documentation names the very things it forbids ("Math.random()", "NEXT_PUBLIC_", game
 * names), and so does much of the codebase — a scanner that cannot tell a rule from a
 * mention of a rule is a scanner nobody will keep.
 *
 * Character-by-character rather than by regex, because a regex cannot distinguish `//` in a
 * comment from `//` inside "https://example.com".
 */
export function stripComments(content: string): string {
  let out = "";
  let index = 0;
  const length = content.length;

  while (index < length) {
    const char = content[index] as string;
    const next = content[index + 1];

    // Line comment.
    if (char === "/" && next === "/") {
      while (index < length && content[index] !== "\n") index += 1;
      continue;
    }

    // Block comment.
    if (char === "/" && next === "*") {
      index += 2;
      while (index < length && !(content[index] === "*" && content[index + 1] === "/")) {
        // Preserve newlines so line numbers stay usable in any future reporting.
        if (content[index] === "\n") out += "\n";
        index += 1;
      }
      index += 2;
      continue;
    }

    // String or template literal: copy verbatim, honouring escapes.
    if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      out += char;
      index += 1;
      while (index < length) {
        const current = content[index] as string;
        out += current;
        if (current === "\\") {
          const escaped = content[index + 1];
          if (escaped !== undefined) out += escaped;
          index += 2;
          continue;
        }
        index += 1;
        if (current === quote) break;
      }
      continue;
    }

    out += char;
    index += 1;
  }

  return out;
}

/** Import specifiers in a file: static imports, type imports, re-exports and dynamic imports. */
export function importSpecifiers(content: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /(?:^|\n)\s*import\s+[^;]*?from\s*["']([^"']+)["']/g,
    /(?:^|\n)\s*import\s*["']([^"']+)["']/g,
    /(?:^|\n)\s*export\s+[^;]*?from\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(content);
    while (match !== null) {
      const specifier = match[1];
      if (specifier !== undefined) specifiers.push(specifier);
      match = pattern.exec(content);
    }
  }
  return specifiers;
}

export interface Violation {
  readonly rule: string;
  readonly file: string;
  readonly detail: string;
}

/** Resolves a relative specifier against the importing file, to a repo-relative path. */
function resolveRelative(fromFile: string, specifier: string): string {
  const segments = fromFile.split("/").slice(0, -1);
  for (const part of specifier.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  return segments.join("/");
}

/** Normalises an import specifier to a repo-relative path when it points inside `src/`. */
export function resolveInternalTarget(file: SourceFile, specifier: string): string | null {
  if (specifier.startsWith("@/")) return `src/${specifier.slice(2)}`;
  if (specifier.startsWith(".")) {
    const resolved = resolveRelative(file.path, specifier);
    return resolved.startsWith("src/") ? resolved : null;
  }
  return null;
}

/* ------------------------------------------------------------------ the rules */

interface ZoneRule {
  readonly name: string;
  /** Files this rule applies to. */
  readonly appliesTo: (path: string) => boolean;
  /** Returns a violation detail when the import is forbidden, or null when it is fine. */
  readonly check: (
    file: SourceFile,
    specifier: string,
    internalTarget: string | null,
  ) => string | null;
}

const FRAMEWORK_PACKAGES = ["react", "react-dom", "next", "drizzle-orm", "postgres", "server-only"];

const isFrameworkImport = (specifier: string): boolean =>
  FRAMEWORK_PACKAGES.some((pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`));

const ZONE_RULES: readonly ZoneRule[] = [
  {
    name: "core-is-pure",
    appliesTo: (path) => path.startsWith("src/core/"),
    check: (_file, specifier, target) => {
      if (target !== null && !target.startsWith("src/core/")) {
        return `core/ may not import "${specifier}" (doc 18 §18.5)`;
      }
      if (isFrameworkImport(specifier)) {
        return `core/ is framework-free and may not import "${specifier}" (ADR-018)`;
      }
      return null;
    },
  },
  {
    name: "core-never-imports-game-adapters",
    appliesTo: (path) => path.startsWith("src/core/"),
    check: (_file, specifier, target) =>
      target?.startsWith("src/game-adapters/") === true || specifier.includes("game-adapters")
        ? `core/ must never learn that a game exists (doc 12 §12.1)`
        : null,
  },
  {
    name: "game-adapters-limited-surface",
    appliesTo: (path) => path.startsWith("src/game-adapters/"),
    check: (_file, specifier, target) => {
      if (target === null) {
        if (specifier === "zod" || specifier.startsWith("zod/")) return null;
        if (isFrameworkImport(specifier)) {
          return `game-adapters/ may not import "${specifier}" (doc 12 §12.9)`;
        }
        return null;
      }
      const allowed =
        target.startsWith("src/core/sensitivity") ||
        target.startsWith("src/core/types") ||
        target.startsWith("src/game-adapters/");
      return allowed
        ? null
        : `game-adapters/ may only import core/sensitivity and core/types, not "${specifier}"`;
    },
  },
  {
    name: "test-engine-has-no-react",
    appliesTo: (path) => path.startsWith("src/test-engine/") && !path.endsWith("mount.tsx"),
    check: (_file, specifier) =>
      specifier === "react" || specifier.startsWith("react/") || specifier === "react-dom"
        ? `the test engine runs outside React (ADR-020); only mount.tsx may import it`
        : null,
  },
  {
    name: "test-engine-imports-only-core",
    appliesTo: (path) => path.startsWith("src/test-engine/"),
    check: (_file, specifier, target) =>
      target !== null && !target.startsWith("src/core/") && !target.startsWith("src/test-engine/")
        ? `test-engine/ may only import from core/, not "${specifier}" (doc 18 §18.2)`
        : null,
  },
  {
    name: "sql-only-in-repositories",
    appliesTo: (path) =>
      path.startsWith("src/") &&
      !path.startsWith("src/db/") &&
      !path.startsWith("src/repositories/"),
    check: (_file, specifier, target) =>
      target?.startsWith("src/db/") === true
        ? `database access belongs in repositories/, not via "${specifier}" (doc 18 §18.2)`
        : null,
  },
];

export function findBoundaryViolations(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];

  for (const file of files) {
    const specifiers = importSpecifiers(stripComments(file.content));
    for (const rule of ZONE_RULES) {
      if (!rule.appliesTo(file.path)) continue;
      for (const specifier of specifiers) {
        const target = resolveInternalTarget(file, specifier);
        const detail = rule.check(file, specifier, target);
        if (detail !== null) violations.push({ rule: rule.name, file: file.path, detail });
      }
    }
  }

  return violations;
}

/**
 * Game names and sensitivity constants may appear only in `game-adapters/` and in seed data.
 *
 * The allowlist is deliberately tiny. A game name leaking into `core/` or into a component is
 * how "adding a game touches no engine code" quietly stops being true.
 */
const GAME_TERMS = [
  "counter-strike",
  "csgo",
  "cs2",
  "apex-legends",
  "apex legends",
  "pubg",
  "delta-force",
  "delta force",
  "三角洲",
  "valorant",
  "overwatch",
  "m_yaw",
  "yaw_constant",
  "yawconstant",
];

const GAME_TERM_ALLOWLIST = [
  "src/game-adapters/",
  "src/db/seed/",
  "src/app/(marketing)/",
  "src/app/(app)/",
];

export function findGameTermLeaks(files: readonly SourceFile[]): Violation[] {
  const violations: Violation[] = [];

  for (const file of files) {
    if (!file.path.startsWith("src/")) continue;
    if (GAME_TERM_ALLOWLIST.some((prefix) => file.path.startsWith(prefix))) continue;

    const lower = stripComments(file.content).toLowerCase();
    for (const term of GAME_TERMS) {
      if (lower.includes(term)) {
        violations.push({
          rule: "no-game-terms-outside-adapters",
          file: file.path,
          detail: `mentions "${term}"; game specifics belong in game-adapters/ (doc 12 §12.1)`,
        });
      }
    }
  }

  return violations;
}

/** `Math.random()` is never used in the domain: every draw must be seeded (`SENS-BR-031`). */
export function findUnseededRandomness(files: readonly SourceFile[]): Violation[] {
  return files
    .filter(
      (file) =>
        file.path.startsWith("src/") && stripComments(file.content).includes("Math.random("),
    )
    .map((file) => ({
      rule: "no-unseeded-randomness",
      file: file.path,
      detail: "Math.random() breaks reproducibility; use core/random deriveRng (SENS-BR-031)",
    }));
}

/** The engine's clock is `performance.now()`, never wall time (`SENS-NFR-006`). */
export function findWallClockInEngine(files: readonly SourceFile[]): Violation[] {
  return files
    .filter(
      (file) =>
        file.path.startsWith("src/test-engine/") &&
        stripComments(file.content).includes("Date.now("),
    )
    .map((file) => ({
      rule: "engine-uses-monotonic-clock",
      file: file.path,
      detail: "the engine must time with performance.now() (SENS-NFR-006)",
    }));
}

export function collectAllViolations(): Violation[] {
  const files = listSourceFiles("src");
  return [
    ...findBoundaryViolations(files),
    ...findGameTermLeaks(files),
    ...findUnseededRandomness(files),
    ...findWallClockInEngine(files),
  ];
}
