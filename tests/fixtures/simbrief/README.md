# Sanitized SimBrief fixtures

These fixed JSON documents model the small upstream boundary consumed by the
Kneeboard parser. Automated tests must use these tracked fixtures and must never
contact live SimBrief.

| Fixture | Expected result | Coverage |
| --- | --- | --- |
| `valid-domestic.json` | Accept | SID, STAR, named enroute, computed, and destination rows |
| `valid-multi-page.json` | Accept | 39 eligible fixes across repeated slot groups |
| `valid-oceanic.json` | Accept | Coordinate fixes plus ignored alternate/ETOPS decoys |
| `valid-southern-eastern.json` | Accept | Southern latitude and eastern longitude parsing |
| `valid-sparse-identity.json` | Accept | Blank airline and `N101SB` registration substitution |
| `valid-exactly-nine.json` | Accept | Exactly one complete group of nine eligible fixes |
| `valid-ten-boundary-cases.json` | Accept | Slot 9/page 2 boundary, coordinate rollover, mixed numeric tokens, repeated identifiers, and fail-closed classification |
| `invalid-missing-detailed-navlog.json` | Reject | LIDO payload with `navlog.fix` absent |
| `invalid-non-lido.json` | Reject | Populated DAL-layout navlog |
| `invalid-malformed-numeric-values.json` | Reject | Invalid numeric syntax, ranges, and procedure flag |
| `invalid-empty-sections.json` | Reject | Empty required objects and empty `navlog.fix` array |
| `invalid-missing-required-fields.json` | Reject | Omitted metadata, position, distance, and flight-number fields |
| `invalid-null-flight-number.json` | Reject | Null flight number and a bare-object `navlog.fix` boundary shape |
| `invalid-empty-flight-number.json` | Reject | Empty flight number and a bare-object `navlog.fix` boundary shape |

## Sanitization boundary

The fixtures preserve public route and procedure identifiers needed for
classification. All ordinary positions, distances, generation timestamps, and
flight numbers are deterministic synthetic values. Coordinate-defined fix
positions are derived from their identifiers so those rows remain internally
consistent. `N101SB` is a simulator registration retained deliberately to cover
SimBrief's observed flight-number substitution.

Only approved parser fields are retained. Pilot IDs, account identifiers,
request identifiers, crew data, URLs, weather, NOTAMs, maps, and other raw OFP
sections are excluded. The oceanic fixture contains explicit sanitized decoys
under `alternate_navlog` and `etops` to verify primary-route-only selection.

## Fixture provenance and regeneration

Captured-route fixtures are generated only from ignored captures under
`.local/simbrief/` using `scripts/sanitize_simbrief_fixture.py`. The script
restricts its input and output paths, allowlists fields, and replaces ordinary
coordinates and distances. Review generated files for unexpected identifiers
before committing them.

Synthetic boundary fixtures are hand-authored from the same allowlisted field
mapping. They use `TST` identities and intentionally artificial positions and
route shapes. Keep each rejection fixture focused enough that a future parser
test can identify the invalid boundary without relying on a live service.
