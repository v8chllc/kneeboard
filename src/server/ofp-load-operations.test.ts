import { describe, expect, it, vi } from "vitest";

import type { OfpLoadResult } from "../db/ofp-load";
import { buildNavlog } from "../domain/navlog-construction";
import { loadOfpFixture } from "../../tests/support/ofp-fixture-adapter";
import { createLoadOperation, mapLoadResult, type LoadDependencies } from "./ofp-load-operations";
import { SimbriefOfpError } from "./simbrief-ofp";

vi.mock("server-only", () => ({}));

const key = "a4a420e8-6f34-4411-936a-97ce73364d3f";
const headers = new Headers();
const rawPayload = { marker: "synthetic" };
const ofpInput = loadOfpFixture("valid-domestic.json");

function dependencies(overrides: Partial<LoadDependencies> = {}) {
  const resolveAccountId = vi.fn(async () => "account-a" as string | null);
  const readPilotId = vi.fn(async () => "000123" as string | null);
  const fetch = vi.fn(async () => ({ rawPayload, ofpInput }));
  const log = vi.fn();
  let prepared: { rawPayload: unknown; navlog: unknown } | undefined;
  const load = vi.fn(async (_accountId: string, _key: string, work: () => Promise<{ rawPayload: unknown; navlog: unknown }>): Promise<OfpLoadResult> => {
    prepared = await work();
    return { outcome: "completed", trackerId: "opaque-tracker" };
  });
  return { resolveAccountId, readPilotId, fetch, load, log, getPrepared: () => prepared, ...overrides };
}

describe("authenticated OFP load", () => {
  it("refuses a signed-out action before reading settings or fetching", async () => {
    const deps = dependencies({ resolveAccountId: async () => null });
    expect(await createLoadOperation(deps)(headers, key)).toMatchObject({ status: "signInRequired" });
    expect(deps.readPilotId).not.toHaveBeenCalled();
    expect(deps.load).not.toHaveBeenCalled();
    expect(deps.fetch).not.toHaveBeenCalled();
  });
  it("requires a valid action key and saved Pilot ID before reservation", async () => {
    const invalid = dependencies();
    expect(await createLoadOperation(invalid)(headers, "wrong")).toMatchObject({ status: "invalidAction" });
    expect(invalid.readPilotId).not.toHaveBeenCalled();
    expect(invalid.load).not.toHaveBeenCalled();
    const missing = dependencies({ readPilotId: async () => null });
    expect(await createLoadOperation(missing)(headers, key)).toMatchObject({ status: "pilotIdRequired" });
    expect(missing.load).not.toHaveBeenCalled();
    expect(missing.fetch).not.toHaveBeenCalled();
  });
  it("uses only server-resolved account and Pilot ID, preserving raw and normalized values separately", async () => {
    const deps = dependencies();
    const result = await createLoadOperation(deps)(headers, key);
    expect(result).toEqual({ status: "completed", trackerId: "opaque-tracker", message: "This load already completed. Opening your tracker." });
    expect(deps.readPilotId).toHaveBeenCalledExactlyOnceWith("account-a");
    expect(deps.load).toHaveBeenCalledOnce();
    expect(deps.load).toHaveBeenCalledWith("account-a", key, expect.any(Function));
    expect(deps.fetch).toHaveBeenCalledExactlyOnceWith("000123");
    expect(deps.getPrepared()).toEqual({ rawPayload, navlog: buildNavlog(ofpInput) });
  });
  it("does not fetch on same-key in-progress or cooldown results", async () => {
    for (const outcome of ["inProgress", "wait"] as const) {
      const deps = dependencies({ load: async () => ({ outcome, remainingMs: 15_001 }) });
      const result = await createLoadOperation(deps)(headers, key);
      expect(result.status).toBe(outcome);
      expect(deps.fetch).not.toHaveBeenCalled();
    }
  });
  it("gives LIDO and detailed-navlog guidance without exposing payload data", async () => {
    for (const reason of ["nonLido", "missingNavlog"] as const) {
      const deps = dependencies({
        fetch: async () => { throw new SimbriefOfpError(reason, ["params.ofp_layout"]); },
        load: async (_accountId, _key, work) => {
          try { await work(); } catch { return { outcome: "failed" }; }
          throw new Error("Expected work failure");
        },
      });
      const result = await createLoadOperation(deps)(headers, key);
      expect(result.status).toBe("failed");
      expect(result.message).toContain(reason === "nonLido" ? "LIDO layout" : "detailed navlog enabled");
      expect(result.message).not.toContain("params.ofp_layout");
    }
  });
  it("returns a generic retryable failure for persistence or unknown fetch errors", async () => {
    const dbFailure = dependencies({ load: async () => { throw new Error("private marker"); } });
    const result = await createLoadOperation(dbFailure)(headers, key);
    expect(result).toMatchObject({ status: "failed" });
    expect(result.message).not.toContain("private marker");
    expect(dbFailure.log).toHaveBeenCalledWith({
      operation: "ofp.load", correlationId: key, outcome: "failed", reason: "persistence",
    });
  });
  it("logs identity and settings dependency failures with safe correlation IDs", async () => {
    for (const testCase of [
      {
        submittedKey: key,
        overrides: { resolveAccountId: async () => { throw new Error("private identity marker"); } },
        reason: "accountResolution",
      },
      {
        submittedKey: key,
        overrides: { readPilotId: async () => { throw new Error("private settings marker"); } },
        reason: "settingsRead",
      },
      {
        submittedKey: "private invalid action key",
        overrides: { resolveAccountId: async () => { throw new Error("private identity marker"); } },
        reason: "accountResolution",
      },
    ]) {
      const log = vi.fn();
      const result = await createLoadOperation(dependencies({ ...testCase.overrides, log }))(headers, testCase.submittedKey);
      expect(result).toEqual({ status: "failed", message: "The OFP could not be loaded. Check your plan and try again." });
      expect(log).toHaveBeenCalledExactlyOnceWith({
        operation: "ofp.load",
        correlationId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f-]{27}$/),
        outcome: "failed",
        reason: testCase.reason,
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain("private");
    }
  });
  it("logs safe failure metadata without Pilot ID or payload details", async () => {
    const log = vi.fn();
    const deps = dependencies({
      log,
      fetch: async () => { throw new SimbriefOfpError("invalidOfp", ["private.payload.path"]); },
      load: async (_accountId, _key, work) => {
        try { await work(); } catch { return { outcome: "failed" }; }
        throw new Error("Expected work failure");
      },
    });
    await createLoadOperation(deps)(headers, key);
    expect(log).toHaveBeenCalledExactlyOnceWith({
      operation: "ofp.load", correlationId: key, outcome: "failed", reason: "invalidOfp",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("000123");
    expect(JSON.stringify(log.mock.calls)).not.toContain("private.payload.path");
  });
});

describe("load outcome mapping", () => {
  it("maps every persistence outcome with a safe message", () => {
    const outcomes: OfpLoadResult[] = [
      { outcome: "created", trackerId: "new-id", snapshot: {} as Extract<OfpLoadResult, { outcome: "created" }>["snapshot"] },
      { outcome: "completed", trackerId: "existing-id" },
      { outcome: "inProgress", remainingMs: 1000 },
      { outcome: "wait", remainingMs: 15_001 },
      { outcome: "failed" },
    ];
    expect(outcomes.map((outcome) => mapLoadResult(outcome).status))
      .toEqual(["created", "completed", "inProgress", "wait", "failed"]);
    expect(mapLoadResult(outcomes[3])).toMatchObject({ remainingMs: 15_001, message: "Wait 16 seconds before another load." });
    expect(mapLoadResult(outcomes[0])).toMatchObject({ trackerId: "new-id" });
  });
});
