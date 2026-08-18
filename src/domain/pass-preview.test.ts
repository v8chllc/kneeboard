import { beforeEach, describe, expect, it, vi } from "vitest";

// Wrap the shared selection so the test can prove — rather than infer — that
// both the preview and the command route through the same implementation.
vi.mock("./pass-cascade", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./pass-cascade")>();
  return { ...actual, selectPassCascade: vi.fn(actual.selectPassCascade) };
});

import { eligibleOf, navlogFor, savedThrough } from "../../tests/support/tracker-scenarios";
import { applyCommand } from "./engine";
import { selectPassCascade } from "./pass-cascade";
import { previewPass } from "./pass-preview";

/**
 * The unmocked implementation. The sweep below must compare `previewPass`
 * against this, not against the mocked module export: comparing against the
 * mock would assert that a value equals itself and prove nothing.
 */
const { selectPassCascade: realSelectPassCascade } = await vi.importActual<
  typeof import("./pass-cascade")
>("./pass-cascade");

const navlog = navlogFor("valid-multi-page.json");
const eligible = eligibleOf(navlog);
const shared = vi.mocked(selectPassCascade);

beforeEach(() => {
  // mockReset, not mockClear: clearing leaves queued one-time return values in
  // place, which would leak stubbed cascades into the very tests that prove the
  // preview and the command share one implementation.
  shared.mockReset();
});

describe("shared cascade implementation", () => {
  it("routes the preview through the shared selection", () => {
    const snapshot = savedThrough(navlog, 9);

    previewPass(snapshot, eligible[5]);

    expect(shared).toHaveBeenCalledTimes(1);
    expect(shared).toHaveBeenCalledWith(snapshot, eligible[5]);
  });

  it("routes the Pass command through the same shared selection", () => {
    const snapshot = savedThrough(navlog, 9);

    applyCommand(navlog, snapshot, {
      type: "passWaypoint",
      expectedVersion: 0,
      routeIndex: eligible[5],
    });

    expect(shared).toHaveBeenCalledTimes(1);
    expect(shared).toHaveBeenCalledWith(snapshot, eligible[5]);
  });

  it("cannot diverge, because neither computes a cascade of its own", () => {
    const snapshot = savedThrough(navlog, 9);
    const sentinel = { outcome: "selected", routeIndexes: [-1, -2] } as const;

    shared.mockReturnValueOnce(sentinel).mockReturnValueOnce(sentinel);

    // With the shared selection stubbed, both consumers report the stub. If
    // either held its own cascade rule, one of these would disagree.
    expect(previewPass(snapshot, eligible[5])).toEqual(sentinel);
    const result = applyCommand(navlog, snapshot, {
      type: "passWaypoint",
      expectedVersion: 0,
      routeIndex: eligible[5],
    });
    expect(result.outcome).toBe("applied");
    if (result.outcome === "applied") {
      // The stubbed cascade named no real fix, so nothing was passed.
      expect(result.snapshot.waypoints.some((w) => w.state === "passed")).toBe(false);
    }
  });
});

describe("previewPass", () => {
  it("returns the same result as the shared selection for every scenario", () => {
    // Compared against the real implementation via vi.importActual, so the
    // mock cannot make this assertion compare a value with itself.
    //
    // Deliberately includes snapshots that no command sequence can reach, such
    // as twelve entered with none passed. Agreement is a property of the pure
    // function for any input, so exercising unreachable inputs strengthens it.
    for (const savedCount of [1, 3, 9, 12]) {
      for (const passedThrough of [0, 1, 2, 5]) {
        if (passedThrough > savedCount) {
          continue;
        }
        const snapshot = savedThrough(navlog, savedCount, { passedThrough });

        for (const routeIndex of [...eligible.slice(0, 14), 0, -1]) {
          expect(previewPass(snapshot, routeIndex)).toEqual(
            realSelectPassCascade(snapshot, routeIndex),
          );
        }
      }
    }
  });

  it("changes nothing about the snapshot it previews", () => {
    const snapshot = savedThrough(navlog, 9, { passedThrough: 2 });
    const copy = structuredClone(snapshot);

    previewPass(snapshot, eligible[7]);

    expect(snapshot).toEqual(copy);
  });

  it("reports the same rejection the command would return", () => {
    const snapshot = savedThrough(navlog, 3);
    const preview = previewPass(snapshot, eligible[20]);
    const result = applyCommand(navlog, snapshot, {
      type: "passWaypoint",
      expectedVersion: 0,
      routeIndex: eligible[20],
    });

    expect(preview).toMatchObject({ outcome: "rejected", reason: "notSaved" });
    expect(result).toMatchObject({ outcome: "rejected", reason: "notSaved" });
  });
});
