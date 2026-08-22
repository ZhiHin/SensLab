import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const srcAlias = fileURLToPath(new URL("./src", import.meta.url));
const testsAlias = fileURLToPath(new URL("./tests", import.meta.url));
const serverOnlyShim = fileURLToPath(
  new URL("./tests/helpers/server-only-shim.ts", import.meta.url),
);

/**
 * Three separate projects, because they have genuinely different requirements
 * (doc 29 §29.1):
 *
 *  - unit         : pure `core/` and `game-adapters/` logic. Fast, no I/O, coverage-gated.
 *  - architecture : structural checks over the source tree. No I/O beyond reading files.
 *  - integration  : requires a real PostgreSQL instance. Excluded from the default `test` run.
 */
export default defineConfig({
  resolve: {
    alias: { "@": srcAlias, "@tests": testsAlias, "server-only": serverOnlyShim },
  },
  test: {
    projects: [
      {
        resolve: { alias: { "@": srcAlias, "@tests": testsAlias, "server-only": serverOnlyShim } },
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        resolve: { alias: { "@": srcAlias, "@tests": testsAlias, "server-only": serverOnlyShim } },
        test: {
          name: "architecture",
          include: ["tests/architecture/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        resolve: { alias: { "@": srcAlias, "@tests": testsAlias, "server-only": serverOnlyShim } },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/helpers/global-setup.ts"],
          hookTimeout: 60_000,
          testTimeout: 30_000,
          // Integration tests share one database; running them in parallel would interleave
          // transactions across files.
          fileParallelism: false,
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["src/core/**/*.ts", "src/game-adapters/**/*.ts", "src/test-engine/**/*.ts"],
      exclude: [
        "**/*.d.ts",
        "**/index.ts",
        "**/contracts.ts",
        "**/*.types.ts",
        // mount.tsx is the React boundary: it needs a real DOM, and the Playwright harness
        // covers it. Nothing below it is exempt.
        "src/test-engine/mount.tsx",
      ],
      // doc 02 §2.7 / doc 34 exit criteria: >= 90% branch coverage on the pure domain.
      thresholds: {
        branches: 90,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
  },
});
