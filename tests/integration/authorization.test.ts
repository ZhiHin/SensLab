import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import { guestRepo, hardwareRepo, sessionRepo, userRepo, withTransaction } from "@/repositories";
import { anonymousActor } from "@/repositories/actor";
import { hashPassword } from "@/lib/password";
import { generateToken, hashToken } from "@/lib/crypto";
import {
  asGuest,
  asUser,
  currentAlgorithmVersionIds,
  makeEnvironmentFingerprint,
  makeHardwareSnapshot,
  resetVolatileTables,
  testSeed,
} from "@tests/helpers/db";

/**
 * Cross-tenant authorisation (doc 23 §23.4, `SENS-BR-034`).
 *
 * This is the suite that keeps ownership honest. It enumerates every owned resource and
 * asserts that a second actor cannot read, update or delete the first actor's data through
 * the repository layer — which is the only path to the database.
 *
 * The assertion is deliberately "returns nothing / throws not-found", never "returns 403":
 * a 403 confirms the row exists, which is itself a disclosure.
 */

const PEPPER = "integration-test-pepper-value-at-least-32-chars";

async function makeUser(email: string): Promise<string> {
  const { userId } = await userRepo.createUser({
    email,
    passwordHash: await hashPassword("correct-horse-battery"),
  });
  return userId;
}

async function makeSessionFor(actor: ReturnType<typeof asUser>, profileId: string | null) {
  const versions = await currentAlgorithmVersionIds();
  return sessionRepo.createTestSession(actor, {
    hardwareProfileId: profileId,
    hardwareSnapshot: makeHardwareSnapshot(),
    primaryGameVersionId: null,
    mode: "standard",
    environment: makeEnvironmentFingerprint(),
    environmentClass: "pass",
    seed: testSeed(),
    ...versions,
  });
}

describe("cross-tenant access", () => {
  beforeEach(async () => {
    await resetVolatileTables();
  });

  afterAll(async () => {
    await closeDb();
  });

  it("hides another user's hardware profile from reads", async () => {
    const alice = asUser(await makeUser("alice@example.test"));
    const bob = asUser(await makeUser("bob@example.test"));

    const profile = await hardwareRepo.createHardwareProfile(alice, {
      name: "Main Setup",
      dpi: 800,
      dpiSource: "known",
    });

    expect(await hardwareRepo.getHardwareProfile(alice, profile.id)).not.toBeNull();
    expect(await hardwareRepo.getHardwareProfile(bob, profile.id)).toBeNull();
    expect(await hardwareRepo.listHardwareProfiles(bob)).toEqual([]);
  });

  it("refuses to update or delete another user's hardware profile", async () => {
    const alice = asUser(await makeUser("alice2@example.test"));
    const bob = asUser(await makeUser("bob2@example.test"));

    const profile = await hardwareRepo.createHardwareProfile(alice, {
      name: "Main Setup",
      dpi: 800,
      dpiSource: "known",
    });

    await expect(
      hardwareRepo.updateHardwareProfile(bob, profile.id, { name: "Stolen" }),
    ).rejects.toThrow(/not found/i);

    await expect(hardwareRepo.softDeleteHardwareProfile(bob, profile.id)).rejects.toThrow(
      /not found/i,
    );

    // Alice's row is untouched.
    const after = await hardwareRepo.getHardwareProfile(alice, profile.id);
    expect(after?.name).toBe("Main Setup");
    expect(after?.deletedAt).toBeNull();
  });

  it("hides another user's calibration session", async () => {
    const alice = asUser(await makeUser("alice3@example.test"));
    const bob = asUser(await makeUser("bob3@example.test"));
    const session = await makeSessionFor(alice, null);

    expect(await sessionRepo.getTestSession(alice, session.id)).not.toBeNull();
    expect(await sessionRepo.getTestSession(bob, session.id)).toBeNull();
    expect(await sessionRepo.listTestSessions(bob)).toEqual([]);
  });

  it("refuses to change another user's session status", async () => {
    const alice = asUser(await makeUser("alice4@example.test"));
    const bob = asUser(await makeUser("bob4@example.test"));
    const session = await makeSessionFor(alice, null);

    await expect(sessionRepo.updateSessionStatus(bob, session.id, "completed")).rejects.toThrow(
      /not found/i,
    );

    const after = await sessionRepo.getTestSession(alice, session.id);
    expect(after?.status).toBe("created");
  });

  it("gives an anonymous actor access to nothing", async () => {
    const alice = asUser(await makeUser("alice5@example.test"));
    const profile = await hardwareRepo.createHardwareProfile(alice, {
      name: "Main Setup",
      dpi: 800,
      dpiSource: "known",
    });
    const session = await makeSessionFor(alice, profile.id);

    expect(await hardwareRepo.listHardwareProfiles(anonymousActor)).toEqual([]);
    expect(await hardwareRepo.getHardwareProfile(anonymousActor, profile.id)).toBeNull();
    expect(await sessionRepo.listTestSessions(anonymousActor)).toEqual([]);
    expect(await sessionRepo.getTestSession(anonymousActor, session.id)).toBeNull();
    await expect(
      hardwareRepo.createHardwareProfile(anonymousActor, {
        name: "x",
        dpi: 800,
        dpiSource: "known",
      }),
    ).rejects.toThrow();
  });

  it("keeps one guest's data invisible to another guest", async () => {
    const tokenA = generateToken();
    const tokenB = generateToken();
    const guestA = asGuest(
      await guestRepo.createGuestSession({
        tokenHash: hashToken(tokenA, PEPPER),
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    );
    const guestB = asGuest(
      await guestRepo.createGuestSession({
        tokenHash: hashToken(tokenB, PEPPER),
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    );

    const profile = await hardwareRepo.createHardwareProfile(guestA, {
      name: "Guest setup",
      dpi: 1600,
      dpiSource: "assumed",
    });

    expect(await hardwareRepo.getHardwareProfile(guestA, profile.id)).not.toBeNull();
    expect(await hardwareRepo.getHardwareProfile(guestB, profile.id)).toBeNull();
  });

  it("does not let a signed-in user reach guest-owned rows they have not claimed", async () => {
    const token = generateToken();
    const guest = asGuest(
      await guestRepo.createGuestSession({
        tokenHash: hashToken(token, PEPPER),
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    );
    const profile = await hardwareRepo.createHardwareProfile(guest, {
      name: "Guest setup",
      dpi: 800,
      dpiSource: "known",
    });

    const mallory = asUser(await makeUser("mallory@example.test"));
    expect(await hardwareRepo.getHardwareProfile(mallory, profile.id)).toBeNull();
  });
});

describe("the guest claim flow — doc 23 §23.6", () => {
  beforeEach(async () => {
    await resetVolatileTables();
  });

  it("moves a guest's sessions and profiles to the claiming account", async () => {
    const token = generateToken();
    const guestSessionId = await guestRepo.createGuestSession({
      tokenHash: hashToken(token, PEPPER),
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const guest = asGuest(guestSessionId);

    const profile = await hardwareRepo.createHardwareProfile(guest, {
      name: "Guest setup",
      dpi: 800,
      dpiSource: "known",
    });
    const versions = await currentAlgorithmVersionIds();
    await sessionRepo.createTestSession(guest, {
      hardwareProfileId: profile.id,
      hardwareSnapshot: makeHardwareSnapshot(),
      primaryGameVersionId: null,
      mode: "quick",
      environment: makeEnvironmentFingerprint(),
      environmentClass: "pass",
      seed: testSeed(),
      ...versions,
    });

    const userId = await makeUser("claimer@example.test");
    const result = await withTransaction((tx) =>
      guestRepo.claimGuestSession(hashToken(token, PEPPER), userId, new Date(), tx),
    );

    expect(result.claimed).toBe(true);
    expect(result.sessionsMoved).toBe(1);
    expect(result.hardwareProfilesMoved).toBe(1);

    // The work is now the user's, and the guest can no longer see it.
    const user = asUser(userId);
    expect(await sessionRepo.listTestSessions(user)).toHaveLength(1);
    expect(await hardwareRepo.listHardwareProfiles(user)).toHaveLength(1);
    expect(await sessionRepo.listTestSessions(guest)).toHaveLength(0);
  });

  it("is idempotent: a second claim by the same user is a no-op, not an error", async () => {
    const token = generateToken();
    await guestRepo.createGuestSession({
      tokenHash: hashToken(token, PEPPER),
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const userId = await makeUser("idempotent@example.test");

    const first = await withTransaction((tx) =>
      guestRepo.claimGuestSession(hashToken(token, PEPPER), userId, new Date(), tx),
    );
    const second = await withTransaction((tx) =>
      guestRepo.claimGuestSession(hashToken(token, PEPPER), userId, new Date(), tx),
    );

    expect(first.claimed).toBe(true);
    expect(second.claimed).toBe(false);
    expect(second.reason).toBe("already_claimed");
  });

  it("refuses a second account trying to claim an already-claimed session", async () => {
    const token = generateToken();
    await guestRepo.createGuestSession({
      tokenHash: hashToken(token, PEPPER),
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const first = await makeUser("first@example.test");
    const second = await makeUser("second@example.test");

    await withTransaction((tx) =>
      guestRepo.claimGuestSession(hashToken(token, PEPPER), first, new Date(), tx),
    );
    const attempt = await withTransaction((tx) =>
      guestRepo.claimGuestSession(hashToken(token, PEPPER), second, new Date(), tx),
    );

    expect(attempt.claimed).toBe(false);
    expect(attempt.reason).toBe("already_claimed");
  });

  it("rejects an unknown token without disclosing anything", async () => {
    const userId = await makeUser("unknown-token@example.test");
    const attempt = await withTransaction((tx) =>
      guestRepo.claimGuestSession(hashToken(generateToken(), PEPPER), userId, new Date(), tx),
    );
    expect(attempt.claimed).toBe(false);
    expect(attempt.reason).toBe("unknown");
  });

  it("refuses to claim an expired guest session — SENS-BR-003", async () => {
    const token = generateToken();
    await guestRepo.createGuestSession({
      tokenHash: hashToken(token, PEPPER),
      expiresAt: new Date(Date.now() - 1000),
    });
    const userId = await makeUser("expired@example.test");

    const attempt = await withTransaction((tx) =>
      guestRepo.claimGuestSession(hashToken(token, PEPPER), userId, new Date(), tx),
    );
    expect(attempt.claimed).toBe(false);
    expect(attempt.reason).toBe("expired");
  });

  it("resolves a guest session only by its token hash", async () => {
    const token = generateToken();
    const guestSessionId = await guestRepo.createGuestSession({
      tokenHash: hashToken(token, PEPPER),
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const resolved = await guestRepo.resolveGuestSessionByTokenHash(
      hashToken(token, PEPPER),
      new Date(),
    );
    expect(resolved?.guestSessionId).toBe(guestSessionId);

    // A different pepper — i.e. an attacker who has the id but not the secret — resolves nothing.
    expect(
      await guestRepo.resolveGuestSessionByTokenHash(hashToken(token, "other-pepper"), new Date()),
    ).toBeNull();
  });

  it("purges expired, unclaimed guest sessions and cascades their data", async () => {
    const token = generateToken();
    const guestSessionId = await guestRepo.createGuestSession({
      tokenHash: hashToken(token, PEPPER),
      expiresAt: new Date(Date.now() - 1000),
    });
    const guest = asGuest(guestSessionId);
    await hardwareRepo.createHardwareProfile(guest, {
      name: "Expiring",
      dpi: 800,
      dpiSource: "known",
    });

    const purged = await guestRepo.purgeExpiredGuestSessions(new Date());
    expect(purged).toBe(1);
    expect(await hardwareRepo.listHardwareProfiles(guest)).toEqual([]);
  });
});
