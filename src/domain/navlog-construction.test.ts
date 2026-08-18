import { describe, expect, it } from "vitest";

import { adaptOfpFixture, loadOfpFixture } from "../../tests/support/ofp-fixture-adapter";
import { buildNavlog } from "./navlog-construction";

const VALID_FIXTURES = [
  "valid-domestic.json",
  "valid-multi-page.json",
  "valid-oceanic.json",
  "valid-southern-eastern.json",
  "valid-sparse-identity.json",
  "valid-exactly-nine.json",
  "valid-ten-boundary-cases.json",
] as const;

describe("synthesized origin row", () => {
  it.each(VALID_FIXTURES)("prepends a display-only origin row to %s", (fileName) => {
    const input = loadOfpFixture(fileName);
    const navlog = buildNavlog(input);
    const origin = navlog.points[0];

    expect(navlog.points).toHaveLength(input.fixes.length + 1);
    expect(origin.routeIndex).toBe(0);
    expect(origin.isSynthesizedOrigin).toBe(true);
    expect(origin.ident).toBe(input.origin.icaoCode);
    expect(origin.latitude).toBe(input.origin.latitude);
    expect(origin.longitude).toBe(input.origin.longitude);
    // No leg precedes the origin, so it has no DIS.
    expect(origin.dis).toBeNull();
    // It is an airport and can never consume a slot.
    expect(origin.classification).toBe("airport");
  });

  it("marks only the first row as synthesized and gives every other row a DIS", () => {
    const navlog = buildNavlog(loadOfpFixture("valid-domestic.json"));

    for (const point of navlog.points.slice(1)) {
      expect(point.isSynthesizedOrigin).toBe(false);
      expect(point.dis).not.toBeNull();
    }
  });

  it("assigns route indexes in original route order without gaps", () => {
    const navlog = buildNavlog(loadOfpFixture("valid-ten-boundary-cases.json"));

    expect(navlog.points.map((point) => point.routeIndex)).toEqual(
      navlog.points.map((_, index) => index),
    );
    // The repeated identifier occupies two distinct route indexes, which is why
    // route index rather than identifier is the stable identity.
    const repeated = navlog.points.filter((point) => point.ident === "REPEAT");
    expect(repeated.map((point) => point.routeIndex)).toEqual([9, 11]);
  });
});

describe("derived RDIS", () => {
  it.each(VALID_FIXTURES)("reaches zero at the destination of %s", (fileName) => {
    const navlog = buildNavlog(loadOfpFixture(fileName));

    expect(navlog.points[navlog.points.length - 1].rdis).toBe(0);
  });

  it.each(VALID_FIXTURES)(
    "reconciles the origin RDIS against the OFP route distance for %s",
    (fileName) => {
      const input = loadOfpFixture(fileName);
      const navlog = buildNavlog(input);

      // general.route_distance is a cross-check only; RDIS is derived solely by
      // summing leg distances. general.air_distance is never read.
      expect(navlog.points[0].rdis).toBeCloseTo(input.routeDistance, 6);
    },
  );

  it("decreases by each leg distance along the route", () => {
    const navlog = buildNavlog(loadOfpFixture("valid-exactly-nine.json"));

    for (let index = 1; index < navlog.points.length; index += 1) {
      const previous = navlog.points[index - 1];
      const current = navlog.points[index];
      expect(previous.rdis - current.rdis).toBeCloseTo(current.dis ?? 0, 6);
    }
  });
});

describe("navlog metadata", () => {
  it("retains the flight number as supplied, including registration substitution", () => {
    const sparse = buildNavlog(loadOfpFixture("valid-sparse-identity.json"));

    expect(sparse.metadata.flightNumber).toBe("N101SB");
    expect(sparse.metadata.originIcaoCode).toBe("KONT");
    expect(sparse.metadata.destinationIcaoCode).toBe("KAFW");
  });

  it("retains empty dedicated procedure identifiers", () => {
    const nine = buildNavlog(loadOfpFixture("valid-exactly-nine.json"));

    expect(nine.metadata.sidIdent).toBe("");
    expect(nine.metadata.starIdent).toBe("");
  });
});

