# SimBrief navlog findings

Observed structure of the SimBrief LIDO JSON navlog, recorded from real captures
during fixture acquisition. This document reports evidence. It does not resolve
the open decisions in [planning status](planning-status.md); where a rule is
recommended rather than confirmed, that is stated explicitly.

Raw captures live in the ignored `.local/simbrief/` directory and are catalogued
in the local manifest written alongside them. The findings below come from five
accepted captures:

| Scenario | Route | Navlog entries | Notes |
| --- | --- | --- | --- |
| Normal domestic | KATL–KORD | 24 | VARNM2 SID, VEECK5 STAR |
| Long multi-page | KLAX–KJFK | 42 | 39 eligible, 5 pages, 4 VORs |
| Oceanic | KBOS–EGLL | 27 | NAT track W, alternate EGCC retained |
| Southern/eastern hemisphere | YSSY–NZAA | 12 | All entries south and east |
| Sparse optional identity | KONT–KAFW | 27 | Blank airline; registration substituted as flight number |

The corresponding tracked parser fixtures are documented under
[`tests/fixtures/simbrief`](../tests/fixtures/simbrief/README.md). They preserve
the observed boundary shapes and classification evidence while replacing
ordinary coordinates, distances, timestamps, and account-linked identity data
with deterministic test values.

## Navlog location and shape

The primary route is `navlog.fix`, an ordered array. Alternate routing appears
separately under `alternate_navlog`, and ETOPS data under `etops`. Selecting
`navlog.fix` alone satisfies the primary-route-only rule in
[tracker behavior](tracker-behavior.md).

An observed LIDO OFP generated with the detailed navlog option disabled still
contained a `navlog` object, but omitted `navlog.fix` entirely. The boundary
parser must reject that shape as a missing detailed navlog rather than
normalizing it to an empty valid route. That same rejection capture represented
`general.sid_ident` and `general.star_ident` as empty objects rather than
strings, reinforcing that layout and detailed-navlog gates should run before
full normalization.

Conversely, an observed DAL-layout OFP contained a populated `navlog.fix` array
with 25 entries. The boundary parser must validate `params.ofp_layout` as LIDO
independently of detailed-navlog presence and reject unsupported layouts before
normalizing route data.

## Normalized field mapping

All numeric-looking values required by the tracker were JSON strings in all
five accepted captures. Boundary validation must parse them deliberately rather
than relying on JavaScript coercion.

### OFP metadata

| Normalized value | SimBrief source | Observed input | Normalization |
| --- | --- | --- | --- |
| Supported layout | `params.ofp_layout` | String | Require the exact value `LIDO`. |
| OFP generation time | `params.time_generated` | Digits-only Unix-seconds string | Parse to an instant and store/display in UTC. |
| Flight number | `general.flight_number` | String | Retain as supplied, including registration substitution. |
| Origin identifier | `origin.icao_code` | String | Retain for metadata and the synthesized origin row. |
| Origin position | `origin.pos_lat`, `origin.pos_long` | Signed-decimal strings | Parse to latitude and longitude numbers with range checks. |
| Destination identifier | `destination.icao_code` | String | Retain for metadata and cross-check against the final navlog row. |
| SID identifier | `general.sid_ident` | String | Use as procedure-classification input; test empty values synthetically. |
| STAR identifier | `general.star_ident` | String | Use as procedure-classification input; test empty values synthetically. |
| Route distance | `general.route_distance` | Non-negative decimal string | Parse only as a cross-check against summed leg distances. |
| Primary rows | `navlog.fix` | Array in accepted captures; absent when detailed navlog was disabled | Normalize one-or-many shape to an ordered list and reject absence. |

`destination.pos_lat` and `destination.pos_long` were also signed-decimal
strings. They matched the final navlog airport row numerically in all five
accepted captures, but the displayed destination row should retain the ordered
navlog values rather than duplicate the top-level position.

### Navlog rows

| Normalized value | SimBrief source | Observed input | Normalization |
| --- | --- | --- | --- |
| Route index | Array position | Ordered list position | Assign once while preserving original order. |
| Identifier | `ident` | Non-empty string | Retain for display and classification. |
| Source type | `type` | `wpt`, `vor`, `ltlg`, or `apt` | Validate as an untrusted classification token. |
| Procedure flag | `is_sid_star` | String `0` or `1` | Parse to a boolean only after validating the token. |
| Inbound route/procedure | `via_airway` | Non-empty string in every observed row | Retain for procedure classification. |
| Latitude | `pos_lat` | Signed-decimal string | Parse to a number in `[-90, 90]`. |
| Longitude | `pos_long` | Signed-decimal string | Parse to a number in `[-180, 180]`. |
| `DIS` | `distance` | Non-negative decimal string | Parse as nautical miles for the leg into this row. |
| `RDIS` | No direct field | Derived | Sum normalized `DIS` values of every later row. |

