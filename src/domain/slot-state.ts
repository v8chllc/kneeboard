/**
 * Slot availability and pending derivation.
 *
 * Governed by `docs/tracker-behavior.md` §Slot availability:
 *
 * - a slot is free when it has never been written, or when it holds a passed
 *   fix that is not the most recently passed fix;
 * - the most recently passed fix is the active leg's FROM waypoint and keeps
 *   its slot, so slot release is deferred by one Pass;
 * - pending fixes are the next eligible unsaved fixes for which a free slot
 *   exists, and states with no pending fix are normal rather than stuck.
 */

import { deriveEligibleSequenceForSnapshot } from "./eligibility";
import type { Navlog } from "./navlog";
import { deriveSlidingWindow } from "./sliding-window";
import { deriveSlotAssignments, slotByRouteIndex } from "./slot-assignment";
import { SLOT_COUNT, type SlotNumber } from "./slots";
import type { TrackerSnapshot, WaypointState } from "./tracker";

/** What a slot currently holds, if anything. */
export interface SlotState {
  readonly slot: SlotNumber;
  /** The resident fix's route index, or `null` when the slot was never written. */
  readonly routeIndex: number | null;
  readonly free: boolean;
}

/**
 * Indexes waypoint state by route index.
 *
 * Exported so the engine shares this one implementation rather than keeping a
 * second copy of it.
 */
export function stateByRouteIndex(
  snapshot: TrackerSnapshot,
): ReadonlyMap<number, WaypointState> {
  return new Map(snapshot.waypoints.map((waypoint) => [waypoint.routeIndex, waypoint.state]));
}

/**
 * The route index of the most recently passed fix, or `null` when none has been
 * passed.
 *
 * Pass is monotone in route order — passing a fix passes every earlier
 * saved-but-unpassed fix — so the most recently passed fix is the passed fix
 * furthest along the route.
 */
export function mostRecentlyPassedRouteIndex(snapshot: TrackerSnapshot): number | null {
  const passed = snapshot.waypoints
    .filter((waypoint) => waypoint.state === "passed")
    .map((waypoint) => waypoint.routeIndex);

  return passed.length === 0 ? null : Math.max(...passed);
}

/** The occupancy and availability of all nine slots. */
export function deriveSlotStates(
  navlog: Navlog,
  snapshot: TrackerSnapshot,
): readonly SlotState[] {
  const slots = slotByRouteIndex(
    deriveSlotAssignments(deriveEligibleSequenceForSnapshot(navlog, snapshot)),
  );
  const states = stateByRouteIndex(snapshot);
  const anchor = mostRecentlyPassedRouteIndex(snapshot);

  // Only window members are resident: an evicted fix's slot now holds the fix
  // that overwrote it.
  const residentBySlot = new Map<number, number>();
  for (const routeIndex of deriveSlidingWindow(snapshot)) {
    const slot = slots.get(routeIndex);
    if (slot !== undefined) {
      residentBySlot.set(slot, routeIndex);
    }
  }

  return Array.from({ length: SLOT_COUNT }, (_, index) => {
    const slot = (index + 1) as SlotNumber;
    const routeIndex = residentBySlot.get(slot);

    if (routeIndex === undefined) {
      // Never written.
      return { slot, routeIndex: null, free: true };
    }

    // Free only when it holds a passed fix that is not the most recent one.
    const free = states.get(routeIndex) === "passed" && routeIndex !== anchor;
    return { slot, routeIndex, free };
  });
}

/** The slot numbers currently available to be written. */
export function deriveFreeSlots(
  navlog: Navlog,
  snapshot: TrackerSnapshot,
): readonly SlotNumber[] {
  return deriveSlotStates(navlog, snapshot)
    .filter((slotState) => slotState.free)
    .map((slotState) => slotState.slot);
}

/**
 * The NEXT eligible unsaved fixes for which a free slot exists, in route order.
 *
 * Slot numbers repeat every nine fixes, so a free slot is claimed by the first
 * unsaved fix that carries it. Later fixes sharing that slot number are queued,
 * waiting for the slot to be released again. Walking the unsaved fixes in route
 * order and consuming each free slot once is what makes this the *next* fixes
 * rather than every fix whose slot number happens to be free.
 *
 * An empty result is a normal state, not a stuck one: it occurs whenever every
 * free slot has been filled and the next slot cannot be released until another
 * fix is passed.
 */
export function derivePendingRouteIndexes(
  navlog: Navlog,
  snapshot: TrackerSnapshot,
): readonly number[] {
  const eligible = deriveEligibleSequenceForSnapshot(navlog, snapshot);
  const slots = slotByRouteIndex(deriveSlotAssignments(eligible));
  const states = stateByRouteIndex(snapshot);
  const unclaimed = new Set(deriveFreeSlots(navlog, snapshot));

  const pending: number[] = [];
  for (const routeIndex of eligible) {
    if (unclaimed.size === 0) {
      break;
    }

    const state = states.get(routeIndex);
    if (state === "saved" || state === "passed" || state === "skipped") {
      continue;
    }

    const slot = slots.get(routeIndex);
    if (slot !== undefined && unclaimed.has(slot)) {
      pending.push(routeIndex);
      unclaimed.delete(slot);
    }
  }

  return pending;
}

/**
 * The earliest pending fix, which is the only fix that may be saved. `null`
 * when nothing is pending.
 */
export function earliestPendingRouteIndex(
  navlog: Navlog,
  snapshot: TrackerSnapshot,
): number | null {
  const pending = derivePendingRouteIndexes(navlog, snapshot);
  return pending.length === 0 ? null : pending[0];
}
