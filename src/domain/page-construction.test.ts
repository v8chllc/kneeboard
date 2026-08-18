import { describe, expect, it } from "vitest";

import { loadOfpFixture } from "../../tests/support/ofp-fixture-adapter";
import { DEFAULT_PROCEDURE_INCLUSION, deriveEligibleSequence } from "./eligibility";
import { buildNavlog } from "./navlog-construction";
import { buildPages } from "./page-construction";
import { deriveSlotAssignments, slotByRouteIndex } from "./slot-assignment";
import type { Navlog } from "./navlog";
import type { Page } from "./pages";
import type { ProcedureInclusion } from "./tracker";

const VALID_FIXTURES = [
  "valid-domestic.json",
  "valid-multi-page.json",
  "valid-oceanic.json",
  "valid-southern-eastern.json",
  "valid-sparse-identity.json",
  "valid-exactly-nine.json",
  "valid-ten-boundary-cases.json",
] as const;

function paginate(
  fileName: string,
  inclusion: ProcedureInclusion = DEFAULT_PROCEDURE_INCLUSION,
  skipped: readonly number[] = [],
): { navlog: Navlog; pages: readonly Page[]; slots: ReadonlyMap<number, number> } {
  const navlog = buildNavlog(loadOfpFixture(fileName));
  const assignments = deriveSlotAssignments(
    deriveEligibleSequence(navlog, inclusion, skipped),
  );
  return { navlog, pages: buildPages(navlog, assignments), slots: slotByRouteIndex(assignments) };
}

describe("page membership", () => {
  it.each(VALID_FIXTURES)("places every point of %s on exactly one page", (fileName) => {
    const { navlog, pages } = paginate(fileName);
    const placed = pages.flatMap((page) => [...page.routeIndexes]);

    // No point lost, none duplicated, original route order preserved.
    expect(placed).toEqual(navlog.points.map((point) => point.routeIndex));
    expect(new Set(placed).size).toBe(navlog.points.length);
  });

  it.each(VALID_FIXTURES)("numbers the pages of %s consecutively from one", (fileName) => {
    const { pages } = paginate(fileName);

    expect(pages.map((page) => page.pageNumber)).toEqual(
      pages.map((_, index) => index + 1),
    );
  });

  it("starts every page after the first exactly at its slot 1 fix", () => {
    const { pages, slots } = paginate("valid-multi-page.json");

    for (const page of pages.slice(1)) {
      expect(slots.get(page.routeIndexes[0])).toBe(1);
    }
  });

  it("assigns at most nine slots per page", () => {
    for (const fileName of VALID_FIXTURES) {
      const { pages, slots } = paginate(fileName);
      for (const page of pages) {
        const slotted = page.routeIndexes.filter((routeIndex) => slots.has(routeIndex));
        expect(slotted.length).toBeLessThanOrEqual(9);
      }
    }
  });
});

describe("page boundaries", () => {
  it("groups 39 eligible fixes into five pages", () => {
    const { pages, slots } = paginate("valid-multi-page.json");

    expect(pages).toHaveLength(5);
    const slottedPerPage = pages.map(
      (page) => page.routeIndexes.filter((routeIndex) => slots.has(routeIndex)).length,
    );
    expect(slottedPerPage).toEqual([9, 9, 9, 9, 3]);
  });

  it("produces a single page for a navlog of exactly nine eligible fixes", () => {
    const { navlog, pages } = paginate("valid-exactly-nine.json");

    expect(pages).toHaveLength(1);
    expect(pages[0].routeIndexes).toHaveLength(navlog.points.length);
  });

  it("includes the origin and every excluded point before slot 1 on page 1", () => {
    const { pages, slots } = paginate("valid-domestic.json");
    const firstPage = pages[0];

    // Route index 0 is the synthesized origin and holds no slot.
    expect(firstPage.routeIndexes[0]).toBe(0);
    expect(slots.has(0)).toBe(false);

    const firstSlotted = firstPage.routeIndexes.find((routeIndex) => slots.has(routeIndex));
    expect(slots.get(firstSlotted!)).toBe(1);
  });

  it("appends an excluded point between slot 9 and the next slot 1 to the preceding page", () => {
    // valid-ten-boundary-cases.json places the computed point ETP (route index
    // 10) between the slot 9 fix at route index 9 and the slot 1 fix that opens
    // page 2 at route index 11.
    const { pages, slots } = paginate("valid-ten-boundary-cases.json");

    expect(pages).toHaveLength(2);
    expect(slots.get(9)).toBe(9);
    expect(slots.has(10)).toBe(false);
    expect(slots.get(11)).toBe(1);

    expect(pages[0].routeIndexes).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // Never prepended to the next page.
    expect(pages[1].routeIndexes[0]).toBe(11);
  });

  it("includes every excluded point after the final assigned fix on the last page", () => {
    const { pages, slots } = paginate("valid-ten-boundary-cases.json");
    const lastPage = pages[pages.length - 1];

    // AMBIG, MYSTERY, and the destination airport all follow the final slot.
    expect(lastPage.routeIndexes).toEqual([11, 12, 13, 14]);
    for (const routeIndex of [12, 13, 14]) {
      expect(slots.has(routeIndex)).toBe(false);
    }
  });
});

