/**
 * Navlog construction: the domain's interpretation of an `OfpInput`.
 *
 * One coherent pass produces the immutable navlog — classification, the
 * synthesized display-only origin row, and derived `RDIS` — because all three
 * are interpretation of the route rather than representation of the payload.
 *
 * Governed by `docs/tracker-behavior.md` §Route scope and §Displayed data.
 */

import { classifyFix } from "./classification";
import type { Navlog, NavlogMetadata, NavlogPoint } from "./navlog";
import type { OfpInput } from "./ofp-input";

/**
 * The source type recorded for the synthesized origin row. The OFP navlog omits
 * the origin entirely, so no upstream token exists; the row is an airport and
 * classifies as one.
 */
const SYNTHESIZED_ORIGIN_SOURCE_TYPE = "apt";

/**
 * Builds the immutable navlog from normalized OFP input.
 *
 * The OFP navlog begins at the first departure or enroute fix, because each row
 * describes the leg preceding it and no leg precedes the origin. A leading
 * display-only origin row is therefore synthesized from the OFP's separate
 * origin data: it is never slot-eligible and has no `DIS`.
 *
 * `RDIS` is the remaining route distance, derived by summing the leg distances
 * of every later row. It reaches zero at the destination by construction and
 * depends on nothing outside the navlog. The OFP's own route-distance total is
 * a cross-check only, and its great-circle air distance is a different
 * measurement that is never read.
 */
export function buildNavlog(input: OfpInput): Navlog {
  const procedures = { sidIdent: input.sidIdent, starIdent: input.starIdent };

  // Accumulate remaining distance backwards so each row sees the sum of the
  // legs after it, with the destination reaching exactly zero.
  const remainingAfter: number[] = new Array<number>(input.fixes.length);
  let remaining = 0;
  for (let index = input.fixes.length - 1; index >= 0; index -= 1) {
    remainingAfter[index] = remaining;
    remaining += input.fixes[index].distance;
  }
  // `remaining` is now the sum of every leg: the origin row's `RDIS`.

  const originPoint: NavlogPoint = {
    routeIndex: 0,
    ident: input.origin.icaoCode,
    sourceType: SYNTHESIZED_ORIGIN_SOURCE_TYPE,
    classification: "airport",
    latitude: input.origin.latitude,
    longitude: input.origin.longitude,
    dis: null,
    rdis: remaining,
    isSynthesizedOrigin: true,
  };

  const points: NavlogPoint[] = [originPoint];
  input.fixes.forEach((fix, index) => {
    points.push({
      routeIndex: index + 1,
      ident: fix.ident,
      sourceType: fix.sourceType,
      classification: classifyFix(fix, procedures),
      latitude: fix.latitude,
      longitude: fix.longitude,
      dis: fix.distance,
      rdis: remainingAfter[index],
      isSynthesizedOrigin: false,
    });
  });

  const metadata: NavlogMetadata = {
    generatedAtUnixSeconds: input.generatedAtUnixSeconds,
    flightNumber: input.flightNumber,
    originIcaoCode: input.origin.icaoCode,
    destinationIcaoCode: input.destination.icaoCode,
    sidIdent: input.sidIdent,
    starIdent: input.starIdent,
  };

  return { metadata, points };
}
