import { describe, expect, it } from "vitest";

import type { TrackerCommand } from "./commands";
import {
  applyCommand,
  areProcedureControlsLocked,
  createInitialSnapshot,
  recalculateSnapshot,
} from "./engine";
import {
  eligibleOf,
  navlogFor,
  savedThrough,
  snapshotWithFacts,
} from "../../tests/support/tracker-scenarios";
import { buildPages } from "./page-construction";
import { deriveSlidingWindow } from "./sliding-window";
import { deriveFreeSlots, derivePendingRouteIndexes } from "./slot-state";
import { deriveSlotAssignments, slotByRouteIndex } from "./slot-assignment";
import { deriveEligibleSequence, deriveEligibleSequenceForSnapshot } from "./eligibility";
import type { TrackerSnapshot } from "./tracker";

const navlog = navlogFor("valid-multi-page.json");
const eligible = eligibleOf(navlog);
const domestic = navlogFor("valid-domestic.json");

function stateOf(snapshot: TrackerSnapshot, routeIndex: number) {
  return snapshot.waypoints.find((waypoint) => waypoint.routeIndex === routeIndex)?.state;
}

function expectApplied(result: ReturnType<typeof applyCommand>): TrackerSnapshot {
  expect(result.outcome).toBe("applied");
  if (result.outcome !== "applied") {
    throw new Error("expected the command to be applied");
  }
  return result.snapshot;
}

describe("createInitialSnapshot", () => {
  it("starts with the first nine eligible fixes pending and the rest queued", () => {
    const snapshot = createInitialSnapshot(navlog);

    expect(snapshot.waypoints).toHaveLength(39);
    expect(snapshot.procedureInclusion).toEqual({ sid: true, star: true });
    expect(snapshot.waypoints.slice(0, 9).every((w) => w.state === "pending")).toBe(true);
    expect(snapshot.waypoints.slice(9).every((w) => w.state === "queued")).toBe(true);
  });

  it("holds no slot, page, or window data in the snapshot", () => {
    const snapshot = createInitialSnapshot(navlog);

    expect(Object.keys(snapshot).sort()).toEqual([
      "procedureInclusion",
      "version",
      "waypoints",
    ]);
    expect(Object.keys(snapshot.waypoints[0]).sort()).toEqual(["routeIndex", "state"]);
  });
});

describe("expected version", () => {
  it("rejects a command whose expected version does not match", () => {
    const snapshot = createInitialSnapshot(navlog);
    const result = applyCommand(navlog, snapshot, {
      type: "saveWaypoint",
      expectedVersion: 7,
      routeIndex: eligible[0],
    });

    expect(result).toMatchObject({ outcome: "rejected", reason: "versionMismatch" });
  });

  it("does not increment the version, which persistence assigns", () => {
    const snapshot = { ...createInitialSnapshot(navlog), version: 4 };
    const next = expectApplied(
      applyCommand(navlog, snapshot, {
        type: "saveWaypoint",
        expectedVersion: 4,
        routeIndex: eligible[0],
      }),
    );

    expect(next.version).toBe(4);
  });
});

