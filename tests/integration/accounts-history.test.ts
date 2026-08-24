import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { hardwareProfiles, testSessions, users } from "@/db/schema";
import { userRepo } from "@/repositories";
import { guestActor, type Actor } from "@/repositories/actor";
import { hashPassword } from "@/lib/password";
import { isAppError } from "@/lib/errors";
import {
  DELETION_WINDOW_DAYS,
  cancelAccountDeletion,
  changePassword,
  exportAccountData,
  getAccount,
  requestAccountDeletion,
  runRetentionSweep,
  updateDisplayName,
} from "@/services/account-service";
import { claimGuestSessionForUser, issueGuestSession, signIn } from "@/services/auth-service";
import {
  startValidation,
  submitValidation,
  validationOfferFor,
} from "@/services/validation-service";
import {
  createProfile,
  deleteProfile,
  listProfiles,
  setDefaultProfile,
  updateProfile,
} from "@/services/hardware-service";
import { compareSessions, getHistory } from "@/services/history-service";
import {
  startCalibrationSession,
  submitCalibrationRound,
  type CalibrationStep,
} from "@/services/calibration-session-service";
import { asUser, db, resetVolatileTables } from "@tests/helpers/db";
import { runPlan } from "@tests/helpers/battery-runner";

/**
 * Accounts, hardware profiles, history and privacy, through the real services (FR-090 – FR-098).
 *
 * The cross-tenant assertions are the ones that matter most: every history and profile read is
 * expected to be *empty or not-found* for another user, not merely filtered in the UI
 * (doc 23 §23.12's first checklist item).
 */

const PASSWORD = "correct-horse-battery-staple";
const OPTIMUM_COUNTS = (800 * 25) / 2.54;

async function makeUser(email: string): Promise<string> {
  const { userId } = await userRepo.createUser({
    email,
    passwordHash: await hashPassword(PASSWORD),
  });
  return userId;
}

/** A finished quick calibration, optionally attributed to a hardware profile. */
async function calibrate(
  actor: Actor,
  options: { readonly seed: bigint; readonly profileId?: string; readonly dpi?: number } = {
    seed: 1_000_003n,
  },
): Promise<string> {
  let step: CalibrationStep = await startCalibrationSession(actor, {
    mode: "quick",
    dpi: options.dpi ?? 800,
    dpiSource: "known",
    currentCmPer360: 38,
    padWidthCm: null,
    gameId: "cs2",
    aspectRatio: 16 / 9,
    environment: { unadjustedMovementEffective: true },
    seed: options.seed,
    ...(options.profileId === undefined ? {} : { hardwareProfileId: options.profileId }),
  });
  const sessionId = step.sessionId;
  const centre = Math.log2(OPTIMUM_COUNTS);

  for (let guard = 0; guard < 6; guard += 1) {
    const skill = new Map(
      step.plan.candidates.map((candidate) => [
        candidate.candidateIndex,
        Math.max(0.3, 1 - Math.abs(Math.log2(candidate.countsPer360 as number) - centre) * 0.9),
      ]),
    );
    const run = runPlan(step.plan, { skillByCandidate: skill, maxStepDeg: 2.5 });
    const progress = await submitCalibrationRound(actor, {
      sessionId: step.sessionId,
      roundIndex: step.roundIndex,
      aggregates: run.aggregates,
      qualityFlags: [],
      aspectRatio: 16 / 9,
    });
    if (progress.kind === "finished") return sessionId;
    step = progress.step;
  }
  throw new Error("calibration did not finish");
}

