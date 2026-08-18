/**
 * Slot eligibility: which navlog points take part in the repeating slot
 * sequence, and in what order.
 *
 * Eligibility has two halves. Classification decides what can ever hold a slot
 * — airports and computed, ambiguous, or unrecognized points never can. Tracker
 * state decides what currently does: SID and STAR fixes drop out when their
 * procedure is excluded before first Save, and skipped fixes consume no slot.
 *
 * Governed by `docs/tracker-behavior.md` §Slot eligibility and §Memory slots.
 */

import { isSlotEligibleClassification } from "./classification";
import type { Navlog, NavlogPoint } from "./navlog";
import type { ProcedureInclusion, TrackerSnapshot } from "./tracker";

/** Both procedures included, which is the default for a new tracker. */
export const DEFAULT_PROCEDURE_INCLUSION: ProcedureInclusion = { sid: true, star: true };

/**
 * Whether a point is eligible under the given procedure inclusion, ignoring
 * skip state. A SID or STAR fix is eligible only while its procedure is
 * included; excluding a procedure also drops any VOR inside it.
 */
export function isEligibleUnderInclusion(
  point: NavlogPoint,
  inclusion: ProcedureInclusion,
): boolean {
  if (!isSlotEligibleClassification(point.classification)) {
    return false;
  }
  if (point.classification === "sidFix") {
    return inclusion.sid;
  }
  if (point.classification === "starFix") {
    return inclusion.star;
  }
  return true;
}

/**
 * The ordered route indexes that take part in slot assignment: eligible by
 * classification, included by procedure, and not skipped. Original route order
 * is preserved, so slot numbering follows position in this sequence.
 */
export function deriveEligibleSequence(
  navlog: Navlog,
  inclusion: ProcedureInclusion,
  skippedRouteIndexes: readonly number[] = [],
): readonly number[] {
  const skipped = new Set(skippedRouteIndexes);

  return navlog.points
    .filter((point) => !skipped.has(point.routeIndex) && isEligibleUnderInclusion(point, inclusion))
    .map((point) => point.routeIndex);
}

/** The route indexes a snapshot records as skipped. */
export function skippedRouteIndexes(snapshot: TrackerSnapshot): readonly number[] {
  return snapshot.waypoints
    .filter((waypoint) => waypoint.state === "skipped")
    .map((waypoint) => waypoint.routeIndex);
}

/** The eligible sequence implied by a snapshot's inclusion and skip state. */
export function deriveEligibleSequenceForSnapshot(
  navlog: Navlog,
  snapshot: TrackerSnapshot,
): readonly number[] {
  return deriveEligibleSequence(
    navlog,
    snapshot.procedureInclusion,
    skippedRouteIndexes(snapshot),
  );
}
