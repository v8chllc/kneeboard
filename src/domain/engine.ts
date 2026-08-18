/**
 * The pure transition engine.
 *
 * A typed command plus a snapshot yields the next snapshot, deterministically:
 * the engine validates preconditions and route-order invariants, recalculates
 * pending and queued state through the shared derivations, and returns the next
 * complete tracker snapshot. It performs no I/O and reads no clock.
 *
 * The engine validates a command's expected version against the snapshot but
 * does NOT increment it. Version assignment belongs to persistence, which
 * writes the state with compare-and-swap versioning
 * (`docs/technical-decisions.md` §Tracker application layer and §Persistence
 * requirements).
 *
 * Governed by `docs/tracker-behavior.md` §Domain implementation direction.
 */

import type { TrackerCommand } from "./commands";
import { DEFAULT_PROCEDURE_INCLUSION, deriveEligibleSequenceForSnapshot } from "./eligibility";
import type { Navlog } from "./navlog";
import { selectPassCascade } from "./pass-cascade";
import { derivePendingRouteIndexes, earliestPendingRouteIndex } from "./slot-state";
import type {
  ProcedureInclusion,
  TrackerSnapshot,
  WaypointEntry,
  WaypointState,
} from "./tracker";

/** Why a command was rejected. */
export type TrackerCommandRejection =
  /** The command's expected version does not match the snapshot's. */
  | "versionMismatch"
  /** The target route index is not a slot-eligible fix of this navlog. */
  | "unknownWaypoint"
  /** The target is not the earliest pending fix, so route order forbids saving it. */
  | "notEarliestPending"
  /** The target is not pending: it is queued, already entered, or terminal. */
  | "notPending"
  /** Skip applies only to queued or pending fixes. */
  | "notSkippable"
  /** The SID and STAR controls locked permanently at the first Save. */
  | "procedureControlsLocked"
  /** Only a saved fix may be passed. */
  | "notSaved";

/**
 * The result of applying a command. Failures are returned rather than thrown,
 * so callers must handle both outcomes and invalid commands stay testable as
 * ordinary values.
 */
export type TrackerCommandResult =
  | { readonly outcome: "applied"; readonly snapshot: TrackerSnapshot }
  | {
      readonly outcome: "rejected";
      readonly reason: TrackerCommandRejection;
      readonly message: string;
    };

function applied(snapshot: TrackerSnapshot): TrackerCommandResult {
  return { outcome: "applied", snapshot };
}

function rejected(reason: TrackerCommandRejection, message: string): TrackerCommandResult {
  return { outcome: "rejected", reason, message };
}

function stateByRouteIndex(snapshot: TrackerSnapshot): ReadonlyMap<number, WaypointState> {
  return new Map(snapshot.waypoints.map((waypoint) => [waypoint.routeIndex, waypoint.state]));
}

/**
 * Recomputes `pending` and `queued` across the snapshot.
 *
 * `saved`, `passed`, and `skipped` are facts a command records; `pending` and
 * `queued` are consequences of those facts, recalculated after every transition
 * so they can never be stale. Entries for fixes that are no longer eligible —
 * after a procedure is excluded — are dropped, while skipped fixes are retained
 * because skipping is terminal and must survive later recalculation.
 */
export function recalculateSnapshot(navlog: Navlog, snapshot: TrackerSnapshot): TrackerSnapshot {
  const states = stateByRouteIndex(snapshot);
  const eligible = deriveEligibleSequenceForSnapshot(navlog, snapshot);
  const pending = new Set(derivePendingRouteIndexes(navlog, snapshot));

  const waypoints: WaypointEntry[] = eligible.map((routeIndex) => {
    const state = states.get(routeIndex);
    if (state === "saved" || state === "passed") {
      return { routeIndex, state };
    }
    return { routeIndex, state: pending.has(routeIndex) ? "pending" : "queued" };
  });

  for (const waypoint of snapshot.waypoints) {
    if (waypoint.state === "skipped") {
      waypoints.push(waypoint);
    }
  }

  waypoints.sort((left, right) => left.routeIndex - right.routeIndex);

  return { ...snapshot, waypoints };
}

/**
 * The snapshot a newly created tracker starts from: no fix entered, both
 * procedures included, and the first nine eligible fixes pending because no
 * slot has been written.
 *
 * The version is a starting value only. Persistence assigns versions on write.
 */
export function createInitialSnapshot(
  navlog: Navlog,
  procedureInclusion: ProcedureInclusion = DEFAULT_PROCEDURE_INCLUSION,
): TrackerSnapshot {
  return recalculateSnapshot(navlog, { version: 0, procedureInclusion, waypoints: [] });
}

/** Whether any fix has been entered, which locks the procedure controls forever. */
export function areProcedureControlsLocked(snapshot: TrackerSnapshot): boolean {
  return snapshot.waypoints.some(
    (waypoint) => waypoint.state === "saved" || waypoint.state === "passed",
  );
}

