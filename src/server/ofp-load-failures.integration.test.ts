import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, describe, expect, it, vi } from "vitest";

import { loadOfpForAccount } from "../db/ofp-load";
import { ofpLoad, ofpRaw, tracker, user } from "../db/schema";
import { localTestDatabaseUrl } from "../../tests/support/local-test-db";
import { createLoadOperation } from "./ofp-load-operations";
import { fetchSimbriefOfp, SIMBRIEF_MAX_BYTES, SIMBRIEF_TIMEOUT_MS } from "./simbrief-ofp";

const testUrl = localTestDatabaseUrl(process.env.TEST_DATABASE_URL);
const pool = testUrl ? new Pool({ connectionString: testUrl }) : undefined;
const db = pool ? drizzle(pool) : undefined;
const origin = "http://127.0.0.1:8765";
const json = { "content-type": "application/json" };
const validOfp = readFileSync(path.join(process.cwd(), "tests/fixtures/simbrief/valid-domestic.json"), "utf8");

afterAll(async () => { await pool?.end(); });

async function account() {
  if (!db) throw new Error("TEST_DATABASE_URL is required");
  const id = randomUUID();
  await db.insert(user).values({ id, name: "Test Pilot", email: `${id}@example.invalid` });
  return id;
}

async function storedFor(accountId: string) {
  const loads = await db!.select().from(ofpLoad).where(eq(ofpLoad.userId, accountId));
  const raws = await db!.select({ id: ofpRaw.loadId }).from(ofpRaw)
    .innerJoin(ofpLoad, eq(ofpRaw.loadId, ofpLoad.id)).where(eq(ofpLoad.userId, accountId));
  const trackers = await db!.select().from(tracker).where(eq(tracker.userId, accountId));
  return { loads: loads.length, raws: raws.length, trackers: trackers.length };
}

function operationFor(accountId: string, fetchImpl: typeof fetch) {
  return createLoadOperation({
    resolveAccountId: async () => accountId,
    readPilotId: async () => "000123",
    load: (id, key, work) => loadOfpForAccount(db!, id, key, work),
    fetch: (pilotId) => fetchSimbriefOfp(pilotId, { origin, fetchImpl }),
  });
}

describe.runIf(Boolean(testUrl))("failed SimBrief transport through the transactional load", () => {
  const responses: [string, () => Response][] = [
    ["non-success", () => new Response("error", { status: 503 })],
    ["invalid JSON", () => new Response("{", { headers: json })],
    ["oversize", () => new Response(`${validOfp}${" ".repeat(SIMBRIEF_MAX_BYTES)}`, { headers: json })],
  ];

  it.each(responses)("stores no tracker or raw payload after a %s response", async (_name, response) => {
    const accountId = await account();
    const result = await operationFor(accountId, async () => response())(new Headers(), randomUUID());
    expect(result).toEqual({ status: "failed", message: "The OFP could not be loaded. Check your plan and try again." });
    expect(await storedFor(accountId)).toEqual({ loads: 0, raws: 0, trackers: 0 });
  });

  it("stores no tracker or raw payload after the transport times out", async () => {
    const accountId = await account();
    const stalled: typeof fetch = (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const pending = operationFor(accountId, stalled)(new Headers(), randomUUID());
      await vi.waitFor(() => expect(vi.getTimerCount()).toBeGreaterThan(0));
      await vi.advanceTimersByTimeAsync(SIMBRIEF_TIMEOUT_MS);
      expect(await pending).toMatchObject({ status: "failed" });
    } finally { vi.useRealTimers(); }
    expect(await storedFor(accountId)).toEqual({ loads: 0, raws: 0, trackers: 0 });
  });
});
