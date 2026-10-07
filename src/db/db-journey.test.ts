/** Claim-labeled 6b Journey against the disposable local PostgreSQL database. */
import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { eligibleOf, navlogFor } from "../../tests/support/tracker-scenarios";
import { localTestDatabaseUrl } from "../../tests/support/local-test-db";
import { createInitialSnapshot } from "../domain/engine";
import { reserveOfpLoad } from "./load-reservation";
import { loadOfpForAccount } from "./ofp-load";
import { loadReservation, ofpLoad, ofpRaw, tracker, user } from "./schema";
import { compareAndSwapTrackerSnapshot, mutateTracker } from "./tracker-operations";

const url = localTestDatabaseUrl(process.env.TEST_DATABASE_URL);
// Each pool has one connection. Contending operations cannot share a session.
const pools = url ? [new Pool({ connectionString: url, max: 1 }), new Pool({ connectionString: url, max: 1 })] : [];
const [a, b] = pools.map((pool) => drizzle(pool));
const navlog = navlogFor("valid-domestic.json");
const fix = eligibleOf(navlog)[0];
const rawPayload = { source: "synthetic", route: ["A", "B"] };
const work = async () => ({ rawPayload, navlog });

afterAll(async () => { await Promise.all(pools.map((pool) => pool.end())); });

async function account() {
  const id = randomUUID();
  await a.insert(user).values({ id, name: "Journey Pilot", email: `${id}@example.invalid` });
  return id;
}

async function seed(id: string, key: string = randomUUID()) {
  const result = await loadOfpForAccount(a, id, key, work);
  if (result.outcome !== "created") throw new Error(`seed was ${result.outcome}`);
  return result.trackerId;
}

async function state(id: string) {
  const loads = await a.select().from(ofpLoad).where(eq(ofpLoad.userId, id));
  const raws = await a.select().from(ofpRaw).innerJoin(ofpLoad, eq(ofpRaw.loadId, ofpLoad.id))
    .where(eq(ofpLoad.userId, id));
  const trackers = await a.select().from(tracker).where(eq(tracker.userId, id));
  const [reservation] = await a.select({
    activeKey: loadReservation.activeKey,
    acceptedAt: sql<string>`${loadReservation.acceptedAt}::text`,
  }).from(loadReservation).where(eq(loadReservation.userId, id));
  return { loads, raws, trackers, reservation };
}

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

