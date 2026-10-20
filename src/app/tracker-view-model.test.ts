import { describe, expect, it } from "vitest";

import { applyCommand, createInitialSnapshot, deriveEligibleSequenceForSnapshot, deriveSlidingWindow } from "../domain";
import { applyOrThrow, navlogFor, reachState } from "../../tests/support/tracker-scenarios";

import { buildTrackerView, formatUtcAviation } from "./tracker-view-model";

const navlog = navlogFor("valid-multi-page.json");

describe("tracker view model", () => {
  it("keeps every navlog row and starts a new page at the next slot 1", () => {
    const view = buildTrackerView(navlog, createInitialSnapshot(navlog));
    expect(view.rows.map((row) => row.routeIndex)).toEqual(navlog.points.map((point) => point.routeIndex));
    expect(view.pageCount).toBeGreaterThan(1);
    expect(view.rows[0].pageStart).toBe(1);
    const starts = view.rows.filter((row) => row.pageStart !== null);
    expect(starts.map((row) => row.pageStart)).toEqual([1, 2, 3, 4, 5]);
    expect(starts.slice(1).every((row) => row.slot === 1)).toBe(true);
    expect(view.windowVisible).toBe(false);
    expect(view.procedureControlsLocked).toBe(false);
  });

  it("distinguishes pending, queued and ineligible entry affordances", () => {
    const view = buildTrackerView(navlog, createInitialSnapshot(navlog));
    const pending = view.rows.filter((row) => row.state === "pending");
    const queued = view.rows.filter((row) => row.state === "queued");
    const ineligible = view.rows.filter((row) => row.state === "ineligible");
    expect(pending.length).toBeGreaterThan(1);
    expect(queued.length).toBeGreaterThan(0);
    expect(ineligible.length).toBeGreaterThan(0);
    expect(pending.filter((row) => row.canSave)).toHaveLength(1);
    expect(pending.every((row) => row.badge === "filled" && row.canSkip)).toBe(true);
    expect(queued.every((row) => row.badge === "outline" && row.canSkip && !row.canSave)).toBe(true);
    expect(ineligible.every((row) => row.slot === null && !row.canSave && !row.canSkip)).toBe(true);
  });

  it("shows saved and passed fixes with one continuous resident rail", () => {
    const snapshot = reachState(navlog, { entered: 3, passed: 1 });
    const view = buildTrackerView(navlog, snapshot);
    const window = deriveSlidingWindow(snapshot);
    const passed = view.rows.find((row) => row.state === "passed");
    const saved = view.rows.filter((row) => row.state === "saved");
    expect(passed).toMatchObject({ canPass: false, canSave: false, badge: "filled" });
    expect(saved).toHaveLength(2);
    expect(saved.every((row) => row.canPass && row.badge === "filled")).toBe(true);
    expect(view.procedureControlsLocked).toBe(true);
    expect(view.rows.filter((row) => row.insideWindowRail).map((row) => row.routeIndex))
      .toEqual(navlog.points.slice(window[0], window.at(-1)! + 1).map((point) => point.routeIndex));
    expect(view.rows.filter((row) => row.railStart).map((row) => row.routeIndex)).toEqual([window[0]]);
    expect(view.rows.filter((row) => row.railEnd).map((row) => row.routeIndex)).toEqual([window.at(-1)]);
  });

  it("keeps the rail continuous across a skipped row between resident fixes", () => {
    const eligible = deriveEligibleSequenceForSnapshot(navlog, createInitialSnapshot(navlog));
    let snapshot = createInitialSnapshot(navlog);
    snapshot = applyOrThrow(navlog, snapshot, { type: "saveWaypoint", routeIndex: eligible[0], expectedVersion: snapshot.version });
    snapshot = applyOrThrow(navlog, snapshot, { type: "skipWaypoint", routeIndex: eligible[1], expectedVersion: snapshot.version });
    snapshot = applyOrThrow(navlog, snapshot, { type: "saveWaypoint", routeIndex: eligible[2], expectedVersion: snapshot.version });
    const skipped = buildTrackerView(navlog, snapshot).rows[eligible[1]];
    expect(skipped).toMatchObject({ state: "skipped", insideWindowRail: true, slot: null });
  });

  it("clears an evicted passed fix's old badge after its slot is overwritten", () => {
    const snapshot = reachState(navlog, { entered: 10, passed: 2 });
    const view = buildTrackerView(navlog, snapshot);
    const firstPassed = view.rows.find((row) => row.state === "passed");
    expect(firstPassed).toBeDefined();
    expect(firstPassed?.slot).toBeNull();
    expect(firstPassed?.insideWindowRail).toBe(false);
    expect(view.rows.filter((row) => row.insideWindowRail && row.state === "saved")).toHaveLength(8);
  });

  it("removes a skipped fix from slot numbering and entry controls", () => {
    const initial = createInitialSnapshot(navlog);
    const target = deriveEligibleSequenceForSnapshot(navlog, initial)[0];
    const result = applyCommand(navlog, initial, { type: "skipWaypoint", routeIndex: target, expectedVersion: initial.version });
    expect(result.outcome).toBe("applied");
    if (result.outcome !== "applied") return;
    const view = buildTrackerView(navlog, result.snapshot);
    expect(view.rows[target]).toMatchObject({ state: "skipped", slot: null, canSave: false, canSkip: false });
    const next = deriveEligibleSequenceForSnapshot(navlog, result.snapshot)[0];
    expect(view.rows[next].slot).toBe(1);
    expect(view.rows[next].canSave).toBe(true);
  });

  it("renders persisted instants in UTC, including across a date boundary", () => {
    expect(formatUtcAviation("2026-10-20T00:15:00.000Z")).toBe("20 OCT 2026 0015Z");
    expect(formatUtcAviation("2026-10-19T19:15:00-05:00")).toBe("20 OCT 2026 0015Z");
  });
});