describe("hardware profiles", () => {
  beforeEach(async () => {
    await resetVolatileTables();
  });
  afterAll(async () => {
    await closeDb();
  });

  it("makes the first profile the default and moves the flag on request", async () => {
    const actor = asUser(await makeUser("profiles@senslab.test"));

    const first = await createProfile(actor, { name: "Main", dpi: 800, dpiSource: "known" });
    expect(first.isDefault).toBe(true);

    const second = await createProfile(actor, { name: "Laptop", dpi: 1600, dpiSource: "assumed" });
    expect(second.isDefault).toBe(false);

    await setDefaultProfile(actor, second.id);
    const profiles = await listProfiles(actor);
    expect(profiles.filter((profile) => profile.isDefault).map((profile) => profile.id)).toEqual([
      second.id,
    ]);
    // The default sorts first, so the calibrate form prefills from it.
    expect(profiles[0]?.id).toBe(second.id);
  });

  it("edits a profile without touching what past sessions measured — SENS-BR-035", async () => {
    const actor = asUser(await makeUser("profile-edit@senslab.test"));
    const profile = await createProfile(actor, {
      name: "Main",
      dpi: 800,
      dpiSource: "known",
      mousepadWidthMm: 450,
    });
    const sessionId = await calibrate(actor, { seed: 1_000_003n, profileId: profile.id });

    await updateProfile(actor, profile.id, { dpi: 3200, name: "Main (new mouse)" });

    const history = await getHistory(actor);
    const item = history.items.find((entry) => entry.sessionId === sessionId);
    // The snapshot, not the profile: the session still reads 800 DPI.
    expect(item?.dpi).toBe(800);
    expect(item?.hardwareProfileName).toBe("Main (new mouse)");
  });

  it("soft-deletes, keeping the session's link and name readable", async () => {
    const actor = asUser(await makeUser("profile-delete@senslab.test"));
    const profile = await createProfile(actor, { name: "Old mouse", dpi: 800, dpiSource: "known" });
    const sessionId = await calibrate(actor, { seed: 1_000_003n, profileId: profile.id });

    await deleteProfile(actor, profile.id);
    expect(await listProfiles(actor)).toHaveLength(0);

    const [row] = await db()
      .select({ id: hardwareProfiles.id, deletedAt: hardwareProfiles.deletedAt })
      .from(hardwareProfiles)
      .where(eq(hardwareProfiles.id, profile.id));
    expect(row?.deletedAt).not.toBeNull();

    const history = await getHistory(actor);
    const item = history.items.find((entry) => entry.sessionId === sessionId);
    expect(item?.hardwareProfileName).toBe("Old mouse");
    expect(item?.hardwareProfileDeleted).toBe(true);
  });

  it("does not let one user reach another's profile", async () => {
    const owner = asUser(await makeUser("owner@senslab.test"));
    const stranger = asUser(await makeUser("stranger@senslab.test"));
    const profile = await createProfile(owner, { name: "Main", dpi: 800, dpiSource: "known" });

    expect(await listProfiles(stranger)).toHaveLength(0);
    await expect(updateProfile(stranger, profile.id, { name: "Mine now" })).rejects.toThrow();
    await expect(deleteProfile(stranger, profile.id)).rejects.toThrow();
    // Untouched.
    expect((await listProfiles(owner))[0]?.name).toBe("Main");
  });
});

