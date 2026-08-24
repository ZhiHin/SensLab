import { readFileSync } from "node:fs";
import { expect, test as setup } from "@playwright/test";
import { AUTH_STATE } from "./auth-state";

/**
 * Signs the fixture account in once and saves the session for every spec that needs it.
 *
 * Sign-in is deliberately rate limited per IP and per account (`SENS-SEC-011`), and a suite
 * that signs in per test spends that budget on setup rather than on what it is testing. One
 * sign-in, reused, keeps the limiter's real behaviour untouched — the integration suite is
 * where it is asserted — while leaving the browser suite free to grow.
 */

interface Fixtures {
  readonly email: string;
  readonly password: string;
}

setup("authenticate the fixture account", async ({ page }) => {
  const { email, password } = JSON.parse(
    readFileSync("test-results/e2e-fixtures.json", "utf8"),
  ) as Fixtures;

  await page.goto("/auth/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/sign-in"));
  await expect(page.locator("body")).toBeVisible();

  await page.context().storageState({ path: AUTH_STATE });
});
