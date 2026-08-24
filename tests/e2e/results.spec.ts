import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { AUTH_STATE } from "./auth-state";

/**
 * Phase 7 end-to-end: the results experience in a browser.
 *
 * The recommendations were produced by the real loop in global setup (pinned seeds, known
 * verdicts). What a browser can prove that the unit suites cannot: the page renders the right
 * layout for each verdict, the chart and the Aim DNA are present and described, nothing shows a
 * number for an unverified game, copy controls copy exactly, and a stranger gets a 404.
 */

interface Fixtures {
  readonly email: string;
  readonly password: string;
  readonly recommendations: { readonly peak_found?: string; readonly indistinguishable?: string };
}

const fixtures = JSON.parse(readFileSync("test-results/e2e-fixtures.json", "utf8")) as Fixtures;

/** Signed in once by the setup project; the ownership spec opts out below. */
test.use({ storageState: AUTH_STATE });

test.describe("a peak_found result", () => {
  test("leads with the number, both ranges, the confidence index and the profile", async ({
    page,
  }) => {
    await page.goto(`/results/${fixtures.recommendations.peak_found}`);

    await expect(page.getByTestId("hero-peak")).toBeVisible();
    await expect(page.getByTestId("recommended-cm")).toHaveText(/^\d+\.\d$/);
    await expect(page.getByText("High-performance range", { exact: true })).toBeVisible();
    await expect(page.getByText("Comfort range", { exact: true })).toBeVisible();
    await expect(page.getByText("Confidence index", { exact: true })).toBeVisible();
    await expect(page.getByTestId("relative-statement")).toContainText(/You were at \d+/);

    // The evidence chart and the profile shape are both rendered as accessible SVG.
    await expect(page.getByTestId("response-curve")).toBeVisible();
    await expect(page.getByTestId("fit-curve")).toBeVisible();
    await expect(page.getByTestId("peak-marker")).toBeVisible();
    await expect(page.getByTestId("current-sens")).toBeVisible();
    await expect(page.locator('[data-testid="candidate-dot"]').first()).toBeVisible();
    await expect(page.getByTestId("aim-dna")).toBeVisible();
    await expect(page.getByTestId("provisional-label")).toBeVisible();

    // The profile is explained with measured values, not a personality label.
    await expect(page.getByTestId("profile-explanation")).toContainText(/\(\d+\)/);
    await expect(page.getByTestId("algorithm-versions")).toContainText("scoring_model_v2");
  });

  test("explains the confidence index as a diagnostic, never a probability", async ({ page }) => {
    await page.goto(`/results/${fixtures.recommendations.peak_found}`);

    await page.getByTestId("confidence-breakdown").locator("summary").click();
    for (const key of ["peak", "sample", "consistency", "environment", "drift", "fit", "anchor"]) {
      await expect(page.getByTestId(`confidence-${key}`)).toBeVisible();
    }
    // Quick mode skips the anchor re-test; the breakdown says so rather than scoring it.
    await expect(page.getByTestId("confidence-anchor")).toContainText(/not measured/i);
    const text = (await page.locator("main").innerText()).toLowerCase();
    expect(text).not.toMatch(/\d+% (chance|probability)/);
  });
});

test.describe("an indistinguishable result", () => {
  test("leads with the comfort range and no point value, and does not look like an error", async ({
    page,
  }) => {
    await page.goto(`/results/${fixtures.recommendations.indistinguishable}`);

    await expect(page.getByTestId("hero-indistinguishable")).toBeVisible();
    await expect(page.getByTestId("comfort-range")).toHaveText(/^\d+\.\d — \d+\.\d$/);
    await expect(page.getByTestId("recommended-cm")).toHaveCount(0);
    await expect(page.getByText("No single sensitivity won")).toBeVisible();
    await expect(page.getByText("What you can do")).toBeVisible();
    // Not an error: no critical styling anywhere in the hero, and the word never appears.
    await expect(page.locator("[data-testid=hero-indistinguishable] .text-critical")).toHaveCount(
      0,
    );
    expect(
      (await page.getByTestId("hero-indistinguishable").innerText()).toLowerCase(),
    ).not.toMatch(/something went wrong|try again|error:/);

    // The curve is still the evidence — flat, and shown.
    await expect(page.getByTestId("response-curve")).toBeVisible();
    await expect(page.getByTestId("peak-marker")).toHaveCount(0);

    // And the index is capped with the reason stated.
    await page.getByTestId("confidence-breakdown").locator("summary").click();
    await expect(page.getByTestId("verdict-cap-note")).toBeVisible();
  });
});

test.describe("game settings from a result", () => {
  test("switches games without re-running anything and never shows an unverified number", async ({
    page,
  }) => {
    await page.goto(`/results/${fixtures.recommendations.peak_found}`);
    await page.getByTestId("see-settings").click();
    await expect(page).toHaveURL(/\/settings$/);

    await expect(page.getByTestId("settings-target-cm")).toHaveText(/^\d+\.\d$/);
    await page.getByTestId("switch-cs2").click();
    await expect(page).toHaveURL(/game=cs2/);
    await expect(page.getByText("No number, on purpose")).toBeVisible();
    await expect(page.locator('[data-testid="emitted-settings"]')).toHaveCount(0);

    // Every launch game is unverified, and the switcher says so for each.
    for (const game of ["cs2", "apex-legends", "pubg", "delta-force-global", "delta-force-cn"]) {
      await expect(page.getByTestId(`switch-${game}`)).toContainText(/not verified/i);
    }
  });

  test("copies exactly the value shown", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(`/results/${fixtures.recommendations.peak_found}/settings`);

    const shown = await page.getByTestId("settings-target-cm").innerText();
    await page.getByTestId("copy-target-cm-per-360").click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(shown);
  });
});

test.describe("ownership", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("is a 404 for anyone but the owner", async ({ page }) => {
    const response = await page.goto(`/results/${fixtures.recommendations.peak_found}`);
    expect(response?.status()).toBe(404);
  });
});

test.describe("the calibration flow", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("starts from the front page and briefs the first round before capturing anything", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByTestId("start-calibration-link").click();
    await expect(page).toHaveURL(/\/calibrate$/);
    await expect(page.getByTestId("calibration-form")).toBeVisible();

    await page.getByTestId("mode-quick").check();
    await page.getByTestId("input-dpi").fill("800");
    await page.getByTestId("input-current-cm").fill("30");
    await page.getByTestId("start-calibration").click();

    await expect(page.getByTestId("session-briefing")).toBeVisible();
    await expect(page.getByText(/Round 1 of 2/)).toBeVisible();
    // Blinded: letters are promised, no sensitivity is named.
    const text = (await page.locator("main").innerText()).toLowerCase();
    expect(text).toContain("shown only as letters");
    expect(text).not.toMatch(/\d+\.\d cm\/360/);
    expect(await page.evaluate(() => document.pointerLockElement === null)).toBe(true);
  });
});
