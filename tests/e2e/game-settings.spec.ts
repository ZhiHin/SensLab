import { expect, test } from "@playwright/test";

/**
 * Phase 5 end-to-end: the honest empty state.
 *
 * The behaviour worth asserting in a browser is not that a conversion works — nothing is
 * verified, so none does. It is that a user arriving with a calibrated sensitivity gets their
 * complete result, is told plainly why there is no game number, and is never shown one
 * anyway. That last part is what a UI test can check and a unit test cannot: the gate lives
 * in the adapter, but the *rendering* is where a number would leak.
 */

test.describe("the verification table", () => {
  test("publishes what has been measured and what has not", async ({ page }) => {
    await page.goto("/games");

    await expect(page.getByRole("heading", { level: 1 })).toContainText("WHAT WE HAVE MEASURED");

    // Read from the register, not from copy: fifteen tracked items, none verified.
    await expect(page.getByText("No game is verified yet")).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(15);
    await expect(page.getByText("EV-001", { exact: true })).toBeVisible();

    // Every launch game is listed and every one is unverified.
    await expect(page.locator('[data-status="unverified"]')).toHaveCount(5);
    await expect(page.locator('[data-status="verified"]')).toHaveCount(0);
  });

  test("is reachable from the front page", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /what has been measured/i }).click();
    await expect(page).toHaveURL(/\/games$/);
  });
});

test.describe("a game with an open register entry", () => {
  test("gives the canonical result and refuses the game number", async ({ page }) => {
    await page.goto("/games/cs2?cm360=31.2&dpi=800");

    // The measurement is complete and correct: 31.2 cm at 800 DPI is 9827 counts per 360.
    await expect(page.getByText("31.2", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("9827")).toBeVisible();

    // And the reason there is no setting is named, with the register entry that tracks it.
    await expect(page.getByText("No number, on purpose")).toBeVisible();
    await expect(page.getByText("EV-001", { exact: true })).toBeVisible();
    await expect(page.locator('[data-testid="emitted-settings"]')).toHaveCount(0);
  });

  test("recomputes when the sensitivity changes", async ({ page }) => {
    await page.goto("/games/cs2");
    await page.getByTestId("input-cm360").fill("40");
    await page.getByTestId("input-dpi").fill("1600");
    await page.getByTestId("convert").click();

    await expect(page).toHaveURL(/cm360=40/);
    // 40 cm at 1600 DPI is 25197 counts per 360.
    await expect(page.getByText("25197")).toBeVisible();
    await expect(page.locator('[data-testid="emitted-settings"]')).toHaveCount(0);
  });

  test("falls back to sensible values for a malformed link", async ({ page }) => {
    await page.goto("/games/cs2?cm360=banana&dpi=-4");
    await expect(page.getByTestId("input-cm360")).toHaveValue("30");
    await expect(page.getByTestId("input-dpi")).toHaveValue("800");
  });

  test("returns 404 for a game that does not exist", async ({ page }) => {
    const response = await page.goto("/games/not-a-real-game");
    expect(response?.status()).toBe(404);
  });
});
