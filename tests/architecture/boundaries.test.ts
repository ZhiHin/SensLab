import { describe, expect, it } from "vitest";
import {
  findBoundaryViolations,
  findGameTermLeaks,
  findUnseededRandomness,
  findWallClockInEngine,
  importSpecifiers,
  listSourceFiles,
  resolveInternalTarget,
  stripComments,
} from "@tests/helpers/source-scan";

/**
 * Architecture tests (doc 18 §18.5).
 *
 * These are the mechanism behind the claim that SensLab's module boundaries are enforced
 * rather than merely documented. Each one corresponds to a specific rule in Phase 0, and each
 * failure message says which.
 */

const sourceFiles = listSourceFiles("src");

const format = (violations: readonly { file: string; detail: string }[]): string =>
  violations.map((v) => `  ${v.file}: ${v.detail}`).join("\n");

describe("module boundaries", () => {
  it("finds source files to check", () => {
    expect(sourceFiles.length).toBeGreaterThan(30);
  });

  it("keeps core/ pure and free of every other module", () => {
    const violations = findBoundaryViolations(sourceFiles).filter((v) => v.rule === "core-is-pure");
    expect(violations, `\n${format(violations)}`).toEqual([]);
  });

  it("never lets core/ learn that a game exists — doc 12 §12.1", () => {
    const violations = findBoundaryViolations(sourceFiles).filter(
      (v) => v.rule === "core-never-imports-game-adapters",
    );
    expect(violations, `\n${format(violations)}`).toEqual([]);
  });

  it("limits game-adapters/ to core/sensitivity, core/types and zod", () => {
    const violations = findBoundaryViolations(sourceFiles).filter(
      (v) => v.rule === "game-adapters-limited-surface",
    );
    expect(violations, `\n${format(violations)}`).toEqual([]);
  });

  it("keeps React out of the test engine — ADR-020", () => {
    const violations = findBoundaryViolations(sourceFiles).filter(
      (v) => v.rule === "test-engine-has-no-react",
    );
    expect(violations, `\n${format(violations)}`).toEqual([]);
  });

  it("lets the test engine import only core/", () => {
    const violations = findBoundaryViolations(sourceFiles).filter(
      (v) => v.rule === "test-engine-imports-only-core",
    );
    expect(violations, `\n${format(violations)}`).toEqual([]);
  });

  it("keeps database access inside repositories/", () => {
    const violations = findBoundaryViolations(sourceFiles).filter(
      (v) => v.rule === "sql-only-in-repositories",
    );
    expect(violations, `\n${format(violations)}`).toEqual([]);
  });
});

describe("game specifics stay in the adapter layer", () => {
  it("mentions no game name or yaw constant outside game-adapters/ and seed data", () => {
    const violations = findGameTermLeaks(sourceFiles);
    expect(violations, `\n${format(violations)}`).toEqual([]);
  });

  it("proves the check works by catching a planted violation in code", () => {
    const planted = findGameTermLeaks([
      {
        path: "src/core/scoring/leak.ts",
        absolutePath: "",
        content: 'const yawConstant = 0.022;\nconst game = "csgo";',
      },
    ]);
    expect(planted).toHaveLength(2);
  });

  it("does not flag a game name that only appears in prose", () => {
    // The rule is about game-specific *code*, not about being unable to discuss a game in a
    // comment. Without this distinction the check would be disabled within a month.
    const documented = findGameTermLeaks([
      {
        path: "src/core/scoring/documented.ts",
        absolutePath: "",
        content: "// PUBG may need a table model.\nexport const x = 1;",
      },
    ]);
    expect(documented).toEqual([]);
  });
});

describe("determinism", () => {
  it("uses no Math.random() anywhere in src/ — SENS-BR-031", () => {
    const violations = findUnseededRandomness(sourceFiles);
    expect(violations, `\n${format(violations)}`).toEqual([]);
  });

  it("times the engine with performance.now(), never wall time — SENS-NFR-006", () => {
    const violations = findWallClockInEngine(sourceFiles);
    expect(violations, `\n${format(violations)}`).toEqual([]);
  });
});

