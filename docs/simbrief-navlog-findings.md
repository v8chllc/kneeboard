# SimBrief navlog findings

Observed structure of the SimBrief LIDO JSON navlog, recorded from real captures
during fixture acquisition. This document reports evidence. It does not resolve
the open decisions in [planning status](planning-status.md); where a rule is
recommended rather than confirmed, that is stated explicitly.

Raw captures live in the ignored `.local/simbrief/` directory and are catalogued
in the local manifest written alongside them. The findings below come from three
accepted captures:

| Scenario | Route | Navlog entries | Notes |
| --- | --- | --- | --- |
| Normal domestic | KATL–KORD | 24 | VARNM2 SID, VEECK5 STAR |
| Long multi-page | KLAX–KJFK | 42 | 39 eligible, 5 pages, 4 VORs |
| Oceanic | KBOS–EGLL | 27 | NAT track W, alternate EGCC retained |

## Navlog location and shape

The primary route is `navlog.fix`, an ordered array. Alternate routing appears
separately under `alternate_navlog`, and ETOPS data under `etops`. Selecting
`navlog.fix` alone satisfies the primary-route-only rule in
[tracker behavior](tracker-behavior.md).

Each fix carries roughly forty fields. Those relevant to the tracker are:

- `ident` — the displayed identifier.
- `name` — a descriptive name. For most fixes this differs from `ident`.
- `type` — classification token. Observed values: `wpt`, `vor`, `ltlg`, `apt`.
- `stage` — `CLB`, `CRZ`, or `DSC`.
- `is_sid_star` — `0` or `1`.
- `via_airway` — the airway or procedure used to reach this fix.
- `pos_lat`, `pos_long` — position.
- `distance` — leg distance into this fix.
- `fir_crossing` — FIR entry data, when the leg crosses a boundary.

## Coordinate representation

`pos_lat` and `pos_long` are **signed decimal degrees**, not LIDO
degrees-minutes strings. Negative longitude is west; negative latitude is south.
The NAT track fixes make this unambiguous because their identifiers already
disclose their positions:

```
52N050W   pos_lat=52.000000   pos_long=-50.000000
55N040W   pos_lat=55.000000   pos_long=-40.000000
```

Both displayed representations must therefore be derived from this single signed
decimal source: the keypad-ready value and the LIDO-formatted reference value
alike. The payload supplies neither directly. [Tracker
behavior](tracker-behavior.md) has been reworded to match.

## Classification evidence

### Airports

Only the destination appears in the navlog, with `type: "apt"`. **The origin
airport is absent from `navlog.fix` in all three captures.** Each navlog begins
at the first SID or enroute fix.

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

**Recommended rule, pending confirmation:** treat an `ltlg` fix as slot-eligible
only when its identifier matches a coordinate pattern. An allowlist fails safe,
because an unseen computed point — an equal-time point, for example — would
default to ineligible rather than silently consuming a slot. A blocklist of
`TOC` and `TOD` fails open and is not recommended.

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

Separating SID from STAR requires `is_sid_star == 1` **and** a `via_airway` match
against the procedure name, with SID and STAR distinguished by which end of
`general.route` the procedure name occupies.

`is_sid_star` is unreliable on computed points. Across three captures, TOC and
TOD carried three different flag patterns. Computed points must never be
identified by that flag.

### VOR fixes

`type: "vor"` appears on the enroute portion and also inside procedures — `BNN`
sits within the EGLL arrival with `sid_star=1`. Excluding STAR fixes therefore
also drops that VOR. The two controls interact.

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
   `general.route_distance` in all three captures — 625, 2258, and 2901 nautical
   miles — so that total serves as a cross-check. `general.air_distance` is a
   great-circle measurement (687, 2080, 2595) and must not be used.

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
- **Numeric values arrive as strings.** Coordinates inside `fir_crossing` are
  quoted (`"pos_lat_entry": "44.94289"`) while top-level `pos_lat` is numeric.
  Do not assume consistent numeric typing across the payload.

## Cases no real capture produced

These belong in synthetic fixtures, as anticipated by the [task
list](task-list.md):

- An excluded point falling exactly between one page's slot 9 and the next
  page's slot 1. All three captures placed excluded points mid-page.
- Coordinate rounding that carries `60.0` minutes into the next degree.
- Southern and eastern hemisphere coordinates, until that capture is taken.
