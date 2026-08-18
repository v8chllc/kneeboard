# Tracker behavior

This document defines the MVP domain language and behavior independently of UI
and database implementation.

## Route scope

The tracker uses only the primary origin-to-destination navlog in route order.
Alternate routing and ETOPS diversion routing are not included.

Every point in the selected navlog is displayed, including points that cannot
receive an INS slot.

The origin airport is not one of those points. Each navlog row's data describes
the leg preceding it, and no leg precedes the origin, so the OFP navlog begins at
the first departure or enroute fix. The tracker synthesizes a leading origin row
from the OFP's separate origin data. That row is display-only: it is never
slot-eligible, and it has no `DIS` because no preceding leg exists.

## Displayed data

Each navlog row shows:

- identifier;
- latitude and longitude in LIDO reference format;
- `DIS`; and
- `RDIS`.

For eligible fixes, the row also shows keypad-ready latitude and longitude with
greater visual prominence than the LIDO reference values.

In a LIDO navlog:

- `DIS` is the distance of the leg from the preceding navlog point into the
  current row. The synthesized origin row has no `DIS`.
- `RDIS` is the remaining route distance from the current row to the
  destination.
- Distances are nautical miles.

The OFP supplies leg distance directly but has no remaining-distance field, so
`RDIS` is derived by summing the leg distances of all rows after the current one.
This yields zero at the destination by construction and depends on no data
outside the navlog itself. The OFP's own route-distance total is a cross-check
only; its great-circle air distance is a different measurement and must not be
used.

## Slot eligibility

Eligible points:

- named enroute route fixes;
- coordinate-defined oceanic route fixes such as `52N040W`;
- SID fixes, by default; and
- STAR fixes, by default.

Always excluded from slot assignment:

- origin, destination, and other airport points; and
- computed or informational points such as top of climb and top of descent.

The second category is deliberately open-ended. Classification must treat an
unrecognized computed point as ineligible rather than granting it a slot.

Classification follows this fail-closed order after boundary fields have been
validated and normalized:

1. A row with source type `apt` is an airport and is ineligible.
2. A row with source type `ltlg` is eligible only when its identifier matches
   the anchored coordinate pattern `^\d{2}[NS]\d{3}[EW]$`. Every other `ltlg`
   row is computed or informational and is ineligible.
3. A `wpt` or `vor` row is a SID or STAR fix only when its normalized
   `is_sid_star` flag is true and its inbound `via_airway` exactly matches one
   of the OFP's dedicated `sid_ident` or `star_ident` values. Airport and `ltlg`
   classification takes precedence because those rows may also carry the flag.
4. A flagged `wpt` or `vor` row that does not match exactly one dedicated
   procedure identifier is ambiguous and ineligible.
5. Every remaining `wpt` or `vor` row is a named enroute fix and is eligible.
6. An unrecognized source type is ineligible.

Excluded points remain visible and read-only. They have no memory slot and omit
keypad-ready coordinates so the interface does not suggest that they should be
entered.

Before the first waypoint is saved, the user may exclude:

- SID fixes;
- STAR fixes; or
- both SID and STAR fixes.

These controls default to including both procedures. Changing them recalculates
slots and pages. The controls lock permanently for that tracker after its first
Save action. Each inclusion change is a typed tracker command applied through
the same pure transition engine and expected-version persistence path as Save,
Pass, and Skip.

## Coordinate presentation

The OFP supplies each position as signed decimal degrees, where negative
latitude is south and negative longitude is west. It does not supply a
preformatted coordinate string. Both displayed representations are therefore
derived from that single source.

Eligible fixes display both representations together:

1. Keypad-ready values are primary.
2. LIDO-formatted coordinates are secondary reference values.

The modeled entry formats are:

- latitude hemisphere plus five digits: degrees, minutes, and tenths of a
  minute; and
- longitude hemisphere plus six digits: degrees, minutes, and tenths of a
  minute.

Examples:

- LIDO `N05°23.5'` becomes `N 05235`.
- LIDO `W006°32.7'` becomes `W 006327`.

When source coordinates have greater precision, conversion rounds to the nearest
tenth of a minute. Conversion must correctly carry `60.0` minutes into the next
degree and preserve the correct hemisphere at boundary cases.

The hemisphere is determined after rounding and after any carry, from the
rounded value. A value whose magnitude rounds to zero lies on the meridian or
the equator regardless of the sign of its input.

