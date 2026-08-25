import { readFileSync } from "node:fs";
import { devices, expect, test, type Page } from "@playwright/test";
import { AUTH_STATE } from "./auth-state";

/**
 * The calibration gate on a touch device (FR-100, SCR-050, `SENS-BR-023`).
 *
 * Its own file because emulating a phone sets `defaultBrowserType`, which Playwright accepts
 * only at the top level of a file — and the claim is worth a file anyway: **the measurement is
 * never offered where it cannot be honest.** A touch device is shown the explanation and a
 * hand-off to a desktop, not a calibration form it could start and never finish meaningfully.
 */

interface Fixtures {
  readonly recommendations: Record<string, string>;
}

const fixtures = JSON.parse(readFileSync("test-results/e2e-fixtures.json", "utf8")) as Fixtures;

test.use({ ...devices["Pixel 7"], storageState: AUTH_STATE });

/** The page body never scrolls horizontally, at any breakpoint (`SENS-UX-027`). */
async function expectNoHorizontalScroll(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    overflow.scrollWidth,
    `${label} overflows horizontally by ${overflow.scrollWidth - overflow.clientWidth}px`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

test("explains why, hands off to a desktop, and never offers a touch calibration", async ({
  page,
}) => {
  await page.goto("/calibrate");

  await expect(page.getByTestId("gate-needs-desktop")).toBeVisible();
  await expect(page.getByTestId("calibration-form")).toHaveCount(0);
  await expect(page.getByTestId("copy-link")).toBeVisible();

  const text = (await page.locator("main").innerText()).toLowerCase();
  expect(text).toContain("mouse");
  // The honesty is the point: it says this measurement cannot be done here, not that the
  // device is unsupported in general.
  expect(text).toContain("results, history, game settings and account all read");
  await expectNoHorizontalScroll(page, "SCR-050");
});

test("still shows a result on the same device", async ({ page }) => {
  await page.goto(`/results/${fixtures.recommendations["peak_found"]}`);
  await expect(page.getByTestId("recommended-cm")).toBeVisible();
  await expect(page.getByTestId("response-curve")).toBeVisible();
  await expectNoHorizontalScroll(page, "results on a phone");
});
