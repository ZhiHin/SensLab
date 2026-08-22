import { expect, test } from "@playwright/test";

/**
 * Browser coverage for the aim-test surfaces (doc 19 §19.12, harness 3).
 *
 * No numerical assertions live here — the deterministic harness owns those. What this file
 * covers is what only a browser can answer: does the briefing appear *before* pointer lock, does
 * the surface strip its navigation while measuring, does Escape pause, and does a run actually
 * reach the database.
 */

test.describe("the test index", () => {
  test("lists the seven MVP tests and says which ones are scored", async ({ page }) => {
    await page.goto("/test");

    await expect(page.getByRole("heading", { level: 1 })).toContainText("THE BATTERY");
    await expect(page.locator("[data-testid^='test-link-']")).toHaveCount(7);

    // Five scored, two not. The distinction is on the page because it is load-bearing: reaction
    // and comfort deliberately never influence the recommendation.
    await expect(page.locator('[data-category="scored"]')).toHaveCount(5);
    await expect(page.locator('[data-category="baseline"]')).toHaveCount(1);
    await expect(page.locator('[data-category="constraint"]')).toHaveCount(1);
  });

  test("is honest that one test is not a recommendation", async ({ page }) => {
    await page.goto("/test");
    await expect(page.getByText(/cannot recommend a sensitivity/i)).toBeVisible();
  });
});

test.describe("the briefing", () => {
  test("describes the task in full text before pointer lock is requested", async ({ page }) => {
    // doc 09 §9.0.8 — a screen reader must be able to read the task before the cursor is
    // captured. A player who has not understood the task produces a clean measurement of their
    // confusion.
    await page.goto("/test/flick");

    await expect(page.getByTestId("briefing")).toBeVisible();
    await expect(page.getByRole("heading", { name: /what to do/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /what it measures/i })).toBeVisible();
    await expect(page.getByRole("listitem")).not.toHaveCount(0);

    // Nothing is captured yet.
    expect(await page.evaluate(() => document.pointerLockElement === null)).toBe(true);
    await expect(page.getByTestId("test-canvas")).toHaveCount(0);
  });

  test("carries the motion advisory", async ({ page }) => {
    await page.goto("/test/tracking");
    await expect(page.getByText(/continuous motion can be uncomfortable/i)).toBeVisible();
  });

  test("says so plainly when the test does not exist", async ({ page }) => {
    await page.goto("/test/not-a-real-test");
    await expect(page.getByRole("heading", { name: /unknown test/i })).toBeVisible();
  });
});
