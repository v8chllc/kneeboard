import { describe, expect, it } from "vitest";

import {
  formatLatitude,
  formatLongitude,
  formatPosition,
  type CoordinatePresentation,
} from "./coordinates";

/**
 * Literal inputs are transcribed from the tracked sanitized fixtures, with the
 * fixture and field recorded so slice 3 can cross-check them against the real
 * payload once the fixture adapter exists. The adapter is deliberately not
 * pulled forward into this slice.
 */
const FIXTURE_VALUES = {
  /** valid-southern-eastern.json: origin.pos_lat "-30.000000" */
  southernOriginLatitude: -30.0,
  /** valid-southern-eastern.json: origin.pos_long "150.000000" */
  easternOriginLongitude: 150.0,
  /** valid-southern-eastern.json: navlog.fix[0] EVONN pos_lat "-30.125000" */
  southernFixLatitude: -30.125,
  /** valid-southern-eastern.json: navlog.fix[0] EVONN pos_long "150.125000" */
  easternFixLongitude: 150.125,
  /** valid-southern-eastern.json: destination.pos_lat "-31.500000" */
  southernDestinationLatitude: -31.5,
  /**
   * valid-ten-boundary-cases.json: navlog.fix[10].pos_lat 12.9999 (bare
   * number). The identifier REPEAT is ambiguous — it appears at navlog.fix[8]
   * (12.9) and navlog.fix[10]. This literal is the fix[10] value.
   */
  rolloverLatitude: 12.9999,
  /**
   * valid-ten-boundary-cases.json: navlog.fix[10].pos_long -179.9999 (bare
   * number), the same fix[10] row as the latitude above, not fix[8].
   */
  antimeridianLongitude: -179.9999,
  /** valid-ten-boundary-cases.json: navlog.fix[9] ETP pos_lat "12.950000" */
  etpLatitude: 12.95,
  /** valid-ten-boundary-cases.json: origin.pos_long "-170.000000" */
  westernOriginLongitude: -170.0,
} as const;

