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

describe("the test engine's React boundary — ADR-020, doc 19 §19.11", () => {
  const engineFiles = sourceFiles.filter((file) => file.path.startsWith("src/test-engine/"));

  it("has exactly one React-aware file", () => {
    const reactAware = engineFiles.filter((file) =>
      importSpecifiers(file.content).some(
        (specifier) => specifier === "react" || specifier.startsWith("react/"),
      ),
    );
    expect(reactAware.map((file) => file.path)).toEqual(["src/test-engine/mount.tsx"]);
  });

  it("keeps the framework out of the engine entirely", () => {
    // A `next/*` import would tie the engine to a rendering framework and to a build. The
    // engine has to be runnable from a plain Vitest process with no bundler at all, which is
    // what makes the deterministic harness possible.
    const offenders = engineFiles.flatMap((file) =>
      importSpecifiers(file.content)
        .filter((specifier) => specifier === "next" || specifier.startsWith("next/"))
        .map((specifier) => `${file.path} -> ${specifier}`),
    );
    expect(offenders).toEqual([]);
  });

  it("touches the DOM only where the DOM is the subject", () => {
    // Pointer lock, the canvas renderer and the React mount are the three files that may know
    // a browser exists. Anywhere else, a `document` reference would mean the measurement
    // pipeline had grown a dependency on the page it happens to be drawn on.
    const allowed = new Set([
      "src/test-engine/input/pointer-lock.ts",
      "src/test-engine/render/renderer.ts",
      "src/test-engine/timing/clock.ts",
      "src/test-engine/mount.tsx",
    ]);

    const offenders = engineFiles
      .filter((file) => !allowed.has(file.path))
      .filter((file) =>
        /\b(document|window|navigator)\.|\brequestAnimationFrame\b|\bperformance\.now\b/.test(
          stripComments(file.content),
        ),
      )
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });
});

describe("a test is data, not code — doc 19 §19.9", () => {
  const definitionFiles = sourceFiles.filter(
    (file) => file.path.startsWith("src/test-engine/tests/") && !file.path.endsWith("index.ts"),
  );

  it("has a definition file for every MVP test", () => {
    expect(definitionFiles.length).toBeGreaterThanOrEqual(7);
  });

  it("never lets a definition reach into the lifecycle it is run by", () => {
    // The claim doc 19 §19.9 makes is that spawning, timing, validity and buffering are engine
    // responsibilities, so adding a test is a new declaration rather than an edit to lifecycle
    // code. A definition that imported the trial manager or the camera could quietly take one
    // of those responsibilities back, and the claim would stop being true without anything
    // failing.
    const forbidden = [
      "trial-manager",
      "round-runner",
      "session-controller",
      "engine",
      "render/camera",
      "render/renderer",
      "telemetry/",
      "timing/",
      "input/",
    ];

    const offenders = definitionFiles.flatMap((file) =>
      importSpecifiers(file.content)
        .filter((specifier) => forbidden.some((fragment) => specifier.includes(fragment)))
        .map((specifier) => `${file.path} -> ${specifier}`),
    );

    expect(offenders).toEqual([]);
  });

  it("keeps player-facing copy out of the definitions", () => {
    // Definitions carry i18n keys. A literal sentence here would be a string the Chinese build
    // cannot translate, and it would live in the one layer that is meant to be pure data.
    const offenders: string[] = [];
    for (const file of definitionFiles) {
      const body = stripComments(file.content);
      for (const match of body.matchAll(/(instructionsKey|displayNameKey):\s*"([^"]*)"/g)) {
        const value = match[2] ?? "";
        if (!/^test\.[a-z0-9]+\.[A-Za-z]+$/.test(value)) {
          offenders.push(`${file.path}: ${match[1]} = "${value}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("metric derivations stay pure — doc 10", () => {
  const metricFiles = sourceFiles.filter((file) =>
    file.path.startsWith("src/test-engine/metrics/"),
  );

  it("has derivation modules to check", () => {
    expect(metricFiles.length).toBeGreaterThanOrEqual(6);
  });

  it("reads the trial and nothing else", () => {
    // A derivation is a pure function of a trial's observations. Reaching for the clock or the
    // camera would let a metric depend on when it happened to be computed, which would make
    // the same trial produce different numbers on re-analysis.
    const offenders = metricFiles.flatMap((file) =>
      importSpecifiers(file.content)
        .filter((specifier) =>
          /timing\/|render\/camera|session-controller|round-runner/.test(specifier),
        )
        .map((specifier) => `${file.path} -> ${specifier}`),
    );
    expect(offenders).toEqual([]);
  });
});

describe("the lab harness never reaches production", () => {
  it("guards the lab route group server-side", () => {
    const layout = sourceFiles.find((file) => file.path === "src/app/(lab)/layout.tsx");
    expect(layout, "the (lab) route group must have a layout that guards it").toBeDefined();

    const body = stripComments(layout?.content ?? "");
    // A hidden link is not a guard: the route must 404 before any client code is sent.
    expect(body).toContain('process.env.NODE_ENV === "production"');
    expect(body).toContain("notFound()");
  });

  it("is imported only from the lab route group", () => {
    const offenders = sourceFiles
      .filter(
        (file) =>
          !file.path.startsWith("src/app/(lab)/") && !file.path.startsWith("src/features/lab/"),
      )
      .flatMap((file) =>
        importSpecifiers(file.content)
          .filter((specifier) => specifier.includes("features/lab"))
          .map((specifier) => `${file.path} -> ${specifier}`),
      );
    expect(offenders).toEqual([]);
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
