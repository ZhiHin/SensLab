import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import importPlugin from "eslint-plugin-import";
import prettierConfig from "eslint-config-prettier";

/**
 * SensLab ESLint configuration.
 *
 * The interesting part of this file is not the style rules — it is the
 * architectural boundary enforcement required by docs/phase-0/18-system-architecture.md §18.5.
 * Documented architecture that is not machine-enforced decays; these zones are the mechanism.
 */

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  {
    plugins: { import: importPlugin },
    settings: {
      "import/resolver": {
        typescript: { project: "./tsconfig.json" },
      },
    },
    rules: {
      /* SENS-NFR-028 — no `any`, no silent escapes. */
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "no-console": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSEnumDeclaration",
          message: "Use a union of string literals or a const object instead of a TS enum.",
        },
      ],

      /* doc 18 §18.5 — module boundaries. */
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              // core/ is pure domain: it may not import anything else in src/.
              target: "./src/core",
              from: "./src",
              except: ["./core"],
              message:
                "core/ must stay pure (doc 18 §18.5). It may not import from any other src/ module — including game-adapters/.",
            },
            {
              // game-adapters/ may only reach the canonical sensitivity maths and shared types.
              target: "./src/game-adapters",
              from: "./src",
              except: ["./core/sensitivity", "./core/types", "./game-adapters"],
              message:
                "game-adapters/ may only import core/sensitivity and core/types (doc 12 §12.9).",
            },
            {
              // test-engine/ may use core/ but nothing else in src/.
              target: "./src/test-engine",
              from: "./src",
              except: ["./core", "./test-engine"],
              message: "test-engine/ may only import from core/ (doc 18 §18.2).",
            },
            {
              // All SQL lives in repositories/. Nothing else may reach the db layer.
              target: [
                "./src/app",
                "./src/components",
                "./src/features",
                "./src/services",
                "./src/core",
                "./src/game-adapters",
                "./src/test-engine",
                "./src/hooks",
                "./src/lib",
              ],
              from: "./src/db",
              message:
                "Database access belongs in repositories/ (doc 18 §18.2). Import a repository instead.",
            },
          ],
        },
      ],
    },
  },

  /* core/ and game-adapters/ are framework-free. */
  {
    files: ["src/core/**/*.ts", "src/game-adapters/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["react", "react-dom", "react/*"], message: "core/ is framework-free." },
            { group: ["next", "next/*"], message: "core/ is framework-free." },
            {
              group: ["drizzle-orm", "drizzle-orm/*", "postgres"],
              message: "core/ performs no I/O.",
            },
            {
              group: ["node:fs", "node:fs/*", "fs", "node:child_process"],
              message: "core/ performs no I/O.",
            },
          ],
        },
      ],
    },
  },

  /* test-engine/ must never re-render React and must never read wall-clock time. */
  {
    files: ["src/test-engine/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["react", "react-dom", "react/*"],
              message:
                "The test engine runs outside React (ADR-020). Only test-engine/mount.tsx may import React.",
            },
          ],
        },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "Date",
          property: "now",
          message: "SENS-NFR-006: engine timing must use performance.now().",
        },
      ],
    },
  },

  /* Scripts and tests are tooling: console output and devDependency imports are expected. */
  {
    files: ["scripts/**/*.ts", "tests/**/*.ts", "*.config.ts", "*.config.mts"],
    rules: {
      "no-console": "off",
      "import/no-restricted-paths": "off",
    },
  },

  prettierConfig,

  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "src/db/migrations/**",
    "next-env.d.ts",
    "docs/**",
  ]),
]);

export default eslintConfig;
