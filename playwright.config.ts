import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration (doc 29 §29.6).
 *
 * Phase 1 has smoke coverage only: the shell renders, the auth screens work and are
 * accessible by keyboard, the security headers are present, and the health endpoint reports
 * integrity. The calibration flows arrive with the screens they exercise.
 *
 * E2E is deliberately the smallest layer in the pyramid — it is the slowest and most brittle,
 * and the properties that actually matter in SensLab live in `core/` where they can be tested
 * deterministically.
 */
const isCi = process.env["CI"] === "true";

/**
 * The production origin. Overridable so a developer with another app on 3000 — which
 * `reuseExistingServer` would otherwise silently test against — can move this one aside.
 */
const PROD_PORT = Number(process.env["PLAYWRIGHT_PROD_PORT"] ?? 3000);
const PROD_URL = `http://localhost:${PROD_PORT}`;

/** The dev origin, used only by the `lab` project. */
const DEV_PORT = Number(process.env["PLAYWRIGHT_DEV_PORT"] ?? 3001);
const DEV_URL = `http://localhost:${DEV_PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  // Spread rather than assigning `undefined`: `exactOptionalPropertyTypes` distinguishes
  // "absent" from "explicitly undefined", and Playwright's default worker count is what we
  // want locally.
  ...(isCi ? { workers: 1 } : {}),
  reporter: isCi ? [["github"], ["html", { open: "never" }]] : "list",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: process.env["PLAYWRIGHT_BASE_URL"] ?? PROD_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  /*
   * Three projects, and the split is driven by one property of the engine rather than by
   * convenience: **a session pauses when its page loses focus**, because a session running in a
   * background tab is not measuring anything. Parallel browser pages compete for focus, so
   * anything that holds pointer lock has to run alone.
   *
   * So: everything that does not hold pointer lock runs in parallel first, then the locked
   * specs run one at a time, then the dev-only harness does the same.
   */
  projects: [
    {
      // One sign-in for the whole suite, saved as storage state. Signing in per test spends
      // the account's rate-limit budget (`SENS-SEC-011`) on setup rather than on testing.
      name: "setup",
      testMatch: /auth\.setup\.ts$/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      testIgnore: [/lab\..*\.spec\.ts$/, /\.locked\.spec\.ts$/, /auth\.setup\.ts$/],
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Shipping surfaces that hold pointer lock. Production build, one at a time.
      name: "locked",
      testMatch: /\.locked\.spec\.ts$/,
      dependencies: ["chromium"],
      fullyParallel: false,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // The engine harness is a development-only route: in the production build it 404s, which
      // the chromium project asserts. Driving it needs the dev server, so it gets its own
      // project pointed at a second origin — and, holding pointer lock, its own turn.
      name: "lab",
      testMatch: /lab\..*\.spec\.ts$/,
      dependencies: ["locked"],
      fullyParallel: false,
      use: { ...devices["Desktop Chrome"], baseURL: DEV_URL },
    },
  ],

  webServer: [
    {
      // Against the production build, not the dev server: the security headers, the CSP nonce
      // and the static/dynamic route split all differ in development.
      command: `npm run build && npm run start -- --port ${PROD_PORT}`,
      url: PROD_URL,
      reuseExistingServer: !isCi,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      // The dev server, purely so the engine harness route exists to be driven.
      command: `next dev --port ${DEV_PORT}`,
      url: DEV_URL,
      reuseExistingServer: !isCi,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
