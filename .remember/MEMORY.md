# Memory

<!-- This file is read by Codex at the start of every session.         -->
<!-- Use $remember to record entries, or edit directly.                  -->
<!-- Types: entity | decision | error | context | preference | todo      -->

## entity

## decision

<!-- decision -->
Decision: Replace the "active page" concept with a "sliding window" representing current INS unit contents
Date: 2026-07-28
Rationale: Pages are a static partition of the eligible sequence by index, so they can never track the unit's contents, which slide forward one fix at a time and straddle page boundaries. The window is the nine most recently saved fixes, drawn inline in navlog sequence as a bracket. Membership changes only on Save, because entering a waypoint overwrites a slot while passing one erases nothing. This also dissolved the open no-saved-fallback decision: the window is non-empty from the first Save onward
Do not reverse: Pages remain as display grouping over the always-visible complete navlog; reverting would reintroduce a fallback rule that has no correct answer

<!-- decision -->
Decision: Defer INS slot release by one Pass, so the most recently passed fix keeps its slot
Date: 2026-07-28
Rationale: The most recently passed fix is the FROM waypoint of the active leg. Overwriting it would destroy the leg, so a slot is free only when it has never been written or holds a passed fix that is not the most recent one. Pending fixes are the next eligible unsaved fixes with a free slot, which means steady cruise usually has exactly one pending fix, lagging one Pass behind, and zero-pending states are normal rather than stuck
Do not reverse: The superseded rule released a slot immediately on Pass, which would let a user overwrite the active leg's FROM waypoint

<!-- decision -->
Decision: Persist the tracker as an aggregate, not relational waypoint rows
Date: 2026-07-28
Rationale: The tracker is read and transitioned as one domain object, so a single-row compare-and-swap update is atomic without a multi-row transaction, and no slot, page, or sliding-window rule leaks into SQL. Shape is ofp_load for indexed metadata, a separate ofp_raw table so large payloads are never touched by the recent-loads query, and a tracker row holding navlog, snapshot, and version. Navlog and snapshot share the tracker row because Postgres rewrites the row on update anyway
Do not reverse: Relational rows would make cascading Pass and Skip renumbering multi-row operations and invite duplicating domain rules in SQL

<!-- decision -->
Decision: Cap SimBrief Pilot ID input at 16 digits
Date: 2026-07-28
Rationale: Real IDs are currently six digits. 16 never rejects a real ID while still bounding input. Validated as ^\d{1,16}$, leading zeros preserved, stored as a string. Documented as a Kneeboard input limit because SimBrief publishes no maximum

<!-- decision -->
Decision: Add a 30-second per-account cooldown to the authenticated OFP load endpoint
Date: 2026-07-28
Rationale: Per-action idempotency and a disabled button stop double-submits but not repeated deliberate clicks, each of which is a new action that would hit SimBrief. A last_load_at column checked server-side needs no new dependency and sits well below the real workflow cadence of generating in SimBrief then loading. Idempotency-key replays bypass the cooldown and return the existing tracker; a cooldown rejection reports remaining wait and does not create a failed load

## context

<!-- context -->
Status: Steps 1 through 3 of docs/task-list.md complete; next is step 4, the framework-independent domain layer
In progress: Nothing in code. The wireframe at docs/prototypes/tracker-wireframe.html is reviewed and accepted, and its display decisions are recorded under "Row display" in docs/product-decisions.md
Blocked: Nothing. The two remaining planning-status items, test infrastructure and version pinning, are deliberately deferred to the steps that need them. Phone layout refinement is deferred to the responsive work in section 9
Next: Build domain types, coordinate conversion, classification, slot and page assignment, and the pure transition engine with Vitest coverage
Updated: 2026-07-28

## error

## preference

## todo

<!-- todo -->
Todo: Obtain sanitized representative SimBrief LIDO fixtures
Source: user
Status: done
Next action: None. All seven scenarios captured, sanitized into tracked fixtures under tests/fixtures/simbrief, and supplemented with synthetic edge-case variants. Raw captures and their scenario mapping remain in the ignored .local/simbrief/ directory
Created: 2026-07-24
Work item:

<!-- todo -->
Todo: Resolve the remaining open implementation-planning decisions in docs/planning-status.md
Source: docs/task-list.md section 2
Status: open
Next action: Decide persistence shape, Pilot ID length cap, and SimBrief load protection. Defer test infrastructure and version pinning to their own steps. The active-page decision was resolved on 2026-07-28 by replacing it with the sliding window
Created: 2026-07-28
Work item:
