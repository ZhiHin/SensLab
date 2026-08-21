import { createUnverifiedAdapter } from "./unverified";
import type { GameAdapter } from "./types";

/**
 * The five launch games (doc 08 §8.1).
 *
 * Every one of them is registered as **unverified**. That is not an oversight and not a
 * placeholder: SensLab has not yet performed and recorded its own verification procedure for
 * any of them (doc 36 — fifteen open items, zero verified), and until it has, the adapter
 * must refuse to emit a number.
 *
 * These games are still fully usable today. The calibration is game-independent, so a player
 * who picks any of them gets their complete result in cm/360 and counts/360 — the settings
 * block simply shows the verification state instead of a value they would otherwise copy
 * into their game and trust.
 *
 * `gameVersionLabel` is "pre-verification" rather than a real build identifier because we
 * have not measured against a build. When a register entry closes, that verification records
 * the build it was performed against and a real version label replaces this one.
 */

const PRE_VERIFICATION = "pre-verification";

export const CS2_ADAPTER: GameAdapter = createUnverifiedAdapter({
  identity: {
    gameId: "cs2",
    gameVersionLabel: PRE_VERIFICATION,
    adapterVersion: "0.1.0",
    displayName: { en: "Counter-Strike 2", "zh-Hans": "反恐精英2" },
    region: "global",
    engineFamily: "source2",
  },
  registerEntry: "EV-001",
});

export const APEX_ADAPTER: GameAdapter = createUnverifiedAdapter({
  identity: {
    gameId: "apex-legends",
    gameVersionLabel: PRE_VERIFICATION,
    adapterVersion: "0.1.0",
    displayName: { en: "Apex Legends", "zh-Hans": "Apex 英雄" },
    region: "global",
  },
  registerEntry: "EV-002",
});

export const PUBG_ADAPTER: GameAdapter = createUnverifiedAdapter({
  identity: {
    gameId: "pubg",
    gameVersionLabel: PRE_VERIFICATION,
    adapterVersion: "0.1.0",
    displayName: { en: "PUBG: BATTLEGROUNDS", "zh-Hans": "绝地求生" },
    region: "global",
    engineFamily: "unreal",
  },
  registerEntry: "EV-003",
});

export const DELTA_FORCE_GLOBAL_ADAPTER: GameAdapter = createUnverifiedAdapter({
  identity: {
    gameId: "delta-force-global",
    gameVersionLabel: PRE_VERIFICATION,
    adapterVersion: "0.1.0",
    displayName: { en: "Delta Force", "zh-Hans": "三角洲行动（国际服）" },
    region: "global",
  },
  registerEntry: "EV-004",
});

/**
 * Registered independently of the Global build (`SENS-BR-015`).
 *
 * These are separately operated, separately patched builds. Assuming they behave identically
 * is precisely the class of guess this product forbids — and settings menus and sensitivity
 * behaviour are exactly where regional builds tend to diverge. If verification later shows
 * the two agree on a given build pair, that is recorded as a *finding* on both register
 * entries; the adapters stay separate, because the equality would be a property of one build
 * pair rather than a permanent fact.
 */
export const DELTA_FORCE_CN_ADAPTER: GameAdapter = createUnverifiedAdapter({
  identity: {
    gameId: "delta-force-cn",
    gameVersionLabel: PRE_VERIFICATION,
    adapterVersion: "0.1.0",
    displayName: { en: "Delta Force (China)", "zh-Hans": "三角洲行动" },
    region: "cn",
  },
  registerEntry: "EV-005",
});

export const LAUNCH_ADAPTERS: readonly GameAdapter[] = [
  CS2_ADAPTER,
  APEX_ADAPTER,
  PUBG_ADAPTER,
  DELTA_FORCE_GLOBAL_ADAPTER,
  DELTA_FORCE_CN_ADAPTER,
];
