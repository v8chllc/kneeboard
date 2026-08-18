import { describe, expect, it } from "vitest";

import { loadOfpFixture } from "../../tests/support/ofp-fixture-adapter";
import { DEFAULT_PROCEDURE_INCLUSION, deriveEligibleSequence } from "./eligibility";
import { buildNavlog } from "./navlog-construction";
import { deriveSlotAssignments, slotByRouteIndex, slotForEligiblePosition } from "./slot-assignment";
import { SLOT_COUNT } from "./slots";
import type { ProcedureInclusion } from "./tracker";

function navlogFor(fileName: string) {
  return buildNavlog(loadOfpFixture(fileName));
}

function assignmentsFor(
  fileName: string,
  inclusion: ProcedureInclusion = DEFAULT_PROCEDURE_INCLUSION,
  skipped: readonly number[] = [],
) {
  const navlog = navlogFor(fileName);
  return deriveSlotAssignments(deriveEligibleSequence(navlog, inclusion, skipped));
}

describe("slotForEligiblePosition", () => {
  it("repeats slots 1 through 9 across the first and later groups", () => {
    const firstGroup = Array.from({ length: SLOT_COUNT }, (_, index) =>
      slotForEligiblePosition(index),
    );
    expect(firstGroup).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);

    // The tenth eligible fix begins the second group at slot 1 again.
    expect(slotForEligiblePosition(9)).toBe(1);
    expect(slotForEligiblePosition(17)).toBe(9);
    expect(slotForEligiblePosition(18)).toBe(1);
    // The documented one-based formula, checked on a later group.
    for (const position of [27, 35, 100]) {
      expect(slotForEligiblePosition(position)).toBe(((position + 1 - 1) % SLOT_COUNT) + 1);
    }
  });

  it("rejects a position that is not a non-negative integer", () => {
    expect(() => slotForEligiblePosition(-1)).toThrow(RangeError);
    expect(() => slotForEligiblePosition(1.5)).toThrow(RangeError);
  });
});

describe("deriveSlotAssignments", () => {
  it("assigns exactly one slot per eligible fix, in route order", () => {
    const assignments = assignmentsFor("valid-multi-page.json");

    expect(assignments).toHaveLength(39);
    expect(assignments.map((assignment) => assignment.routeIndex)).toEqual(
      [...assignments.map((assignment) => assignment.routeIndex)].sort((a, b) => a - b),
    );
    expect(assignments.slice(0, 9).map((assignment) => assignment.slot)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(assignments[9].slot).toBe(1);
    // 39 eligible fixes: four full groups and a partial group of three.
    expect(assignments[38].slot).toBe(3);
  });

  it("never queues anything for a navlog of exactly nine eligible fixes", () => {
    const assignments = assignmentsFor("valid-exactly-nine.json");

    expect(assignments).toHaveLength(9);
    expect(assignments.map((assignment) => assignment.slot)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });

  it("renumbers every following fix when an earlier fix is skipped", () => {
    const navlog = navlogFor("valid-multi-page.json");
    const sequence = deriveEligibleSequence(navlog, DEFAULT_PROCEDURE_INCLUSION);
    const skippedPosition = 20;
    const after = assignmentsFor("valid-multi-page.json", DEFAULT_PROCEDURE_INCLUSION, [
      sequence[skippedPosition],
    ]);

    // The fix that used to follow the skipped one takes the skipped fix's slot.
    expect(after[skippedPosition].routeIndex).toBe(sequence[skippedPosition + 1]);
    expect(after[skippedPosition].slot).toBe(slotForEligiblePosition(skippedPosition));
  });

  it("never disturbs the slot of a fix earlier in the route than the skip", () => {
    // docs/tracker-behavior.md: Save is route-ordered and Skip applies only to
    // queued or pending fixes, so every skip is later in the route than every
    // entered fix. The minimal snapshot depends on this: a saved fix's derived
    // slot must never drift from the slot it was written into.
    const navlog = navlogFor("valid-multi-page.json");
    const sequence = deriveEligibleSequence(navlog, DEFAULT_PROCEDURE_INCLUSION);
    const before = slotByRouteIndex(deriveSlotAssignments(sequence));

    for (const skippedPosition of [1, 8, 9, 20, 38]) {
      const after = slotByRouteIndex(
        deriveSlotAssignments(
          deriveEligibleSequence(navlog, DEFAULT_PROCEDURE_INCLUSION, [sequence[skippedPosition]]),
        ),
      );

      // Every fix ahead of the skip — the only ones that can already be saved —
      // keeps the exact slot it had.
      for (let position = 0; position < skippedPosition; position += 1) {
        const routeIndex = sequence[position];
        expect(after.get(routeIndex)).toBe(before.get(routeIndex));
      }

      // The skipped fix itself holds no slot.
      expect(after.has(sequence[skippedPosition])).toBe(false);
    }
  });

  it("is stable across repeated derivation from the same inputs", () => {
    const first = assignmentsFor("valid-domestic.json");
    const second = assignmentsFor("valid-domestic.json");

    expect(first).toEqual(second);
  });

  it("renumbers for each of the four SID and STAR inclusion combinations", () => {
    const combinations: ProcedureInclusion[] = [
      { sid: true, star: true },
      { sid: false, star: true },
      { sid: true, star: false },
      { sid: false, star: false },
    ];

    const rendered = combinations.map((inclusion) =>
      assignmentsFor("valid-domestic.json", inclusion)
        .map((assignment) => `${assignment.routeIndex}:${assignment.slot}`)
        .join(","),
    );

    // Each control changes which fixes hold slots and therefore the numbering
    // itself, not only the classification.
    expect(new Set(rendered).size).toBe(4);

    const withSid = assignmentsFor("valid-domestic.json", { sid: true, star: true });
    const withoutSid = assignmentsFor("valid-domestic.json", { sid: false, star: true });
    // valid-domestic.json begins with SID fixes, so excluding the SID moves
    // slot 1 to a different route index.
    expect(withoutSid[0].routeIndex).not.toBe(withSid[0].routeIndex);
    expect(withoutSid[0].slot).toBe(1);
  });
});
