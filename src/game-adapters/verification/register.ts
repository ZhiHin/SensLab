import type { VerificationStatus } from "../../core/types/vocabulary";

/**
 * The external verification register (doc 36), as data.
 *
 * ## Why this exists in code and not only in a document
 *
 * Doc 36 is the single source of truth for what SensLab has and has not established about a
 * third-party game. A document cannot stop a constant from being merged. This module can:
 * `createVerifiedAdapter` refuses to build a scope whose governing entry is not `verified`
 * here, and the registry refuses to register it. A pull request that adds a yaw constant
 * therefore *cannot* pass CI without also flipping the entry that authorises it — which is
 * exactly the reviewable moment `SENS-SEC-023` asks for.
 *
 * ## Status changes are not a code change
 *
 * Flipping an entry to `verified` requires `evidence`: the build measured, the date, who
 * signed off, and the raw measurements themselves. Those measurements are then replayed
 * against the adapter's model on every test run (doc 12 §12.8 requirement 6), so a register
 * entry that claims verification it cannot substantiate fails the suite rather than shipping.
 *
 * **Every entry below is `open`.** That is the correct state: no one has yet performed and
 * recorded SensLab's own verification procedure (doc 08 §8.5) for any game. It is not a
 * placeholder, and there is no code path that treats it as one.
 */

export type RegisterArea = "game_adapters" | "engineering" | "security" | "product";

export interface RegisterEntry {
  /** Stable identifier, e.g. "EV-001". Referenced by adapters and surfaced in the UI. */
  readonly id: string;
  readonly subject: string;
  readonly status: VerificationStatus | "open" | "investigating" | "rejected";
  /** Plain description of what stays gated until this closes. */
  readonly blocks: string;
  readonly area: RegisterArea;
  /** 1 is most urgent. Mirrors doc 36 §36.6. */
  readonly priority: number;
  /**
   * Whether this entry governs a real subject or a test fixture.
   *
   * The distinction exists so that the verified path through the gate can be exercised at
   * all. A test needs *some* closed entry to build a verified adapter against, and the
   * alternative — letting tests bypass the register — would put a hole in the one mechanism
   * this phase exists to provide. Fixture entries are excluded from every count the product
   * reports, and a test asserts no `real_subject` entry is verified.
   */
  readonly governs: "real_subject" | "test_fixture";
  /**
   * Present only once the entry closes. Recorded here so that the register, and not an
   * adapter module, is the place a reviewer looks to see what was actually measured.
   */
  readonly closedNote?: string;
}

/**
 * doc 36 §36.6, verbatim in content. A test asserts this list and the document agree on
 * ids, statuses and counts, so the two cannot drift.
 */
