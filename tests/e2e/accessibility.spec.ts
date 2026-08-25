import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { AUTH_STATE } from "./auth-state";

/**
 * The automated accessibility scan (doc 28 §28.11, `SENS-UX-028`–`SENS-UX-034`).
 *
 * Every page, every state fixture, every run. Automated tooling catches perhaps half of what
 * matters — doc 28 says so plainly and schedules manual passes for the rest — but the half it
 * catches is the half that regresses silently, and a scan that only runs before a release is a
 * scan that finds a month of accumulated defects at the worst moment.
 *
 * Scoped to WCAG 2.1 A and AA, which is the posture doc 28 §28.4 commits to.
 */

interface Fixtures {
  readonly recommendations: Record<string, string>;
}

const fixtures = JSON.parse(readFileSync("test-results/e2e-fixtures.json", "utf8")) as Fixtures;

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function scan(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  // The full violation is attached rather than a count: "3 violations" sends the reader
  // hunting, while the node and the rule identify the element and the fix.
  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.map((node) => node.html.slice(0, 120)),
    })),
  ).toEqual([]);
}

test.describe("public surfaces", () => {
  for (const path of ["/", "/games", "/auth/sign-in", "/auth/sign-up"]) {
    test(`has no accessibility violations: ${path}`, async ({ page }) => {
      await page.goto(path);
      await scan(page);
    });
  }
});

test.describe("signed-in surfaces", () => {
  test.use({ storageState: AUTH_STATE });

  for (const path of ["/history", "/hardware-profiles", "/profile", "/settings", "/calibrate"]) {
    test(`has no accessibility violations: ${path}`, async ({ page }) => {
      await page.goto(path);
      await scan(page);
    });
  }

  test("has no accessibility violations on a result and its settings", async ({ page }) => {
    await page.goto(`/results/${fixtures.recommendations["peak_found"]}`);
    await scan(page);
    await page.goto(`/results/${fixtures.recommendations["peak_found"]}/settings`);
    await scan(page);
  });

  test("has no accessibility violations on the indistinguishable layout", async ({ page }) => {
    await page.goto(`/results/${fixtures.recommendations["indistinguishable"]}`);
    await scan(page);
  });

  test("has no accessibility violations on a validation result", async ({ page }) => {
    await page.goto(`/results/${fixtures.recommendations["validated"]}/validation`);
    await scan(page);
  });
});

test.describe("keyboard and structure — SENS-UX-028, doc 28 §28.5", () => {
  test("reaches the calibration call to action from the keyboard alone", async ({ page }) => {
    await page.goto("/");

    // The skip link is the first stop, and it must be reachable before the navigation.
    await page.keyboard.press("Tab");
    await expect(page.locator("a:focus")).toContainText(/skip to content/i);

    // Then the CTA is reachable by tabbing, without a mouse anywhere in the sequence.
    for (let press = 0; press < 12; press += 1) {
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(
        () => document.activeElement?.getAttribute("data-testid") ?? "",
      );
      if (focused === "start-calibration-link") return;
    }
    throw new Error("the calibration call to action was not reachable by keyboard");
  });

  test("gives every page exactly one h1 and a main landmark", async ({ page }) => {
    for (const path of ["/", "/games", "/auth/sign-in"]) {
      await page.goto(path);
      expect(await page.locator("h1").count(), `${path} h1 count`).toBe(1);
      expect(await page.locator("main#main").count(), `${path} main`).toBe(1);
    }
  });

  test("shows a visible focus indicator rather than removing the outline", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => {
      const element = document.activeElement;
      if (element === null) return null;
      const style = window.getComputedStyle(element);
      return { width: style.outlineWidth, style: style.outlineStyle };
    });
    expect(outline?.style).not.toBe("none");
    expect(Number.parseFloat(outline?.width ?? "0")).toBeGreaterThan(0);
  });
});

test.describe("the measurement surface — SENS-UX-032", () => {
  test.use({ storageState: AUTH_STATE });

  test("describes the canvas and its state to a screen reader", async ({ page }) => {
    await page.goto("/calibrate");
    await page.getByTestId("mode-quick").check();
    await page.getByTestId("input-dpi").fill("800");
    await page.getByTestId("start-calibration").click();
    await page.getByTestId("begin-round").click();

    const canvas = page.getByTestId("test-canvas");
    await expect(canvas).toHaveAttribute("aria-label", /measurement area/i);
    await expect(canvas).toHaveAttribute("aria-describedby", "measuring-status");

    const status = page.getByTestId("trial-phase");
    await expect(status).toHaveAttribute("aria-live", "polite");
    // Procedural only: a running commentary of performance would be feedback a sighted player
    // does not get (`SENS-BR-007`).
    const text = (await status.innerText()).toLowerCase();
    expect(text).not.toMatch(/\d+\s*(ms|cm|%)/);
    expect(text).toMatch(/ready|measuring|get ready|paused/);
  });
});

test.describe("the error surfaces — doc 22 §22.6", () => {
  test("renders a designed 404 that says nothing about what exists", async ({ page }) => {
    // Both an unknown URL and a resource owned by somebody else land here, and the wording
    // must not let a reader tell those apart (`SENS-SEC-010`).
    const unknown = await page.goto("/no-such-page-at-all");
    expect(unknown?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: /nothing here/i })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);

    // A real id shape that is simply not the reader's must produce the same screen, not a
    // different message.
    const foreign = await page.goto("/results/00000000-0000-7000-8000-000000000000");
    expect(foreign?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: /nothing here/i })).toBeVisible();
  });
});
