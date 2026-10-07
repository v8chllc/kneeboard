import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { eligibleOf, navlogFor } from "../../tests/support/tracker-scenarios";
import { localTestDatabaseUrl } from "../../tests/support/local-test-db";
import { loadOfpForAccount } from "./ofp-load";
import { tracker, user } from "./schema";
import { compareAndSwapTrackerSnapshot, mutateTracker } from "./tracker-operations";

const testUrl = localTestDatabaseUrl(process.env.TEST_DATABASE_URL);
const pool = testUrl ? new Pool({ connectionString: testUrl }) : undefined;
const db = pool ? drizzle(pool) : undefined;
const navlog = navlogFor("valid-domestic.json");
const firstFix = eligibleOf(navlog)[0];

afterAll(async () => { await pool?.end(); });

async function seededTracker() {
  if (!db) throw new Error("TEST_DATABASE_URL is required");
  const accountId = randomUUID();
  await db.insert(user).values({ id: accountId, name: "Test Pilot", email: `${accountId}@example.invalid` });
  const result = await loadOfpForAccount(db, accountId, randomUUID(), async () => ({
    rawPayload: { source: "synthetic" }, navlog,
  }));
  if (result.outcome !== "created") throw new Error("expected created");
  return { accountId, trackerId: result.trackerId };
}

describe.runIf(Boolean(testUrl))("tracker compare-and-swap against local PostgreSQL", () => {
  it("persists the complete command result and increments both versions", async () => {
    const { accountId, trackerId } = await seededTracker();
    const result = await mutateTracker(db!, accountId, trackerId, {
      type: "saveWaypoint", routeIndex: firstFix, expectedVersion: 1,
    });
    expect(result.outcome).toBe("applied");
    if (result.outcome !== "applied") throw new Error("expected applied");
    expect(result.snapshot.version).toBe(2);
    expect(result.snapshot.waypoints.find((entry) => entry.routeIndex === firstFix)?.state).toBe("saved");
    const [stored] = await db!.select({ snapshot: tracker.snapshot, version: tracker.version })
      .from(tracker).where(eq(tracker.id, trackerId));
    expect(stored.version).toBe(2);
    expect(stored.snapshot).toEqual(result.snapshot);
  });

  it("allows exactly one concurrent writer and reports the other as stale", async () => {
    const { accountId, trackerId } = await seededTracker();
    const command = { type: "saveWaypoint" as const, routeIndex: firstFix, expectedVersion: 1 };
    const results = await Promise.all([
      mutateTracker(db!, accountId, trackerId, command),
      mutateTracker(db!, accountId, trackerId, command),
    ]);
    expect(results.map((result) => result.outcome).sort()).toEqual(["applied", "stale"]);
    const [stored] = await db!.select({ version: tracker.version }).from(tracker)
      .where(eq(tracker.id, trackerId));
    expect(stored.version).toBe(2);
  });

  it("rejects a lost compare-and-swap race at the write boundary", async () => {
    const { accountId, trackerId } = await seededTracker();
    const [storedBefore] = await db!.select({ snapshot: tracker.snapshot }).from(tracker)
      .where(eq(tracker.id, trackerId));
    const proposed = storedBefore.snapshot;
    const first = await compareAndSwapTrackerSnapshot(db!, accountId, trackerId, 1, proposed);
    const second = await compareAndSwapTrackerSnapshot(db!, accountId, trackerId, 1, proposed);
    expect(first?.version).toBe(2);
    expect(second).toBeNull();
    const [stored] = await db!.select({ version: tracker.version, snapshot: tracker.snapshot })
      .from(tracker).where(eq(tracker.id, trackerId));
    expect(stored.version).toBe(2);
    expect(stored.snapshot.version).toBe(2);
  });

  it("scopes the conditional write to its account", async () => {
    const { trackerId } = await seededTracker();
    const [storedBefore] = await db!.select({ snapshot: tracker.snapshot }).from(tracker)
      .where(eq(tracker.id, trackerId));
    const proposed = storedBefore.snapshot;
    const result = await compareAndSwapTrackerSnapshot(db!, randomUUID(), trackerId, 1, proposed);
    expect(result).toBeNull();
    const [stored] = await db!.select({ version: tracker.version }).from(tracker)
      .where(eq(tracker.id, trackerId));
    expect(stored.version).toBe(1);
  });

  it("reports a version mismatch before entering the transition", async () => {
    const { accountId, trackerId } = await seededTracker();
    const result = await mutateTracker(db!, accountId, trackerId, {
      type: "saveWaypoint", routeIndex: firstFix, expectedVersion: 8,
    });
    expect(result).toEqual({ outcome: "stale", message: "tracker changed; reload and try again" });
    const [stored] = await db!.select({ version: tracker.version }).from(tracker)
      .where(eq(tracker.id, trackerId));
    expect(stored.version).toBe(1);
  });

  it("does not reveal or mutate a tracker owned by another account", async () => {
    const { trackerId } = await seededTracker();
    const result = await mutateTracker(db!, randomUUID(), trackerId, {
      type: "saveWaypoint", routeIndex: firstFix, expectedVersion: 1,
    });
    expect(result).toEqual({ outcome: "notFound" });
    const [stored] = await db!.select({ version: tracker.version }).from(tracker)
      .where(eq(tracker.id, trackerId));
    expect(stored.version).toBe(1);
  });

  it("rejects a domain-invalid command without writing", async () => {
    const { accountId, trackerId } = await seededTracker();
    const result = await mutateTracker(db!, accountId, trackerId, {
      type: "passWaypoint", routeIndex: firstFix, expectedVersion: 1,
    });
    expect(result).toMatchObject({ outcome: "rejected", reason: "notSaved" });
    const [stored] = await db!.select({ version: tracker.version }).from(tracker)
      .where(eq(tracker.id, trackerId));
    expect(stored.version).toBe(1);
  });

  it("fails closed on malformed persisted JSON without writing", async () => {
    const { accountId, trackerId } = await seededTracker();
    await db!.update(tracker).set({
      snapshot: { version: 1, procedureInclusion: { sid: true, star: true }, waypoints: [{ routeIndex: firstFix, state: "INVALID" }] } as never,
    }).where(eq(tracker.id, trackerId));
    await expect(mutateTracker(db!, accountId, trackerId, {
      type: "saveWaypoint", routeIndex: firstFix, expectedVersion: 1,
    })).rejects.toThrow("invalid persisted tracker data");
    const [stored] = await db!.select({ version: tracker.version }).from(tracker)
      .where(eq(tracker.id, trackerId));
    expect(stored.version).toBe(1);
  });

  it("fails closed on malformed persisted navlog without writing", async () => {
    const { accountId, trackerId } = await seededTracker();
    await db!.update(tracker).set({ navlog: { ...navlog, points: [{ ...navlog.points[0], latitude: "INVALID" }] } as never })
      .where(eq(tracker.id, trackerId));
    await expect(mutateTracker(db!, accountId, trackerId, {
      type: "saveWaypoint", routeIndex: firstFix, expectedVersion: 1,
    })).rejects.toThrow("invalid persisted tracker data");
    const [stored] = await db!.select({ version: tracker.version }).from(tracker)
      .where(eq(tracker.id, trackerId));
    expect(stored.version).toBe(1);
  });
});