describe("Save", () => {
  it("saves the earliest pending fix", () => {
    const next = expectApplied(
      applyCommand(navlog, createInitialSnapshot(navlog), {
        type: "saveWaypoint",
        expectedVersion: 0,
        routeIndex: eligible[0],
      }),
    );

    expect(stateOf(next, eligible[0])).toBe("saved");
    // The ninth slot is now free for the tenth fix only after a Pass, so the
    // set of pending fixes shrinks by one rather than shifting.
    expect(stateOf(next, eligible[9])).toBe("queued");
  });

  it("rejects saving a pending fix that is not the earliest", () => {
    const result = applyCommand(navlog, createInitialSnapshot(navlog), {
      type: "saveWaypoint",
      expectedVersion: 0,
      routeIndex: eligible[3],
    });

    expect(result).toMatchObject({ outcome: "rejected", reason: "notEarliestPending" });
  });

  it("rejects saving a queued fix", () => {
    const result = applyCommand(navlog, createInitialSnapshot(navlog), {
      type: "saveWaypoint",
      expectedVersion: 0,
      routeIndex: eligible[20],
    });

    expect(result).toMatchObject({ outcome: "rejected", reason: "notPending" });
  });

  it("rejects saving an already saved or passed fix", () => {
    const snapshot = savedThrough(navlog, 9, { passedThrough: 2 });

    for (const routeIndex of [eligible[0], eligible[5]]) {
      expect(
        applyCommand(navlog, snapshot, {
          type: "saveWaypoint",
          expectedVersion: 0,
          routeIndex,
        }),
      ).toMatchObject({ outcome: "rejected", reason: "notPending" });
    }
  });

  it("rejects saving a skipped fix", () => {
    const snapshot = snapshotWithFacts(navlog, [
      { routeIndex: eligible[0], state: "skipped" },
    ]);

    expect(
      applyCommand(navlog, snapshot, {
        type: "saveWaypoint",
        expectedVersion: 0,
        routeIndex: eligible[0],
      }),
    ).toMatchObject({ outcome: "rejected", reason: "notPending" });
  });

  it("rejects saving a point that is not an eligible fix", () => {
    // Route index 0 is the synthesized origin airport.
    expect(
      applyCommand(navlog, createInitialSnapshot(navlog), {
        type: "saveWaypoint",
        expectedVersion: 0,
        routeIndex: 0,
      }),
    ).toMatchObject({ outcome: "rejected", reason: "unknownWaypoint" });
  });

  it("rejects saving when nothing is pending", () => {
    const snapshot = savedThrough(navlog, 9);

    expect(
      applyCommand(navlog, snapshot, {
        type: "saveWaypoint",
        expectedVersion: 0,
        routeIndex: eligible[9],
      }),
    ).toMatchObject({ outcome: "rejected", reason: "notPending" });
  });

  it("evicts the previous occupant of the slot it writes", () => {
    // Nine saved and two passed frees slot 1, so saving the tenth fix
    // overwrites the first.
    const snapshot = savedThrough(navlog, 9, { passedThrough: 2 });
    const next = expectApplied(
      applyCommand(navlog, snapshot, {
        type: "saveWaypoint",
        expectedVersion: 0,
        routeIndex: eligible[9],
      }),
    );
    const slots = slotByRouteIndex(
      deriveSlotAssignments(deriveEligibleSequenceForSnapshot(navlog, next)),
    );

    expect(stateOf(next, eligible[9])).toBe("saved");
    expect(slots.get(eligible[9])).toBe(1);
    expect(slots.get(eligible[0])).toBe(1);
  });
});

