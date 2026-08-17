# Memory

<!-- This file is read by Codex at the start of every session.         -->
<!-- Use $remember to record entries, or edit directly.                -->
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

<!-- decision -->
Decision: Keep the build execution strategy surface-neutral, naming required capabilities rather than an agent product
Date: 2026-08-12
Rationale: The draft was written against Codex and asked which Codex surface would host the build, which would have gone stale faster than the requirements it served. The document now names five capabilities a surface must provide — bounded read-only delegation, isolated concurrent writes, running the canonical commands, durable in-repo progress, and an independent review pass — and the kickoff prompt names the surface actually in use
Do not reverse: A surface-specific strategy would need rewriting whenever the tooling changes, and the requirements would drift during the rewrite

<!-- decision -->
Decision: One pull request per numbered task-list section, one conventional commit per slice
Date: 2026-08-12
Rationale: Matches the protected-main workflow adopted after the org transfer. Section-sized diffs are coherent enough to review as a unit and small enough to actually read, while per-slice commits make the pull request an ordered sequence rather than one opaque diff. A section may split across two pull requests, but a pull request never spans two sections
Do not reverse: No build goal commits directly to main

<!-- decision -->
Decision: CodeRabbit is the mandatory independent review gate on every section pull request, governed by a committed .coderabbit.yaml
Date: 2026-08-13
Rationale: Step 7 of the slice lifecycle has the agent inspect its own diff, which catches mechanical problems but shares the blind spots of whatever wrote the code. The gate is the check that does not share them. CodeRabbit is already integrated with the repository, so it replaced the multi-agent consensus review originally drafted. Every finding is triaged; accepted findings are fixed and the affected gates re-run; accepting as-is requires a recorded reason in the pull request
Do not reverse: No review runs on CodeRabbit's default profile

<!-- decision -->
Decision: Interactive bounded goals through task-list sections 4 and 5; a capped loop permitted from section 6 with a three-slice ceiling
Date: 2026-08-13
Rationale: Sections 4 and 5 establish the canonical quality commands and the domain invariants, so an unattended error there is the most expensive kind. A permitted loop stops hard at the section boundary, honors every stop condition, may push its own branch, and may never open a pull request, merge, or deploy. Graduation is the user's call at the section 5 pull request
Do not reverse: A loop that could merge or deploy would convert a wrong turn into a production event

<!-- decision -->
Decision: Permit a user-authorized read-only manager to supervise routine build checkpoints while one persistent primary build agent remains the sole writer and integrator
Date: 2026-08-13
Rationale: Requiring the user to manually approve every routine checkpoint prevents unattended coordination but does not require human judgment for evidence-backed continuation. The manager may approve bounded continuation, request in-scope repairs, and evaluate validation evidence. Product and architecture choices, governing conflicts, weakened boundaries, exceptional parallel writing, merges, production operations, and graduation to capped loops remain with the human sponsor
Do not reverse: Treating the manager as another implementation agent would violate the single-writer model; treating it as the human sponsor would improperly transfer product and production authority

<!-- decision -->
Decision: Preserve reusable issue-build prompts in an ignored project-local journal under .local/prompts/
Date: 2026-08-13
Rationale: Prompts should remain adjacent to the repository for study and iteration without becoming product artifacts or cluttering version history. Each entry preserves the verbatim prompt, execution metadata, result, deviations, and lessons

<!-- decision -->
Decision: A manager pushes the section branch, opens its pull request ready for review, runs the review gate to completion, and checkpoints at merge-ready
Date: 2026-08-17
Rationale: The old default required explicit kickoff authorization for the push and put the human handoff mid-sequence, where it bought no new information — the same diff gets read one step later, after review findings have changed it. Push and pull-request open are reversible and approve nothing, while merge, deployment, and every production operation stay with the user. The old default also inverted the supervision gradient, since a capped loop was already permitted to push its own branch. Merge-ready is defined as CI green on the current head, a completed review of that head, every finding dispositioned, and accepted-as-is findings satisfying the citation rules, bounded by three review cycles. Merged as PR #14 at bb698ba
Do not reverse: A draft-pull-request variant was tried and abandoned. It made the user read a diff CodeRabbit was about to change, so the same diff got read twice, and it reintroduced the mid-sequence handoff the amendment existed to remove