export const VERIFICATION_REGISTER: readonly RegisterEntry[] = [
  {
    id: "EV-001",
    subject: "Counter-Strike 2: hipfire sensitivity model",
    status: "open",
    blocks: "the CS2 adapter, and therefore the launch gate",
    area: "game_adapters",
    priority: 1,
    governs: "real_subject",
  },
  {
    id: "EV-002",
    subject: "Apex Legends: hipfire sensitivity model",
    status: "open",
    blocks: "the Apex adapter",
    area: "game_adapters",
    priority: 3,
    governs: "real_subject",
  },
  {
    id: "EV-003",
    subject: "PUBG: sensitivity model form",
    status: "open",
    blocks: "the PUBG adapter",
    area: "game_adapters",
    priority: 4,
    governs: "real_subject",
  },
  {
    id: "EV-004",
    subject: "Delta Force (Global): sensitivity model",
    status: "open",
    blocks: "the Delta Force Global adapter",
    area: "game_adapters",
    priority: 5,
    governs: "real_subject",
  },
  {
    id: "EV-005",
    subject: "Delta Force (China): sensitivity model",
    status: "open",
    blocks: "the China-build adapter",
    area: "game_adapters",
    priority: 5,
    governs: "real_subject",
  },
  {
    id: "EV-006",
    subject: "Counter-Strike 2: zoom / scoped sensitivity model",
    status: "open",
    blocks: "CS2 ADS and per-scope output",
    area: "game_adapters",
    priority: 5,
    governs: "real_subject",
  },
  {
    id: "EV-007",
    subject: "Apex Legends: per-optic ADS model",
    status: "open",
    blocks: "Apex ADS and per-optic output",
    area: "game_adapters",
    priority: 6,
    governs: "real_subject",
  },
  {
    id: "EV-008",
    subject: "PUBG: per-scope models",
    status: "open",
    blocks: "PUBG ADS and per-scope output",
    area: "game_adapters",
    priority: 6,
    governs: "real_subject",
  },
  {
    id: "EV-009",
    subject: "Delta Force (Global and China): ADS and scope models",
    status: "open",
    blocks: "scoped output for both builds",
    area: "game_adapters",
    priority: 6,
    governs: "real_subject",
  },
  {
    id: "EV-010",
    subject: "unadjustedMovement support matrix",
    status: "open",
    blocks: "the browser support matrix and the environment check",
    area: "engineering",
    priority: 2,
    governs: "real_subject",
  },
  {
    id: "EV-011",
    subject: "Third-party naming of FOV-matching criteria",
    status: "open",
    blocks: "UI labelling of conversion methods only",
    area: "product",
    priority: 7,
    governs: "real_subject",
  },
  {
    id: "EV-012",
    subject: "Windows pointer-speed multiplier table",
    status: "open",
    blocks: "nothing; collected as context for warnings only",
    area: "engineering",
    priority: 8,
    governs: "real_subject",
  },
  {
    id: "EV-013",
    subject: "Server Actions CSRF guarantees for the chosen framework version",
    status: "open",
    blocks: "nothing; defence in depth",
    area: "security",
    priority: 7,
    governs: "real_subject",
  },
  {
    id: "EV-014",
    subject: "FOV axis and scaling conventions per game",
    status: "open",
    blocks: "every ADS/scope conversion",
    area: "game_adapters",
    priority: 4,
    governs: "real_subject",
  },
  {
    id: "EV-015",
    subject: "Setting ranges, steps and precision per game and scope",
    status: "open",
    blocks: "quantisation correctness",
    area: "game_adapters",
    priority: 3,
    governs: "real_subject",
  },

  /**
   * A closed entry that governs nothing real.
   *
   * It exists so the *verified* path through the gate can be exercised — an adapter built on
   * a fictional constant, replaying fictional measurements, refusing outside its fictional
   * range. Without it the only way to test that path would be to let tests bypass the
   * register, which would put a hole in the exact mechanism this module provides.
   *
   * It is excluded from every count the product reports, no production adapter may cite it
   * (asserted by a test), and the fictional constant lives in the test helper rather than
   * here, so nothing in `src/` carries a number that could be mistaken for a real one.
   */
  {
    id: "EV-FIXTURE",
    subject: "Test fixture — a fictional game used to exercise the adapter contract",
    status: "verified",
    blocks: "nothing; no real product depends on this entry",
    area: "engineering",
    priority: 8,
    governs: "test_fixture",
    closedNote: "Fictional. Measurements are invented and are not a claim about any game.",
  },
  {
    id: "EV-FIXTURE-ADS",
    subject: "Test fixture — an unmeasured scope on the fictional game",
    status: "open",
    blocks: "the fixture's scoped output, so the partial state has something to be partial about",
    area: "engineering",
    priority: 8,
    governs: "test_fixture",
  },
];

const BY_ID = new Map(VERIFICATION_REGISTER.map((entry) => [entry.id, entry]));

/** The register as the product reports it: real subjects only, fixtures excluded. */
export function realRegisterEntries(): readonly RegisterEntry[] {
  return VERIFICATION_REGISTER.filter((entry) => entry.governs === "real_subject");
}

export function findRegisterEntry(id: string): RegisterEntry | null {
  return BY_ID.get(id) ?? null;
}

/**
 * True when this entry authorises a shipped constant.
 *
 * `needs_recheck` counts: the entry *was* closed with evidence, and doc 08 §8.6 keeps such
 * adapters serving values behind a "last verified" disclosure rather than pulling them.
 */
export function authorisesConstants(id: string): boolean {
  const entry = BY_ID.get(id);
  return entry?.status === "verified" || entry?.status === "needs_recheck";
}

export function openRegisterEntries(): readonly RegisterEntry[] {
  return realRegisterEntries().filter(
    (entry) => entry.status !== "verified" && entry.status !== "rejected",
  );
}

export interface RegisterSummary {
  readonly total: number;
  readonly open: number;
  readonly verified: number;
  readonly rejected: number;
}

export function summariseRegister(): RegisterSummary {
  const entries = realRegisterEntries();
  return {
    total: entries.length,
    open: openRegisterEntries().length,
    verified: entries.filter((entry) => entry.status === "verified").length,
    rejected: entries.filter((entry) => entry.status === "rejected").length,
  };
}
