import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { AUTH_STATE } from "./auth-state";

/**
 * Phase 8 end-to-end: validation and fine-tuning in a browser.
 *
 * What a browser proves that the unit and integration suites cannot: the result page offers
 * the comparison (or says why it does not), the run briefs before it captures and names no
 * sensitivity, every metric row carries its interval with the non-significant rows at equal
 * weight, and the fine-tune reveals its labels **only** on the reveal page.
 */

interface Fixtures {
  readonly email: string;
  readonly password: string;
  readonly recommendations: {
    readonly peak_found?: string;
    readonly indistinguishable?: string;
    readonly validated?: string;
  };
  readonly validationVerdict: string;
}

const fixtures = JSON.parse(readFileSync("test-results/e2e-fixtures.json", "utf8")) as Fixtures;

/** Signed in once by the setup project; the ownership spec opts out below. */
test.use({ storageState: AUTH_STATE });

test.describe("offering the comparison", () => {
  test("invites a validation from the result and briefs it without naming a sensitivity", async ({
    page,
  }) => {
    await page.goto(`/results/${fixtures.recommendations.peak_found}`);

    await page.getByTestId("start-validation").click();
    await expect(page).toHaveURL(/\/validate$/);
    await expect(page.getByTestId("validation-briefing")).toBeVisible();

    // Blinded: the briefing promises letters and names no value.
    const text = (await page.locator("main").innerText()).toLowerCase();
    expect(text).toContain("shown only as letters");
    expect(text).not.toMatch(/\d+\.\d cm\/360/);
    expect(await page.evaluate(() => document.pointerLockElement === null)).toBe(true);
  });

  test("is not offered for a result with no point value", async ({ page }) => {
    await page.goto(`/results/${fixtures.recommendations.indistinguishable}`);

    await expect(page.getByTestId("start-validation")).toHaveCount(0);
    const response = await page.goto(
      `/results/${fixtures.recommendations.indistinguishable}/validate`,
    );
    expect(response?.status()).toBe(404);
  });
});

test.describe("a validation result", () => {
  test("shows every metric with its interval, at equal weight, and the confidence move", async ({
    page,
  }) => {
    await page.goto(`/results/${fixtures.recommendations.validated}/validation`);

    await expect(page.getByTestId("validation-headline")).toBeVisible();
    await expect(page.getByTestId("validation-arms")).toContainText("cm/360");
    await expect(page.getByTestId("confidence-updated")).toContainText(/\d+ → \d+/);

    // Every rendered row carries an interval, and a non-significant row is labelled in place
    // rather than dropped (`SENS-BR-016`, doc 17 §17.4).
    const rows = page.locator('[data-testid^="metric-"]');
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(3);
    for (let index = 0; index < count; index += 1) {
      await expect(rows.nth(index)).toContainText(/\[ -?\d/);
      await expect(rows.nth(index)).toContainText(/measurable/);
    }

    // The verdict is never rendered as a probability.
    const text = (await page.locator("main").innerText()).toLowerCase();
    expect(text).not.toMatch(/\d+% (chance|probability)/);
    expect(text).toContain("composite");
  });

  test("summarises the outcome back on the result page", async ({ page }) => {
    await page.goto(`/results/${fixtures.recommendations.validated}`);

    await expect(page.getByTestId("validation-summary")).toContainText(
      /Confidence moved \d+ → \d+/,
    );
    await expect(page.getByTestId("start-validation")).toHaveCount(0);
    await page.getByTestId("see-validation").click();
    await expect(page).toHaveURL(/\/validation$/);
  });
});

test.describe("fine-tuning", () => {
  test("briefs five blinded candidates and reveals no label before the run", async ({ page }) => {
    await page.goto(`/fine-tune/${fixtures.recommendations.validated}`);

    await expect(page.getByTestId("fine-tune-briefing")).toBeVisible();
    const text = (await page.locator("main").innerText()).toLowerCase();
    expect(text).toContain("letter");
    // The reveal labels must not appear anywhere before the run.
    expect(text).not.toContain("slightly higher");
    expect(text).not.toContain("slightly lower");
    expect(text).not.toMatch(/\d+\.\d cm\/360/);
  });

  test("is a 404 for a result with no point value", async ({ page }) => {
    const response = await page.goto(`/fine-tune/${fixtures.recommendations.indistinguishable}`);
    expect(response?.status()).toBe(404);
  });
});

test.describe("ownership", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("keeps the comparison private to the owner", async ({ page }) => {
    const validation = await page.goto(`/results/${fixtures.recommendations.validated}/validation`);
    expect(validation?.status()).toBe(404);
    const fineTune = await page.goto(`/fine-tune/${fixtures.recommendations.validated}`);
    expect(fineTune?.status()).toBe(404);
  });
});
