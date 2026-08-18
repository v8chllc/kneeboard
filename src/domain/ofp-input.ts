/**
 * Domain input types.
 *
 * These types describe the SimBrief OFP data *after* representation
 * normalization and *before* any domain interpretation. Normalization —
 * coercing quoted numerics to numbers, collapsing SimBrief's
 * single-element-object-or-array shapes to lists, and rejecting non-LIDO or
 * incomplete payloads — is the Zod boundary's job and arrives in task-list
 * section 8. Interpretation — classification, eligibility, the synthesized
 * origin row, and derived `RDIS` — is domain work and lives in `src/domain/`.
 *
 * Section 8's Zod schema must produce exactly these types, which the compiler
 * enforces at the call site.
 *
 * Field mapping is recorded in `docs/simbrief-navlog-findings.md`.
 */

/**
 * One row of the primary `navlog.fix` list, with representation already
 * normalized.
 *
 * The origin airport is deliberately absent: the OFP navlog begins at the first
 * departure or enroute fix because each row describes the leg preceding it. The
 * domain synthesizes the leading origin row from {@link OfpAirport}.
 */
export interface OfpNavlogFix {
  /** SimBrief `ident`. Retained for display and classification. */
  readonly ident: string;
  /**
   * SimBrief `type`, retained as an untrusted classification token rather than
   * a closed union. An unrecognized token must classify as ineligible, so the
   * domain — not the boundary — decides what is recognized.
   */
  readonly sourceType: string;
  /** SimBrief `is_sid_star`, parsed to a boolean after token validation. */
  readonly isSidStar: boolean;
  /** SimBrief `via_airway`. Names the procedure or airway of the preceding leg. */
  readonly viaAirway: string;
  /** Signed decimal degrees in `[-90, 90]`. Negative is south. */
  readonly latitude: number;
  /** Signed decimal degrees in `[-180, 180]`. Negative is west. */
  readonly longitude: number;
  /** SimBrief `distance`: nautical miles of the leg *into* this row. */
  readonly distance: number;
}

/** Origin or destination position supplied outside the navlog. */
export interface OfpAirport {
  readonly icaoCode: string;
  /** Signed decimal degrees in `[-90, 90]`. Negative is south. */
  readonly latitude: number;
  /** Signed decimal degrees in `[-180, 180]`. Negative is west. */
  readonly longitude: number;
}

/**
 * The complete set of OFP values the tracker consumes. The full raw payload is
 * retained separately by persistence and is not modeled here.
 */
export interface OfpInput {
  /** SimBrief `params.time_generated` as Unix seconds. Displayed in UTC. */
  readonly generatedAtUnixSeconds: number;
  /** SimBrief `general.flight_number`, displayed as supplied. */
  readonly flightNumber: string;
  readonly origin: OfpAirport;
  readonly destination: OfpAirport;
  /** SimBrief `general.sid_ident`. Empty when the OFP declares no SID. */
  readonly sidIdent: string;
  /** SimBrief `general.star_ident`. Empty when the OFP declares no STAR. */
  readonly starIdent: string;
  /**
   * SimBrief `general.route_distance`, retained only as a cross-check against
   * summed leg distances. `general.air_distance` is a different great-circle
   * measurement and must never be used.
   */
  readonly routeDistance: number;
  /** The primary origin-to-destination navlog, in route order. */
  readonly fixes: readonly OfpNavlogFix[];
}