`name`, `stage`, and `fir_crossing` supplied useful research evidence but are
not required by the documented tracker display or the recommended
classification rules. They should not be retained in the normalized MVP model
unless implementation reveals a concrete requirement.

The synthesized origin row maps `origin.icao_code`, `origin.pos_lat`, and
`origin.pos_long` into an excluded airport row before the first navlog row. Its
`DIS` is absent and its `RDIS` is the sum of every normalized navlog `DIS`.

## Optional flight identity

In an observed valid LIDO OFP generated without an airline or flight number,
`general.icao_airline` remained present as an empty string. SimBrief populated
`general.flight_number` with the aircraft registration from `aircraft.reg`
instead of leaving it empty. Both fields contained the simulator registration
`N101SB`.

**Resolved product decision:** Kneeboard displays `general.flight_number` as
supplied, including SimBrief's simulator-registration substitution. The MVP does
not normalize `aircraft.reg` solely to detect or relabel this case. Boundary
validation must still treat `general.flight_number` as untrusted input, and
synthetic fixtures should cover omitted, null, and empty values.

## Coordinate representation

`pos_lat` and `pos_long` are quoted **signed decimal degree strings**, not LIDO
degrees-minutes strings. After parsing, negative longitude is west and negative
latitude is south.
The NAT track fixes make this unambiguous because their identifiers already
disclose their positions:

```
52N050W   pos_lat="52.000000"   pos_long="-50.000000"
55N040W   pos_lat="55.000000"   pos_long="-40.000000"
```

Both displayed representations must therefore be derived from this single signed
decimal source: the keypad-ready value and the LIDO-formatted reference value
alike. The payload supplies neither directly. [Tracker
behavior](tracker-behavior.md) has been reworded to match.

## Classification evidence

### Airports

Only the destination appears in the navlog, with `type: "apt"`. **The origin
airport is absent from `navlog.fix` in all five accepted captures.** Each navlog
begins at the first SID or enroute fix.

Every accepted capture had exactly one `apt` row, it was the final row, and its
identifier, name, and numeric position matched the top-level `destination`
object.

### Computed points

Top of climb and top of descent appear as ordinary navlog entries with
`type: "ltlg"` — the same type as slot-eligible coordinate-defined oceanic
fixes. Type alone cannot separate them.

The discriminator is the relationship between `ident` and `name`:

| ident | name | Eligible |
| --- | --- | --- |
| `TOC` | `TOP OF CLIMB` | No |
| `TOD` | `TOP OF DESCENT` | No |
| `52N050W` | `52N050W` | Yes |

Across five accepted captures, all ten non-coordinate `ltlg` rows were TOC or
TOD, while all four coordinate rows matched `^\d{2}[NS]\d{3}[EW]$`.

**Confirmed rule:** treat an `ltlg` fix as slot-eligible only when its identifier
matches that anchored coordinate pattern. The allowlist fails safe, because an
unseen computed point — an equal-time point, for example — defaults to
ineligible rather than silently consuming a slot. A blocklist of `TOC` and
`TOD` would fail open.

### SID and STAR fixes

`is_sid_star` is a single flag covering both procedures; it does not identify
which one. `via_airway` names the procedure but describes the **preceding leg**,
per the SimBrief explanation already cited in [tracker
behavior](tracker-behavior.md). A fix reached via a procedure can therefore carry
that procedure's name while sitting outside it:

```
KLAX–KJFK   WYZEE   via=OSHNN1   sid_star=1     inside the SID
KLAX–KJFK   BEALE   via=OSHNN1   sid_star=0     outside the SID
KBOS–EGLL   LBSTA   via=LBSTA8   sid_star=0     outside the SID
```

The payload provides dedicated procedure names in `general.sid_ident` and
`general.star_ident`; both fields were strings in every accepted capture. They
avoid parsing procedure names from `general.route`.