Kneeboard follows ARINC 424 at those boundaries:

- `E` is entered for longitudes falling on the `0` or `180` degree meridians
  (§5.37), so the longitude range is `(-180, +180]` and a west longitude that
  carries onto the 180th meridian renders as `E`.
- `N` is entered for latitudes falling on the equator (§5.36).

This diverges deliberately from ISO 6709 §6.5(b) and §6.5(c), which render the
180th meridian as `W` over the range `[-180, +180)`. ARINC 424 is the format the
navigation databases the pilot cross-checks are built from, including the LIDO
OFPs Kneeboard consumes, so its convention governs here.

Both displayed representations are derived, read-only data. The MVP provides no
coordinate-edit override.

## Memory slots

Memory slots repeat from 1 through 9.

Every eligible fix carries a slot number derived from its position in the
eligible sequence: `slot = ((eligible index - 1) mod 9) + 1`. The number is
displayed for every eligible fix regardless of state, so the same slot number
appears once per page of the route.

Only Skip and the SID/STAR inclusion controls change eligibility, so only those
operations renumber slots and rebuild pages. Save and Pass never renumber.
Because Save is route-ordered, every skip occurs later in the route than every
entered fix, so renumbering can never disturb a fix already entered into the
unit.

### Slot availability

A slot is `free` when either:

- it has never been written; or
- it holds a passed fix that is not the most recently passed fix.

The most recently passed fix is the FROM waypoint of the active leg. Its slot
stays occupied because overwriting it would destroy the active leg. Passing a
fix therefore does not release its slot immediately; the release is deferred
until a later fix is passed.

- At tracker creation no slot has been written, so all nine are free and the
  first nine eligible fixes are `pending`.
- Later eligible fixes are `queued` and display their expected repeating slot
  number.
- An excluded or skipped point consumes no slot.
- `pending` fixes are the next eligible unsaved fixes for which a free slot
  exists. A newly promoted fix becomes `pending`; it never becomes `saved`
  automatically.
- Saving records that the waypoint was entered into all INS units in the
  aircraft. There is no per-unit status. Saving overwrites the free slot and
  evicts whatever that slot previously held.

Only the earliest pending fix in route order can be saved. This enforces
route-order entry while still allowing multiple fixes to remain saved and active
in INS memory.

States with no pending fix are normal, not stuck. They occur whenever every free
slot has been filled and the next slot cannot be released until another fix is
passed. In steady cruise exactly one fix is usually pending, lagging one Pass
behind. A navlog with nine or fewer eligible fixes never queues anything, so it
has no pending fixes once all of them are saved.

MVP assumes a contiguous active leg. Non-contiguous legs, such as a direct-to
that bypasses intermediate slots, are deferred.

## State model

```text
queued  ────────> pending ────────> saved ────────> passed
   │                 │
   └────> skipped <──┘
```

### Queued

A future eligible fix awaiting an active memory slot. It shows its expected slot
number and may be skipped.

### Pending

An eligible fix with an active slot assignment, awaiting manual entry into the
aircraft INS. It may be saved when it is the earliest pending fix, or skipped.

### Saved

The user has recorded the fix as entered into all modeled INS units. It remains
active until passed.

### Passed

The fix has been removed from the active INS sequence. It remains in its slot,
and therefore inside the sliding window, until a later Save overwrites it. Its
slot becomes free only once a later fix has been passed. Passed is terminal.

### Skipped

The fix will not be entered, consumes no slot, and causes all following slot and
page assignments to recalculate immediately. Skipped is terminal for MVP.

## Passing and bypassed waypoints

Any saved waypoint may be marked passed.

Passing a saved waypoint atomically:

1. marks that waypoint passed;
2. marks every earlier saved-but-unpassed waypoint passed;
3. frees every affected slot except the one holding the newly passed waypoint,
   which anchors the active leg;
4. promotes the next queued fixes into the freed slots immediately; and
5. recalculates pending and queued state.

A cascade therefore frees several slots at once and can promote several fixes to
`pending` together, which is what the direct-to case requires. A single Pass
frees at most one slot.

This is a deliberate operational convention for the simulator workflow.
“Passed” means removed from the active INS sequence; it does not necessarily mean
the aircraft physically overflew the fix.

For example, if ATC clears the aircraft directly to a later saved fix and
bypasses intermediate saved fixes, the pilot marks the later fix passed.
Kneeboard then passes all earlier unpassed fixes as a side effect. A saved
waypoint is never changed to `skipped`; bypassed saved waypoints are handled
through Pass.

