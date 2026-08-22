import { expect, test } from "@playwright/test";

/**
 * The parts of an aim test that hold pointer lock.
 *
 * These live in their own spec because they cannot run concurrently with any other browser page.
 * That is not a quirk of the tests: the engine pauses when its page loses focus, because a
 * session running in a background tab is not measuring anything. Parallel pages compete for
 * focus, so anything holding pointer lock has to run alone — see the `locked` project in
 * `playwright.config.ts`.
 */

test.describe("a run", () => {
  test("starts a session, captures the pointer and strips the navigation", async ({ page }) => {
    await page.goto("/test/flick");
    await page.getByTestId("begin-button").click();

    // The canvas appears once the server has issued a plan.
    await expect(page.getByTestId("test-canvas")).toBeVisible();
    await page.getByTestId("lock-button").click();

    const lockedTag = await page.evaluate(() => document.pointerLockElement?.tagName ?? null);
    expect(lockedTag).toBe("CANVAS");

    // While measuring there is no navigation on the page at all — not hidden, not disabled:
    // not rendered. A stray Tab into a link would steal focus, and focus loss invalidates the
    // open trial.
    await expect(page.getByTestId("exit-link")).toHaveCount(0);
    await expect(page.locator("main a")).toHaveCount(0);
  });

  test("shows no score anywhere while a trial is being measured — SENS-BR-007", async ({
    page,
  }) => {
    await page.goto("/test/flick");
    await page.getByTestId("begin-button").click();
    await expect(page.getByTestId("test-canvas")).toBeVisible();
    await page.getByTestId("lock-button").click();

    await page.waitForTimeout(1200);

    const text = (await page.locator("main").innerText()).toLowerCase();
    for (const forbidden of ["score", "accuracy", "hit rate", "streak", "cm/360"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  test("pauses on Escape and offers a way out that keeps what was measured", async ({ page }) => {
    await page.goto("/test/flick");
    await page.getByTestId("begin-button").click();
    await expect(page.getByTestId("test-canvas")).toBeVisible();
    await page.getByTestId("lock-button").click();

    await page.keyboard.press("Escape");

    await expect(page.getByTestId("overlay-state")).toContainText(/paused/i);
    await expect(page.getByTestId("resume-button")).toBeVisible();
    await expect(page.getByTestId("restart-button")).toBeVisible();
    await expect(page.getByTestId("abandon-button")).toBeVisible();
    expect(await page.evaluate(() => document.pointerLockElement === null)).toBe(true);
  });

  test("ends with a summary that does not pretend to be a recommendation", async ({ page }) => {
    await page.goto("/test/flick");
    await page.getByTestId("begin-button").click();
    await expect(page.getByTestId("test-canvas")).toBeVisible();
    await page.getByTestId("lock-button").click();
    await page.keyboard.press("Escape");
    await page.getByTestId("abandon-button").click();

    await expect(page.getByTestId("summary")).toBeVisible();
    await expect(page.getByText(/does not produce a sensitivity recommendation/i)).toBeVisible();
    // Navigation is back, because nothing is being measured any more.
    await expect(page.getByRole("link", { name: /back to the tests/i })).toBeVisible();
  });
});