describe("history and comparison", () => {
  beforeEach(async () => {
    await resetVolatileTables();
  });
  afterAll(async () => {
    await closeDb();
  });

  it("lists a user's sessions with what the screen shows, and only theirs", async () => {
    const actor = asUser(await makeUser("history@senslab.test"));
    const stranger = asUser(await makeUser("history-stranger@senslab.test"));
    const profile = await createProfile(actor, { name: "Main", dpi: 800, dpiSource: "known" });
    const sessionId = await calibrate(actor, { seed: 1_000_003n, profileId: profile.id });

    const history = await getHistory(actor);
    expect(history.items).toHaveLength(1);
    const item = history.items[0];
    expect(item?.sessionId).toBe(sessionId);
    expect(item?.recommendationId).not.toBeNull();
    expect(item?.gameName).toBe("Counter-Strike 2");
    expect(item?.dpi).toBe(800);
    expect(item?.mode).toBe("quick");
    expect(item?.confidenceIndex).not.toBeNull();
    expect(item?.versions.calibration).toBe("calibration_model_v2");
    expect(history.profiles).toEqual([{ id: profile.id, name: "Main" }]);

    // Cross-tenant: the other account's history is empty, not filtered.
    expect((await getHistory(stranger)).items).toHaveLength(0);
    await expect(compareSessions(stranger, sessionId, sessionId)).rejects.toThrow();
  });

  it("filters by hardware profile while still offering every profile as a filter", async () => {
    const actor = asUser(await makeUser("history-filter@senslab.test"));
    const main = await createProfile(actor, { name: "Main", dpi: 800, dpiSource: "known" });
    const laptop = await createProfile(actor, { name: "Laptop", dpi: 1600, dpiSource: "known" });
    await calibrate(actor, { seed: 1_000_003n, profileId: main.id });
    await calibrate(actor, { seed: 1_000_004n, profileId: laptop.id, dpi: 1600 });

    const all = await getHistory(actor);
    expect(all.items).toHaveLength(2);

    const filtered = await getHistory(actor, { hardwareProfileId: laptop.id });
    expect(filtered.items).toHaveLength(1);
    expect(filtered.items[0]?.hardwareProfileName).toBe("Laptop");
    expect(filtered.filteredProfileId).toBe(laptop.id);
    // The filter control still lists both, so a filter is reversible from the page itself.
    expect(filtered.profiles.map((profile) => profile.name).sort()).toEqual(["Laptop", "Main"]);
  });

  it("compares two sessions and flags a comparison across different hardware", async () => {
    const actor = asUser(await makeUser("compare@senslab.test"));
    const main = await createProfile(actor, { name: "Main", dpi: 800, dpiSource: "known" });
    const laptop = await createProfile(actor, { name: "Laptop", dpi: 1600, dpiSource: "known" });
    const a = await calibrate(actor, { seed: 1_000_003n, profileId: main.id });
    const b = await calibrate(actor, { seed: 1_000_004n, profileId: laptop.id, dpi: 1600 });

    const flagged = await compareSessions(actor, a, b);
    expect(flagged.comparability.comparable).toBe(false);
    expect(flagged.comparability.differences).toContain("hardware_profile");
    expect(flagged.comparability.differences).toContain("dpi");
    // The numbers are still reported — the flag is about how to read them.
    expect(flagged.a.sessionId).toBe(a);
    expect(flagged.b.sessionId).toBe(b);
    expect(flagged.dimensions.length).toBeGreaterThan(0);
    expect(["meaningful", "within_noise", "not_available"]).toContain(flagged.change.verdict);

    const c = await calibrate(actor, { seed: 1_000_005n, profileId: main.id });
    const comparable = await compareSessions(actor, a, c);
    expect(comparable.comparability.comparable).toBe(true);
    expect(comparable.comparability.differences).toHaveLength(0);
  });

  it("lists a session's own result, not the steps that belong to another session", async () => {
    const actor = asUser(await makeUser("history-children@senslab.test"));
    const sessionId = await calibrate(actor, { seed: 1_000_003n });
    const recommendationId = (await getHistory(actor)).items[0]?.recommendationId;
    expect(recommendationId).toBeDefined();

    const offer = await validationOfferFor(actor, recommendationId ?? "");
    expect(offer?.offered).toBe(true);
    const step = await startValidation(actor, {
      recommendationId: recommendationId ?? "",
      aspectRatio: 16 / 9,
      environment: {},
    });
    const run = runPlan(step.plan, {
      skillByCandidate: new Map([
        [0, 0.55],
        [1, 1],
      ]),
      maxStepDeg: 2.5,
    });
    await submitValidation(actor, {
      sessionId: step.sessionId,
      aggregates: run.aggregates,
      qualityFlags: [],
    });

    // The validation ran and is visible on the result, but it is not a history row of its own:
    // it produced no recommendation, and a row for it would read as a failed calibration.
    const history = await getHistory(actor);
    expect(history.items.map((item) => item.sessionId)).toEqual([sessionId]);
    expect(history.items[0]?.validationVerdict).toBe("improved");
  });

  it("refuses to compare a session with itself", async () => {
    const actor = asUser(await makeUser("compare-self@senslab.test"));
    const sessionId = await calibrate(actor);
    await expect(compareSessions(actor, sessionId, sessionId)).rejects.toThrow();
  });
});

