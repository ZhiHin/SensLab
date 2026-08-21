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
  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: process.env["PLAYWRIGHT_BASE_URL"] ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    // Against the production build, not the dev server: the security headers, the CSP nonce
    // and the static/dynamic route split all differ in development.
    command: "npm run build && npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: !isCi,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
