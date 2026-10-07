import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { navlogFor } from "../../tests/support/tracker-scenarios";
import { localTestDatabaseUrl } from "../../tests/support/local-test-db";
import { createInitialSnapshot } from "../domain/engine";
import { reserveOfpLoad } from "./load-reservation";
import { loadOfpForAccount } from "./ofp-load";
import { loadReservation, ofpLoad, ofpRaw, tracker, user } from "./schema";

const testUrl = localTestDatabaseUrl(process.env.TEST_DATABASE_URL);
const pool = testUrl ? new Pool({ connectionString: testUrl }) : undefined;
const db = pool ? drizzle(pool) : undefined;
const navlog = navlogFor("valid-domestic.json");
const payload = { source: "synthetic", route: ["A", "B"] };
const work = async () => ({ rawPayload: payload, navlog });

afterAll(async () => { await pool?.end(); });

async function account() {
  if (!db) throw new Error("TEST_DATABASE_URL is required");
  const id = randomUUID();
  await db.insert(user).values({ id, name: "Test Pilot", email: `${id}@example.invalid` });
  return id;
}

async function rowsFor(accountId: string, key: string) {
  if (!db) throw new Error("TEST_DATABASE_URL is required");
  const loads = await db.select().from(ofpLoad).where(eq(ofpLoad.userId, accountId));
  const matching = loads.filter((load) => load.idempotencyKey === key);
  const raws = matching.length ? await db.select().from(ofpRaw).where(eq(ofpRaw.loadId, matching[0].id)) : [];
  const trackers = matching.length ? await db.select().from(tracker).where(eq(tracker.loadId, matching[0].id)) : [];
  return { loads: matching, raws, trackers };
}