describe.runIf(Boolean(url) && process.env.DB_JOURNEY_ISOLATED === "1").sequential("6b database Journey", () => {
  it("C-1 accepts an owned tracker command and confirms exactly version two", async () => {
    const id = await account();
    const trackerId = await seed(id);
    const result = await mutateTracker(a, id, trackerId, { type: "saveWaypoint", routeIndex: fix, expectedVersion: 1 });
    expect(result.outcome).toBe("applied");
    if (result.outcome !== "applied") throw new Error("command not applied");
    const { trackers } = await state(id);
    expect(trackers).toHaveLength(1);
    expect(trackers[0].id).toBe(trackerId);
    expect(trackers[0].version).toBe(2);
    expect(trackers[0].snapshot).toEqual(result.snapshot);
    expect(result.snapshot.version).toBe(2);
    expect(result.snapshot.waypoints.find((point) => point.routeIndex === fix)?.state).toBe("saved");
  }, 15000);

  it("C-2 permits one of two overlapping separate-connection tracker writes", async () => {
    const id = await account();
    const trackerId = await seed(id);
    const command = { type: "saveWaypoint" as const, routeIndex: fix, expectedVersion: 1 };
    const lockPool = new Pool({ connectionString: url!, max: 1 });
    const holder = await lockPool.connect();
    let writes: Promise<Awaited<ReturnType<typeof mutateTracker>>>[] = [];
    try {
      const firstPid = (await a.execute(sql`select pg_backend_pid() as pid`)).rows[0] as { pid: number };
      const secondPid = (await b.execute(sql`select pg_backend_pid() as pid`)).rows[0] as { pid: number };
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM tracker WHERE id = $1 FOR UPDATE", [trackerId]);
      writes = [mutateTracker(a, id, trackerId, command), mutateTracker(b, id, trackerId, command)];

      // Both operations must have read version 1 and reached their blocked
      // UPDATE before the row lock is released. Merely starting two promises
      // does not establish an actual compare-and-swap race.
      let blocked = false;
      for (let attempt = 0; attempt < 250; attempt += 1) {
        const { rows } = await holder.query<{ pid: number; wait_event_type: string | null }>(
          "SELECT pid, wait_event_type FROM pg_stat_activity WHERE pid = ANY($1::integer[])",
          [[firstPid.pid, secondPid.pid]],
        );
        if (rows.length === 2 && rows.every((row) => row.wait_event_type === "Lock")) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(blocked, "both tracker writes must be blocked on the held row").toBe(true);
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
      await lockPool.end();
    }
    const results = await Promise.all(writes);
    expect(results.map((result) => result.outcome).sort()).toEqual(["applied", "stale"]);
    expect(results.find((result) => result.outcome === "stale")).toEqual({
      outcome: "stale", message: "tracker changed; reload and try again",
    });
    const { trackers } = await state(id);
    expect(trackers).toHaveLength(1);
    expect(trackers[0].id).toBe(trackerId);
    expect(trackers[0].version).toBe(2);
    expect(trackers[0].snapshot.version).toBe(2);
    const applied = results.find((result) => result.outcome === "applied");
    if (applied?.outcome !== "applied") throw new Error("no applied command");
    expect(trackers[0].snapshot).toEqual(applied.snapshot);
    expect(trackers[0].snapshot.waypoints.filter((point) => point.routeIndex === fix && point.state === "saved")).toHaveLength(1);
  }, 15000);

  it("C-3 rejects stale and invalid commands without changing persisted state", async () => {
    const id = await account();
    const trackerId = await seed(id);
    const before = (await state(id)).trackers[0];
    expect(await mutateTracker(a, id, trackerId, { type: "saveWaypoint", routeIndex: fix, expectedVersion: 8 }))
      .toEqual({ outcome: "stale", message: "tracker changed; reload and try again" });
    expect(await mutateTracker(a, id, trackerId, { type: "passWaypoint", routeIndex: fix, expectedVersion: 1 }))
      .toMatchObject({ outcome: "rejected", reason: "notSaved" });
    expect((await state(id)).trackers[0]).toEqual(before);
  }, 15000);

  it("C-4 gives the same missing and unowned result and protects the owner", async () => {
    const owner = await account();
    const other = await account();
    const trackerId = await seed(owner);
    const before = (await state(owner)).trackers[0];
    const command = { type: "saveWaypoint" as const, routeIndex: fix, expectedVersion: 1 };
    expect(await mutateTracker(b, other, trackerId, command)).toEqual({ outcome: "notFound" });
    expect(await mutateTracker(b, other, randomUUID(), command)).toEqual({ outcome: "notFound" });
    expect(await compareAndSwapTrackerSnapshot(b, other, trackerId, 1, before.snapshot)).toBeNull();
    expect((await state(owner)).trackers[0]).toEqual(before);
  }, 15000);

  it("C-5 fails closed on each malformed persisted representation", async () => {
    for (const patch of [
      { navlog: { ...navlog, points: [{ ...navlog.points[0], latitude: "INVALID" }] } },
      { snapshot: { ...createInitialSnapshot(navlog), version: 1, waypoints: [{ routeIndex: fix, state: "INVALID" }] } },
    ]) {
      const id = await account();
      const trackerId = await seed(id);
      await a.update(tracker).set(patch as never).where(eq(tracker.id, trackerId));
      const before = (await state(id)).trackers[0];
      await expect(mutateTracker(a, id, trackerId, { type: "saveWaypoint", routeIndex: fix, expectedVersion: 1 }))
        .rejects.toThrow("invalid persisted tracker data");
      expect((await state(id)).trackers[0]).toEqual(before);
    }
    // The production CHECK normally forbids this drift. Remove it only inside
    // the disposable Journey database to verify the read boundary also closes.
    const id = await account();
    const trackerId = await seed(id);
    await a.execute(sql`ALTER TABLE tracker DROP CONSTRAINT tracker_snapshot_version_matches`);
    try {
      await a.update(tracker).set({ version: 2 }).where(eq(tracker.id, trackerId));
      const before = (await state(id)).trackers[0];
      await expect(mutateTracker(a, id, trackerId, { type: "saveWaypoint", routeIndex: fix, expectedVersion: 1 }))
        .rejects.toThrow("invalid persisted tracker data");
      expect((await state(id)).trackers[0]).toEqual(before);
    } finally {
      await a.update(tracker).set({ version: 1 }).where(eq(tracker.id, trackerId));
      await a.execute(sql`ALTER TABLE tracker ADD CONSTRAINT tracker_snapshot_version_matches CHECK (snapshot ->> 'version' IS NOT NULL AND (snapshot ->> 'version')::integer = version)`);
    }
  }, 15000);

  it("C-6 atomically accepts one different-key claim before work", async () => {
    const id = await account();
    const started = barrier();
    const finish = barrier();
    let firstCalls = 0;
    let secondCalls = 0;
    const first = loadOfpForAccount(a, id, "first", async () => {
      firstCalls += 1; started.release(); await finish.promise; return work();
    });
    try {
      await started.promise;
      const accepted = (await state(id)).reservation.acceptedAt;
      const second = await loadOfpForAccount(b, id, "second", async () => {
        secondCalls += 1; return work();
      });
      expect(second.outcome).toBe("wait");
      expect(firstCalls).toBe(1);
      expect(secondCalls).toBe(0);
      expect((await state(id)).reservation).toEqual({ activeKey: "first", acceptedAt: accepted });
      finish.release();
      const created = await first;
      expect(created.outcome).toBe("created");
      if (created.outcome !== "created") throw new Error("first load not created");
      const after = await state(id);
      expect(after.loads).toHaveLength(1);
      expect(after.raws).toHaveLength(1);
      expect(after.trackers.map((row) => row.id)).toEqual([created.trackerId]);
    } finally { finish.release(); }
  }, 15000);

  it("C-7 preserves an active same-key attempt and reports bounded progress", async () => {
    const id = await account();
    const first = await reserveOfpLoad(a, id, "same");
    expect(first.outcome).toBe("claimed");
    if (first.outcome !== "claimed") throw new Error("first claim not accepted");
    const before = (await state(id)).reservation;
    expect(before.acceptedAt).toBe(first.acceptedAt);
    let calls = 0;
    const result = await loadOfpForAccount(b, id, "same", async () => { calls += 1; return work(); });
    expect(result.outcome).toBe("inProgress");
    if (result.outcome !== "inProgress") throw new Error("not in progress");
    expect(result.remainingMs).toBeGreaterThan(0);
    expect(result.remainingMs).toBeLessThanOrEqual(30000);
    expect(calls).toBe(0);
    expect((await state(id)).reservation).toEqual(before);
  }, 15000);

  it("C-8 waits on a different active key without replacing it", async () => {
    const id = await account();
    const first = await reserveOfpLoad(a, id, "one");
    expect(first.outcome).toBe("claimed");
    if (first.outcome !== "claimed") throw new Error("first claim not accepted");
    const before = (await state(id)).reservation;
    expect(before.acceptedAt).toBe(first.acceptedAt);
    let calls = 0;
    const result = await loadOfpForAccount(b, id, "two", async () => { calls += 1; return work(); });
    expect(result.outcome).toBe("wait");
    if (result.outcome !== "wait") throw new Error("did not wait");
    expect(result.remainingMs).toBeGreaterThan(0);
    expect(result.remainingMs).toBeLessThanOrEqual(30000);
    expect(calls).toBe(0);
    expect((await state(id)).reservation).toEqual(before);
  }, 15000);

  it("C-9 replays a completed same-account key without work or rows", async () => {
    const id = await account();
    const other = await account();
    const trackerId = await seed(id, "shared");
    const before = await state(id);
    let calls = 0;
    expect(await loadOfpForAccount(b, id, "shared", async () => { calls += 1; return work(); }))
      .toEqual({ outcome: "completed", trackerId });
    expect(calls).toBe(0);
    expect(await state(id)).toEqual(before);
    const otherResult = await loadOfpForAccount(b, other, "shared", work);
    expect(otherResult.outcome).toBe("created");
    if (otherResult.outcome !== "created") throw new Error("other account load not created");
    expect(otherResult.trackerId).not.toBe(trackerId);
    const otherState = await state(other);
    expect(otherState.loads).toHaveLength(1);
    expect(otherState.raws).toHaveLength(1);
    expect(otherState.trackers.map((row) => row.id)).toEqual([otherResult.trackerId]);
    expect(await state(id)).toEqual(before);
  }, 15000);

  it("C-10 cleans failed work and invalid prepared JSON while retaining cooldown", async () => {
    for (const callback of [
      async () => { throw new Error("synthetic failure"); },
      async () => ({ rawPayload: { invalid: undefined }, navlog }),
      async () => ({ rawPayload, navlog: { ...navlog, points: [{ ...navlog.points[0], longitude: "INVALID" }] } }),
    ]) {
      const id = await account();
      expect(await loadOfpForAccount(a, id, "bad", callback)).toEqual({ outcome: "failed" });
      const after = await state(id);
      expect(after.loads).toHaveLength(0);
      expect(after.raws).toHaveLength(0);
      expect(after.trackers).toHaveLength(0);
      expect(after.reservation.activeKey).toBeNull();
      expect(after.reservation.acceptedAt).toBeTruthy();
      expect((await reserveOfpLoad(b, id, "bad")).outcome).toBe("wait");
      expect((await state(id)).reservation).toEqual(after.reservation);
    }
  }, 15000);

  it("C-11 expires an abandoned attempt and preserves a newer same-key claim", async () => {
    const id = await account();
    const started = barrier();
    const finish = barrier();
    const old = loadOfpForAccount(a, id, "same", async () => {
      started.release(); await finish.promise; throw new Error("old failed");
    });
    try {
      await started.promise;
      await b.update(loadReservation).set({ acceptedAt: sql`clock_timestamp() - interval '31 seconds'` })
        .where(eq(loadReservation.userId, id));
      const newer = await reserveOfpLoad(b, id, "same");
      expect(newer.outcome).toBe("claimed");
      const before = (await state(id)).reservation;
      if (newer.outcome === "claimed") expect(before.acceptedAt).toBe(newer.acceptedAt);
      finish.release();
      expect(await old).toEqual({ outcome: "failed" });
      expect((await state(id)).reservation).toEqual(before);
    } finally { finish.release(); }
  }, 15000);

  it("C-12 commits metadata, raw JSON, normalized navlog, and initial tracker together", async () => {
    const id = await account();
    const result = await loadOfpForAccount(a, id, "success", work);
    expect(result.outcome).toBe("created");
    if (result.outcome !== "created") throw new Error("not created");
    const after = await state(id);
    expect(after.loads).toHaveLength(1);
    expect(after.loads[0]).toMatchObject({ userId: id, idempotencyKey: "success",
      flightNumber: navlog.metadata.flightNumber, originIcaoCode: navlog.metadata.originIcaoCode,
      destinationIcaoCode: navlog.metadata.destinationIcaoCode,
      generatedAt: new Date(navlog.metadata.generatedAtUnixSeconds * 1000),
    });
    expect(after.raws).toHaveLength(1);
    expect(after.raws[0].ofp_raw.payload).toEqual(rawPayload);
    expect(after.trackers).toHaveLength(1);
    expect(after.trackers[0]).toMatchObject({ id: result.trackerId, userId: id, loadId: after.loads[0].id,
      navlog, version: 1, snapshot: { ...createInitialSnapshot(navlog), version: 1 },
    });
    expect(result.snapshot).toEqual(after.trackers[0].snapshot);
    expect(after.reservation.activeKey).toBeNull();
    expect(after.reservation.acceptedAt).toBeTruthy();
  }, 15000);

  it("C-13 rolls back a failed raw write and exposes only a generic error", async () => {
    const id = await account();
    await expect(loadOfpForAccount(a, id, "rollback", async () => ({
      rawPayload: { unsupportedPostgresJson: "\u0000" }, navlog,
    }))).rejects.toThrow(/^OFP load could not be saved$/);
    const after = await state(id);
    expect(after.loads).toHaveLength(0);
    expect(after.raws).toHaveLength(0);
    expect(after.trackers).toHaveLength(0);
    expect(after.reservation.activeKey).toBeNull();
    expect(after.reservation.acceptedAt).toBeTruthy();
    expect((await reserveOfpLoad(b, id, "rollback")).outcome).toBe("wait");
  }, 15000);

  it("C-14 uses account-key uniqueness after a newer same-key completion", async () => {
    const id = await account();
    const started = barrier();
    const finish = barrier();
    const old = loadOfpForAccount(a, id, "duplicate", async () => {
      started.release(); await finish.promise; return work();
    });
    try {
      await started.promise;
      await b.update(loadReservation).set({ acceptedAt: sql`clock_timestamp() - interval '31 seconds'` })
        .where(eq(loadReservation.userId, id));
      const winner = await loadOfpForAccount(b, id, "duplicate", work);
      expect(winner.outcome).toBe("created");
      finish.release();
      const loser = await old;
      if (winner.outcome !== "created") throw new Error("new claim did not complete");
      expect(loser).toEqual({ outcome: "completed", trackerId: winner.trackerId });
      const after = await state(id);
      expect(after.loads).toHaveLength(1);
      expect(after.raws).toHaveLength(1);
      expect(after.trackers).toHaveLength(1);
      expect(after.trackers[0].id).toBe(winner.trackerId);
    } finally { finish.release(); }
  }, 15000);
});
