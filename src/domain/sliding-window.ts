/**
 * Sliding window derivation.
 *
 * The window is the tracker's representation of the current data state of the
 * INS unit: the nine most recently saved fixes. It is distinct from a page,
 * which is display grouping, and there is no "active page".
 *
 * Governed by `docs/tracker-behavior.md` §Sliding window:
 *
 * - members are always `saved` or `passed`, never `pending` or `queued`;
 * - it holds between one and nine members once entry begins, and is empty
 *   before the first Save because the unit holds no data yet;
 * - membership changes only on Save, which writes a fix into a free slot and
 *   evicts that slot's previous occupant. Pass never changes membership.
 */

import { SLOT_COUNT } from "./slots";
import type { TrackerSnapshot } from "./tracker";

/** Waypoint states whose fixes have been written into the unit. */
const RESIDENT_STATES = new Set(["saved", "passed"]);

/**
 * The route indexes currently written into the unit's nine slots, in route
 * order from the oldest resident member to the newest.
 *
 * Save is route-ordered, so the most recently saved fixes are the last resident
 * fixes in route order; taking the final nine is therefore the same set as
 * "the nine most recently saved". Pass changes no fix's residency, which is why
 * this derivation is invariant under Pass.
 *
 * Empty before the first Save: the window is not shown when the unit holds no
 * data.
 */
export function deriveSlidingWindow(snapshot: TrackerSnapshot): readonly number[] {
  const resident = snapshot.waypoints
    .filter((waypoint) => RESIDENT_STATES.has(waypoint.state))
    .map((waypoint) => waypoint.routeIndex)
    .sort((a, b) => a - b);

  return resident.slice(-SLOT_COUNT);
}