describe("formatLatitude", () => {
  it("formats a northern latitude in both representations", () => {
    // docs/tracker-behavior.md worked example: LIDO N05°23.5' becomes N 05235.
    const result = formatLatitude(5 + 23.5 / 60);

    expect(result).toMatchObject({
      hemisphere: "N",
      degrees: 5,
      minutes: 23,
      tenthsOfMinute: 5,
      keypad: "N 05235",
      lido: "N05°23.5'",
    });
  });

  it("formats a southern latitude from the southern/eastern fixture", () => {
    expect(formatLatitude(FIXTURE_VALUES.southernFixLatitude)).toMatchObject({
      hemisphere: "S",
      keypad: "S 30075",
      lido: "S30°07.5'",
    });

    expect(formatLatitude(FIXTURE_VALUES.southernOriginLatitude).keypad).toBe("S 30000");
    expect(formatLatitude(FIXTURE_VALUES.southernDestinationLatitude).keypad).toBe("S 31300");
  });

  it("rounds to the nearest tenth of a minute", () => {
    // 12.95 degrees is exactly 12 degrees 57.0 minutes.
    expect(formatLatitude(FIXTURE_VALUES.etpLatitude).keypad).toBe("N 12570");
    // 0.04 minutes below the tenth rounds down, 0.06 above rounds up.
    expect(formatLatitude(10 + 20.24 / 60).keypad).toBe("N 10202");
    expect(formatLatitude(10 + 20.26 / 60).keypad).toBe("N 10203");
  });

  it("carries 60.0 minutes into the next degree", () => {
    // 12.9999 degrees is 12 degrees 59.994 minutes, which rounds to 60.0 and
    // must carry rather than render 12 degrees 60.0 minutes.
    expect(formatLatitude(FIXTURE_VALUES.rolloverLatitude)).toMatchObject({
      degrees: 13,
      minutes: 0,
      tenthsOfMinute: 0,
      keypad: "N 13000",
      lido: "N13°00.0'",
    });
  });

  it("takes N on the equator, including for negative and negative-zero input", () => {
    // ARINC 424 section 5.36: N is entered for latitudes falling on the equator.
    expect(formatLatitude(0).keypad).toBe("N 00000");
    expect(formatLatitude(-0).keypad).toBe("N 00000");
    // Hemisphere is chosen after rounding: this magnitude rounds to 0.0 tenths,
    // so it lies on the equator despite a negative input. A sign-bit test would
    // wrongly yield S here, because Math.round returns negative zero.
    expect(formatLatitude(-0.0005).keypad).toBe("N 00000");
  });

  it("preserves a southern hemisphere that survives rounding", () => {
    // -0.002 degrees is -0.12 minutes, which rounds to -0.1 minutes rather than
    // to zero, so it does NOT lie on the equator and correctly takes S.
    expect(formatLatitude(-0.002).keypad).toBe("S 00001");
  });

  it("formats both poles", () => {
    expect(formatLatitude(90).keypad).toBe("N 90000");
    expect(formatLatitude(-90).keypad).toBe("S 90000");
  });

  it("rejects values the boundary should already have rejected", () => {
    expect(() => formatLatitude(90.5)).toThrow(RangeError);
    expect(() => formatLatitude(-91)).toThrow(RangeError);
    expect(() => formatLatitude(Number.NaN)).toThrow(RangeError);
    expect(() => formatLatitude(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("formatLongitude", () => {
  it("formats an eastern longitude in both representations", () => {
    expect(formatLongitude(FIXTURE_VALUES.easternFixLongitude)).toMatchObject({
      hemisphere: "E",
      keypad: "E 150075",
      lido: "E150°07.5'",
    });

    expect(formatLongitude(FIXTURE_VALUES.easternOriginLongitude).keypad).toBe("E 150000");
  });

  it("formats a western longitude in both representations", () => {
    // docs/tracker-behavior.md worked example: LIDO W006°32.7' becomes W 006327.
    expect(formatLongitude(-(6 + 32.7 / 60))).toMatchObject({
      hemisphere: "W",
      keypad: "W 006327",
      lido: "W006°32.7'",
    });

    expect(formatLongitude(FIXTURE_VALUES.westernOriginLongitude).keypad).toBe("W 170000");
  });

  it("takes E on the prime meridian, including for negative-zero input", () => {
    // ARINC 424 section 5.37: E is entered on the 0 and 180 degree meridians.
    expect(formatLongitude(0).keypad).toBe("E 000000");
    expect(formatLongitude(-0).keypad).toBe("E 000000");
    expect(formatLongitude(-0.0005).keypad).toBe("E 000000");
  });

  it("takes E on the 180th meridian from either direction", () => {
    expect(formatLongitude(180).keypad).toBe("E 180000");
    expect(formatLongitude(-180).keypad).toBe("E 180000");
  });

  it("carries a western longitude onto the 180th meridian and then takes E", () => {
    // 179 degrees 59.97 minutes west carries to 180 degrees 00.0 minutes and
    // only then takes its hemisphere.
    expect(formatLongitude(-(179 + 59.97 / 60))).toMatchObject({
      hemisphere: "E",
      degrees: 180,
      minutes: 0,
      tenthsOfMinute: 0,
      keypad: "E 180000",
    });
  });

  it("never renders the carried antimeridian as W 180000, 180 degrees 00.x, or 181 degrees", () => {
    const result = formatLongitude(FIXTURE_VALUES.antimeridianLongitude);

    expect(result.keypad).toBe("E 180000");
    expect(result.keypad).not.toBe("W 180000");
    expect(result.hemisphere).not.toBe("W");
    expect(result.degrees).toBe(180);
    expect(result.degrees).not.toBe(181);
    expect(result.minutes).toBe(0);
    expect(result.tenthsOfMinute).toBe(0);
  });

  it("rejects values the boundary should already have rejected", () => {
    expect(() => formatLongitude(180.5)).toThrow(RangeError);
    expect(() => formatLongitude(-181)).toThrow(RangeError);
    expect(() => formatLongitude(Number.NaN)).toThrow(RangeError);
  });
});

describe("carry invariants", () => {
  it("never emits 60 minutes or an over-range degree across a dense sweep", () => {
    for (let hundredths = -18000; hundredths <= 18000; hundredths += 1) {
      const longitude = hundredths / 100;
      const result = formatLongitude(longitude);

      expect(result.minutes).toBeLessThanOrEqual(59);
      expect(result.tenthsOfMinute).toBeLessThanOrEqual(9);
      expect(result.degrees).toBeLessThanOrEqual(180);

      if (Math.abs(longitude) <= 90) {
        const latitude = formatLatitude(longitude);
        expect(latitude.minutes).toBeLessThanOrEqual(59);
        expect(latitude.degrees).toBeLessThanOrEqual(90);
      }
    }
  });
});

describe("shared rounded intermediate", () => {
  /**
   * Re-renders both representations from the returned rounded intermediate. If
   * keypad and LIDO were ever derived from different roundings, one of these
   * reconstructions would disagree with the value it came from.
   */
  function assertRepresentationsAgree(
    result: CoordinatePresentation,
    degreeDigits: 2 | 3,
  ): void {
    const paddedDegrees = String(result.degrees).padStart(degreeDigits, "0");
    const paddedMinutes = String(result.minutes).padStart(2, "0");

    expect(result.keypad).toBe(
      `${result.hemisphere} ${paddedDegrees}${paddedMinutes}${result.tenthsOfMinute}`,
    );
    expect(result.lido).toBe(
      `${result.hemisphere}${paddedDegrees}°${paddedMinutes}.${result.tenthsOfMinute}'`,
    );
  }

  it("derives keypad and LIDO values from one rounding for every boundary value", () => {
    const latitudes = [
      0,
      -0,
      -0.0005,
      -0.002,
      90,
      -90,
      FIXTURE_VALUES.rolloverLatitude,
      FIXTURE_VALUES.etpLatitude,
      FIXTURE_VALUES.southernFixLatitude,
    ];
    const longitudes = [
      0,
      -0,
      180,
      -180,
      FIXTURE_VALUES.antimeridianLongitude,
      FIXTURE_VALUES.easternFixLongitude,
      FIXTURE_VALUES.westernOriginLongitude,
      -(179 + 59.97 / 60),
    ];

    for (const latitude of latitudes) {
      assertRepresentationsAgree(formatLatitude(latitude), 2);
    }
    for (const longitude of longitudes) {
      assertRepresentationsAgree(formatLongitude(longitude), 3);
    }
  });

  it("formats a position identically through formatPosition and the axis functions", () => {
    const latitude = FIXTURE_VALUES.rolloverLatitude;
    const longitude = FIXTURE_VALUES.antimeridianLongitude;

    expect(formatPosition(latitude, longitude)).toEqual({
      latitude: formatLatitude(latitude),
      longitude: formatLongitude(longitude),
    });
  });
});