describe("Skip", () => {
  it("skips a pending fix and renumbers the fixes after it", () => {
    const before = createInitialSnapshot(navlog);
    const beforeSlots = slotByRouteIndex(
      deriveSlotAssignments(deriveEligibleSequenceForSnapshot(navlog, before)),
    );
    const next = expectApplied(
      applyCommand(navlog, before, {
        type: "skipWaypoint",
        expectedVersion: 0,
        routeIndex: eligible[2],
      }),
    );
    const afterSlots = slotByRouteIndex(
      deriveSlotAssignments(deriveEligibleSequenceForSnapshot(navlog, next)),
    );

    expect(stateOf(next, eligible[2])).toBe("skipped");
    // Skipped consumes no slot.
    expect(afterSlots.has(eligible[2])).toBe(false);
    // Everything after it moves up one slot.
    expect(beforeSlots.get(eligible[3])).toBe(4);
    expect(afterSlots.get(eligible[3])).toBe(3);
    // Everything before it is untouched.
    expect(afterSlots.get(eligible[0])).toBe(beforeSlots.get(eligible[0]));
    expect(afterSlots.get(eligible[1])).toBe(beforeSlots.get(eligible[1]));
  });

  it("skips a queued fix", () => {
    const next = expectApplied(
      applyCommand(navlog, createInitialSnapshot(navlog), {
        type: "skipWaypoint",
        expectedVersion: 0,
        routeIndex: eligible[25],
      }),
    );

    expect(stateOf(next, eligible[25])).toBe("skipped");
  });

  it("never disturbs the slot of a fix already entered", () => {
    const snapshot = savedThrough(navlog, 5);
    const beforeSlots = slotByRouteIndex(
      deriveSlotAssignments(deriveEligibleSequenceForSnapshot(navlog, snapshot)),
    );
    const next = expectApplied(
      applyCommand(navlog, snapshot, {
        type: "skipWaypoint",
        expectedVersion: 0,
        routeIndex: eligible[7],
      }),
    );
    const afterSlots = slotByRouteIndex(
      deriveSlotAssignments(deriveEligibleSequenceForSnapshot(navlog, next)),
    );

    for (const routeIndex of eligible.slice(0, 5)) {
      expect(afterSlots.get(routeIndex)).toBe(beforeSlots.get(routeIndex));
      expect(stateOf(next, routeIndex)).toBe("saved");
    }
  });

  it("rejects skipping a saved, passed, or already skipped fix", () => {
    const snapshot = snapshotWithFacts(navlog, [
      { routeIndex: eligible[0], state: "passed" },
      { routeIndex: eligible[1], state: "saved" },
      { routeIndex: eligible[2], state: "skipped" },
    ]);

    for (const routeIndex of [eligible[0], eligible[1], eligible[2]]) {
      expect(
        applyCommand(navlog, snapshot, {
          type: "skipWaypoint",
          expectedVersion: 0,
          routeIndex,
        }),
      ).toMatchObject({ outcome: "rejected", reason: "notSkippable" });
    }
  });

  it("rejects skipping a point that is not an eligible fix", () => {
    expect(
      applyCommand(navlog, createInitialSnapshot(navlog), {
        type: "skipWaypoint",
        expectedVersion: 0,
        routeIndex: 0,
      }),
    ).toMatchObject({ outcome: "rejected", reason: "unknownWaypoint" });
  });
});

describe("procedure inclusion", () => {
  it("changes inclusion before the first Save and recalculates eligibility", () => {
    const before = createInitialSnapshot(domestic);
    const next = expectApplied(
      applyCommand(domestic, before, {
        type: "setProcedureInclusion",
        expectedVersion: 0,
        inclusion: { sid: false, star: true },
      }),
    );

    expect(before.waypoints).toHaveLength(21);
    expect(next.waypoints).toHaveLength(17);
    expect(next.procedureInclusion).toEqual({ sid: false, star: true });
    expect(next.waypoints.map((w) => w.routeIndex)).toEqual([
      ...deriveEligibleSequence(domestic, { sid: false, star: true }),
    ]);
  });

  it("locks permanently after the first Save", () => {
    const saved = expectApplied(
      applyCommand(domestic, createInitialSnapshot(domestic), {
        type: "saveWaypoint",
        expectedVersion: 0,
        routeIndex: eligibleOf(domestic)[0],
      }),
    );

    expect(areProcedureControlsLocked(createInitialSnapshot(domestic))).toBe(false);
    expect(areProcedureControlsLocked(saved)).toBe(true);
    expect(
      applyCommand(domestic, saved, {
        type: "setProcedureInclusion",
        expectedVersion: 0,
        inclusion: { sid: false, star: false },
      }),
    ).toMatchObject({ outcome: "rejected", reason: "procedureControlsLocked" });
  });

  it("stays locked once every entered fix has been passed", () => {
    const snapshot = savedThrough(domestic, 3, { passedThrough: 3 });

    expect(areProcedureControlsLocked(snapshot)).toBe(true);
    expect(
      applyCommand(domestic, snapshot, {
        type: "setProcedureInclusion",
        expectedVersion: 0,
        inclusion: { sid: true, star: false },
      }),
    ).toMatchObject({ outcome: "rejected", reason: "procedureControlsLocked" });
  });
});

describe("Pass", () => {
  it("passes a single saved fix without freeing its slot", () => {
    const snapshot = savedThrough(navlog, 9);
    const next = expectApplied(
      applyCommand(navlog, snapshot, {
        type: "passWaypoint",
        expectedVersion: 0,
        routeIndex: eligible[0],
      }),
    );

    expect(stateOf(next, eligible[0])).toBe("passed");
    // Deferred release: the most recently passed fix anchors the active leg.
    expect(deriveFreeSlots(navlog, next)).toEqual([]);
    expect(derivePendingRouteIndexes(navlog, next)).toEqual([]);
  });

  it("cascades to every earlier saved-but-unpassed fix", () => {
    const snapshot = savedThrough(navlog, 9);
    const next = expectApplied(
      applyCommand(navlog, snapshot, {
        type: "passWaypoint",
        expectedVersion: 0,
        routeIndex: eligible[5],
      }),
    );

    for (const routeIndex of eligible.slice(0, 6)) {
      expect(stateOf(next, routeIndex)).toBe("passed");
    }
    for (const routeIndex of eligible.slice(6, 9)) {
      expect(stateOf(next, routeIndex)).toBe("saved");
    }
  });

  it("frees every affected slot except the newly passed one and promotes into them", () => {
    const snapshot = savedThrough(navlog, 9);
    const next = expectApplied(
      applyCommand(navlog, snapshot, {
        type: "passWaypoint",
        expectedVersion: 0,
        routeIndex: eligible[4],
      }),
    );

    // Slots 1-4 released; slot 5 anchors the active leg.
    expect(deriveFreeSlots(navlog, next)).toEqual([1, 2, 3, 4]);
    // Several fixes promote to pending together, which is what the direct-to
    // case requires.
    expect(derivePendingRouteIndexes(navlog, next)).toEqual(eligible.slice(9, 13));
    for (const routeIndex of eligible.slice(9, 13)) {
      expect(stateOf(next, routeIndex)).toBe("pending");
    }
  });

  it("never renumbers slots", () => {
    const snapshot = savedThrough(navlog, 9);
    const before = slotByRouteIndex(
      deriveSlotAssignments(deriveEligibleSequenceForSnapshot(navlog, snapshot)),
    );
    const next = expectApplied(
      applyCommand(navlog, snapshot, {
        type: "passWaypoint",
        expectedVersion: 0,
        routeIndex: eligible[4],
      }),
    );
    const after = slotByRouteIndex(
      deriveSlotAssignments(deriveEligibleSequenceForSnapshot(navlog, next)),
    );

    expect([...after.entries()]).toEqual([...before.entries()]);
  });

  it("does not rebuild pages", () => {
    const snapshot = savedThrough(navlog, 9);
    const pagesOf = (state: TrackerSnapshot) =>
      buildPages(
        navlog,
        deriveSlotAssignments(deriveEligibleSequenceForSnapshot(navlog, state)),
      );
    const before = pagesOf(snapshot);
    const next = expectApplied(
      applyCommand(navlog, snapshot, {
        type: "passWaypoint",
        expectedVersion: 0,
        routeIndex: eligible[4],
      }),
    );

    expect(pagesOf(next)).toEqual(before);
  });

  it("does not change sliding window membership", () => {
    const snapshot = savedThrough(navlog, 9);
    const before = deriveSlidingWindow(snapshot);
    const next = expectApplied(
      applyCommand(navlog, snapshot, {
        type: "passWaypoint",
        expectedVersion: 0,
        routeIndex: eligible[4],
      }),
    );

    expect(deriveSlidingWindow(next)).toEqual(before);
  });

  it("rejects passing a fix that is not saved", () => {
    const snapshot = savedThrough(navlog, 9, { passedThrough: 2 });

    for (const routeIndex of [eligible[0], eligible[9], eligible[30]]) {
      expect(
        applyCommand(navlog, snapshot, {
          type: "passWaypoint",
          expectedVersion: 0,
          routeIndex,
        }),
      ).toMatchObject({ outcome: "rejected", reason: "notSaved" });
    }
  });

  it("rejects passing a point that is not an eligible fix", () => {
    expect(
      applyCommand(navlog, savedThrough(navlog, 3), {
        type: "passWaypoint",
        expectedVersion: 0,
        routeIndex: 0,
      }),
    ).toMatchObject({ outcome: "rejected", reason: "unknownWaypoint" });
  });
});

describe("unknown commands", () => {
  it("rejects an unrecognized command type instead of throwing", () => {
    // Section 8 decodes commands from request payloads and persisted JSON, so a
    // malformed command must return a rejection like any other failure.
    const malformed = { type: "teleport", expectedVersion: 0 } as unknown as TrackerCommand;

    expect(() => applyCommand(navlog, createInitialSnapshot(navlog), malformed)).not.toThrow();
    expect(applyCommand(navlog, createInitialSnapshot(navlog), malformed)).toMatchObject({
      outcome: "rejected",
      reason: "unknownCommand",
    });
  });
});

