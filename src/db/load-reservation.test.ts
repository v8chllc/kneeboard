import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { navlogFor } from "../../tests/support/tracker-scenarios";
import { localTestDatabaseUrl } from "../../tests/support/local-test-db";
import { createInitialSnapshot } from "../domain/engine";
import { reserveOfpLoad } from "./load-reservation";
import { loadReservation, ofpLoad, tracker, user } from "./schema";

const testUrl = localTestDatabaseUrl(process.env.TEST_DATABASE_URL);
const pool = testUrl ? new Pool({ connectionString: testUrl }) : undefined;
const db = pool ? drizzle(pool) : undefined;
const navlog = navlogFor("valid-domestic.json");

afterAll(async () => { await pool?.end(); });

async function account() {
  if (!db) throw new Error("TEST_DATABASE_URL is required");
  const id = randomUUID();
  await db.insert(user).values({ id, name: "Test Pilot", email: `${id}@example.invalid` });
  return id;
}

async function completedTracker(accountId: string, key: string) {
  if (!db) throw new Error("TEST_DATABASE_URL is required");
  const loadId = randomUUID();
  const trackerId = randomUUID();
  await db.insert(ofpLoad).values({
    id: loadId, userId: accountId, idempotencyKey: key,
    flightNumber: "TEST1", originIcaoCode: "KORD", destinationIcaoCode: "KJFK",
    generatedAt: new Date("2026-01-01T00:00:00Z"),
  });
  await db.insert(tracker).values({
    id: trackerId, userId: accountId, loadId, navlog,
    snapshot: { ...createInitialSnapshot(navlog), version: 1 }, version: 1,
  });
  return trackerId;
}

describe.runIf(Boolean(testUrl))("OFP load reservation against local PostgreSQL", () => {
  it("claims with database time and returns a precision-preserving attempt token", async () => {
    const accountId = await account();
    const result = await reserveOfpLoad(db!, accountId, "first");
    expect(result.outcome).toBe("claimed");
    if (result.outcome !== "claimed") throw new Error("expected claimed");
    const [stored] = await db!.select({
      activeKey: loadReservation.activeKey,
      acceptedAt: sql<string>`${loadReservation.acceptedAt}::text`,
      ageMs: sql<number>`extract(epoch from (statement_timestamp() - ${loadReservation.acceptedAt})) * 1000`,
    }).from(loadReservation).where(eq(loadReservation.userId, accountId));
    expect(stored.activeKey).toBe("first");
    expect(stored.acceptedAt).toBe(result.acceptedAt);
    expect(Number(stored.ageMs)).toBeGreaterThanOrEqual(0);
    expect(Number(stored.ageMs)).toBeLessThan(30000);
  });

  it("returns in-progress for the active key without replacing its attempt", async () => {
    const accountId = await account();
    const first = await reserveOfpLoad(db!, accountId, "same");
    const second = await reserveOfpLoad(db!, accountId, "same");
    expect(first.outcome).toBe("claimed");
    expect(second).toMatchObject({ outcome: "inProgress" });
    if (second.outcome !== "inProgress" || first.outcome !== "claimed") throw new Error("wrong reservation states");
    expect(second.remainingMs).toBeGreaterThan(0);
    expect(second.remainingMs).toBeLessThanOrEqual(30000);
    const [stored] = await db!.select({ acceptedAt: sql<string>`${loadReservation.acceptedAt}::text` })
      .from(loadReservation).where(eq(loadReservation.userId, accountId));
    expect(stored.acceptedAt).toBe(first.acceptedAt);
  });

  it("returns remaining cooldown for a different active key", async () => {
    const accountId = await account();
    await reserveOfpLoad(db!, accountId, "first");
    const result = await reserveOfpLoad(db!, accountId, "second");
    expect(result).toMatchObject({ outcome: "wait" });
    if (result.outcome !== "wait") throw new Error("expected wait");
    expect(result.remainingMs).toBeGreaterThan(0);
    expect(result.remainingMs).toBeLessThanOrEqual(30000);
    const [stored] = await db!.select({ activeKey: loadReservation.activeKey })
      .from(loadReservation).where(eq(loadReservation.userId, accountId));
    expect(stored.activeKey).toBe("first");
  });

  it("replays a completed same-key load ahead of cooldown", async () => {
    const accountId = await account();
    await reserveOfpLoad(db!, accountId, "replay");
    const trackerId = await completedTracker(accountId, "replay");
    expect(await reserveOfpLoad(db!, accountId, "replay"))
      .toEqual({ outcome: "completed", trackerId });
  });

  it("does not replay another account's completed key", async () => {
    const firstAccount = await account();
    const secondAccount = await account();
    await completedTracker(firstAccount, "shared");
    expect((await reserveOfpLoad(db!, secondAccount, "shared")).outcome).toBe("claimed");
  });

  it("retains cooldown after failure and allows a new claim after expiry", async () => {
    const accountId = await account();
    await reserveOfpLoad(db!, accountId, "failed");
    await db!.update(loadReservation).set({ activeKey: null })
      .where(eq(loadReservation.userId, accountId));
    expect((await reserveOfpLoad(db!, accountId, "failed")).outcome).toBe("wait");
    await db!.update(loadReservation).set({ acceptedAt: sql`now() - interval '31 seconds'` })
      .where(eq(loadReservation.userId, accountId));
    const result = await reserveOfpLoad(db!, accountId, "next");
    expect(result.outcome).toBe("claimed");
    const [stored] = await db!.select({ activeKey: loadReservation.activeKey })
      .from(loadReservation).where(eq(loadReservation.userId, accountId));
    expect(stored.activeKey).toBe("next");
  });

  it("accepts only one of two simultaneous same-key requests", async () => {
    const accountId = await account();
    const results = await Promise.all([
      reserveOfpLoad(db!, accountId, "same"),
      reserveOfpLoad(db!, accountId, "same"),
    ]);
    expect(results.map((result) => result.outcome).sort()).toEqual(["claimed", "inProgress"]);
  });

  it("accepts only one of two simultaneous different-key requests", async () => {
    const accountId = await account();
    const results = await Promise.all([
      reserveOfpLoad(db!, accountId, "a"),
      reserveOfpLoad(db!, accountId, "b"),
    ]);
    expect(results.map((result) => result.outcome).sort()).toEqual(["claimed", "wait"]);
  });

  it("keeps reservations independent across accounts", async () => {
    const firstAccount = await account();
    const secondAccount = await account();
    const results = await Promise.all([
      reserveOfpLoad(db!, firstAccount, "same"),
      reserveOfpLoad(db!, secondAccount, "same"),
    ]);
    expect(results.map((result) => result.outcome)).toEqual(["claimed", "claimed"]);
    const [first, second] = await Promise.all([
      db!.select({ userId: loadReservation.userId, activeKey: loadReservation.activeKey })
        .from(loadReservation).where(eq(loadReservation.userId, firstAccount)),
      db!.select({ userId: loadReservation.userId, activeKey: loadReservation.activeKey })
        .from(loadReservation).where(eq(loadReservation.userId, secondAccount)),
    ]);
    expect(first).toEqual([{ userId: firstAccount, activeKey: "same" }]);
    expect(second).toEqual([{ userId: secondAccount, activeKey: "same" }]);
  });
});
