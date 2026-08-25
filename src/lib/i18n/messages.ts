import { DEFAULT_LOCALE, type Locale } from "@/core/preferences";

/**
 * Message catalogue (FR-105, doc 28 §28.10).
 *
 * ## What is translated, and what deliberately is not
 *
 * doc 28 §28.10 requires en and zh-Hans for the **game-facing surfaces**: the screens where a
 * player reads a number and takes it into a game. Those are the strings here.
 *
 * Two categories are *excluded on purpose*:
 *
 *  - **Game setting names come from the adapter, not this catalogue** (doc 08 §8.7). The label
 *    has to match what the player sees in the game's own menu in their language, and only the
 *    adapter knows that. A translation here would be a second, wrong answer.
 *  - **Game names come from the game record**, which carries its own localised names — the
 *    Chinese client calls Delta Force 三角洲行动, and that is a fact about the game rather than
 *    a UI string.
 *
 * ## No concatenated sentences
 *
 * Every entry is a complete sentence or a complete label. Where a value appears inside a
 * sentence it is a named placeholder, so a translator can move it: Chinese puts the unit and
 * the number in a different order to English and a catalogue built from fragments cannot
 * express that.
 */

export interface MessageParams {
  readonly [key: string]: string | number;
}

const EN = {
  /* ------------------------------------------------------------ settings surface */
  "settings.title": "Your settings",
  "settings.convertTo": "Convert to",
  "settings.target": "Target",
  "settings.copy": "Copy",
  "settings.copied": "Copied",
  "settings.dpi": "DPI",
  "settings.achieved": "Achieved",
  "settings.unverified.title": "No number, on purpose",
  "settings.unverified.body":
    "We do not have a verified sensitivity model for this game yet, so we will not guess at " +
    "its in-game number. Your measured result is below in cm/360 — that value is real and " +
    "does not depend on any game.",
  "settings.canonical.title": "What to set",
  "settings.canonical.body":
    "Set your in-game sensitivity so that one full 360° turn takes this much mouse movement. " +
    "Most games have a community tool that converts cm/360 to their own number.",

  /* ------------------------------------------------------------ result values */
  "result.recommended": "Your true sens",
  "result.highPerformance": "High-performance range",
  "result.comfort": "Comfort range",
  "result.confidence": "Confidence index",
  "result.aimProfile": "Aim profile",
  "result.provisional": "Provisional scale",
  "result.perTurn": "per 360°",
  "result.counts": "{count} counts / 360°",

  /* ------------------------------------------------------------ honesty caveats */
  "caveat.browser":
    "SensLab runs in a browser and is not the game engine. This is an estimate with a stated " +
    "confidence.",
  "caveat.assumedDpi":
    "Your cm/360 and counts/360 results are unaffected; any game number would be wrong by the " +
    "same proportion as the DPI.",
  "caveat.unverifiedShort": "Not verified",

  /* ------------------------------------------------------------ units */
  "unit.cm": "cm",
  "unit.in": "in",
  "unit.cmPer360": "cm / 360°",
  "unit.inPer360": "in / 360°",
} as const;

export type MessageKey = keyof typeof EN;

/**
 * Simplified Chinese.
 *
 * Translated as complete statements rather than word-for-word: the honesty caveats are the
 * point of the product and a literal rendering of "we won't guess" reads as evasive in
 * Chinese, so it is stated as "we will not provide an unverified number".
 */
const ZH_HANS: Readonly<Record<MessageKey, string>> = {
  "settings.title": "你的设置",
  "settings.convertTo": "转换为",
  "settings.target": "目标",
  "settings.copy": "复制",
  "settings.copied": "已复制",
  "settings.dpi": "DPI",
  "settings.achieved": "实际值",
  "settings.unverified.title": "暂不提供数值",
  "settings.unverified.body":
    "我们尚未验证这款游戏的灵敏度模型，因此不会提供未经验证的游戏内数值。下方是你的实测结果（厘米/360°）——" +
    "这个值是真实测量得出的，与任何游戏无关。",
  "settings.canonical.title": "如何设置",
  "settings.canonical.body":
    "调整游戏内灵敏度，使鼠标移动这段距离时视角正好转过一整圈（360°）。大多数游戏都有社区工具可以把厘米/360°换算成该游戏的数值。",

  "result.recommended": "你的真实灵敏度",
  "result.highPerformance": "高表现区间",
  "result.comfort": "舒适区间",
  "result.confidence": "置信指数",
  "result.aimProfile": "瞄准特征",
  "result.provisional": "临时参考标度",
  "result.perTurn": "每 360°",
  "result.counts": "{count} 计数 / 360°",

  "caveat.browser": "SensLab 在浏览器中运行，并非游戏引擎。结果是带有明确置信度的估计值。",
  "caveat.assumedDpi":
    "你的厘米/360° 与计数/360° 结果不受影响；但游戏内数值会按 DPI 的偏差同比例出错。",
  "caveat.unverifiedShort": "未验证",

  "unit.cm": "厘米",
  "unit.in": "英寸",
  "unit.cmPer360": "厘米 / 360°",
  "unit.inPer360": "英寸 / 360°",
};

const CATALOGUES: Readonly<Record<Locale, Readonly<Record<MessageKey, string>>>> = {
  en: EN,
  "zh-Hans": ZH_HANS,
};

/**
 * Resolves a message, substituting `{named}` placeholders.
 *
 * A missing translation falls back to English rather than to the key: a player seeing
 * `settings.unverified.body` learns nothing, while the English sentence is at least true.
 */
export function translate(locale: Locale, key: MessageKey, params: MessageParams = {}): string {
  const catalogue = CATALOGUES[locale] ?? CATALOGUES[DEFAULT_LOCALE];
  const template = catalogue[key] ?? CATALOGUES[DEFAULT_LOCALE][key];
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

/** A bound translator, so a component does not thread the locale through every call. */
export function translator(locale: Locale): (key: MessageKey, params?: MessageParams) => string {
  return (key, params) => translate(locale, key, params);
}

/** Every key the catalogue defines, for the completeness test. */
export function messageKeys(): readonly MessageKey[] {
  return Object.keys(EN) as MessageKey[];
}

export function catalogueFor(locale: Locale): Readonly<Record<MessageKey, string>> {
  return CATALOGUES[locale];
}
