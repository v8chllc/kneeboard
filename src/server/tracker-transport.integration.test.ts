import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { loadOfpForAccount } from "../db/ofp-load";
import { mutateTracker } from "../db/tracker-operations";
import { tracker, user } from "../db/schema";
import { navlogFor } from "../../tests/support/tracker-scenarios";
import { localTestDatabaseUrl } from "../../tests/support/local-test-db";
import { selectTrackerForAccount } from "./tracker-data";
import { createTrackerTransport } from "./tracker-transport";

const testUrl = localTestDatabaseUrl(process.env.TEST_DATABASE_URL);
const pool = testUrl ? new Pool({ connectionString: testUrl }) : undefined;
const db = pool ? drizzle(pool) : undefined;
const navlog = navlogFor("valid-domestic.json");
const command = { type: "saveWaypoint", routeIndex: 1, expectedVersion: 1 };

afterAll(async () => { await pool?.end(); });

async function seededTracker() {
  if (!db) throw new Error("TEST_DATABASE_URL is required");
  const owner = randomUUID();
  const other = randomUUID();
  for (const id of [owner, other]) {
    await db.insert(user).values({ id, name: "Test Pilot", email: `${id}@example.invalid` });
  }
  const load = await loadOfpForAccount(db, owner, randomUUID(), async () => ({
    rawPayload: { privateMarker: "must-not-reach-client" }, navlog,
  }));
  if (load.outcome !== "created") throw new Error("expected tracker");
  return { owner, other, id: load.trackerId };
}

function transport() {
  if (!db) throw new Error("TEST_DATABASE_URL is required");
  return createTrackerTransport({
    resolveAccountId: async (headers) => headers.get("x-test-account"),
    read: (accountId, id) => selectTrackerForAccount(db, accountId, id),
    mutate: (accountId, id, typedCommand) => mutateTracker(db, accountId, id, typedCommand),
  });
}

function asAccount(id: string): Headers { return new Headers({ "x-test-account": id }); }

describe.runIf(Boolean(testUrl))("account-scoped tracker transport against local PostgreSQL", () => {
  it("returns the same read and command result for another account and a missing ID", async () => {
    const { owner, other, id } = await seededTracker();
    const service = transport();
    const missing = randomUUID();
    expect(await service.read(asAccount(owner), id)).toMatchObject({ status: "found" });
    expect(await service.read(asAccount(other), id)).toEqual(await service.read(asAccount(other), missing));
    expect(await service.command(asAccount(other), id, command))
      .toEqual(await service.command(asAccount(other), missing, command));
    const [stored] = await db!.select({ version: tracker.version }).from(tracker).where(eq(tracker.id, id));
    expect(stored.version).toBe(1);
  });
  it("returns confirmed version after mutation and stale result for a repeat", async () => {
    const { owner, id } = await seededTracker();
    const service = transport();
    const applied = await service.command(asAccount(owner), id, command);
    expect(applied).toMatchObject({ status: "applied", snapshot: { version: 2 } });
    expect(await service.command(asAccount(owner), id, command))
      .toEqual({ status: "stale", message: "Tracker changed. Reload and try again." });
    const [stored] = await db!.select({ version: tracker.version, snapshot: tracker.snapshot })
      .from(tracker).where(eq(tracker.id, id));
    expect(stored.version).toBe(2);
    if (applied.status !== "applied") throw new Error("expected applied");
    expect(applied.snapshot).toEqual(stored.snapshot);
  });
  it("fails closed on corrupt persisted navlog and snapshot without writing", async () => {
    for (const column of ["navlog", "snapshot"] as const) {
      const { owner, id } = await seededTracker();
      if (column === "navlog") {
        await db!.update(tracker).set({ navlog: { invalid: "private marker" } as never }).where(eq(tracker.id, id));
      } else {
        await db!.update(tracker).set({ snapshot: { version: 1, invalid: "private marker" } as never }).where(eq(tracker.id, id));
      }
      const service = transport();
      expect(await service.read(asAccount(owner), id)).toEqual({ status: "unreadable", message: "Tracker could not be opened. Try again." });
      expect(await service.command(asAccount(owner), id, command))
        .toEqual({ status: "unreadable", message: "Tracker could not be updated. Reload and try again." });
      const [stored] = await db!.select({ version: tracker.version }).from(tracker).where(eq(tracker.id, id));
      expect(stored.version).toBe(1);
    }
  });
  it("never sends raw payload in the account-scoped view", async () => {
    const { owner, id } = await seededTracker();
    const found = await transport().read(asAccount(owner), id);
    expect(found.status).toBe("found");
    expect(JSON.stringify(found)).not.toContain("must-not-reach-client");
  });
});
