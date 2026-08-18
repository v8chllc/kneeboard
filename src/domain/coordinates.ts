/**
 * Coordinate conversion and formatting.
 *
 * The OFP supplies each position only as signed decimal degrees, so both
 * displayed representations — the keypad-ready value entered into the simulated
 * INS and the LIDO reference value shown beside it — are derived here from that
 * single source, through a single rounded intermediate, so they can never
 * disagree.
 *
 * Governed by `docs/tracker-behavior.md` §Coordinate presentation.
 */

/** Tenths of a minute in one degree: 60 minutes x 10. */
const TENTHS_PER_DEGREE = 600;

/** Tenths of a minute in one minute. */
const TENTHS_PER_MINUTE = 10;

/** Latitude magnitude never exceeds 90 degrees. */
const MAX_LATITUDE_DEGREES = 90;

/** Longitude magnitude never exceeds 180 degrees. */
const MAX_LONGITUDE_DEGREES = 180;

/** The 180th meridian in tenths of a minute, used to normalize -180 to +180. */
const ANTIMERIDIAN_TENTHS = MAX_LONGITUDE_DEGREES * TENTHS_PER_DEGREE;

export type LatitudeHemisphere = "N" | "S";
export type LongitudeHemisphere = "E" | "W";
export type Hemisphere = LatitudeHemisphere | LongitudeHemisphere;

/**
 * One axis of a position, rounded once and rendered two ways.
 *
 * `degrees`, `minutes`, and `tenthsOfMinute` are the rounded intermediate.
 * `keypad` and `lido` are both rendered from it, which is the property that
 * keeps the primary and reference values consistent.
 */
export interface CoordinatePresentation {
  readonly hemisphere: Hemisphere;
  /** Whole degrees, 0-90 for latitude and 0-180 for longitude. */
  readonly degrees: number;
  /** Whole minutes, always 0-59. A carry makes 60 unrepresentable. */
  readonly minutes: number;
  /** Tenths of a minute, always 0-9. */
  readonly tenthsOfMinute: number;
  /** Keypad entry form: `N 05235`, `W 006327`. */
  readonly keypad: string;
  /** LIDO reference form: `N05°23.5'`, `W006°32.7'`. */
  readonly lido: string;
}

/** Both axes of a displayed position. */
export interface PositionPresentation {
  readonly latitude: CoordinatePresentation;
  readonly longitude: CoordinatePresentation;
}

/**
 * Rounds a signed decimal degree value to the nearest tenth of a minute and
 * returns the signed total in tenths of a minute.
 *
 * Rounding the total rather than the minutes field makes the 60.0-minute carry
 * inherent: 179.9999 degrees is 107999.94 tenths, which rounds to 108000 and
 * floor-divides to exactly 180 degrees and 0.0 minutes. No separate carry step
 * exists, so `minutes` can never be emitted as 60 and `degrees` can never
 * overshoot its maximum by a carry.
 */
function roundToTenthsOfMinute(degrees: number): number {
  return Math.round(degrees * TENTHS_PER_DEGREE);
}

/** Splits a non-negative tenths total into degrees, minutes, and tenths. */
function splitTenths(totalTenths: number): {
  degrees: number;
  minutes: number;
  tenthsOfMinute: number;
} {
  const degrees = Math.floor(totalTenths / TENTHS_PER_DEGREE);
  const remainder = totalTenths - degrees * TENTHS_PER_DEGREE;
  return {
    degrees,
    minutes: Math.floor(remainder / TENTHS_PER_MINUTE),
    tenthsOfMinute: remainder % TENTHS_PER_MINUTE,
  };
}

function present(
  hemisphere: Hemisphere,
  totalTenths: number,
  degreeDigits: 2 | 3,
): CoordinatePresentation {
  const { degrees, minutes, tenthsOfMinute } = splitTenths(totalTenths);
  const paddedDegrees = String(degrees).padStart(degreeDigits, "0");
  const paddedMinutes = String(minutes).padStart(2, "0");

  return {
    hemisphere,
    degrees,
    minutes,
    tenthsOfMinute,
    keypad: `${hemisphere} ${paddedDegrees}${paddedMinutes}${tenthsOfMinute}`,
    lido: `${hemisphere}${paddedDegrees}°${paddedMinutes}.${tenthsOfMinute}'`,
  };
}

/**
 * Rejects a value outside the axis range.
 *
 * The check is applied to the supplied value, not to the rounded one: rounding
 * first would pull an out-of-range value such as 90.00001 back onto the pole
 * and admit it silently.
 *
 * Task-list section 8 is expected to range-check the payload with Zod at the
 * transport boundary, but that boundary does not exist yet, so this guard is
 * currently the only range check on the path into the domain and must not be
 * weakened when the boundary lands.
 */
function assertInRange(value: number, maxDegrees: number, axis: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${axis} must be a finite number`);
  }
  if (Math.abs(value) > maxDegrees) {
    throw new RangeError(`${axis} is out of range: ${value}`);
  }
}

/**
 * Converts a signed decimal latitude, where negative is south, into keypad and
 * LIDO representations.
 *
 * The hemisphere is determined *after* rounding, from the rounded value, using
 * an arithmetic comparison. A latitude whose magnitude rounds to zero lies on
 * the equator and takes `N`, per ARINC 424 §5.36 — including a negative input
 * and negative zero, for which a sign-bit test would wrongly yield `S`.
 */
export function formatLatitude(latitude: number): CoordinatePresentation {
  assertInRange(latitude, MAX_LATITUDE_DEGREES, "latitude");

  const roundedTenths = roundToTenthsOfMinute(latitude);
  const hemisphere: LatitudeHemisphere = roundedTenths < 0 ? "S" : "N";

  return present(hemisphere, Math.abs(roundedTenths), 2);
}

/**
 * Converts a signed decimal longitude, where negative is west, into keypad and
 * LIDO representations.
 *
 * The hemisphere is determined *after* rounding and after any carry, from the
 * rounded value, using an arithmetic comparison. Both the prime meridian and
 * the 180th meridian take `E`, per ARINC 424 §5.37, whose range is
 * `(-180, +180]`. A west longitude that carries onto the 180th meridian —
 * 179°59.97'W becomes 180°00.0' — is therefore normalized to `E 180000`.
 *
 * This diverges deliberately from ISO 6709 §6.5(c), which renders the same
 * meridian `W`. See `docs/tracker-behavior.md` §Coordinate presentation.
 */
export function formatLongitude(longitude: number): CoordinatePresentation {
  assertInRange(longitude, MAX_LONGITUDE_DEGREES, "longitude");

  const roundedTenths = roundToTenthsOfMinute(longitude);
  // Normalize onto the ARINC 424 range (-180, +180] before choosing the
  // hemisphere, so the 180th meridian is reached as +180 from either direction.
  const normalizedTenths =
    roundedTenths === -ANTIMERIDIAN_TENTHS ? ANTIMERIDIAN_TENTHS : roundedTenths;
  const hemisphere: LongitudeHemisphere = normalizedTenths < 0 ? "W" : "E";

  return present(hemisphere, Math.abs(normalizedTenths), 3);
}

/** Converts a signed decimal position into both displayed representations. */
export function formatPosition(latitude: number, longitude: number): PositionPresentation {
  return {
    latitude: formatLatitude(latitude),
    longitude: formatLongitude(longitude),
  };
}