<!-- decision -->
Decision: A review finding is accepted as-is only against a governing citation verified by a bounded read-only subagent, never by the manager alone
Date: 2026-08-17
Rationale: Letting the manager run the review gate to completion means it triages findings against work it supervised. The old test asked whether acceptance "would weaken a boundary" — a judgment that invites the answer the judge prefers. Acceptance now requires citing the governing document and passage that already sanctions the behavior; no citation means fix or escalate. Safety, privacy, authorization, and test findings are never accepted as-is regardless of citation. The citation is checked by a bounded read-only subagent with no stake in the outcome
Do not reverse: The subagent prompt is fixed in docs/build-execution-strategy.md rather than authored per finding, because a leading prompt gets a leading answer and that failure is invisible in the output. A skipped or reworded check is itself a reportable deviation, since the cheapest way around the control is never to invoke it

## context

<!-- context -->
Status: Section 4 complete and merged; section 5, the framework-independent domain layer, is next
In progress: Nothing in flight. main is clean at bb698ba with no open pull requests. PRs #10 (memory fast-track), #13 (manual CodeRabbit invocation), and #14 (section-boundary push policy and review-gate completion) are merged
Next: Rebuild the section 5 manager kickoff prompt from the amended template in docs/build-execution-strategy.md — push, pull-request open, description authorship, and gate completion are now documented defaults rather than hand-written authorizations. Then build src/domain/: types and typed commands, coordinate conversion, waypoint classification, slot and page assignment, and the pure transition engine with unit tests. The open loop-eligibility todo comes due at the section 5 pull request
Updated: 2026-08-17

## error

<!-- error -->
Symptom: Assumed a pull request introducing .coderabbit.yaml would be reviewed on CodeRabbit's default profile, because the config had not reached main yet
Root cause: CodeRabbit reads .coderabbit.yaml from the feature branch under review, not from the base branch, so it governs the pull request that introduces it
Fix: Land config changes on the branch that needs them; verify against CodeRabbit's published schema.v2.json rather than by eye
Status: resolved

<!-- error -->
Symptom: Auto-review did not fire on a non-draft pull request, and later a fix commit received only a verification comment rather than a review
Root cause: Two separate CodeRabbit behaviors. Auto-review can silently fail to fire, plausibly during a GitHub outage, and silence is indistinguishable from a pass. Separately, CodeRabbit is incremental and does not re-review commits it has already seen, so a fix commit pushed to a reviewed pull request gets targeted verification of the fixes rather than a fresh review that could surface newly introduced issues
Fix: Confirm a review actually completed rather than inferring it from configuration. Invoke manually by commenting @coderabbitai review; if that also produces nothing the gate is unavailable, so stop and report rather than merging. For a fix commit, name the gate of record as the original review plus the verification, or force a full review when the delta warrants it
Status: resolved

## preference

<!-- preference -->
Preference: Concise responses — answer what was asked without meandering preamble or trailing recaps
Scope: global

<!-- preference -->
Preference: Decide routine open questions and state the default for override, or ask directly — do not re-raise the same unresolved question at the end of every turn
Scope: global

<!-- preference -->
Preference: Use the authenticated `gh` CLI directly for GitHub operations; do not try the connected GitHub app first because it is consistently unconnected across sessions
Scope: github tooling

## todo

<!-- todo -->
Todo: Revisit the loop-eligibility threshold at the section 5 pull request
Source: conversation
Status: open
Next action: Compare the approved "from section 6 onward" cut against cutting by kind of work — sections 6 to 8 carry persistence, account isolation, and vertical-slice product judgment, while section 9 is the mechanical work
Created: 2026-08-13
Work item:
