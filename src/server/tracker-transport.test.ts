import { describe, expect, it, vi } from "vitest";

import { createInitialSnapshot } from "../domain/engine";
import type { TrackerCommandRejection } from "../domain/engine";
import { navlogFor } from "../../tests/support/tracker-scenarios";
import { createTrackerTransport, mapTrackerMutation, parseTrackerCommand, type TrackerTransportDependencies } from "./tracker-transport";

const trackerId = "a4a420e8-6f34-4411-936a-97ce73364d3f";
const navlog = navlogFor("valid-domestic.json");
const snapshot = { ...createInitialSnapshot(navlog), version: 1 };
const row = {
  navlog, snapshot, version: 1, flightNumber: "TST101", originIcaoCode: "KATL",
  destinationIcaoCode: "KORD", generatedAt: new Date("2026-01-01T00:00:00.000Z"),
  loadedAt: new Date("2026-01-01T00:01:00.000Z"),
};
const command = { type: "saveWaypoint", routeIndex: 1, expectedVersion: 1 };

function deps(overrides: Partial<TrackerTransportDependencies> = {}) {
  const resolveAccountId = vi.fn(async () => "account-a" as string | null);
  const read = vi.fn(async () => row);
  const mutate = vi.fn(async () => ({ outcome: "applied" as const, snapshot: { ...snapshot, version: 2 } }));
  const log = vi.fn();
  return { resolveAccountId, read, mutate, log, ...overrides };
}

describe("tracker request transport", () => {
  it("refuses unsigned requests before reading or mutating", async () => {
    const dependencies = deps({ resolveAccountId: async () => null });
    const transport = createTrackerTransport(dependencies);
    expect(await transport.read(new Headers(), trackerId)).toMatchObject({ status: "signInRequired" });
    expect(await transport.command(new Headers(), trackerId, command)).toMatchObject({ status: "signInRequired" });
    expect(dependencies.read).not.toHaveBeenCalled();
    expect(dependencies.mutate).not.toHaveBeenCalled();
  });
  it("returns the same result for invalid, missing, and unowned tracker IDs", async () => {
    const dependencies = deps({ read: async () => null, mutate: async () => ({ outcome: "notFound" }) });
    const transport = createTrackerTransport(dependencies);
    const missing = await transport.read(new Headers(), trackerId);
    const unowned = await transport.read(new Headers(), trackerId);
    const invalid = await transport.read(new Headers(), "not-a-uuid");
    expect(unowned).toEqual(missing);
    expect(invalid).toEqual(missing);
    expect(await transport.command(new Headers(), trackerId, command))
      .toEqual({ status: "notFound", message: "Tracker not found." });
    expect(await transport.command(new Headers(), "not-a-uuid", command))
      .toEqual({ status: "notFound", message: "Tracker not found." });
  });
  it("returns validated navlog, snapshot, and UTC header without raw payload", async () => {
    const dependencies = deps();
    const result = await createTrackerTransport(dependencies).read(new Headers(), trackerId);
    expect(result).toEqual({ status: "found", navlog, snapshot, header: {
      flightNumber: "TST101", originIcaoCode: "KATL", destinationIcaoCode: "KORD",
      generatedAtUtc: "2026-01-01T00:00:00.000Z", loadedAtUtc: "2026-01-01T00:01:00.000Z",
    } });
    expect(dependencies.read).toHaveBeenCalledWith("account-a", trackerId);
    expect(JSON.stringify(result)).not.toContain("rawPayload");
  });
  it("rejects corrupted stored navlog, snapshot, or version generically", async () => {
    for (const change of [
      { navlog: { ...navlog, points: [{ ...navlog.points[0], latitude: "private invalid" }] } },
      { snapshot: { ...snapshot, waypoints: [{ routeIndex: 1, state: "private invalid" }] } },
      { version: 2 },
    ]) {
      const result = await createTrackerTransport(deps({ read: async () => ({ ...row, ...change }) }))
        .read(new Headers(), trackerId);
      expect(result).toEqual({ status: "unreadable", message: "Tracker could not be opened. Try again." });
      expect(JSON.stringify(result)).not.toContain("private invalid");
    }
  });
  it("validates every typed command and expected version before mutation", async () => {
    const dependencies = deps();
    const transport = createTrackerTransport(dependencies);
    for (const invalid of [
      { ...command, expectedVersion: 0 }, { ...command, routeIndex: "1" },
      { type: "setProcedureInclusion", expectedVersion: 1, inclusion: { sid: "true", star: true } },
      { type: "unknown", expectedVersion: 1 },
    ]) {
      const result = await transport.command(new Headers(), trackerId, invalid);
      expect(result.status).toBe("rejected");
    }
    expect(dependencies.mutate).not.toHaveBeenCalled();
    for (const valid of [
      command, { type: "passWaypoint", routeIndex: 1, expectedVersion: 1 },
      { type: "skipWaypoint", routeIndex: 1, expectedVersion: 1 },
      { type: "setProcedureInclusion", inclusion: { sid: true, star: false }, expectedVersion: 1 },
    ]) {
      expect(parseTrackerCommand(valid)).toEqual(valid);
    }
    expect(parseTrackerCommand({ type: "unknown" })).toMatchObject({ status: "rejected", reason: "unknownCommand" });
    expect(parseTrackerCommand({ ...command, expectedVersion: "1" })).toMatchObject({ status: "rejected", reason: "malformedCommand" });
  });
  it("returns only a confirmed snapshot and maps stale and storage failures", async () => {
    const dependencies = deps();
    const transport = createTrackerTransport(dependencies);
    expect(await transport.command(new Headers(), trackerId, command))
      .toEqual({ status: "applied", snapshot: { ...snapshot, version: 2 }, message: "Tracker updated." });
    expect(dependencies.mutate).toHaveBeenCalledWith("account-a", trackerId, command);
    const stale = createTrackerTransport(deps({ mutate: async () => ({ outcome: "stale", message: "tracker changed; reload and try again" }) }));
    expect(await stale.command(new Headers(), trackerId, command)).toEqual({ status: "stale", message: "Tracker changed. Reload and try again." });
    const corrupt = createTrackerTransport(deps({ mutate: async () => { throw new Error("private invalid persisted data"); } }));
    expect(await corrupt.command(new Headers(), trackerId, command))
      .toEqual({ status: "unreadable", message: "Tracker could not be updated. Reload and try again." });
  });
  it("logs safe metadata for read failures, command failures, rejections, and conflicts", async () => {
    const log = vi.fn();
    const mutate = vi.fn()
      .mockResolvedValueOnce({ outcome: "stale", message: "tracker changed; reload and try again" })
      .mockRejectedValueOnce(new Error("private mutation marker"));
    const dependencies = deps({
      log,
      read: async () => { throw new Error("private read marker"); },
      mutate,
    });
    const transport = createTrackerTransport(dependencies);
    await transport.read(new Headers(), trackerId);
    await transport.command(new Headers(), trackerId, command);
    await transport.command(new Headers(), trackerId, command);
    await transport.command(new Headers(), trackerId, { type: "unknown", secret: "private command marker" });
    expect(log.mock.calls).toEqual([
      [{ operation: "tracker.read", correlationId: trackerId, outcome: "failed", reason: "unreadable" }],
      [{ operation: "tracker.command", correlationId: trackerId, outcome: "stale", reason: "versionMismatch" }],
      [{ operation: "tracker.command", correlationId: trackerId, outcome: "failed", reason: "unreadable" }],
      [{ operation: "tracker.command", correlationId: trackerId, outcome: "rejected", reason: "unknownCommand" }],
    ]);
    expect(JSON.stringify(log.mock.calls)).not.toContain("private");
  });
});

describe("complete rejection mapping", () => {
  it("maps every domain reason, stale, and notFound to defined safe responses", () => {
    const reasons: TrackerCommandRejection[] = [
      "versionMismatch", "unknownWaypoint", "notEarliestPending", "notPending",
      "notSkippable", "procedureControlsLocked", "notSaved", "unknownCommand", "malformedCommand",
    ];
    for (const reason of reasons) {
      const result = mapTrackerMutation({ outcome: "rejected", reason, message: "private coordinate marker" });
      expect(result.status).toBe(reason === "versionMismatch" ? "stale" : "rejected");
      expect(JSON.stringify(result)).not.toContain("private coordinate marker");
      if (result.status === "rejected") expect(result.reason).toBe(reason);
    }
    expect(mapTrackerMutation({ outcome: "notFound" })).toEqual({ status: "notFound", message: "Tracker not found." });
  });
});
