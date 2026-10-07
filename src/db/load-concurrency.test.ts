import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { localTestDatabaseUrl } from "../../tests/support/local-test-db";
import { navlogFor } from "../../tests/support/tracker-scenarios";
import { loadOfpForAccount } from "./ofp-load";
import { loadReservation, ofpLoad, ofpRaw, tracker, user } from "./schema";

const testUrl = localTestDatabaseUrl(process.env.TEST_DATABASE_URL);
const firstPool = testUrl ? new Pool({ connectionString: testUrl }) : undefined;
const secondPool = testUrl ? new Pool({ connectionString: testUrl }) : undefined;
const firstDb = firstPool ? drizzle(firstPool) : undefined;
const secondDb = secondPool ? drizzle(secondPool) : undefined;
const navlog = navlogFor("valid-domestic.json");
const workResult = { rawPayload: { source: "synthetic" }, navlog };

afterAll(async () => { await Promise.all([firstPool?.end(), secondPool?.end()]); });

async function account() {
  if (!firstDb) throw new Error("TEST_DATABASE_URL is required");
  const id = randomUUID();
  await firstDb.insert(user).values({ id, name: "Test Pilot", email: `${id}@example.invalid` });
  return id;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe.runIf(Boolean(testUrl))("OFP load concurrency across PostgreSQL connections", () => {
  it("starts one fetch while same-key and different-key requests observe its reservation", async () => {
    const accountId = await account();
    const started = deferred();
    const release = deferred();
    let callbackCalls = 0;
    const first = loadOfpForAccount(firstDb!, accountId, "primary", async () => {
      callbackCalls += 1;
      started.resolve();
      await release.promise;
      return workResult;
    });
    await started.promise;
    try {
      const [same, different] = await Promise.all([
        loadOfpForAccount(secondDb!, accountId, "primary", async () => {
          callbackCalls += 1;
          return workResult;
        }),
        loadOfpForAccount(secondDb!, accountId, "other", async () => {
          callbackCalls += 1;
          return workResult;
        }),
      ]);
      expect(same.outcome).toBe("inProgress");
      expect(different.outcome).toBe("wait");
      expect(callbackCalls).toBe(1);
      release.resolve();
      const created = await first;
      expect(created.outcome).toBe("created");
      if (created.outcome !== "created") throw new Error("expected created");
      const replay = await loadOfpForAccount(secondDb!, accountId, "primary", async () => {
        callbackCalls += 1;
        return workResult;
      });
      expect(replay).toEqual({ outcome: "completed", trackerId: created.trackerId });
      expect(callbackCalls).toBe(1);
    } finally {
      release.resolve();
    }
  }, 10000);

  it("expires after real database time and resolves simultaneous completions by uniqueness", async () => {
    const accountId = await account();
    const firstStarted = deferred();
    const secondStarted = deferred();
    const release = deferred();
    let callbackCalls = 0;
    const first = loadOfpForAccount(firstDb!, accountId, "reused", async () => {
      callbackCalls += 1;
      firstStarted.resolve();
      await release.promise;
      return workResult;
    });
    await firstStarted.promise;
    try {
      // Keep the claim active, then let the PostgreSQL clock carry it across
      // the remaining three seconds. This avoids a full 30-second test wait.
      await firstDb!.update(loadReservation)
        .set({ acceptedAt: sql`clock_timestamp() - interval '27 seconds'` })
        .where(eq(loadReservation.userId, accountId));
      const before = await loadOfpForAccount(secondDb!, accountId, "reused", async () => {
        callbackCalls += 1;
        return workResult;
      });
      expect(before.outcome).toBe("inProgress");
      expect(callbackCalls).toBe(1);

      // This sleeps an otherwise idle database session; it holds no lock.
      await secondDb!.execute(sql`select pg_sleep(3.2)`);
      const [elapsed] = await secondDb!.select({
        ageMs: sql<number>`(extract(epoch from (clock_timestamp() - ${loadReservation.acceptedAt})) * 1000)::integer`,
      }).from(loadReservation).where(eq(loadReservation.userId, accountId));
      expect(elapsed.ageMs).toBeGreaterThanOrEqual(30000);

      const second = loadOfpForAccount(secondDb!, accountId, "reused", async () => {
        callbackCalls += 1;
        secondStarted.resolve();
        await release.promise;
        return workResult;
      });
      const secondState = await Promise.race([
        secondStarted.promise.then(() => "started"),
        second.then(() => "returned", () => "returned"),
      ]);
      expect(secondState).toBe("started");
      expect(callbackCalls).toBe(2);
      release.resolve();
      const settled = await Promise.allSettled([first, second]);
      expect(settled.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
      if (settled[0].status !== "fulfilled" || settled[1].status !== "fulfilled") {
        throw new Error("expected both loads to resolve");
      }
      const results = [settled[0].value, settled[1].value];
      expect(results.map((result) => result.outcome).sort()).toEqual(["completed", "created"]);
      const created = results.find((result) => result.outcome === "created");
      const completed = results.find((result) => result.outcome === "completed");
      expect(created?.trackerId).toBe(completed?.trackerId);

      const loads = await firstDb!.select({ id: ofpLoad.id }).from(ofpLoad)
        .where(eq(ofpLoad.userId, accountId));
      expect(loads).toHaveLength(1);
      const raws = await firstDb!.select({ loadId: ofpRaw.loadId }).from(ofpRaw)
        .where(eq(ofpRaw.loadId, loads[0].id));
      const trackers = await firstDb!.select({ id: tracker.id }).from(tracker)
        .where(eq(tracker.loadId, loads[0].id));
      expect(raws).toHaveLength(1);
      expect(trackers).toEqual([{ id: created?.trackerId }]);
    } finally {
      release.resolve();
    }
  }, 10000);
});