**Confirmed rule:** classify a `wpt` or `vor` row as SID or STAR only when
`is_sid_star == "1"` and `via_airway` exactly matches the corresponding dedicated
procedure identifier. Apply airport and `ltlg` classification first because
destination, TOC, and TOD rows may also carry the procedure flag. Treat an
otherwise unrecognized flagged row as ineligible rather than guessing. No such
ambiguous row appeared in the five accepted captures.

`is_sid_star` is unreliable on computed points. Across the accepted captures,
TOC and TOD carried multiple flag patterns. Computed points must never be
identified by that flag.

### VOR fixes

`type: "vor"` appears on the enroute portion and also inside procedures — `BNN`
sits within the EGLL arrival with `sid_star=1`. Excluding STAR fixes therefore
also drops that VOR. The two controls interact.

### Cross-capture classification result

Applying the two confirmed rules after airport precedence produced the
following evidence across 132 rows:

| Category | Rows | Slot eligibility |
| --- | ---: | --- |
| Airport | 5 | Never |
| Computed TOC/TOD | 10 | Never |
| Coordinate-defined `ltlg` | 4 | Yes |
| SID `wpt`/`vor` | 27 | Controlled by SID inclusion |
| STAR `wpt`/`vor` | 27 | Controlled by STAR inclusion |
| Named enroute `wpt`/`vor` | 59 | Yes |

The resulting eligible counts were 21, 39, 24, 9, and 24 in capture order. No
row fell into an unknown source type or ambiguous flagged-procedure category.

## Gaps against documented behavior

Three gaps were found between the payload and the originally documented
behavior. All three have since been resolved and
[tracker behavior](tracker-behavior.md) now reflects the outcome.

1. **The origin airport is not in the navlog.** Every capture begins at the
   first departure or enroute fix, because each row's data describes the leg
   preceding it and no leg precedes the origin. Only the destination carries
   `type: "apt"`.

   *Resolved:* the tracker synthesizes a leading display-only origin row from
   the top-level `origin` object, which supplies `icao_code`, `name`, `pos_lat`,
   `pos_long`, and `elevation` in all captures. The row is never slot-eligible
   and has no `DIS`. The page-construction rule stands unchanged, and the
   display stays symmetric with the destination row.

2. **There is no remaining-distance field.** Per-fix `distance` is leg distance
   only, matching `DIS`. No cumulative or remaining total exists.

   *Resolved:* `RDIS` is derived by summing the leg distances of all following
   rows. This reaches zero at the destination by construction and depends on
   nothing outside `navlog.fix`. Leg distances reconcile exactly against
   `general.route_distance` in all five accepted captures — 625, 2258, 2901,
   1209, and 1116 nautical miles — so that total serves as a cross-check.
   `general.air_distance` is a different great-circle measurement and must not
   be used.

3. **FIR boundaries are not navlog rows.** FIR data arrives as a `fir_crossing`
   object attached to the fix whose leg crosses the boundary. No capture
   contains a FIR row, so the documented "FIR boundary markers" example was not
   achievable.

   *Resolved:* the example was removed. The excluded-point category remains
   open-ended so that unrecognized computed points still fall under it. FIR data
   stays in the raw payload, unused by MVP.

## Boundary validation hazards

- **Single-element collapse.** SimBrief returns a bare object where an array is
  expected when only one element is present. Within one capture, `fir_crossing`
  held `.fir` as a three-element array on one fix and as a bare object on three
  others. Boundary schemas must accept both shapes and normalize to a list.
  Assume this applies anywhere in the payload, including `navlog.fix` itself on a
  degenerate route.
- **Numeric values arrive as strings.** `params.time_generated`, airport and
  navlog coordinates, navlog distances, `general.route_distance`, and
  `is_sid_star` were all quoted in every inspected capture. Parse and range-check
  each required value explicitly; do not assume numeric JSON tokens.

## Synthetic boundary coverage

The cases no accepted capture produced are represented by deterministic fixtures
documented under [`tests/fixtures/simbrief`](../tests/fixtures/simbrief/README.md):

- `valid-exactly-nine.json` and `valid-ten-boundary-cases.json` isolate the first
  repeating-slot boundary.
- `valid-ten-boundary-cases.json` places a non-coordinate `ltlg` point between
  slot 9 and the next slot 1, uses a coordinate that rounds through `60.0`
  minutes, repeats an identifier at two route positions, mixes JSON numbers
  with numeric strings, and includes unmatched procedure and unknown-type rows
  that must fail closed to ineligible.
- Focused rejection fixtures cover malformed numeric values, empty sections,
  missing required fields, and omitted, null, or empty flight numbers.
