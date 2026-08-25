import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { AUTH_STATE } from "./auth-state";

/**
 * Responsive behaviour and the calibration gate (doc 28 §28.1–§28.3, FR-100, `SENS-BR-023`).
 *
 * Every reading surface works at every width: results, history and settings are what a player
 * reaches from a phone, and wide content scrolls inside its own container rather than making
 * the page scroll sideways (`SENS-UX-027`).
 *
 * The touch gate needs real device emulation, which forces its own worker, so it lives in
 * `touch-gate.spec.ts`.
 */

interface Fixtures {
  readonly recommendations: Record<string, string>;
}

const fixtures = JSON.parse(readFileSync("test-results/e2e-fixtures.json", "utf8")) as Fixtures;

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

test.describe("reading surfaces at every breakpoint — SENS-UX-027", () => {
  test.use({ storageState: AUTH_STATE });

  const widths = [
    { name: "xs", width: 375, height: 812 },
    { name: "sm", width: 640, height: 900 },
    { name: "md", width: 900, height: 900 },
    { name: "lg", width: 1280, height: 900 },
    { name: "xl", width: 1600, height: 1000 },
  ];

  for (const size of widths) {
    test(`does not scroll the body sideways at ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      for (const path of [
        "/",
        "/history",
        "/settings",
        `/results/${fixtures.recommendations["peak_found"]}`,
        `/results/${fixtures.recommendations["peak_found"]}/settings`,
        `/results/${fixtures.recommendations["validated"]}/validation`,
      ]) {
        await page.goto(path);
        await expectNoHorizontalScroll(page, `${path} at ${size.name}`);
      }
    });
  }

  test("scrolls the response curve inside its own container on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/results/${fixtures.recommendations["peak_found"]}`);

    // The chart is wider than the phone; its container is what scrolls, not the page.
    const scrollable = await page.locator('[data-testid="response-curve"]').evaluate((element) => {
      let node: HTMLElement | null = element as HTMLElement;
      while (node !== null) {
        const overflow = window.getComputedStyle(node).overflowX;
        if (overflow === "auto" || overflow === "scroll") return true;
        node = node.parentElement;
      }
      return false;
    });
    expect(scrollable).toBe(true);
  });
});
