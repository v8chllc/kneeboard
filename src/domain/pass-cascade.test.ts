import { describe, expect, it } from "vitest";

import {
  eligibleOf,
  navlogFor,
  savedThrough,
  snapshotWithFacts,
} from "../../tests/support/tracker-scenarios";
import { createInitialSnapshot } from "./engine";
import { selectPassCascade } from "./pass-cascade";
import type { TrackerSnapshot } from "./tracker";

const navlog = navlogFor("valid-multi-page.json");
const eligible = eligibleOf(navlog);

function stateOf(snapshot: TrackerSnapshot, routeIndex: number) {
  return snapshot.waypoints.find((waypoint) => waypoint.routeIndex === routeIndex)?.state;
}

describe("selectPassCascade", () => {
  it("selects only the target when it is the sole saved fix", () => {
    const snapshot = savedThrough(navlog, 1);

    expect(selectPassCascade(snapshot, eligible[0])).toEqual({
      outcome: "selected",
      routeIndexes: [eligible[0]],
    });
  });

  it("selects every earlier saved-but-unpassed fix, in route order", () => {
    // ATC clears the aircraft directly to a later saved fix: passing it must
    // pass the bypassed saved fixes as a side effect.
    const snapshot = savedThrough(navlog, 9);
    const selection = selectPassCascade(snapshot, eligible[5]);

    expect(selection).toEqual({
      outcome: "selected",
      routeIndexes: eligible.slice(0, 6),
    });
  });

  it("excludes fixes already passed, because passed is terminal", () => {
    const snapshot = savedThrough(navlog, 9, { passedThrough: 3 });
    const selection = selectPassCascade(snapshot, eligible[5]);

    expect(selection).toEqual({
      outcome: "selected",
      routeIndexes: eligible.slice(3, 6),
    });
  });

  it("excludes skipped fixes, which are never passed", () => {
    const snapshot = snapshotWithFacts(navlog, [
      { routeIndex: eligible[0], state: "saved" },
      { routeIndex: eligible[1], state: "skipped" },
      { routeIndex: eligible[2], state: "saved" },
    ]);

    expect(selectPassCascade(snapshot, eligible[2])).toEqual({
      outcome: "selected",
      routeIndexes: [eligible[0], eligible[2]],
    });
  });

  it("always ends with the target fix", () => {
    const snapshot = savedThrough(navlog, 9, { passedThrough: 2 });

    for (const position of [2, 4, 8]) {
      const selection = selectPassCascade(snapshot, eligible[position]);
      expect(selection.outcome).toBe("selected");
      if (selection.outcome === "selected") {
        expect(selection.routeIndexes[selection.routeIndexes.length - 1]).toBe(
          eligible[position],
        );
      }
    }
  });

  it("rejects a fix that is not saved", () => {
    const snapshot = savedThrough(navlog, 9, { passedThrough: 2 });

    // Asserted rather than described, because a comment about which state each
    // fix is in can drift from the snapshot without anything failing.
    expect(stateOf(snapshot, eligible[0])).toBe("passed");
    expect(stateOf(snapshot, eligible[9])).toBe("pending");
    expect(stateOf(snapshot, eligible[12])).toBe("queued");
    expect(stateOf(snapshot, eligible[30])).toBe("queued");

    for (const routeIndex of [eligible[0], eligible[9], eligible[12], eligible[30]]) {
      expect(selectPassCascade(snapshot, routeIndex)).toMatchObject({
        outcome: "rejected",
        reason: "notSaved",
      });
    }
    expect(selectPassCascade(createInitialSnapshot(navlog), eligible[0])).toMatchObject({
      outcome: "rejected",
      reason: "notSaved",
    });
  });

  it("rejects a skipped fix", () => {
    const snapshot = snapshotWithFacts(navlog, [
      { routeIndex: eligible[0], state: "skipped" },
    ]);

    expect(selectPassCascade(snapshot, eligible[0])).toMatchObject({
      outcome: "rejected",
      reason: "notSaved",
    });
  });

  it("rejects a point that is not an eligible fix", () => {
    expect(selectPassCascade(savedThrough(navlog, 3), 0)).toMatchObject({
      outcome: "rejected",
      reason: "unknownWaypoint",
    });
  });

  it("does not mutate the snapshot", () => {
    const snapshot = savedThrough(navlog, 9);
    const copy = structuredClone(snapshot);

    selectPassCascade(snapshot, eligible[7]);

    expect(snapshot).toEqual(copy);
  });
});
