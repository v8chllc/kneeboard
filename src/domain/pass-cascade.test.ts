import { describe, expect, it } from "vitest";

import {
  eligibleOf,
  navlogFor,
  savedThrough,
  snapshotWithFacts,
} from "../../tests/support/tracker-scenarios";
import { createInitialSnapshot } from "./engine";
import { selectPassCascade } from "./pass-cascade";

const navlog = navlogFor("valid-multi-page.json");
const eligible = eligibleOf(navlog);

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

    // In this snapshot eligible[0] is passed, eligible[12] is pending, and
    // eligible[30] is queued. The skipped case is covered separately below,
    // and the pending case again from a fresh tracker.
    for (const routeIndex of [eligible[0], eligible[12], eligible[30]]) {
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
