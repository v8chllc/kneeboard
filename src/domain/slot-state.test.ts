import { describe, expect, it } from "vitest";

import {
  eligibleOf,
  navlogFor,
  savedThrough,
  snapshotWithFacts,
} from "../../tests/support/tracker-scenarios";
import { createInitialSnapshot } from "./engine";
import {
  deriveFreeSlots,
  derivePendingRouteIndexes,
  deriveSlotStates,
  earliestPendingRouteIndex,
  mostRecentlyPassedRouteIndex,
} from "./slot-state";

const navlog = navlogFor("valid-multi-page.json");
const eligible = eligibleOf(navlog);
const nineOnly = navlogFor("valid-exactly-nine.json");

describe("mostRecentlyPassedRouteIndex", () => {
  it("is null when nothing has been passed", () => {
    expect(mostRecentlyPassedRouteIndex(createInitialSnapshot(navlog))).toBeNull();
    expect(mostRecentlyPassedRouteIndex(savedThrough(navlog, 5))).toBeNull();
  });

  it("is the passed fix furthest along the route", () => {
    const snapshot = savedThrough(navlog, 9, { passedThrough: 3 });
    expect(mostRecentlyPassedRouteIndex(snapshot)).toBe(eligible[2]);
  });
});

describe("deriveFreeSlots", () => {
  it("reports all nine slots free at tracker creation", () => {
    expect(deriveFreeSlots(navlog, createInitialSnapshot(navlog))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });

  it("occupies each slot as a fix is saved into it", () => {
    expect(deriveFreeSlots(navlog, savedThrough(navlog, 4))).toEqual([5, 6, 7, 8, 9]);
    expect(deriveFreeSlots(navlog, savedThrough(navlog, 9))).toEqual([]);
  });

  it("frees no slot when a single fix is passed", () => {
    // Deferred release: the most recently passed fix anchors the active leg and
    // keeps its slot, so one Pass releases nothing.
    const snapshot = savedThrough(navlog, 9, { passedThrough: 1 });

    expect(mostRecentlyPassedRouteIndex(snapshot)).toBe(eligible[0]);
    expect(deriveFreeSlots(navlog, snapshot)).toEqual([]);
  });

  it("frees the earlier slot only once a later fix is passed", () => {
    // The worked example: nine saved, first two passed. Slot 2 anchors the
    // active leg WP2 to WP3, so only slot 1 is free.
    const snapshot = savedThrough(navlog, 9, { passedThrough: 2 });

    expect(deriveFreeSlots(navlog, snapshot)).toEqual([1]);
  });

  it("frees every passed slot except the most recently passed one", () => {
    const snapshot = savedThrough(navlog, 9, { passedThrough: 5 });

    expect(deriveFreeSlots(navlog, snapshot)).toEqual([1, 2, 3, 4]);
  });

  it("marks a never-written slot free and a saved slot occupied", () => {
    const states = deriveSlotStates(navlog, savedThrough(navlog, 3));

    expect(states.slice(0, 3).map((state) => state.free)).toEqual([false, false, false]);
    expect(states.slice(0, 3).map((state) => state.routeIndex)).toEqual(eligible.slice(0, 3));
    expect(states.slice(3).every((state) => state.free && state.routeIndex === null)).toBe(true);
  });
});

describe("derivePendingRouteIndexes", () => {
  it("makes the first nine eligible fixes pending at tracker creation", () => {
    expect(derivePendingRouteIndexes(navlog, createInitialSnapshot(navlog))).toEqual(
      eligible.slice(0, 9),
    );
  });

  it("leaves nothing pending once every free slot is filled", () => {
    // A normal state, not a stuck one.
    expect(derivePendingRouteIndexes(navlog, savedThrough(navlog, 9))).toEqual([]);
    expect(earliestPendingRouteIndex(navlog, savedThrough(navlog, 9))).toBeNull();
  });

  it("promotes exactly one fix when one slot is released", () => {
    const snapshot = savedThrough(navlog, 9, { passedThrough: 2 });

    expect(derivePendingRouteIndexes(navlog, snapshot)).toEqual([eligible[9]]);
    expect(earliestPendingRouteIndex(navlog, snapshot)).toBe(eligible[9]);
  });

  it("promotes several fixes when several slots are released at once", () => {
    const snapshot = savedThrough(navlog, 9, { passedThrough: 5 });

    // Four slots free, so the next four unsaved fixes are pending together.
    expect(derivePendingRouteIndexes(navlog, snapshot)).toEqual(eligible.slice(9, 13));
  });

  it("has no pending fix once a navlog of nine eligible fixes is fully saved", () => {
    const nineEligible = eligibleOf(nineOnly);
    expect(nineEligible).toHaveLength(9);

    const snapshot = savedThrough(nineOnly, 9);
    expect(derivePendingRouteIndexes(nineOnly, snapshot)).toEqual([]);
    // Nothing was ever queued either.
    expect(snapshot.waypoints.every((waypoint) => waypoint.state === "saved")).toBe(true);
  });

  it("never makes a skipped fix pending", () => {
    const snapshot = snapshotWithFacts(navlog, [
      { routeIndex: eligible[0], state: "skipped" },
    ]);

    expect(derivePendingRouteIndexes(navlog, snapshot)).not.toContain(eligible[0]);
    // The skip renumbers, so the next nine eligible fixes are pending instead.
    expect(derivePendingRouteIndexes(navlog, snapshot)).toEqual(eligible.slice(1, 10));
  });
});
