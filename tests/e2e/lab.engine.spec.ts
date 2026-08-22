import { expect, test } from "@playwright/test";

/**
 * Browser integration for the aim engine (doc 19 §19.12, harness 3).
 *
 * Real pointer lock, a real canvas, a real `requestAnimationFrame`. **No numerical assertions
 * live here** — the deterministic harness owns those, and it owns them because a browser cannot
 * be asked to deliver a frame exactly 140 ms late. What this file asserts is the set of things
 * only a browser can answer: does the lock get acquired, does the loop run, does the HUD show
 * no score, does Escape pause, and does a session survive a full round.
 *
 * These run against the dev server, because the harness route deliberately 404s in production.
 */

test.describe("the engine harness", () => {
  test("renders a canvas and starts idle", async ({ page }) => {
    await page.goto("/lab/engine");

    await expect(page.getByRole("heading", { level: 1 })).toContainText("AIM ENGINE");
    await expect(page.getByTestId("engine-canvas")).toBeVisible();
    await expect(page.getByTestId("engine-state")).toHaveText(/ready|idle/);
    await expect(page.getByTestId("start-button")).toBeVisible();
  });

  test("acquires pointer lock from a user gesture and runs the loop", async ({ page }) => {
    await page.goto("/lab/engine");
    await page.getByTestId("start-button").click();

    await expect(page.getByTestId("engine-state")).toHaveText("running");

    // The lock is held by the canvas the engine owns, not by the document at large.
    const lockedTag = await page.evaluate(() => document.pointerLockElement?.tagName ?? null);
    expect(lockedTag).toBe("CANVAS");

    // The frame loop is genuinely running: the backing store has been sized and painted.
    const painted = await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      return canvas === null ? 0 : canvas.width * canvas.height;
    });
    expect(painted).toBeGreaterThan(0);
  });

  test("shows no score anywhere on the page while a session runs — SENS-BR-007", async ({
    page,
  }) => {
    await page.goto("/lab/engine");
    await page.getByTestId("start-button").click();
    await expect(page.getByTestId("engine-state")).toHaveText("running");

    await page.waitForTimeout(1500);

    // The HUD is drawn on the canvas, so there is nothing in the DOM to leak — this asserts it
    // stayed that way.
    const text = (await page.locator("main").innerText()).toLowerCase();
    for (const forbidden of ["score", "accuracy", "hit rate", "streak"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  test("pauses on Escape and exits pointer lock", async ({ page }) => {
    await page.goto("/lab/engine");
    await page.getByTestId("start-button").click();
    await expect(page.getByTestId("engine-state")).toHaveText("running");

    await page.keyboard.press("Escape");

    await expect(page.getByTestId("engine-state")).toHaveText("paused");
    await expect(page.getByTestId("overlay-state")).toContainText("Paused");
    await expect(page.getByTestId("resume-button")).toBeVisible();

    expect(await page.evaluate(() => document.pointerLockElement === null)).toBe(true);
  });

  test("offers no DOM control while the pointer is locked", async ({ page }) => {
    // While the lock is held there is no cursor, so a button beside the canvas would be a
    // control the player cannot press. Escape is the only in-session control, and restart and
    // abort live on the pause overlay — which exists only when nothing is being measured.
    await page.goto("/lab/engine");
    await page.getByTestId("start-button").click();
    await expect(page.getByTestId("engine-state")).toHaveText("running");

    await expect(page.getByTestId("abort-button")).toHaveCount(0);
    await expect(page.getByTestId("restart-button")).toHaveCount(0);
    await expect(page.getByTestId("controls-hint")).toContainText(/Escape|Enter/);
  });

  test("aborts from the pause overlay and stops measuring", async ({ page }) => {
    await page.goto("/lab/engine");
    await page.getByTestId("start-button").click();
    await expect(page.getByTestId("engine-state")).toHaveText("running");

    // Escape first: the lock has to be released before any DOM control is reachable.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("engine-state")).toHaveText("paused");

    await page.getByTestId("abort-button").click();

    await expect(page.getByTestId("engine-state")).toHaveText("aborted");
    await expect(page.getByTestId("overlay-state")).toContainText("aborted");
    expect(await page.evaluate(() => document.pointerLockElement === null)).toBe(true);
  });

  test("keeps the warm-up gate closed until it is satisfied", async ({ page }) => {
    await page.goto("/lab/engine");
    await page.getByTestId("start-button").click();

    await expect(page.getByTestId("engine-stage")).toHaveText("free_aim");
    // The engine is in the warm-up, so no round has been emitted.
    await expect(page.getByText(/Rounds completed \(0\)/)).toBeVisible();
  });
});