describe("determinism", () => {
  /**
   * Each command records the outcome it must produce against the snapshot it
   * is applied to. Without that, a command that silently starts rejecting —
   * because pending derivation changed, say — would still "pass" a determinism
   * check by comparing two identical rejection objects, proving nothing about
   * the transition path it claims to cover.
   */
  const cases: ReadonlyArray<{
    command: TrackerCommand;
    snapshot: TrackerSnapshot;
    outcome: "applied" | "rejected";
  }> = [
    {
      command: { type: "saveWaypoint", expectedVersion: 0, routeIndex: eligible[0] },
      snapshot: createInitialSnapshot(navlog),
      outcome: "applied",
    },
    {
      command: { type: "skipWaypoint", expectedVersion: 0, routeIndex: eligible[4] },
      snapshot: createInitialSnapshot(navlog),
      outcome: "applied",
    },
    {
      command: {
        type: "setProcedureInclusion",
        expectedVersion: 0,
        inclusion: { sid: true, star: false },
      },
      snapshot: createInitialSnapshot(navlog),
      outcome: "applied",
    },
    {
      // Passing a saved fix: the Pass transition path, not a rejection.
      command: { type: "passWaypoint", expectedVersion: 0, routeIndex: eligible[3] },
      snapshot: savedThrough(navlog, 9),
      outcome: "applied",
    },
    {
      // Saving into a slot freed by a cascade.
      command: { type: "saveWaypoint", expectedVersion: 0, routeIndex: eligible[9] },
      snapshot: savedThrough(navlog, 9, { passedThrough: 2 }),
      outcome: "applied",
    },
    {
      // Deliberate rejections, kept alongside the applied paths.
      command: { type: "saveWaypoint", expectedVersion: 0, routeIndex: eligible[20] },
      snapshot: createInitialSnapshot(navlog),
      outcome: "rejected",
    },
    {
      command: { type: "passWaypoint", expectedVersion: 0, routeIndex: eligible[1] },
      snapshot: createInitialSnapshot(navlog),
      outcome: "rejected",
    },
  ];

  it("exercises both applied and rejected paths", () => {
    // Guards the guard: if every case degraded to a rejection, the determinism
    // assertions below would compare rejection objects and prove nothing.
    expect(cases.filter((c) => c.outcome === "applied").length).toBeGreaterThanOrEqual(5);
    expect(cases.some((c) => c.outcome === "rejected")).toBe(true);
  });

  it("returns an identical result for the same snapshot and command", () => {
    for (const { command, snapshot, outcome } of cases) {
      const first = applyCommand(navlog, snapshot, command);
      const second = applyCommand(navlog, snapshot, command);

      expect(first.outcome).toBe(outcome);
      expect(first).toEqual(second);
    }
  });

  it("does not mutate the snapshot it is given", () => {
    for (const { command, snapshot } of cases) {
      const copy = structuredClone(snapshot);
      applyCommand(navlog, snapshot, command);
      expect(snapshot).toEqual(copy);
    }
  });

  it("replays a command sequence to the same state every time", () => {
    function replay(): TrackerSnapshot {
      let snapshot = createInitialSnapshot(navlog);
      for (const routeIndex of [eligible[0], eligible[1], eligible[2]]) {
        snapshot = expectApplied(
          applyCommand(navlog, snapshot, {
            type: "saveWaypoint",
            expectedVersion: snapshot.version,
            routeIndex,
          }),
        );
      }
      return expectApplied(
        applyCommand(navlog, snapshot, {
          type: "skipWaypoint",
          expectedVersion: snapshot.version,
          routeIndex: eligible[10],
        }),
      );
    }

    expect(replay()).toEqual(replay());
  });

  it("recalculates idempotently", () => {
    const snapshot = savedThrough(navlog, 9, { passedThrough: 3 });

    expect(recalculateSnapshot(navlog, snapshot)).toEqual(snapshot);
  });
});
