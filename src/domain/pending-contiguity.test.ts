import { describe, expect, it } from "vitest";

import { eligibleOf, navlogFor } from "../../tests/support/tracker-scenarios";
import type { TrackerCommand } from "./commands";
import { applyCommand, createInitialSnapshot } from "./engine";
import { deriveEligibleSequenceForSnapshot } from "./eligibility";
import { derivePendingRouteIndexes } from "./slot-state";
import type { TrackerSnapshot } from "./tracker";

/**
 * `docs/tracker-behavior.md` says MVP assumes a contiguous active leg and
 * defers the non-contiguous case. The engine does not enforce contiguity,
 * because the documents do not specify a guard. This suite establishes whether
 * the deferred case is reachable at all.
 *
 * The reasoning it checks: passing a fix passes every earlier saved-but-unpassed
 * fix, so passed fixes always form a prefix of the entered fixes, so freed slots
 * always correspond to a prefix. A later fix should therefore never find a free
 * slot while an earlier unsaved eligible fix does not.
 */
function pendingIsPrefixOfUnsaved(navlog: ReturnType<typeof navlogFor>, snapshot: TrackerSnapshot) {
  const eligible = deriveEligibleSequenceForSnapshot(navlog, snapshot);
  const states = new Map(snapshot.waypoints.map((w) => [w.routeIndex, w.state]));
  const unsaved = eligible.filter((routeIndex) => {
    const state = states.get(routeIndex);
    return state === "pending" || state === "queued";
  });
  const pending = derivePendingRouteIndexes(navlog, snapshot);

  return {
    holds: pending.every((routeIndex, index) => unsaved[index] === routeIndex),
    pending,
    unsaved,
  };
}

/** Explores every state reachable by Save, Pass, and Skip from a new tracker. */
function exploreReachableStates(
  navlog: ReturnType<typeof navlogFor>,
  limit: number,
): TrackerSnapshot[] {
  const eligible = eligibleOf(navlog);
  const start = createInitialSnapshot(navlog);
  const seen = new Set<string>([JSON.stringify(start)]);
  const queue: TrackerSnapshot[] = [start];
  const visited: TrackerSnapshot[] = [];

  while (queue.length > 0 && visited.length < limit) {
    const snapshot = queue.shift()!;
    visited.push(snapshot);

    const commands: TrackerCommand[] = eligible.flatMap((routeIndex) => [
      { type: "saveWaypoint", expectedVersion: snapshot.version, routeIndex },
      { type: "passWaypoint", expectedVersion: snapshot.version, routeIndex },
      { type: "skipWaypoint", expectedVersion: snapshot.version, routeIndex },
    ]);

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

describe("pending contiguity across reachable states", () => {
  // Ten eligible fixes: enough to queue past the first group of nine, small
  // enough to explore exhaustively.
  const navlog = navlogFor("valid-ten-boundary-cases.json");
  const EXPLORATION_CAP = 50000;
  const states = exploreReachableStates(navlog, EXPLORATION_CAP);

  it("explores a non-trivial state space", () => {
    // 22,782 states: every state reachable by any sequence of Save, Pass, and
    // Skip over the fixture's ten eligible fixes.
    expect(states.length).toBeGreaterThan(20000);
    // The exploration must actually reach the interesting states, or the
    // invariant below would hold vacuously.
    expect(states.some((s) => s.waypoints.some((w) => w.state === "passed"))).toBe(true);
    expect(states.some((s) => s.waypoints.some((w) => w.state === "skipped"))).toBe(true);
    expect(states.some((s) => s.waypoints.some((w) => w.state === "queued"))).toBe(true);
    expect(states.some((s) => derivePendingRouteIndexes(navlog, s).length === 0)).toBe(true);
    expect(states.some((s) => derivePendingRouteIndexes(navlog, s).length > 1)).toBe(true);
  });

  it("never makes a fix pending while an earlier unsaved eligible fix is not", () => {
    // The deferred non-contiguous case is unreachable: cascade keeps passed
    // fixes a route-order prefix, so freed slots are always claimed in order.
    for (const snapshot of states) {
      const { holds, pending, unsaved } = pendingIsPrefixOfUnsaved(navlog, snapshot);
      if (!holds) {
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

  it("exhausts the reachable state space rather than stopping at the cap", () => {
    // If this ever reaches the cap, the invariants above are checked over a
    // truncated prefix of the state space and the conclusion weakens from
    // "unreachable" to "not reached within the cap".
    expect(states.length).toBeLessThan(EXPLORATION_CAP);
  });
});
