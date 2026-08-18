/**
 * Pass cascade selection.
 *
 * This is the single implementation of "which fixes would a Pass mark passed".
 * Both the Pass command and the Pass preview call it. Two code paths that must
 * agree is the defect this module exists to prevent, so nothing else may
 * reimplement the rule.
 *
 * Governed by `docs/tracker-behavior.md` §Passing and bypassed waypoints:
 * passing a saved waypoint atomically marks that waypoint passed and marks
 * every earlier saved-but-unpassed waypoint passed. A saved waypoint is never
 * changed to `skipped`; bypassed saved waypoints are handled through Pass.
 */

import type { TrackerSnapshot } from "./tracker";

/** Why a cascade could not be selected. */
export type PassCascadeRejection = "unknownWaypoint" | "notSaved";

/** The ordered cascade a Pass would apply, or the reason it cannot. */
export type PassCascadeSelection =
  | { readonly outcome: "selected"; readonly routeIndexes: readonly number[] }
  | {
      readonly outcome: "rejected";
      readonly reason: PassCascadeRejection;
      readonly message: string;
    };

/**
 * Selects the fixes a Pass of `routeIndex` would mark passed, in route order.
 *
 * The result always ends with the target fix, and contains every earlier fix
 * still in the `saved` state. Already-passed fixes are not re-included: passed
 * is terminal, and a cascade changes nothing about them.
 *
 * Depends only on waypoint state and route order, so it needs no navlog and no
 * slot derivation.
 */
export function selectPassCascade(
  snapshot: TrackerSnapshot,
  routeIndex: number,
): PassCascadeSelection {
  // Exported, so it may be called with a value the engine has not validated.
  // Checking here keeps the message below free of any unvalidated input.
  if (!Number.isInteger(routeIndex)) {
    return {
      outcome: "rejected",
      reason: "unknownWaypoint",
      message: "route index must be an integer",
    };
  }

  const target = snapshot.waypoints.find((waypoint) => waypoint.routeIndex === routeIndex);

  if (target === undefined) {
    return {
      outcome: "rejected",
      reason: "unknownWaypoint",
      message: `route index ${routeIndex} is not an eligible fix`,
    };
  }

  if (target.state !== "saved") {
    return {
      outcome: "rejected",
      reason: "notSaved",
      message: `a ${target.state} fix may not be passed`,
    };
  }

  const routeIndexes = snapshot.waypoints
    .filter((waypoint) => waypoint.state === "saved" && waypoint.routeIndex <= routeIndex)
    .map((waypoint) => waypoint.routeIndex)
    .sort((left, right) => left - right);

  return { outcome: "selected", routeIndexes };
}
