/**
 * Test-only scenario builders for tracker snapshots.
 *
 * Slice 5a implements deferred slot release before any Pass command exists, so
 * a snapshot containing passed fixes cannot be reached by driving commands. It
 * must be constructed directly.
 *
 * TRACKED OBLIGATION for slice 5b: once Pass exists, every snapshot built here
 * with passed fixes must be re-reached by applying real Pass commands, and the
 * results compared. Until that happens, a hand-built snapshot could encode a
 * state the engine can never actually produce, and the suite would be verifying
 * a fiction.
 *
 * Not a Vitest suite: Vitest's default include matches only `*.test.ts`.
 */

import {
  DEFAULT_PROCEDURE_INCLUSION,
  deriveEligibleSequence,
} from "../../src/domain/eligibility";
import type { TrackerCommand } from "../../src/domain/commands";
import {
  applyCommand,
  createInitialSnapshot,
  recalculateSnapshot,
} from "../../src/domain/engine";
import { earliestPendingRouteIndex } from "../../src/domain/slot-state";
import type { Navlog } from "../../src/domain/navlog";
import { buildNavlog } from "../../src/domain/navlog-construction";
import type {
  ProcedureInclusion,
  TrackerSnapshot,
  WaypointState,
} from "../../src/domain/tracker";
import { loadOfpFixture } from "./ofp-fixture-adapter";

/** Builds the navlog for a tracked sanitized fixture. */
export function navlogFor(fileName: string): Navlog {
  return buildNavlog(loadOfpFixture(fileName));
}

/** The eligible route indexes of a navlog under the given inclusion. */
export function eligibleOf(
  navlog: Navlog,
  inclusion: ProcedureInclusion = DEFAULT_PROCEDURE_INCLUSION,
): readonly number[] {
  return deriveEligibleSequence(navlog, inclusion);
}

/**
 * Builds a snapshot from recorded facts — `saved`, `passed`, or `skipped` — and
 * lets the engine's own recalculation fill in `pending` and `queued`, so a
 * scenario can never assert against hand-written derived state.
 */
export function snapshotWithFacts(
  navlog: Navlog,
  facts: ReadonlyArray<{ routeIndex: number; state: WaypointState }>,
  options: { version?: number; procedureInclusion?: ProcedureInclusion } = {},
): TrackerSnapshot {
  return recalculateSnapshot(navlog, {
    version: options.version ?? 0,
    procedureInclusion: options.procedureInclusion ?? DEFAULT_PROCEDURE_INCLUSION,
    waypoints: facts.map((fact) => ({ routeIndex: fact.routeIndex, state: fact.state })),
  });
}

/** Marks the first `count` eligible fixes saved, in route order. */
export function savedThrough(
  navlog: Navlog,
  count: number,
  options: { passedThrough?: number } = {},
): TrackerSnapshot {
  const eligible = eligibleOf(navlog);
  const passedThrough = options.passedThrough ?? 0;

  return snapshotWithFacts(
    navlog,
    eligible.slice(0, count).map((routeIndex, position) => ({
      routeIndex,
      state: (position < passedThrough ? "passed" : "saved") as WaypointState,
    })),
  );
}

/**
 * Thrown when a requested state cannot be reached by applying real commands.
 *
 * This is how a hand-built scenario encoding a state the engine can never
 * produce is detected rather than assumed away.
 */
export class UnreachableStateError extends Error {}

/**
 * Drives real commands from a new tracker until the first `entered` eligible
 * fixes have been entered and the first `passed` of them have been passed.
 *
 * Saves the earliest pending fix whenever one exists; when nothing is pending
 * and more fixes are still needed, passes the next unpassed entered fix to
 * release a slot. Throws {@link UnreachableStateError} when neither move makes
 * progress, which means the requested state is not reachable.
 */
export function reachState(
  navlog: Navlog,
  target: { entered: number; passed: number },
): TrackerSnapshot {
  const eligible = eligibleOf(navlog);
  let snapshot = createInitialSnapshot(navlog);

  const enteredCount = () =>
    snapshot.waypoints.filter((w) => w.state === "saved" || w.state === "passed").length;
  const passedCount = () => snapshot.waypoints.filter((w) => w.state === "passed").length;

  const apply = (command: TrackerCommand): void => {
    const result = applyCommand(navlog, snapshot, command);
    if (result.outcome !== "applied") {
      throw new UnreachableStateError(`${command.type} rejected: ${result.reason}`);
    }
    snapshot = result.snapshot;
  };

  while (enteredCount() < target.entered || passedCount() < target.passed) {
    const earliest = earliestPendingRouteIndex(navlog, snapshot);

    if (earliest !== null && enteredCount() < target.entered) {
      apply({ type: "saveWaypoint", expectedVersion: snapshot.version, routeIndex: earliest });
      continue;
    }

    if (passedCount() < target.passed) {
      apply({
        type: "passWaypoint",
        expectedVersion: snapshot.version,
        routeIndex: eligible[passedCount()],
      });
      continue;
    }

    throw new UnreachableStateError(
      `cannot reach ${target.entered} entered with ${target.passed} passed: ` +
        `stalled at ${enteredCount()} entered and ${passedCount()} passed`,
    );
  }

  return snapshot;
}

/** Applies one command, throwing if it is rejected. */
export function applyOrThrow(
  navlog: Navlog,
  snapshot: TrackerSnapshot,
  command: TrackerCommand,
): TrackerSnapshot {
  const result = applyCommand(navlog, snapshot, command);
  if (result.outcome !== "applied") {
    throw new UnreachableStateError(`${command.type} rejected: ${result.reason}`);
  }
  return result.snapshot;
}
