/**
 * Test-only fixture adapter.
 *
 * Loads a tracked sanitized SimBrief fixture and casts it to the domain's
 * `OfpInput`. It is deliberately dumb: it asserts the shape it expects and
 * throws on anything else. It performs no lenient coercion, applies no default,
 * and encodes no domain rule. Classification, eligibility, origin-row
 * synthesis, and `RDIS` all belong to `src/domain/`.
 *
 * This exists only because representation normalization is a Zod boundary
 * concern that arrives in task-list section 8. When that boundary lands, its
 * schema must be proven to produce output identical to this adapter for every
 * tracked fixture; otherwise the two can diverge on an edge case and the suite
 * keeps passing while production fails.
 *
 * Not a Vitest suite: Vitest's default include matches only `*.test.ts`.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import type { OfpAirport, OfpInput, OfpNavlogFix } from "../../src/domain/ofp-input";

const FIXTURE_DIRECTORY = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "simbrief",
);

/** Matches the two scalar shapes observed for numeric fields, and nothing else. */
const NUMERIC_STRING = /^-?\d+(\.\d+)?$/;

function fail(fixture: string, field: string, reason: string): never {
  throw new Error(`${fixture}: ${field} ${reason}`);
}

function record(
  value: unknown,
  fixture: string,
  field: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(fixture, field, "is not an object");
  }
  return value as Record<string, unknown>;
}

function requiredString(
  source: Record<string, unknown>,
  fixture: string,
  key: string,
  path: string = key,
): string {
  const value = source[key];
  if (typeof value !== "string") {
    fail(fixture, path, "is not a string");
  }
  return value;
}

/**
 * Accepts a JSON number or a numeric string, which are the only two shapes the
 * captures produced. Anything else throws rather than being coerced.
 */
function requiredNumber(
  source: Record<string, unknown>,
  fixture: string,
  key: string,
  path: string = key,
): number {
  const value = source[key];
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail(fixture, path, "is not a finite number");
    }
    return value;
  }
  if (typeof value === "string" && NUMERIC_STRING.test(value)) {
    const converted = Number(value);
    // A syntactically valid numeric string can still overflow to Infinity. The
    // adapter throws on anything unexpected rather than coercing it.
    if (!Number.isFinite(converted)) {
      fail(fixture, path, "does not convert to a finite number");
    }
    return converted;
  }
  return fail(fixture, path, "is neither a number nor a numeric string");
}

/** Accepts only the `0` and `1` tokens, quoted or bare. */
function requiredFlag(
  source: Record<string, unknown>,
  fixture: string,
  key: string,
  path: string = key,
): boolean {
  const value = source[key];
  if (value === 0 || value === "0") {
    return false;
  }
  if (value === 1 || value === "1") {
    return true;
  }
  return fail(fixture, path, "is not a 0 or 1 token");
}

/** Latitude bound declared by `OfpNavlogFix` and `OfpAirport`. */
const MAX_LATITUDE_DEGREES = 90;

/** Longitude bound declared by `OfpNavlogFix` and `OfpAirport`. */
const MAX_LONGITUDE_DEGREES = 180;

/**
 * Reads a coordinate and rejects one outside its declared axis range, so the
 * adapter cannot hand back an `OfpInput` that violates its own contract.
 *
 * This is distinct from `assertInRange` in `src/domain/coordinates.ts`. That
 * guard is currently the only range check on the path into the domain; this one
 * guards the shape of test input. Neither replaces the other.
 */
function requiredCoordinate(
  source: Record<string, unknown>,
  fixture: string,
  key: string,
  path: string,
  maxDegrees: number,
): number {
  const value = requiredNumber(source, fixture, key, path);
  if (Math.abs(value) > maxDegrees) {
    fail(fixture, path, `is outside the range [-${maxDegrees}, ${maxDegrees}]: ${value}`);
  }
  return value;
}

function airport(value: unknown, fixture: string, field: string): OfpAirport {
  const source = record(value, fixture, field);
  return {
    icaoCode: requiredString(source, fixture, "icao_code", `${field}.icao_code`),
    latitude: requiredCoordinate(
      source,
      fixture,
      "pos_lat",
      `${field}.pos_lat`,
      MAX_LATITUDE_DEGREES,
    ),
    longitude: requiredCoordinate(
      source,
      fixture,
      "pos_long",
      `${field}.pos_long`,
      MAX_LONGITUDE_DEGREES,
    ),
  };
}

function navlogFix(value: unknown, fixture: string, index: number): OfpNavlogFix {
  const field = `navlog.fix[${index}]`;
  const source = record(value, fixture, field);
  return {
    ident: requiredString(source, fixture, "ident", `${field}.ident`),
    sourceType: requiredString(source, fixture, "type", `${field}.type`),
    isSidStar: requiredFlag(source, fixture, "is_sid_star", `${field}.is_sid_star`),
    viaAirway: requiredString(source, fixture, "via_airway", `${field}.via_airway`),
    latitude: requiredCoordinate(
      source,
      fixture,
      "pos_lat",
      `${field}.pos_lat`,
      MAX_LATITUDE_DEGREES,
    ),
    longitude: requiredCoordinate(
      source,
      fixture,
      "pos_long",
      `${field}.pos_long`,
      MAX_LONGITUDE_DEGREES,
    ),
    distance: requiredNumber(source, fixture, "distance", `${field}.distance`),
  };
}

/** Casts already-parsed fixture JSON. Exposed so shape rejection can be tested. */
export function adaptOfpFixture(parsed: unknown, fixture: string): OfpInput {
  const root = record(parsed, fixture, "<root>");
  const params = record(root.params, fixture, "params");
  const general = record(root.general, fixture, "general");
  const navlog = record(root.navlog, fixture, "navlog");

  const fixes = navlog.fix;
  if (!Array.isArray(fixes)) {
    // A bare object here is SimBrief's single-element collapse. Normalizing it
    // is the Zod boundary's job, not this adapter's.
    fail(fixture, "navlog.fix", "is not an array");
  }

  return {
    generatedAtUnixSeconds: requiredNumber(params, fixture, "time_generated"),
    flightNumber: requiredString(general, fixture, "flight_number"),
    origin: airport(root.origin, fixture, "origin"),
    destination: airport(root.destination, fixture, "destination"),
    sidIdent: requiredString(general, fixture, "sid_ident"),
    starIdent: requiredString(general, fixture, "star_ident"),
    routeDistance: requiredNumber(general, fixture, "route_distance"),
    fixes: fixes.map((fix, index) => navlogFix(fix, fixture, index)),
  };
}

/** Reads and casts a tracked fixture by file name. */
export function loadOfpFixture(fileName: string): OfpInput {
  const contents = readFileSync(path.join(FIXTURE_DIRECTORY, fileName), "utf8");
  return adaptOfpFixture(JSON.parse(contents), fileName);
}
