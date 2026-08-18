import { describe, expect, it } from "vitest";

import { eligibleOf, navlogFromFixtureSubset } from "../../tests/support/tracker-scenarios";
import type { TrackerCommand } from "./commands";
import { applyCommand, createInitialSnapshot } from "./engine";
import { deriveEligibleSequenceForSnapshot } from "./eligibility";
import type { Navlog } from "./navlog";
import { derivePendingRouteIndexes } from "./slot-state";
import type { ProcedureInclusion, TrackerSnapshot } from "./tracker";

/**
 * `docs/tracker-behavior.md` §Slot availability says MVP assumes a contiguous
 * active leg and defers the non-contiguous case. The engine does not enforce
 * contiguity, because the documents specify no guard. This suite establishes
 * whether the deferred case is reachable at all.
 *
 * The reasoning under test: passing a fix passes every earlier saved-but-
 * unpassed fix, so passed fixes always form a route-order prefix, so freed
 * slots are always claimed in order and a later fix can never find a free slot
 * while an earlier unsaved eligible fix does not.
 *
 * The exploration must include the SID and STAR inclusion controls, not only
 * Save, Pass, and Skip. An inclusion change removes eligible fixes and
 * renumbers slots, which is the mechanism most likely to break contiguity, so
 * omitting it would make the conclusion broader than the evidence.
 */

const INCLUSIONS: readonly ProcedureInclusion[] = [
  { sid: true, star: true },
  { sid: false, star: true },
  { sid: true, star: false },
  { sid: false, star: false },
];

/**
 * A ten-fix route derived from `valid-domestic.json`: two SID fixes, six
 * enroute fixes, two STAR fixes, and the destination airport.
 *
 * Ten eligible fixes is the smallest route that queues past the first group of
 * nine, and the procedure mix means each inclusion combination yields a
 * genuinely different eligible sequence — ten, eight, eight, and six fixes —
 * rather than leaving the controls inert.
 */
const navlog: Navlog = navlogFromFixtureSubset(
  "valid-domestic.json",
  [0, 1, 6, 7, 8, 9, 10, 11, 12, 13, 23],
);

const EXPLORATION_CAP = 200000;

/**
 * Explores every state reachable by Save, Pass, Skip, and pre-start SID/STAR
 * inclusion changes, seeded from all four inclusion combinations.
 */
function exploreReachableStates(limit: number): TrackerSnapshot[] {
  const eligible = new Set<number>();
  for (const inclusion of INCLUSIONS) {
    for (const routeIndex of eligibleOf(navlog, inclusion)) {
      eligible.add(routeIndex);
    }
  }
  const targets = [...eligible].sort((left, right) => left - right);

  const starts = INCLUSIONS.map((inclusion) => createInitialSnapshot(navlog, inclusion));
  const seen = new Set(starts.map((snapshot) => JSON.stringify(snapshot)));
  const queue: TrackerSnapshot[] = [...starts];
  const visited: TrackerSnapshot[] = [];

  while (queue.length > 0 && visited.length < limit) {
    const snapshot = queue.shift()!;
    visited.push(snapshot);

    const commands: TrackerCommand[] = [
      ...targets.flatMap((routeIndex): TrackerCommand[] => [
        { type: "saveWaypoint", expectedVersion: snapshot.version, routeIndex },
        { type: "passWaypoint", expectedVersion: snapshot.version, routeIndex },
        { type: "skipWaypoint", expectedVersion: snapshot.version, routeIndex },
      ]),
      ...INCLUSIONS.map(
        (inclusion): TrackerCommand => ({
          type: "setProcedureInclusion",
          expectedVersion: snapshot.version,
          inclusion,
        }),
      ),
    ];

    for (const command of commands) {
      const result = applyCommand(navlog, snapshot, command);
      if (result.outcome !== "applied") {
        continue;
      }
      const key = JSON.stringify(result.snapshot);
      if (!seen.has(key)) {
        seen.add(key);
        queue.push(result.snapshot);
      }
    }
  }

  return visited;
}

const states = exploreReachableStates(EXPLORATION_CAP);

describe("reachable state exploration", () => {
  it("covers every inclusion combination and a non-trivial state space", () => {
    // 66,558 states at the time of writing.
    expect(states.length).toBeGreaterThan(60000);

    const inclusionsSeen = new Set(states.map((s) => JSON.stringify(s.procedureInclusion)));
    expect(inclusionsSeen.size).toBe(4);

    // The invariants below would hold vacuously without these.
    expect(states.some((s) => s.waypoints.some((w) => w.state === "passed"))).toBe(true);
    expect(states.some((s) => s.waypoints.some((w) => w.state === "skipped"))).toBe(true);
    expect(states.some((s) => s.waypoints.some((w) => w.state === "queued"))).toBe(true);
    expect(states.some((s) => derivePendingRouteIndexes(navlog, s).length === 0)).toBe(true);
    expect(states.some((s) => derivePendingRouteIndexes(navlog, s).length > 1)).toBe(true);
    // Inclusion changes combined with skips, the renumbering-heavy case.
    expect(
      states.some(
        (s) =>
          !s.procedureInclusion.sid && s.waypoints.some((w) => w.state === "skipped"),
      ),
    ).toBe(true);
  });

  it("exhausts the reachable state space rather than stopping at the cap", () => {
    // If this ever reaches the cap, the invariants below are checked over a
    // truncated prefix and the conclusion weakens from "unreachable" to "not
    // reached within the cap". Raise the cap and re-measure instead.
    expect(states.length).toBeLessThan(EXPLORATION_CAP);
  });
});

describe("pending contiguity", () => {
  it("never makes a fix pending while an earlier unsaved eligible fix is not", () => {
    for (const snapshot of states) {
      const eligible = deriveEligibleSequenceForSnapshot(navlog, snapshot);
      const stateOf = new Map(snapshot.waypoints.map((w) => [w.routeIndex, w.state]));
      const unsaved = eligible.filter((routeIndex) => {
        const state = stateOf.get(routeIndex);
        return state === "pending" || state === "queued";
      });
      const pending = derivePendingRouteIndexes(navlog, snapshot);

      const isPrefix = pending.every((routeIndex, index) => unsaved[index] === routeIndex);
      if (!isPrefix) {
        throw new Error(
          `non-contiguous pending reached: pending=${JSON.stringify(pending)} ` +
            `unsaved=${JSON.stringify(unsaved)} snapshot=${JSON.stringify(snapshot)}`,
        );
      }
    }
  });

  it("keeps passed fixes a prefix of the entered fixes", () => {
    for (const snapshot of states) {
      const entered = snapshot.waypoints.filter(
        (w) => w.state === "saved" || w.state === "passed",
      );
      const passedCount = entered.filter((w) => w.state === "passed").length;

      expect(entered.slice(0, passedCount).every((w) => w.state === "passed")).toBe(true);
      expect(entered.slice(passedCount).every((w) => w.state === "saved")).toBe(true);
    }
  });
});
