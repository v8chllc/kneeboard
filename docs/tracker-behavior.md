# Tracker behavior

This document defines the MVP domain language and behavior independently of UI
and database implementation.

## Route scope

The tracker uses only the primary origin-to-destination navlog in route order.
Alternate routing and ETOPS diversion routing are not included.

Every point in the selected navlog is displayed, including points that cannot
receive an INS slot.

## Displayed data

Each navlog row shows:

- identifier;
- latitude and longitude in the OFP's LIDO format;
- `DIS`; and
- `RDIS`.

For eligible fixes, the row also shows keypad-ready latitude and longitude with
greater visual prominence than the LIDO reference values.

In a LIDO navlog:

- `DIS` is the distance of the leg from the preceding navlog point into the
  current row.
- `RDIS` is the remaining route distance from the current row to the
  destination.
- Distances are nautical miles.

## Slot eligibility

Eligible points:

- named enroute route fixes;
- coordinate-defined oceanic route fixes such as `52N040W`;
- SID fixes, by default; and
- STAR fixes, by default.

Always excluded from slot assignment:

- origin, destination, and other airport points; and
- computed or informational points such as top of climb, top of descent, or FIR
  boundary markers.

Excluded points remain visible and read-only. They have no memory slot and omit
keypad-ready coordinates so the interface does not suggest that they should be
entered.

Before the first waypoint is saved, the user may exclude:

- SID fixes;
- STAR fixes; or
- both SID and STAR fixes.

These controls default to including both procedures. Changing them recalculates
slots and pages. The controls lock permanently for that tracker after its first
Save action.

## Coordinate presentation

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

Keypad values are derived, read-only data. The MVP provides no coordinate-edit
override.

## Memory slots

Memory slots repeat from 1 through 9.

- At tracker creation, the first nine eligible fixes are `pending` and have
  active slot assignments 1–9.
- Later eligible fixes are `queued` and display their expected repeating slot
  number.
- An excluded or skipped point consumes no slot.
- A released slot is assigned immediately to the next queued fix.
- A newly assigned fix becomes `pending`; it does not become `saved`
  automatically.
- Saving records that the waypoint was entered into all INS units in the
  aircraft. There is no per-unit status.

Only the earliest pending fix in route order can be saved. This enforces
route-order entry while still allowing multiple fixes to remain saved and active
in INS memory.

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

The fix has been removed from the active INS sequence and its slot has been
released. Passed is terminal.

### Skipped

The fix will not be entered, consumes no slot, and causes all following slot and
page assignments to recalculate immediately. Skipped is terminal for MVP.

## Passing and bypassed waypoints

Any saved waypoint may be marked passed.

Passing a saved waypoint atomically:

1. marks that waypoint passed;
2. marks every earlier saved-but-unpassed waypoint passed;
3. releases all affected slots;
4. promotes the next queued fixes immediately; and
5. recalculates pages and the active page.

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

## Active page

- Before any waypoint has been saved, page 1 is active.
- Once waypoints are saved, the active page is the page containing the earliest
  saved waypoint that is still awaiting Pass.
- The UI automatically navigates when the active page changes.
- Manual browsing does not change tracker state.

The fallback active-page rule for the rare state where no saved waypoint remains
but later pending waypoints exist should be finalized in implementation
planning.

## Domain implementation direction

The domain is event-like but not event sourced.

Typed commands such as Save, Pass, and Skip are applied through a pure,
deterministic transition engine. The engine:

- validates preconditions and route-order invariants;
- computes cascade effects;
- recalculates slot assignments and pages; and
- returns the next complete tracker snapshot.

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
- immediate promotion into released slots;
- SID/STAR inclusion and exclusion before first Save;
- locked procedure controls after first Save;
- excluded rows before slot 1, after slot 9, and after the final assigned fix;
- active-page movement;
- coordinate rounding, degree rollover, and all hemispheres; and
- deterministic recalculation from the same input snapshot and command.

## References

- [SimBrief staff explanation that fix details describe the preceding leg](https://forum.navigraph.com/t/departure-airport-in-navlog/19556/2)
- [iniBuilds L-1011 aircraft manual thread](https://forum.inibuilds.com/topic/35986-aircraft-manual-tristar-airliner/)