This behavior has operational implications and must be explained prominently in
the tracker UI.

## Page construction

Pages are based on consecutive groups of nine eligible slot assignments, not a
fixed number of displayed rows. Excluded points are included on the appropriate
page without consuming slots.

Rules:

1. Page 1 begins at the start of the navlog. It includes the excluded origin and
   every other excluded point before the fix assigned to slot 1.
2. A normal page includes the eligible fixes assigned slots 1 through 9.
3. Excluded points between a page's slot 9 and the next page's slot 1 are
   appended to the page ending at slot 9. They are never prepended to the next
   page.
4. The next page begins exactly with its slot 1 fix.
5. The last page includes every excluded point after the final slot-assigned
   fix.
6. Skips and pre-start SID/STAR exclusions rebuild page membership while
   preserving original navlog order.

The placement rule in item 3 is important: excluded points at a page boundary
belong to the preceding slot page.

## Sliding window

Pages group the route for display. The sliding window is a separate concept: it
represents the current data state of the INS unit.

- The window contains exactly the fixes currently written into the unit's nine
  slots.
- Its members are always `saved` or `passed`, never `pending` or `queued`.
- It holds between one and nine members. It grows during initial entry and holds
  nine members from the first overwrite onward.
- It is not shown before the first Save, because the unit holds no data yet.
- Membership changes only on Save. Saving writes a fix into a free slot and
  evicts that slot's previous occupant. Pass never changes membership.

The window is rendered inline, in navlog sequence rather than slot sequence, as
a bracket spanning consecutive rows from the oldest resident member to the
newest. Skipped and slot-ineligible rows may fall inside the bracket without
being members.

Equivalently, the window is the set of the nine most recently saved fixes.

Manual browsing does not change tracker state.

### Worked example

Nine eligible fixes are saved into slots 1–9, then the first two are passed.

- The window still brackets WP1–WP9. Pass changed no membership.
- WP2 is the most recently passed fix and anchors leg WP2→WP3, so slot 2 stays
  occupied. Only slot 1 is free.
- WP10 is `pending` in slot 1. Nothing else is pending.
- Saving WP10 overwrites WP1. The window now brackets WP2–WP10.

If instead WP10 is skipped, the eligible sequence renumbers so WP11 takes
slot 1. Saving WP11 overwrites WP1 and the window brackets WP2–WP11, with the
skipped WP10 falling inside the bracket while holding no slot.

## Domain implementation direction

The domain is event-like but not event sourced.

Typed commands such as Save, Pass, and Skip are applied through a pure,
deterministic transition engine. The engine:

- validates preconditions and route-order invariants;
- computes cascade effects;
- recalculates slot assignments and pages; and
- returns the next complete tracker snapshot.

The domain also exposes a pure Pass preview that returns the exact ordered set
of fixes a Pass command would mark passed. The cascade-confirmation UI consumes
that result rather than recreating the cascade rule. The eventual command still
revalidates against its expected snapshot version, so a preview never grants
authority to mutate stale state.

The resulting snapshot is persisted atomically. No event stream or visible
history is retained.

## Required domain test cases

The lean Vitest suite should prioritize:

- first and later groups of nine slots;
- skipping queued and pending fixes;
- terminal states and invalid transitions;
- route-order Save enforcement;
- passing one fix;
- cascading Pass across several saved fixes;
- deferred slot release, including that passing one fix frees no slot until a
  later fix is passed;
- promotion into freed slots, including multiple promotions from one cascade;
- states with no pending fix, both in cruise and for navlogs of nine or fewer
  eligible fixes;
- SID/STAR inclusion and exclusion before first Save;
- locked procedure controls after first Save;
- excluded rows before slot 1, after slot 9, and after the final assigned fix;
- sliding window membership, growth to nine, eviction on Save, and invariance
  under Pass;
- sliding window brackets spanning skipped and ineligible rows;
- slot renumbering on Skip, including that it never disturbs an entered fix;
- coordinate rounding, degree rollover, and all hemispheres; and
- deterministic recalculation from the same input snapshot and command.

## References

- [SimBrief staff explanation that fix details describe the preceding leg](https://forum.navigraph.com/t/departure-airport-in-navlog/19556/2)
- [iniBuilds L-1011 aircraft manual thread](https://forum.inibuilds.com/topic/35986-aircraft-manual-tristar-airliner/)
