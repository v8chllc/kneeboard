/**
 * Waypoint classification.
 *
 * Implements the fail-closed classification order in
 * `docs/tracker-behavior.md` §Slot eligibility exactly as written. The order
 * matters: airport and `ltlg` classification run before the procedure flag is
 * consulted, because destination, top-of-climb, and top-of-descent rows carry
 * that flag in the accepted captures.
 *
 * An unrecognized point is always ineligible. A blocklist would fail open; this
 * fails closed.
 */

import type { NavlogPointClassification } from "./navlog";
import type { OfpNavlogFix } from "./ofp-input";

/**
 * The anchored pattern a coordinate-defined oceanic fix identifier must match,
 * such as `52N040W`. Every other `ltlg` row is computed or informational.
 */
export const COORDINATE_FIX_IDENT_PATTERN = /^\d{2}[NS]\d{3}[EW]$/;

/** The OFP's dedicated procedure identifiers, empty when none is declared. */
export interface ProcedureIdentifiers {
  readonly sidIdent: string;
  readonly starIdent: string;
}

/**
 * Classifies one navlog row. Pure and total: every input yields a
 * classification, and unrecognized inputs yield an ineligible one.
 */
export function classifyFix(
  fix: OfpNavlogFix,
  procedures: ProcedureIdentifiers,
): NavlogPointClassification {
  // 1. Airports are ineligible, and take precedence over the procedure flag.
  if (fix.sourceType === "apt") {
    return "airport";
  }

  // 2. A coordinate-defined `ltlg` row is eligible; every other `ltlg` row is a
  //    computed or informational point, whatever its procedure flag says.
  if (fix.sourceType === "ltlg") {
    return COORDINATE_FIX_IDENT_PATTERN.test(fix.ident) ? "coordinateFix" : "computedPoint";
  }

  if (fix.sourceType === "wpt" || fix.sourceType === "vor") {
    if (!fix.isSidStar) {
      // 5. Any remaining `wpt` or `vor` row is a named enroute fix.
      return "enrouteFix";
    }

    // 3. A flagged row belongs to a procedure only on an exact match against a
    //    dedicated identifier. `via_airway` describes the preceding leg, so a
    //    fix outside the procedure can still carry its name.
    if (procedures.sidIdent !== "" && fix.viaAirway === procedures.sidIdent) {
      return "sidFix";
    }
    if (procedures.starIdent !== "" && fix.viaAirway === procedures.starIdent) {
      return "starFix";
    }

    // 4. Flagged but matching neither dedicated identifier: ambiguous, so
    //    ineligible rather than guessed.
    return "ambiguousProcedureFix";
  }

  // 6. An unrecognized source type is ineligible.
  return "unrecognized";
}

/**
 * Whether a classification can ever consume an INS slot.
 *
 * This is the classification half of eligibility. Whether a `sidFix` or
 * `starFix` actually consumes a slot depends additionally on the tracker's
 * SID/STAR inclusion state, which is applied where slots are derived.
 */
export function isSlotEligibleClassification(
  classification: NavlogPointClassification,
): boolean {
  switch (classification) {
    case "coordinateFix":
    case "sidFix":
    case "starFix":
    case "enrouteFix":
      return true;
    case "airport":
    case "computedPoint":
    case "ambiguousProcedureFix":
    case "unrecognized":
      return false;
    default: {
      const unhandled: never = classification;
      throw new Error(`Unhandled classification: ${JSON.stringify(unhandled)}`);
    }
  }
}
