import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  LOCALES,
  formatDistance,
  formatDistanceRange,
  intlLocale,
  isLocale,
  per360Label,
  shouldReduceMotion,
} from "@/core/preferences";
import {
  MIN_VIEWPORT_HEIGHT,
  MIN_VIEWPORT_WIDTH,
  evaluateGate,
  type Capabilities,
} from "@/core/environment/capability";
import { catalogueFor, messageKeys, translate, translator } from "@/lib/i18n/messages";

/**
 * Presentation-layer rules: units, locale, the motion override and the calibration gate
 * (FR-100 – FR-103, FR-105, `SENS-UX-026`).
 *
 * These are pure and cheap to test, and each of them decides something a user sees rather than
 * something the instrument measures — which is exactly why they need pinning: a unit
 * conversion that leaked into the measurement, or a gate that let a phone through, would both
 * be silent.
 */

describe("units are presentation, never measurement — FR-103", () => {
  it("shows centimetres unchanged and inches converted", () => {
    expect(formatDistance(31.2, "metric").text).toBe("31.2 cm");
    const imperial = formatDistance(31.2, "imperial");
    expect(imperial.unit).toBe("in");
    expect(imperial.value).toBeCloseTo(31.2 / 2.54, 9);
    expect(imperial.text).toBe("12.28 in");
  });

  it("gives inches the finer precision their larger unit needs", () => {
    // One decimal of an inch is a coarser step than one decimal of a centimetre, so matching
    // the digit count would make the imperial reading the less trustworthy of the two.
    expect(formatDistance(30, "metric").text).toBe("30.0 cm");
    expect(formatDistance(30, "imperial").text).toBe("11.81 in");
  });

  it("labels a range once rather than repeating the unit", () => {
    expect(formatDistanceRange(29.8, 38.1, "metric")).toBe("29.8 — 38.1 cm");
    expect(formatDistanceRange(29.8, 38.1, "imperial")).toBe("11.73 — 15.00 in");
  });

  it("names the per-360 denominator for each unit", () => {
    expect(per360Label("metric")).toBe("cm / 360°");
    expect(per360Label("imperial")).toBe("in / 360°");
  });

  it("keeps the unit independent of the locale", () => {
    // A player reading Chinese may still want centimetres, and one reading English may want
    // inches; doc 28 §28.10 makes them separate axes on purpose.
    expect(formatDistance(31.2, "metric", "zh-Hans").value).toBe(31.2);
    expect(formatDistance(31.2, "imperial", "en").value).toBeCloseTo(12.283, 3);
  });
});

describe("locale — doc 28 §28.10", () => {
  it("recognises exactly the supported set", () => {
    expect([...LOCALES]).toEqual(["en", "zh-Hans"]);
    expect(isLocale("zh-Hans")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(DEFAULT_LOCALE).toBe("en");
  });

  it("maps to a BCP 47 tag for `Intl` and the lang attribute", () => {
    expect(intlLocale("en")).toBe("en");
    expect(intlLocale("zh-Hans")).toBe("zh-Hans-CN");
  });
});

describe("the motion override — FR-101, SENS-UX-023", () => {
  it("defers to the system when the preference is `system`", () => {
    expect(shouldReduceMotion("system", true)).toBe(true);
    expect(shouldReduceMotion("system", false)).toBe(false);
  });

  it("overrides the system in both directions", () => {
    // The whole reason the setting exists: a user whose OS asks for reduced motion for other
    // reasons can still have SensLab's, and one whose OS says nothing can still ask for less.
    expect(shouldReduceMotion("full", true)).toBe(false);
    expect(shouldReduceMotion("reduced", false)).toBe(true);
  });
});

describe("the calibration gate — SENS-UX-026, FR-100, SENS-BR-023", () => {
  const desktop: Capabilities = {
    finePointer: true,
    hover: true,
    viewportWidth: 1440,
    viewportHeight: 900,
    pointerLock: true,
  };

  it("passes a desktop with a mouse", () => {
    const gate = evaluateGate(desktop);
    expect(gate.verdict).toBe("ready");
    expect(gate.missing).toEqual([]);
    expect(gate.required).toEqual({ width: MIN_VIEWPORT_WIDTH, height: MIN_VIEWPORT_HEIGHT });
  });

  it("sends a phone to the desktop explanation rather than asking it to resize", () => {
    // A phone fails the pointer test *and* the size test. Telling its owner to enlarge the
    // window would be advice they cannot follow.
    const phone = evaluateGate({
      finePointer: false,
      hover: false,
      viewportWidth: 390,
      viewportHeight: 844,
      pointerLock: true,
    });
    expect(phone.verdict).toBe("needs_desktop");
    expect(phone.missing).toContain("pointer");
    expect(phone.missing).toContain("size");
  });

  it("passes a tablet with a mouse attached — capability, not user agent", () => {
    expect(evaluateGate({ ...desktop, viewportWidth: 1180, viewportHeight: 820 }).verdict).toBe(
      "ready",
    );
  });

  it("asks a small desktop window to grow, as a distinct state", () => {
    const small = evaluateGate({ ...desktop, viewportWidth: 900, viewportHeight: 700 });
    expect(small.verdict).toBe("window_too_small");
    expect(small.missing).toEqual(["size"]);

    const short = evaluateGate({ ...desktop, viewportHeight: 500 });
    expect(short.verdict).toBe("window_too_small");
  });

  it("names a browser without Pointer Lock separately from a wrong device", () => {
    const gate = evaluateGate({ ...desktop, pointerLock: false });
    expect(gate.verdict).toBe("browser_unsupported");
    expect(gate.missing).toEqual(["pointer_lock"]);
  });

  it("treats a fine pointer without hover as a device this cannot run on", () => {
    // A stylus reports a fine pointer but cannot rest over a target; the measurement needs
    // both, so the answer is the same as for touch.
    expect(evaluateGate({ ...desktop, hover: false }).verdict).toBe("needs_desktop");
  });
});

describe("the message catalogue — FR-105", () => {
  it("translates every key into Simplified Chinese", () => {
    const keys = messageKeys();
    expect(keys.length).toBeGreaterThan(10);
    const zh = catalogueFor("zh-Hans");
    const en = catalogueFor("en");
    // "DPI" is used unchanged in Chinese — it is the initialism the mouse software itself
    // shows. Translating it would invent a term the player has never seen.
    const sameInBoth = new Set(["settings.dpi"]);
    const untranslated = keys.filter((key) => zh[key] === en[key] && !sameInBoth.has(key));
    expect(untranslated).toEqual([]);
  });

  it("keeps the honesty caveats in both languages", () => {
    // The caveats are the product's position, not decoration: a build that shipped them in
    // one language only would be making a different promise to half its users.
    for (const locale of LOCALES) {
      expect(translate(locale, "settings.unverified.title").length).toBeGreaterThan(0);
      expect(translate(locale, "settings.unverified.body").length).toBeGreaterThan(20);
      expect(translate(locale, "caveat.browser").length).toBeGreaterThan(20);
    }
  });

  it("substitutes named placeholders so a translator can reorder them", () => {
    expect(translate("en", "result.counts", { count: "8,111" })).toContain("8,111");
    expect(translate("zh-Hans", "result.counts", { count: "8,111" })).toContain("8,111");
    // A placeholder with no value is left visible rather than rendered as "undefined".
    expect(translate("en", "result.counts")).toContain("{count}");
  });

  it("binds a translator to one locale", () => {
    const t = translator("zh-Hans");
    expect(t("settings.title")).toBe("你的设置");
    expect(translator("en")("settings.title")).toBe("Your settings");
  });
});
