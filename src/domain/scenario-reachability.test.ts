import { describe, expect, it } from "vitest";

import {
  eligibleOf,
  navlogFor,
  reachState,
  savedThrough,
  UnreachableStateError,
} from "../../tests/support/tracker-scenarios";

const navlog = navlogFor("valid-multi-page.json");

/** Every hand-built scenario shape the suite relies on. */
const SCENARIOS = [
  { entered: 1, passed: 0 },
  { entered: 2, passed: 0 },
  { entered: 3, passed: 0 },
  { entered: 5, passed: 0 },
  { entered: 8, passed: 0 },
  { entered: 9, passed: 0 },
  { entered: 9, passed: 1 },
  { entered: 9, passed: 2 },
  { entered: 9, passed: 3 },
  { entered: 9, passed: 5 },
  { entered: 10, passed: 2 },
  { entered: 12, passed: 4 },
] as const;

describe("hand-built scenarios are reachable through real commands", () => {
  it.each(SCENARIOS)(
    "reaches $entered entered and $passed passed by driving Save and Pass",
    ({ entered, passed }) => {
      const driven = reachState(navlog, { entered, passed });
      const handBuilt = savedThrough(navlog, entered, { passedThrough: passed });

      expect(driven.waypoints).toEqual(handBuilt.waypoints);
      expect(driven.procedureInclusion).toEqual(handBuilt.procedureInclusion);
    },
  );
});

describe("unreachable saturation states", () => {
  /**
   * At most nine fixes can be resident, and once any fix has been passed the
   * most recently passed one anchors the active leg and holds its slot, so at
   * most eight fixes can be saved-but-unpassed from then on. A state with more
   * entered-and-unpassed fixes than that cannot be produced by any command
   * sequence.
   */
  it.each([
    { entered: 10, passed: 0 },
    { entered: 10, passed: 1 },
    { entered: 15, passed: 0 },
    { entered: 39, passed: 0 },
  ])("cannot reach $entered entered with $passed passed", ({ entered, passed }) => {
    expect(() => reachState(navlog, { entered, passed })).toThrow(UnreachableStateError);
  });

  it("reaches the largest entered count the slot rules allow", () => {
    // Eight saved plus the anchor: the ceiling once entry passes nine.
    const snapshot = reachState(navlog, { entered: 12, passed: 4 });
    const saved = snapshot.waypoints.filter((waypoint) => waypoint.state === "saved");

    expect(saved).toHaveLength(8);
    expect(eligibleOf(navlog).indexOf(saved[saved.length - 1].routeIndex)).toBe(11);
  });
});
