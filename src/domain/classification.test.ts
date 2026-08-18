import { describe, expect, it } from "vitest";

import { loadOfpFixture } from "../../tests/support/ofp-fixture-adapter";
import {
  COORDINATE_FIX_IDENT_PATTERN,
  classifyFix,
  isSlotEligibleClassification,
} from "./classification";
import type { NavlogPointClassification } from "./navlog";
import type { OfpNavlogFix } from "./ofp-input";

function fix(overrides: Partial<OfpNavlogFix>): OfpNavlogFix {
  return {
    ident: "TESTA",
    sourceType: "wpt",
    isSidStar: false,
    viaAirway: "DCT",
    latitude: 10,
    longitude: 20,
    distance: 5,
    ...overrides,
  };
}

const NO_PROCEDURES = { sidIdent: "", starIdent: "" };

function classifyFixture(fileName: string): Map<string, NavlogPointClassification[]> {
  const input = loadOfpFixture(fileName);
  const procedures = { sidIdent: input.sidIdent, starIdent: input.starIdent };
  const byIdent = new Map<string, NavlogPointClassification[]>();

  for (const entry of input.fixes) {
    const classification = classifyFix(entry, procedures);
    const existing = byIdent.get(entry.ident);
    if (existing) {
      existing.push(classification);
    } else {
      byIdent.set(entry.ident, [classification]);
    }
  }

  return byIdent;
}

function countEligible(fileName: string): number {
  const input = loadOfpFixture(fileName);
  const procedures = { sidIdent: input.sidIdent, starIdent: input.starIdent };
  return input.fixes.filter((entry) =>
    isSlotEligibleClassification(classifyFix(entry, procedures)),
  ).length;
}

describe("classifyFix precedence", () => {
  it("classifies an airport before consulting the procedure flag", () => {
    expect(
      classifyFix(
        fix({ ident: "EGLL", sourceType: "apt", isSidStar: true, viaAirway: "NUGR2H" }),
        { sidIdent: "LBSTA8", starIdent: "NUGR2H" },
      ),
    ).toBe("airport");
  });

  it("classifies a non-coordinate ltlg row as computed before the procedure flag", () => {
    expect(
      classifyFix(fix({ ident: "TOD", sourceType: "ltlg", isSidStar: true, viaAirway: "VEECK5" }), {
        sidIdent: "VARNM2",
        starIdent: "VEECK5",
      }),
    ).toBe("computedPoint");
  });

  it("classifies a coordinate-defined ltlg row as eligible", () => {
    expect(
      classifyFix(fix({ ident: "52N050W", sourceType: "ltlg", viaAirway: "NATW" }), NO_PROCEDURES),
    ).toBe("coordinateFix");
  });

  it("matches a procedure only on an exact dedicated identifier", () => {
    const procedures = { sidIdent: "OSHNN1", starIdent: "PUCKY1" };

    expect(classifyFix(fix({ isSidStar: true, viaAirway: "OSHNN1" }), procedures)).toBe("sidFix");
    expect(classifyFix(fix({ isSidStar: true, viaAirway: "PUCKY1" }), procedures)).toBe("starFix");
    // via_airway describes the preceding leg, so an unflagged row carrying the
    // procedure name sits outside the procedure and stays enroute.
    expect(classifyFix(fix({ isSidStar: false, viaAirway: "OSHNN1" }), procedures)).toBe(
      "enrouteFix",
    );
    // A flagged row matching neither dedicated identifier is ambiguous.
    expect(classifyFix(fix({ isSidStar: true, viaAirway: "UNKNOWN1" }), procedures)).toBe(
      "ambiguousProcedureFix",
    );
  });

  it("never matches a procedure against an empty dedicated identifier", () => {
    expect(classifyFix(fix({ isSidStar: true, viaAirway: "" }), NO_PROCEDURES)).toBe(
      "ambiguousProcedureFix",
    );
  });

  it("classifies a VOR the same way as a waypoint", () => {
    expect(
      classifyFix(fix({ ident: "BNN", sourceType: "vor", isSidStar: true, viaAirway: "NUGR2H" }), {
        sidIdent: "LBSTA8",
        starIdent: "NUGR2H",
      }),
    ).toBe("starFix");
    expect(classifyFix(fix({ ident: "EKR", sourceType: "vor" }), NO_PROCEDURES)).toBe("enrouteFix");
  });

  it("fails closed on an unrecognized source type", () => {
    expect(classifyFix(fix({ sourceType: "unknown" }), NO_PROCEDURES)).toBe("unrecognized");
    expect(classifyFix(fix({ sourceType: "" }), NO_PROCEDURES)).toBe("unrecognized");
  });
});

describe("COORDINATE_FIX_IDENT_PATTERN", () => {
  it("is anchored and accepts only the observed coordinate ident shape", () => {
    for (const ident of ["52N050W", "55N040W", "56N030W", "55N020W", "31S150E"]) {
      expect(COORDINATE_FIX_IDENT_PATTERN.test(ident)).toBe(true);
    }
    for (const ident of ["TOC", "TOD", "ETP", "5N050W", "052N050W", "52N050W ", "X52N050W"]) {
      expect(COORDINATE_FIX_IDENT_PATTERN.test(ident)).toBe(false);
    }
  });
});