describe.runIf(Boolean(testUrl))("transactional OFP load against local PostgreSQL", () => {
  it("commits metadata, unchanged raw JSON, and the initial tracker together", async () => {
    const accountId = await account();
    const result = await loadOfpForAccount(db!, accountId, "success", work);
    expect(result.outcome).toBe("created");
    if (result.outcome !== "created") throw new Error("expected created");
    const { loads, raws, trackers } = await rowsFor(accountId, "success");
    expect(loads).toHaveLength(1);
    expect(loads[0]).toMatchObject({
      userId: accountId, idempotencyKey: "success",
      flightNumber: navlog.metadata.flightNumber,
      originIcaoCode: navlog.metadata.originIcaoCode,
      destinationIcaoCode: navlog.metadata.destinationIcaoCode,
      generatedAt: new Date(navlog.metadata.generatedAtUnixSeconds * 1000),
    });
    expect(raws).toHaveLength(1);
    expect(raws[0].payload).toEqual(payload);
    expect(trackers).toHaveLength(1);
    expect(trackers[0].id).toBe(result.trackerId);
    expect(trackers[0].navlog).toEqual(navlog);
    expect(trackers[0].version).toBe(1);
    expect(trackers[0].snapshot).toEqual({ ...createInitialSnapshot(navlog), version: 1 });
    expect(result.snapshot).toEqual(trackers[0].snapshot);
    const [reservation] = await db!.select({ activeKey: loadReservation.activeKey, acceptedAt: loadReservation.acceptedAt })
      .from(loadReservation).where(eq(loadReservation.userId, accountId));
    expect(reservation.activeKey).toBeNull();
    expect(reservation.acceptedAt).not.toBeNull();
  });

  it("replays a completed same-key action without calling OFP work", async () => {
    const accountId = await account();
    const created = await loadOfpForAccount(db!, accountId, "replay", work);
    if (created.outcome !== "created") throw new Error("expected created");
    let workCalls = 0;
    const replay = await loadOfpForAccount(db!, accountId, "replay", async () => {
      workCalls += 1;
      return work();
    });
    expect(replay).toEqual({ outcome: "completed", trackerId: created.trackerId });
    expect(workCalls).toBe(0);
    expect((await rowsFor(accountId, "replay")).loads).toHaveLength(1);
  });

  it("clears only its failed attempt and retains the cooldown", async () => {
    const accountId = await account();
    const result = await loadOfpForAccount(db!, accountId, "failed", async () => {
      throw new Error("synthetic work failure");
    });
    expect(result).toEqual({ outcome: "failed" });
    const [reservation] = await db!.select({
      activeKey: loadReservation.activeKey,
      acceptedAt: sql<string>`${loadReservation.acceptedAt}::text`,
    }).from(loadReservation).where(eq(loadReservation.userId, accountId));
    expect(reservation.activeKey).toBeNull();
    expect(reservation.acceptedAt).toBeTruthy();
    expect((await rowsFor(accountId, "failed")).loads).toHaveLength(0);
    let workCalls = 0;
    const retry = await loadOfpForAccount(db!, accountId, "failed", async () => {
      workCalls += 1;
      return work();
    });
    expect(retry.outcome).toBe("wait");
    expect(workCalls).toBe(0);
    const [retained] = await db!.select({ acceptedAt: sql<string>`${loadReservation.acceptedAt}::text` })
      .from(loadReservation).where(eq(loadReservation.userId, accountId));
    expect(retained.acceptedAt).toBe(reservation.acceptedAt);
  });

  it("rejects invalid prepared JSON before any load row is written", async () => {
    const accountId = await account();
    const result = await loadOfpForAccount(db!, accountId, "invalid", async () => ({
      rawPayload: { invalid: undefined }, navlog,
    }));
    expect(result).toEqual({ outcome: "failed" });
    expect((await rowsFor(accountId, "invalid")).loads).toHaveLength(0);
  });

  it("rejects a non-object raw OFP before opening the transaction", async () => {
    const accountId = await account();
    const result = await loadOfpForAccount(db!, accountId, "not-object", async () => ({
      rawPayload: null, navlog,
    }));
    expect(result).toEqual({ outcome: "failed" });
    expect((await rowsFor(accountId, "not-object")).loads).toHaveLength(0);
  });

  it("rejects an invalid normalized navlog before any load row is written", async () => {
    const accountId = await account();
    const result = await loadOfpForAccount(db!, accountId, "bad-navlog", async () => ({
      rawPayload: payload,
      navlog: { ...navlog, points: [{ ...navlog.points[0], longitude: "INVALID" }] },
    }));
    expect(result).toEqual({ outcome: "failed" });
    expect((await rowsFor(accountId, "bad-navlog")).loads).toHaveLength(0);
  });

  it("rolls back metadata when raw JSONB insertion fails", async () => {
    const accountId = await account();
    await expect(loadOfpForAccount(db!, accountId, "rollback", async () => ({
      rawPayload: { unsupportedPostgresJson: "\u0000" }, navlog,
    }))).rejects.toThrow("OFP load could not be saved");
    const rows = await rowsFor(accountId, "rollback");
    expect(rows.loads).toHaveLength(0);
    expect(rows.raws).toHaveLength(0);
    expect(rows.trackers).toHaveLength(0);
    const [reservation] = await db!.select({ activeKey: loadReservation.activeKey, acceptedAt: loadReservation.acceptedAt })
      .from(loadReservation).where(eq(loadReservation.userId, accountId));
    expect(reservation.activeKey).toBeNull();
    expect(reservation.acceptedAt).not.toBeNull();
  });

  it("does not clear a newer reservation when an old attempt fails late", async () => {
    const accountId = await account();
    const result = await loadOfpForAccount(db!, accountId, "old", async () => {
      await db!.update(loadReservation).set({ acceptedAt: sql`clock_timestamp() - interval '31 seconds'` })
        .where(eq(loadReservation.userId, accountId));
      const newer = await reserveOfpLoad(db!, accountId, "new");
      expect(newer.outcome).toBe("claimed");
      throw new Error("old work failed");
    });
    expect(result).toEqual({ outcome: "failed" });
    const [reservation] = await db!.select({ activeKey: loadReservation.activeKey })
      .from(loadReservation).where(eq(loadReservation.userId, accountId));
    expect(reservation.activeKey).toBe("new");
  });

  it("matches the exact attempt timestamp even when a newer claim reuses the key", async () => {
    const accountId = await account();
    let newerAcceptedAt = "";
    const result = await loadOfpForAccount(db!, accountId, "same", async () => {
      await db!.update(loadReservation).set({ acceptedAt: sql`clock_timestamp() - interval '31 seconds'` })
        .where(eq(loadReservation.userId, accountId));
      const newer = await reserveOfpLoad(db!, accountId, "same");
      expect(newer.outcome).toBe("claimed");
      if (newer.outcome === "claimed") newerAcceptedAt = newer.acceptedAt;
      throw new Error("older same-key work failed");
    });
    expect(result).toEqual({ outcome: "failed" });
    const [reservation] = await db!.select({
      activeKey: loadReservation.activeKey,
      acceptedAt: sql<string>`${loadReservation.acceptedAt}::text`,
    }).from(loadReservation).where(eq(loadReservation.userId, accountId));
    expect(reservation).toEqual({ activeKey: "same", acceptedAt: newerAcceptedAt });
  });

  it("keeps same-key successful loads separate across accounts", async () => {
    const firstAccount = await account();
    const secondAccount = await account();
    const [first, second] = await Promise.all([
      loadOfpForAccount(db!, firstAccount, "shared", work),
      loadOfpForAccount(db!, secondAccount, "shared", work),
    ]);
    expect(first.outcome).toBe("created");
    expect(second.outcome).toBe("created");
    if (first.outcome !== "created" || second.outcome !== "created") throw new Error("expected created");
    expect(first.trackerId).not.toBe(second.trackerId);
    expect((await rowsFor(firstAccount, "shared")).trackers[0].userId).toBe(firstAccount);
    expect((await rowsFor(secondAccount, "shared")).trackers[0].userId).toBe(secondAccount);
  });

  it("uses account-key uniqueness as the final duplicate guard", async () => {
    const accountId = await account();
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    let releaseFirst!: () => void;
    const firstMayFinish = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const first = loadOfpForAccount(db!, accountId, "duplicate", async () => {
      signalStarted();
      await firstMayFinish;
      return work();
    });
    await started;
    try {
      await db!.update(loadReservation).set({ acceptedAt: sql`clock_timestamp() - interval '31 seconds'` })
        .where(eq(loadReservation.userId, accountId));
      const second = await loadOfpForAccount(db!, accountId, "duplicate", work);
      expect(second.outcome).toBe("created");
      releaseFirst();
      const late = await first;
      expect(late).toEqual({ outcome: "completed", trackerId: second.outcome === "created" ? second.trackerId : "" });
      const rows = await rowsFor(accountId, "duplicate");
      expect(rows.loads).toHaveLength(1);
      expect(rows.raws).toHaveLength(1);
      expect(rows.trackers).toHaveLength(1);
    } finally {
      releaseFirst();
    }
  });
});