describe("fixture adapter strictness", () => {
  it("loads every valid fixture", () => {
    for (const fileName of VALID_FIXTURES) {
      expect(loadOfpFixture(fileName).fixes.length).toBeGreaterThan(0);
    }
  });

  it("rejects a bare-object navlog.fix rather than normalizing the collapse", () => {
    expect(() => loadOfpFixture("invalid-null-flight-number.json")).toThrow(
      /navlog.fix is not an array/,
    );
  });

  it("rejects malformed numeric values and invalid procedure flags", () => {
    expect(() => loadOfpFixture("invalid-malformed-numeric-values.json")).toThrow(
      /is neither a number nor a numeric string/,
    );
    expect(() =>
      adaptOfpFixture(
        {
          params: { time_generated: 1 },
          general: {
            flight_number: "TST1",
            sid_ident: "",
            star_ident: "",
            route_distance: 1,
          },
          origin: { icao_code: "TSTA", pos_lat: 1, pos_long: 1 },
          destination: { icao_code: "TSTB", pos_lat: 1, pos_long: 1 },
          navlog: {
            fix: [
              {
                ident: "TSTC",
                type: "wpt",
                is_sid_star: "2",
                via_airway: "DCT",
                pos_lat: 1,
                pos_long: 1,
                distance: 1,
              },
            ],
          },
        },
        "synthetic",
      ),
    ).toThrow(/is_sid_star is not a 0 or 1 token/);
  });

  it("rejects empty sections, missing fields, and a null flight number", () => {
    expect(() => loadOfpFixture("invalid-empty-sections.json")).toThrow();
    expect(() => loadOfpFixture("invalid-missing-required-fields.json")).toThrow();
    expect(() => loadOfpFixture("invalid-missing-detailed-navlog.json")).toThrow(
      /navlog.fix is not an array/,
    );
  });

  it("rejects a numeric string that overflows to a non-finite number", () => {
    expect(() =>
      adaptOfpFixture(
        {
          params: { time_generated: "9".repeat(400) },
          general: {
            flight_number: "TST1",
            sid_ident: "",
            star_ident: "",
            route_distance: 1,
          },
          origin: { icao_code: "TSTA", pos_lat: 1, pos_long: 1 },
          destination: { icao_code: "TSTB", pos_lat: 1, pos_long: 1 },
          navlog: { fix: [] },
        },
        "synthetic",
      ),
    ).toThrow(/time_generated does not convert to a finite number/);
  });

  it("reports the field path that failed", () => {
    expect(() => loadOfpFixture("invalid-empty-sections.json")).toThrow(/time_generated/);
  });
});

describe("coordinate literal cross-check", () => {
  /**
   * Locks the hand-transcribed literals in coordinates.test.ts against the real
   * fixture values, now that the adapter can read them. Fixes are addressed by
   * route index, not identifier: valid-ten-boundary-cases.json repeats the
   * identifier REPEAT at two positions.
   */
  it("matches the southern/eastern literals used in coordinates.test.ts", () => {
    const input = loadOfpFixture("valid-southern-eastern.json");

    expect(input.origin.latitude).toBe(-30.0);
    expect(input.origin.longitude).toBe(150.0);
    expect(input.destination.latitude).toBe(-31.5);
    expect(input.fixes[0].latitude).toBe(-30.125);
    expect(input.fixes[0].longitude).toBe(150.125);
  });

  it("matches the boundary-case literals used in coordinates.test.ts", () => {
    const input = loadOfpFixture("valid-ten-boundary-cases.json");

    expect(input.origin.longitude).toBe(-170.0);
    // navlog.fix[9] is ETP; the rollover pair is navlog.fix[10], the SECOND row
    // identified as REPEAT. navlog.fix[8] is the first REPEAT at 12.9/-170.9.
    expect(input.fixes[9].ident).toBe("ETP");
    expect(input.fixes[9].latitude).toBe(12.95);
    expect(input.fixes[10].ident).toBe("REPEAT");
    expect(input.fixes[10].latitude).toBe(12.9999);
    expect(input.fixes[10].longitude).toBe(-179.9999);
    expect(input.fixes[8].ident).toBe("REPEAT");
    expect(input.fixes[8].latitude).toBe(12.9);
  });
});