describe("isSlotEligibleClassification", () => {
  it("grants slots only to fixes, never to airports or computed or ambiguous points", () => {
    expect(isSlotEligibleClassification("coordinateFix")).toBe(true);
    expect(isSlotEligibleClassification("sidFix")).toBe(true);
    expect(isSlotEligibleClassification("starFix")).toBe(true);
    expect(isSlotEligibleClassification("enrouteFix")).toBe(true);

    expect(isSlotEligibleClassification("airport")).toBe(false);
    expect(isSlotEligibleClassification("computedPoint")).toBe(false);
    expect(isSlotEligibleClassification("ambiguousProcedureFix")).toBe(false);
    expect(isSlotEligibleClassification("unrecognized")).toBe(false);
  });
});

describe("classification against the tracked fixtures", () => {
  /**
   * Eligible counts recorded in docs/simbrief-navlog-findings.md:211 as
   * "21, 39, 24, 9, and 24 in capture order". Capture order is not filename
   * order, so each fixture is mapped to its capture by ROUTE, using the table
   * at docs/simbrief-navlog-findings.md:12-18, and cross-checked against that
   * table's navlog entry count. Both agree for all five.
   */
  const DOCUMENTED_ELIGIBLE_COUNTS: ReadonlyArray<{
    fixture: string;
    route: string;
    navlogEntries: number;
    eligible: number;
  }> = [
    { fixture: "valid-domestic.json", route: "KATL-KORD", navlogEntries: 24, eligible: 21 },
    { fixture: "valid-multi-page.json", route: "KLAX-KJFK", navlogEntries: 42, eligible: 39 },
    { fixture: "valid-oceanic.json", route: "KBOS-EGLL", navlogEntries: 27, eligible: 24 },
    { fixture: "valid-southern-eastern.json", route: "YSSY-NZAA", navlogEntries: 12, eligible: 9 },
    { fixture: "valid-sparse-identity.json", route: "KONT-KAFW", navlogEntries: 27, eligible: 24 },
  ];

  it.each(DOCUMENTED_ELIGIBLE_COUNTS)(
    "reproduces the documented eligible count for $fixture ($route)",
    ({ fixture: fileName, route, navlogEntries, eligible }) => {
      const input = loadOfpFixture(fileName);

      // Confirms the fixture-to-capture mapping before asserting its count.
      expect(`${input.origin.icaoCode}-${input.destination.icaoCode}`).toBe(route);
      expect(input.fixes).toHaveLength(navlogEntries);

      expect(countEligible(fileName)).toBe(eligible);
    },
  );

  /**
   * The two synthetic fixtures are hand-authored boundary constructions, not
   * captures, so docs/simbrief-navlog-findings.md records no eligible count for
   * them. These counts are derived from the documented classification rules and
   * the fixtures' own README descriptions, and are asserted as such.
   */
  it("counts nine eligible fixes in the exactly-nine boundary fixture", () => {
    expect(countEligible("valid-exactly-nine.json")).toBe(9);
  });

  it("counts ten eligible fixes in the ten-boundary-cases fixture", () => {
    // Fourteen rows: ten enroute fixes, one computed ETP, one ambiguous
    // flagged row, one unknown source type, and the destination airport.
    expect(countEligible("valid-ten-boundary-cases.json")).toBe(10);
  });

  it("classifies top of climb and top of descent as computed despite their flags", () => {
    // valid-domestic.json carries is_sid_star "1" on both TOC (via VARNM2, the
    // SID) and TOD (via VEECK5, the STAR). Both must still fail closed.
    const domestic = classifyFixture("valid-domestic.json");
    expect(domestic.get("TOC")).toEqual(["computedPoint"]);
    expect(domestic.get("TOD")).toEqual(["computedPoint"]);

    // valid-oceanic.json flags TOD via the STAR identifier NUGR2H.
    const oceanic = classifyFixture("valid-oceanic.json");
    expect(oceanic.get("TOC")).toEqual(["computedPoint"]);
    expect(oceanic.get("TOD")).toEqual(["computedPoint"]);
  });

  it("classifies the oceanic coordinate fixes as eligible and its decoys as absent", () => {
    const oceanic = classifyFixture("valid-oceanic.json");

    for (const ident of ["52N050W", "55N040W", "56N030W", "55N020W"]) {
      expect(oceanic.get(ident)).toEqual(["coordinateFix"]);
    }

    // Primary-route-only selection: the sanitized alternate and ETOPS decoys
    // are never read, so their idents cannot appear.
    expect(oceanic.has("SANITIZED-ALTERNATE-DECOY")).toBe(false);
    expect(oceanic.has("SANITIZED-ETOPS-DECOY")).toBe(false);

    // BNN is a VOR inside the STAR, so excluding the STAR also drops it.
    expect(oceanic.get("BNN")).toEqual(["starFix"]);
    expect(oceanic.get("EGLL")).toEqual(["airport"]);
  });

  it("fails closed on the ambiguous, unknown-type, and flagged non-fix boundary rows", () => {
    const boundary = classifyFixture("valid-ten-boundary-cases.json");

    // Flagged via UNKNOWN1, matching neither SID1 nor STAR1.
    expect(boundary.get("AMBIG")).toEqual(["ambiguousProcedureFix"]);
    // Source type "unknown".
    expect(boundary.get("MYSTERY")).toEqual(["unrecognized"]);
    // An ltlg equal-time point flagged via the SID identifier.
    expect(boundary.get("ETP")).toEqual(["computedPoint"]);
    // The destination airport flagged via the STAR identifier.
    expect(boundary.get("TSTD")).toEqual(["airport"]);
    // The repeated identifier occupies two route positions and classifies the
    // same way at both, which is why route index rather than ident is identity.
    expect(boundary.get("REPEAT")).toEqual(["enrouteFix", "enrouteFix"]);
  });
});