describe("guest claiming — FR-092", () => {
  beforeEach(async () => {
    await resetVolatileTables();
  });
  afterAll(async () => {
    await closeDb();
  });

  it("moves a guest's sessions and profiles to the account that claims them", async () => {
    const issued = await issueGuestSession();
    const guest = guestActor(issued.guestSessionId);
    const sessionId = await calibrate(guest);

    const userId = await makeUser("claimer@senslab.test");
    const actor = asUser(userId);
    expect((await getHistory(actor)).items).toHaveLength(0);

    const claim = await claimGuestSessionForUser(actor, issued.token);
    expect(claim.claimed).toBe(true);
    expect(claim.sessionsMoved).toBe(1);

    const history = await getHistory(actor);
    expect(history.items.map((item) => item.sessionId)).toEqual([sessionId]);
    const [row] = await db()
      .select({ userId: testSessions.userId, guestSessionId: testSessions.guestSessionId })
      .from(testSessions)
      .where(eq(testSessions.id, sessionId));
    expect(row?.userId).toBe(userId);
    expect(row?.guestSessionId).toBeNull();
  });

  it("refuses a second account claiming the same guest session", async () => {
    const issued = await issueGuestSession();
    await calibrate(guestActor(issued.guestSessionId));

    const first = asUser(await makeUser("first-claimer@senslab.test"));
    expect((await claimGuestSessionForUser(first, issued.token)).claimed).toBe(true);

    const second = asUser(await makeUser("second-claimer@senslab.test"));
    const attempt = await claimGuestSessionForUser(second, issued.token);
    expect(attempt.claimed).toBe(false);
    expect(attempt.reason).toBe("already_claimed");
    expect((await getHistory(second)).items).toHaveLength(0);
    expect((await getHistory(first)).items).toHaveLength(1);
  });
});