describe("page rebuilding", () => {
  it("rebuilds membership after a skip while preserving route order", () => {
    const { navlog } = paginate("valid-multi-page.json");
    const sequence = deriveEligibleSequence(navlog, DEFAULT_PROCEDURE_INCLUSION);
    const { pages } = paginate("valid-multi-page.json", DEFAULT_PROCEDURE_INCLUSION, [
      sequence[4],
    ]);

    const placed = pages.flatMap((page) => [...page.routeIndexes]);
    // The skipped fix is still displayed; it simply holds no slot.
    expect(placed).toContain(sequence[4]);
    expect(placed).toEqual(navlog.points.map((point) => point.routeIndex));

    // One fewer eligible fix moves the page boundary by one position.
    const before = paginate("valid-multi-page.json").pages;
    expect(pages[1].routeIndexes[0]).not.toBe(before[1].routeIndexes[0]);
  });

  it("rebuilds membership for each SID and STAR inclusion combination", () => {
    const combinations: ProcedureInclusion[] = [
      { sid: true, star: true },
      { sid: false, star: true },
      { sid: true, star: false },
      { sid: false, star: false },
    ];

    const shapes = combinations.map((inclusion) => {
      const { navlog, pages } = paginate("valid-domestic.json", inclusion);
      // Every point still displays under every combination.
      expect(pages.flatMap((page) => [...page.routeIndexes])).toEqual(
        navlog.points.map((point) => point.routeIndex),
      );
      return pages.map((page) => page.routeIndexes.length).join(",");
    });

    expect(new Set(shapes).size).toBeGreaterThan(1);
  });

  it("puts every point on one page when no fix is eligible", () => {
    // Built inline rather than from a fixture: no tracked fixture classifies
    // every row as ineligible, and a conditional assertion would pass without
    // testing the case.
    const navlog = buildNavlog({
      generatedAtUnixSeconds: 1,
      flightNumber: "TST1",
      origin: { icaoCode: "TSTA", latitude: 1, longitude: 1 },
      destination: { icaoCode: "TSTB", latitude: 2, longitude: 2 },
      sidIdent: "",
      starIdent: "",
      routeDistance: 3,
      fixes: [
        {
          ident: "TOC",
          sourceType: "ltlg",
          isSidStar: false,
          viaAirway: "DCT",
          latitude: 1.5,
          longitude: 1.5,
          distance: 2,
        },
        {
          ident: "TSTB",
          sourceType: "apt",
          isSidStar: false,
          viaAirway: "DCT",
          latitude: 2,
          longitude: 2,
          distance: 1,
        },
      ],
    });
    const pages = buildPages(navlog, deriveSlotAssignments([]));

    expect(pages).toHaveLength(1);
    expect(pages[0].routeIndexes).toEqual([0, 1, 2]);
  });

  it("keeps enroute fixes eligible when both procedures are excluded", () => {
    // valid-southern-eastern.json holds 5 enroute fixes and 4 STAR fixes, so
    // excluding both procedures reduces the sequence without emptying it.
    const { navlog } = paginate("valid-southern-eastern.json");

    expect(deriveEligibleSequence(navlog, { sid: true, star: true })).toHaveLength(9);
    expect(deriveEligibleSequence(navlog, { sid: false, star: false })).toHaveLength(5);
  });
});