describe("test fixtures never reach production code", () => {
  it("keeps the fixture adapter out of src/", () => {
    const offenders = sourceFiles.filter((file) =>
      importSpecifiers(file.content).some((specifier) => specifier.includes("fixture-adapter")),
    );
    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  it("imports nothing from tests/ inside src/ — SENS-NFR-031", () => {
    const offenders = sourceFiles.flatMap((file) =>
      importSpecifiers(file.content)
        .filter((specifier) => specifier.startsWith("@tests/") || specifier.includes("/tests/"))
        .map((specifier) => `${file.path} -> ${specifier}`),
    );
    expect(offenders).toEqual([]);
  });
});

describe("repository layer takes an actor", () => {
  const repoFiles = sourceFiles.filter(
    (file) =>
      file.path.startsWith("src/repositories/") &&
      !file.path.endsWith("actor.ts") &&
      !file.path.endsWith("transaction.ts") &&
      !file.path.endsWith("index.ts"),
  );

  it("has repository modules to check", () => {
    expect(repoFiles.length).toBeGreaterThanOrEqual(5);
  });

  /**
   * Repositories that touch an owned resource must take an `Actor`.
   *
   * Reference-data repositories (games, algorithm versions) legitimately do not — nobody owns
   * a game — so the assertion is that every module handling owned data references the actor
   * type at all, which is what forces ownership into the SQL rather than into a caller's
   * good intentions (`SENS-BR-034`).
   */
  const OWNED_RESOURCE_REPOS = [
    "src/repositories/hardware-repo.ts",
    "src/repositories/session-repo.ts",
    "src/repositories/user-repo.ts",
  ];

  it.each(OWNED_RESOURCE_REPOS)("%s enforces ownership through an Actor", (path) => {
    const file = sourceFiles.find((candidate) => candidate.path === path);
    expect(file, `${path} not found`).toBeDefined();
    expect(file?.content).toMatch(/\bActor\b/);
  });

  it("filters owned reads by an ownership predicate, not by a caller-supplied id", () => {
    const hardware = sourceFiles.find((f) => f.path === "src/repositories/hardware-repo.ts");
    const sessions = sourceFiles.find((f) => f.path === "src/repositories/session-repo.ts");
    expect(hardware?.content).toContain("ownershipPredicate");
    expect(sessions?.content).toContain("ownershipPredicate");
  });
});

describe("secrets never reach the client", () => {
  it("declares no NEXT_PUBLIC_ variable that looks like a secret — SENS-SEC-014", () => {
    const offenders = sourceFiles.flatMap((file) => {
      const matches = file.content.match(/NEXT_PUBLIC_[A-Z0-9_]+/g) ?? [];
      return matches
        .filter((name) => /(SECRET|TOKEN|KEY|PASSWORD|SALT|CREDENTIAL)/.test(name))
        .map((name) => `${file.path}: ${name}`);
    });
    expect(offenders).toEqual([]);
  });

  it("keeps the environment schema server-only", () => {
    const env = sourceFiles.find((file) => file.path === "src/lib/env.ts");
    expect(stripComments(env?.content ?? "")).not.toMatch(/NEXT_PUBLIC_/);
    expect(env?.content).toContain('typeof window !== "undefined"');
  });
});

describe("import scanning itself", () => {
  it("recognises static, type, side-effect, re-export and dynamic imports", () => {
    const specifiers = importSpecifiers(
      [
        `import a from "one";`,
        `import type { B } from "two";`,
        `import "three";`,
        `export { c } from "four";`,
        `const d = await import("five");`,
      ].join("\n"),
    );
    expect(specifiers.sort()).toEqual(["five", "four", "one", "three", "two"]);
  });

  it("resolves alias and relative specifiers to repo-relative paths", () => {
    const file = { path: "src/core/scoring/x.ts", absolutePath: "", content: "" };
    expect(resolveInternalTarget(file, "@/lib/env")).toBe("src/lib/env");
    expect(resolveInternalTarget(file, "../types/brand")).toBe("src/core/types/brand");
    expect(resolveInternalTarget(file, "./contracts")).toBe("src/core/scoring/contracts");
    expect(resolveInternalTarget(file, "zod")).toBeNull();
  });
});
