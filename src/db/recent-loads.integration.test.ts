import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { localTestDatabaseUrl } from "../../tests/support/local-test-db";
import { navlogFor } from "../../tests/support/tracker-scenarios";
import { createInitialSnapshot } from "../domain/engine";
import { selectRecentLoadsForAccount } from "./recent-loads";
import * as schema from "./schema";

const { ofpLoad, ofpRaw, tracker, user } = schema;

const url = localTestDatabaseUrl(process.env.TEST_DATABASE_URL);
const pool = url && process.env.DB_JOURNEY_ISOLATED === "1" ? new Pool({ connectionString: url }) : undefined;
const db = pool ? drizzle(pool, { schema }) : undefined;
const navlog = navlogFor("valid-domestic.json");
const snapshot = { ...createInitialSnapshot(navlog), version: 1 };

afterAll(async () => { await pool?.end(); });

async function account() {
  const accountId = randomUUID();
  await db!.insert(user).values({ id: accountId, name: "Recent Test Pilot", email: `${accountId}@example.invalid` });
  return accountId;
}

async function load(accountId: string, sequence: number, withTracker = true) {
  const id = `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
  const loadedAt = new Date(Date.UTC(2026, 9, 20, 10, Math.floor(sequence / 2)));
  await db!.insert(ofpLoad).values({
    id, userId: accountId, idempotencyKey: randomUUID(), flightNumber: "SAME123",
    originIcaoCode: "KLAX", destinationIcaoCode: "KJFK",
    generatedAt: new Date("2026-10-20T09:00:00.000Z"), loadedAt,
  });
  await db!.insert(ofpRaw).values({ loadId: id, payload: { privateMarker: `raw-${sequence}` } });
  if (!withTracker) return null;
  const trackerId = randomUUID();
  await db!.insert(tracker).values({
    id: trackerId, userId: accountId, loadId: id, navlog, snapshot, version: 1,
  });
  return trackerId;
}

describe.runIf(Boolean(db))("recent loads against isolated PostgreSQL", () => {
  it("selects ten account-owned completed instances in indexed time and ID order without raw data", async () => {
    const first = await account();
    const second = await account();
    const trackerIds = new Map<number, string>();
    for (let sequence = 1; sequence <= 12; sequence += 1) {
      trackerIds.set(sequence, (await load(first, sequence))!);
    }
    const otherTrackerId = await load(second, 13);
    await load(first, 14, false); // An incomplete row never becomes a recent tracker.

    const queries: string[] = [];
    const inspectedDb = drizzle(pool!, { schema, logger: { logQuery(query) { queries.push(query); } } });
    const result = await selectRecentLoadsForAccount(inspectedDb, first);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('from "ofp_load" inner join "tracker"');
    expect(queries[0]).not.toMatch(/ofp_raw|payload|navlog|snapshot/);
    const expectedSequence = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3];
    expect(result.map((item) => item.trackerId))
      .toEqual(expectedSequence.map((sequence) => trackerIds.get(sequence)));
    expect(result).toHaveLength(10);
    expect(result.every((item) => item.flightNumber === "SAME123")).toBe(true);
    expect(result[0]).toEqual({
      trackerId: trackerIds.get(12), flightNumber: "SAME123",
      originIcaoCode: "KLAX", destinationIcaoCode: "KJFK",
      generatedAtUtc: "2026-10-20T09:00:00.000Z",
      loadedAtUtc: "2026-10-20T10:06:00.000Z",
    });
    expect(JSON.stringify(result)).not.toContain("privateMarker");
    expect(JSON.stringify(result)).not.toContain("raw-");
    expect(await selectRecentLoadsForAccount(db!, second)).toEqual([{
      trackerId: otherTrackerId, flightNumber: "SAME123",
      originIcaoCode: "KLAX", destinationIcaoCode: "KJFK",
      generatedAtUtc: "2026-10-20T09:00:00.000Z",
      loadedAtUtc: "2026-10-20T10:06:00.000Z",
    }]);
    expect(await selectRecentLoadsForAccount(db!, randomUUID())).toEqual([]);
    console.log("JOURNEY recent-load read: pass");
  }, 30000);
});