describe("account management and privacy — FR-097, FR-098", () => {
  beforeEach(async () => {
    await resetVolatileTables();
  });
  afterAll(async () => {
    await closeDb();
  });

  it("reads and edits the profile", async () => {
    const actor = asUser(await makeUser("account@senslab.test"));
    const before = await getAccount(actor);
    expect(before?.email).toBe("account@senslab.test");
    expect(before?.displayName).toBeNull();
    expect(before?.status).toBe("active");

    await updateDisplayName(actor, "  Zhi  ");
    expect((await getAccount(actor))?.displayName).toBe("Zhi");
    await updateDisplayName(actor, "   ");
    expect((await getAccount(actor))?.displayName).toBeNull();
  });

  it("requires the current password to change it, and signs every session out", async () => {
    const email = "password@senslab.test";
    const actor = asUser(await makeUser(email));
    const signedIn = await signIn({ email, password: PASSWORD });
    expect(signedIn.sessionToken).not.toBeNull();

    await expect(
      changePassword(actor, {
        currentPassword: "wrong-password-entirely",
        newPassword: "a".repeat(16),
      }),
    ).rejects.toThrow();

    const changed = await changePassword(actor, {
      currentPassword: PASSWORD,
      newPassword: "a-much-better-passphrase",
    });
    expect(changed.revokedSessions).toBeGreaterThanOrEqual(1);

    // The old password stops working; the new one is what signs in.
    expect((await signIn({ email, password: PASSWORD })).sessionToken).toBeNull();
    expect(
      (await signIn({ email, password: "a-much-better-passphrase" })).sessionToken,
    ).not.toBeNull();
  });

  it("exports everything the account owns and nothing it does not", async () => {
    const actor = asUser(await makeUser("export@senslab.test"));
    const stranger = asUser(await makeUser("export-stranger@senslab.test"));
    await createProfile(actor, { name: "Main", dpi: 800, dpiSource: "known" });
    const sessionId = await calibrate(actor);
    await calibrate(stranger, { seed: 1_000_004n });

    const result = await exportAccountData(actor);
    expect(result.filename).toMatch(/^senslab-export-\d{4}-\d{2}-\d{2}\.json$/);
    const document = JSON.parse(result.json) as Record<string, unknown>;

    const sessions = document["sessions"] as { id: string; seed: string }[];
    expect(sessions.map((session) => session.id)).toEqual([sessionId]);
    // The 64-bit seed survives as a decimal string, so an exported session can be replayed.
    expect(sessions[0]?.seed).toMatch(/^[0-9]+$/);
    expect((document["hardwareProfiles"] as unknown[]).length).toBe(1);
    expect((document["recommendations"] as unknown[]).length).toBe(1);
    expect((document["trials"] as unknown[]).length).toBeGreaterThan(0);
    expect((document["trialMetrics"] as unknown[]).length).toBeGreaterThan(0);
    expect((document["dimensionScores"] as unknown[]).length).toBe(6);

    // No credential material, and nothing belonging to the other account.
    expect(result.json).not.toContain("$argon2");
    expect(result.json).not.toContain("export-stranger@senslab.test");
  });

  it("schedules deletion, locks sign-in, and can be cancelled inside the window", async () => {
    const email = "deleter@senslab.test";
    const userId = await makeUser(email);
    const actor = asUser(userId);
    await calibrate(actor);

    await expect(requestAccountDeletion(actor, "not-the-password")).rejects.toThrow();

    const schedule = await requestAccountDeletion(actor, PASSWORD);
    const days = (new Date(schedule.purgeAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(DELETION_WINDOW_DAYS - 1);
    expect(days).toBeLessThan(DELETION_WINDOW_DAYS + 1);

    // Locked out, but nothing removed yet.
    expect((await signIn({ email, password: PASSWORD })).sessionToken).toBeNull();
    expect((await getHistory(actor)).items).toHaveLength(1);
    expect((await getAccount(actor))?.deletionScheduledAt).not.toBeNull();

    await cancelAccountDeletion(actor);
    expect((await getAccount(actor))?.status).toBe("active");
    expect((await signIn({ email, password: PASSWORD })).sessionToken).not.toBeNull();
  });

  it("purges the account once the window has elapsed, and expired guest sessions with it", async () => {
    const actor = asUser(await makeUser("purge@senslab.test"));
    await calibrate(actor);
    await requestAccountDeletion(actor, PASSWORD);

    // Nothing is due yet.
    expect((await runRetentionSweep(new Date())).accountsPurged).toBe(0);

    const afterWindow = new Date(Date.now() + (DELETION_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000);
    const swept = await runRetentionSweep(afterWindow);
    expect(swept.accountsPurged).toBe(1);

    // The user row and everything cascading from it is gone.
    expect(
      await db().select({ id: users.id }).from(users).where(eq(users.email, "purge@senslab.test")),
    ).toHaveLength(0);
    expect(await db().select({ id: testSessions.id }).from(testSessions)).toHaveLength(0);

    // And an unclaimed guest session goes in the same sweep once it expires (`SENS-BR-003`).
    await issueGuestSession();
    const afterGuestExpiry = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000);
    expect((await runRetentionSweep(afterGuestExpiry)).guestSessionsPurged).toBeGreaterThanOrEqual(
      1,
    );
  });

  it("keeps account reads and writes to the signed-in user", async () => {
    const guest = guestActor((await issueGuestSession()).guestSessionId);
    await expect(getAccount(guest)).rejects.toThrow();
    await expect(exportAccountData(guest)).rejects.toThrow();
    await expect(requestAccountDeletion(guest, PASSWORD)).rejects.toThrow();
    try {
      await getAccount(guest);
    } catch (error: unknown) {
      expect(isAppError(error)).toBe(true);
    }
  });
});
