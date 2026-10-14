/**
 * Repeating slot derivation.
 *
 * Every eligible fix carries a slot derived from its position in the eligible
 * sequence: `slot = ((eligible index - 1) mod 9) + 1`. The number is displayed
 * for every eligible fix regardless of state, so the same slot number appears
 * once per page of the route.
 *
 * Only Skip and the SID/STAR inclusion controls change eligibility, so only
 * those operations renumber. Save and Pass never do.
 *
 * Governed by `docs/tracker-behavior.md` §Memory slots.
 */

import { SLOT_COUNT, type SlotAssignment, type SlotNumber } from "./slots";

/**
 * The slot for a zero-based position in the eligible sequence.
 *
 * Expressed over a zero-based position, `((position) mod 9) + 1` is the same
 * mapping the documented one-based formula describes.
 */
export function slotForEligiblePosition(position: number): SlotNumber {
  if (!Number.isInteger(position) || position < 0) {
    throw new RangeError(`eligible position must be a non-negative integer: ${position}`);
  }
  return ((position % SLOT_COUNT) + 1) as SlotNumber;
}

/** Assigns repeating slots across an eligible sequence, in route order. */
export function deriveSlotAssignments(
  eligibleSequence: readonly number[],
): readonly SlotAssignment[] {
  return eligibleSequence.map((routeIndex, position) => ({
    routeIndex,
    slot: slotForEligiblePosition(position),
  }));
}

/** Indexes slot assignments by route index for lookup during display. */
export function slotByRouteIndex(
  assignments: readonly SlotAssignment[],
): ReadonlyMap<number, SlotNumber> {
  return new Map(assignments.map((assignment) => [assignment.routeIndex, assignment.slot]));
}
