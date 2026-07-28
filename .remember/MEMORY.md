# Memory

<!-- This file is read by Claude at the start of every session.        -->
<!-- Use /remember to record entries, or edit directly.                 -->
<!-- Types: entity | decision | error | context | preference | todo     -->

## entity

<!-- entity -->
Entity: tracker-wireframe.html
Type: Module
Location: docs/prototypes/tracker-wireframe.html
Purpose: Static reference drawing of the navlog, waypoint states, and sliding window across six fixture-derived scenarios
Dependencies: none
Notes: Throwaway. Plain HTML and CSS, no JavaScript or build step. Rows are transcribed from tests/fixtures/simbrief and were verified programmatically against the fixture JSON. Not carried into application code

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

<!-- decision -->
Decision: Validate the tracker display model with a throwaway static wireframe before writing domain code
Date: 2026-07-28
Rationale: Two domain-model corrections in one session came from visual reasoning — that pages cannot track unit contents, and that passing a fix cannot free its slot. Both would have been expensive to discover after the transition engine and its tests existed. The wireframe needs no domain code, so the cheapest moment to look at the model is before anything depends on it
Do not reverse: The wireframe is a reference drawing under docs/prototypes and is deliberately not carried into application code

## context

<!-- context -->
Status: Steps 1 through 3 of docs/task-list.md complete; next is step 4, the framework-independent domain layer
In progress: Nothing in code. Planning docs through step 3 are committed and pushed to origin/main at b24c5ac
Blocked: Repository is being transferred from a personal GitHub account to a business organization account. Re-clone before further work; the current local checkout points at the old remote. After transfer, main is protected and code work moves to feature branches and pull requests
Next: Confirm the authoritative clone path, then build domain types, coordinate conversion, classification, slot and page assignment, and the pure transition engine with Vitest coverage
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
Status: done
Next action: None. Persistence shape, Pilot ID cap, and load protection were decided on 2026-07-28. Test infrastructure and version pinning were moved into task-list sections 9 and 5, which resolve them
Created: 2026-07-28
Work item:

<!-- todo -->
Todo: Re-clone the repository after the transfer to the business organization account
Source: user
Status: open
Next action: Confirm the new remote and the authoritative local path, then verify main is protected and that the feature-branch plus pull-request flow works via gh
Created: 2026-07-28
Work item:

<!-- todo -->
Todo: Decide the domain layer's location before writing section 4 code
Source: conversation
Status: open
Next action: Choose whether the framework-independent domain layer gets its own directory and package.json now, or waits to be slotted into the Next.js tree during scaffolding in section 5
Created: 2026-07-28
Work item:
