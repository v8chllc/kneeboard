import { describe, expect, it } from "vitest";

import { navlogFor, eligibleOf, savedThrough, snapshotWithFacts } from "../../tests/support/tracker-scenarios";
import { createInitialSnapshot } from "./engine";
import { deriveSlidingWindow } from "./sliding-window";

const navlog = navlogFor("valid-multi-page.json");
const eligible = eligibleOf(navlog);

describe("deriveSlidingWindow", () => {
  it("is empty before the first Save, because the unit holds no data", () => {
    expect(deriveSlidingWindow(createInitialSnapshot(navlog))).toEqual([]);
  });

  it("grows one member per Save up to nine", () => {
    for (const count of [1, 2, 5, 8, 9]) {
      expect(deriveSlidingWindow(savedThrough(navlog, count))).toEqual(
        eligible.slice(0, count),
      );
    }
  });

  it("holds nine members from the first overwrite onward", () => {
    for (const count of [9, 10, 15, 39]) {
      const window = deriveSlidingWindow(savedThrough(navlog, count));
      expect(window).toHaveLength(9);
      expect(window).toEqual(eligible.slice(count - 9, count));
    }
  });

  it("evicts the oldest member on Save", () => {
    const before = deriveSlidingWindow(savedThrough(navlog, 9));
    const after = deriveSlidingWindow(savedThrough(navlog, 10));

    expect(before).toContain(eligible[0]);
    expect(after).not.toContain(eligible[0]);
    expect(after[after.length - 1]).toBe(eligible[9]);
  });

  it("does not change membership when fixes are passed", () => {
    // The worked example in docs/tracker-behavior.md: nine saved, then the
    // first two passed. The window still brackets the same nine fixes.
    const saved = deriveSlidingWindow(savedThrough(navlog, 9));
    const passed = deriveSlidingWindow(savedThrough(navlog, 9, { passedThrough: 2 }));

    expect(passed).toEqual(saved);
  });

  it("holds only saved or passed members, never pending or queued", () => {
    const snapshot = savedThrough(navlog, 12, { passedThrough: 4 });
    const window = deriveSlidingWindow(snapshot);
    const states = new Map(snapshot.waypoints.map((w) => [w.routeIndex, w.state]));

    for (const routeIndex of window) {
      expect(["saved", "passed"]).toContain(states.get(routeIndex));
    }
    expect(window).toHaveLength(9);
  });

  it("brackets consecutive rows that may include skipped and ineligible ones", () => {
    // A skipped fix and the ineligible rows around it can fall inside the
    // bracket without being members.
    const snapshot = snapshotWithFacts(navlog, [
      ...eligible.slice(0, 5).map((routeIndex) => ({ routeIndex, state: "saved" as const })),
      { routeIndex: eligible[5], state: "skipped" as const },
      ...eligible.slice(6, 10).map((routeIndex) => ({ routeIndex, state: "saved" as const })),
    ]);
    const window = deriveSlidingWindow(snapshot);

    expect(window).toHaveLength(9);
    expect(window).not.toContain(eligible[5]);
    // The skipped fix lies inside the bracket spanned by the window.
    expect(eligible[5]).toBeGreaterThan(window[0]);
    expect(eligible[5]).toBeLessThan(window[window.length - 1]);
  });
});