function applySave(
  navlog: Navlog,
  snapshot: TrackerSnapshot,
  routeIndex: number,
): TrackerCommandResult {
  const state = stateByRouteIndex(snapshot).get(routeIndex);
  if (state === "skipped") {
    return rejected("notPending", "a skipped fix may not be saved");
  }

  const eligible = deriveEligibleSequenceForSnapshot(navlog, snapshot);
  if (!eligible.includes(routeIndex)) {
    return rejected("unknownWaypoint", `route index ${routeIndex} is not an eligible fix`);
  }

  const earliest = earliestPendingRouteIndex(navlog, snapshot);
  if (earliest === null) {
    return rejected("notPending", "no fix is pending, so nothing may be saved");
  }
  if (routeIndex !== earliest) {
    const pending = derivePendingRouteIndexes(navlog, snapshot);
    return pending.includes(routeIndex)
      ? rejected(
          "notEarliestPending",
          `route index ${routeIndex} is pending but ${earliest} is earlier in the route`,
        )
      : rejected("notPending", `route index ${routeIndex} is not pending`);
  }

  return applied(
    recalculateSnapshot(navlog, {
      ...snapshot,
      waypoints: snapshot.waypoints.map((waypoint) =>
        waypoint.routeIndex === routeIndex ? { ...waypoint, state: "saved" } : waypoint,
      ),
    }),
  );
}

function applySkip(
  navlog: Navlog,
  snapshot: TrackerSnapshot,
  routeIndex: number,
): TrackerCommandResult {
  const state = stateByRouteIndex(snapshot).get(routeIndex);
  if (state === undefined) {
    return rejected("unknownWaypoint", `route index ${routeIndex} is not an eligible fix`);
  }
  if (state !== "queued" && state !== "pending") {
    return rejected("notSkippable", `a ${state} fix may not be skipped`);
  }

  return applied(
    recalculateSnapshot(navlog, {
      ...snapshot,
      waypoints: snapshot.waypoints.map((waypoint) =>
        waypoint.routeIndex === routeIndex ? { ...waypoint, state: "skipped" } : waypoint,
      ),
    }),
  );
}

/**
 * Passing a saved fix atomically passes every earlier saved-but-unpassed fix.
 *
 * The cascade comes from the one shared selection the Pass preview also calls,
 * so the confirmation the user saw and the transition applied cannot disagree.
 *
 * Pass changes eligibility for nothing, so it never renumbers slots and never
 * rebuilds pages. Freed slots and promoted fixes fall out of recalculation: a
 * slot holding a passed fix that is no longer the most recently passed one
 * becomes free, and the next unsaved fixes claiming those slots become pending.
 */
function applyPass(
  navlog: Navlog,
  snapshot: TrackerSnapshot,
  routeIndex: number,
): TrackerCommandResult {
  const selection = selectPassCascade(snapshot, routeIndex);
  if (selection.outcome === "rejected") {
    return rejected(selection.reason, selection.message);
  }

  const cascade = new Set(selection.routeIndexes);

  return applied(
    recalculateSnapshot(navlog, {
      ...snapshot,
      waypoints: snapshot.waypoints.map((waypoint) =>
        cascade.has(waypoint.routeIndex) ? { ...waypoint, state: "passed" } : waypoint,
      ),
    }),
  );
}

function applyProcedureInclusion(
  navlog: Navlog,
  snapshot: TrackerSnapshot,
  inclusion: ProcedureInclusion,
): TrackerCommandResult {
  if (areProcedureControlsLocked(snapshot)) {
    return rejected(
      "procedureControlsLocked",
      "the SID and STAR controls locked permanently at the first Save",
    );
  }

  return applied(recalculateSnapshot(navlog, { ...snapshot, procedureInclusion: inclusion }));
}

/**
 * Applies one typed command to a snapshot.
 *
 * Pure and total: the same navlog, snapshot, and command always yield the same
 * result, and every failure is a returned value rather than an exception.
 */
export function applyCommand(
  navlog: Navlog,
  snapshot: TrackerSnapshot,
  command: TrackerCommand,
): TrackerCommandResult {
  if (command.expectedVersion !== snapshot.version) {
    return rejected(
      "versionMismatch",
      `expected version ${command.expectedVersion} but the snapshot is at ${snapshot.version}`,
    );
  }

  switch (command.type) {
    case "saveWaypoint":
      return applySave(navlog, snapshot, command.routeIndex);
    case "skipWaypoint":
      return applySkip(navlog, snapshot, command.routeIndex);
    case "setProcedureInclusion":
      return applyProcedureInclusion(navlog, snapshot, command.inclusion);
    case "passWaypoint":
      return applyPass(navlog, snapshot, command.routeIndex);
    default: {
      const unhandled: never = command;
      throw new Error(`Unhandled tracker command: ${JSON.stringify(unhandled)}`);
    }
  }
}
