import { describe, expect, it } from "vitest";

import { loadOfpFixture } from "../../tests/support/ofp-fixture-adapter";
import {
  DEFAULT_PROCEDURE_INCLUSION,
  deriveEligibleSequence,
  deriveEligibleSequenceForSnapshot,
  isEligibleUnderInclusion,
  skippedRouteIndexes,
} from "./eligibility";
import { buildNavlog } from "./navlog-construction";
import type { Navlog } from "./navlog";
import type { ProcedureInclusion, TrackerSnapshot } from "./tracker";

function navlogFor(fileName: string): Navlog {
  return buildNavlog(loadOfpFixture(fileName));
}

const INCLUSIONS: ReadonlyArray<{ label: string; inclusion: ProcedureInclusion }> = [
  { label: "both procedures", inclusion: { sid: true, star: true } },
  { label: "STAR only", inclusion: { sid: false, star: true } },
  { label: "SID only", inclusion: { sid: true, star: false } },
  { label: "neither procedure", inclusion: { sid: false, star: false } },
];

describe("isEligibleUnderInclusion", () => {
  it("defaults to including both procedures", () => {
    expect(DEFAULT_PROCEDURE_INCLUSION).toEqual({ sid: true, star: true });
  });

  it("drops SID and STAR fixes only when their own procedure is excluded", () => {
    const navlog = navlogFor("valid-domestic.json");
    const sidFix = navlog.points.find((point) => point.classification === "sidFix");
    const starFix = navlog.points.find((point) => point.classification === "starFix");
    const enrouteFix = navlog.points.find((point) => point.classification === "enrouteFix");

    expect(sidFix).toBeDefined();
    expect(starFix).toBeDefined();
    expect(enrouteFix).toBeDefined();

    expect(isEligibleUnderInclusion(sidFix!, { sid: false, star: true })).toBe(false);
    expect(isEligibleUnderInclusion(sidFix!, { sid: true, star: false })).toBe(true);
    expect(isEligibleUnderInclusion(starFix!, { sid: true, star: false })).toBe(false);
    expect(isEligibleUnderInclusion(starFix!, { sid: false, star: true })).toBe(true);
    // An enroute fix is unaffected by either control.
    for (const { inclusion } of INCLUSIONS) {
      expect(isEligibleUnderInclusion(enrouteFix!, inclusion)).toBe(true);
    }
  });

  it("never makes an airport, computed, ambiguous, or unknown point eligible", () => {
    const navlog = navlogFor("valid-ten-boundary-cases.json");
    const ineligible = navlog.points.filter((point) =>
      ["airport", "computedPoint", "ambiguousProcedureFix", "unrecognized"].includes(
        point.classification,
      ),
    );

    expect(ineligible.length).toBeGreaterThan(0);
    for (const point of ineligible) {
      for (const { inclusion } of INCLUSIONS) {
        expect(isEligibleUnderInclusion(point, inclusion)).toBe(false);
      }
    }
  });
});

describe("deriveEligibleSequence", () => {
  it("preserves original route order", () => {
    const sequence = deriveEligibleSequence(
      navlogFor("valid-multi-page.json"),
      DEFAULT_PROCEDURE_INCLUSION,
    );

    expect(sequence).toHaveLength(39);
    expect([...sequence]).toEqual([...sequence].sort((a, b) => a - b));
    // The synthesized origin row is never eligible.
    expect(sequence).not.toContain(0);
  });

  it("changes the eligible sequence for all four inclusion combinations", () => {
    // valid-domestic.json holds 4 SID fixes, 10 STAR fixes, and 7 enroute fixes.
    const navlog = navlogFor("valid-domestic.json");
    const lengths = INCLUSIONS.map(
      ({ inclusion }) => deriveEligibleSequence(navlog, inclusion).length,
    );

    expect(lengths).toEqual([21, 17, 11, 7]);
    // Every combination yields a distinct sequence, not merely a distinct count.
    const sequences = INCLUSIONS.map(({ inclusion }) =>
      deriveEligibleSequence(navlog, inclusion).join(","),
    );
    expect(new Set(sequences).size).toBe(4);
  });

  it("removes skipped fixes from the sequence", () => {
    const navlog = navlogFor("valid-multi-page.json");
    const full = deriveEligibleSequence(navlog, DEFAULT_PROCEDURE_INCLUSION);
    const skipped = [full[5], full[11]];
    const reduced = deriveEligibleSequence(navlog, DEFAULT_PROCEDURE_INCLUSION, skipped);

    expect(reduced).toHaveLength(full.length - 2);
    for (const routeIndex of skipped) {
      expect(reduced).not.toContain(routeIndex);
    }
  });

  it("ignores a skip of a point that was never eligible", () => {
    const navlog = navlogFor("valid-domestic.json");
    const full = deriveEligibleSequence(navlog, DEFAULT_PROCEDURE_INCLUSION);

    // Route index 0 is the synthesized origin, which holds no slot.
    expect(deriveEligibleSequence(navlog, DEFAULT_PROCEDURE_INCLUSION, [0])).toEqual(full);
  });
});

describe("deriveEligibleSequenceForSnapshot", () => {
  it("reads inclusion and skip state from the snapshot", () => {
    const navlog = navlogFor("valid-multi-page.json");
    const full = deriveEligibleSequence(navlog, DEFAULT_PROCEDURE_INCLUSION);
    const snapshot: TrackerSnapshot = {
      version: 1,
      procedureInclusion: { sid: false, star: true },
      waypoints: [
        { routeIndex: full[20], state: "skipped" },
        { routeIndex: full[21], state: "queued" },
      ],
    };

    expect(skippedRouteIndexes(snapshot)).toEqual([full[20]]);

    const sequence = deriveEligibleSequenceForSnapshot(navlog, snapshot);
    expect(sequence).not.toContain(full[20]);
    expect(sequence).toEqual(
      deriveEligibleSequence(navlog, { sid: false, star: true }, [full[20]]),
    );
  });
});
