# Agent Guidance

## Start Here

Before planning or changing application behavior, read:

1. `README.md`
2. `../project-management/kneeboard/product-decisions.md`
3. `../project-management/kneeboard/tracker-behavior.md`
4. `../project-management/kneeboard/technical-decisions.md`
5. `../project-management/kneeboard/planning-status.md`
6. `../project-management/kneeboard/task-list.md`
7. `../project-management/kneeboard/build-execution-strategy.md`
8. `WORKFLOW_STANDARDS.md`

The project documents are in the sibling `project-management` checkout. If it
is missing, clone `git@github.com:v8chllc/project-management.git` beside this
repository before changing governed behavior.

The decision documents are the source of truth. The sibling
`project-management/kneeboard/task-list.md` records execution order but does
not override product, domain, or technical decisions.

The sibling `project-management/kneeboard/prototypes/tracker-wireframe.html` is
a throwaway reference drawing of the navlog, waypoint states, and sliding
window. Consult it to understand the intended display, but do not carry it into
application code.

Application implementation began with task-list section 4. Development tooling
and planning artifacts may already exist, so inspect the repository and working
tree before assuming a blank slate.

## Working Agreement

- Research the existing decisions, implementation, and relevant upstream
  documentation before proposing a solution.
- Present findings, options, and trade-offs before making material code or
  architecture changes.
- Keep changes small, dependency-light, and limited to the approved MVP.
- Do not silently resolve an open decision from `../project-management/kneeboard/planning-status.md`.
  Propose a choice and update the governing documentation deliberately after
  approval.
- If implementation conflicts with documented behavior, stop and surface the
  conflict rather than quietly changing behavior.
- Preserve unrelated user changes in a dirty working tree.
- Do not implement deferred features or infrastructure "for later."
- Use the authenticated `gh` CLI directly for GitHub operations in this
  repository. Do not attempt the connected GitHub app first.
- Track work on the Project Management board
  (https://github.com/orgs/v8chllc/projects/4). Work starts with a coordination
  issue in `v8chllc/project-management` on that board, and each Kneeboard change
  has a Kneeboard issue as its sub-issue. Never add a Kneeboard issue or pull
  request to the board: the parent carries the board status. The former
  Kneeboard board is closed.

## Product and Safety Boundary

Kneeboard is a home flight-simulation aid for entering SimBrief route waypoints
into CIVA/Delco Carousel IV-A and Litton LTN-72 inertial navigation systems.

Never describe, design, or test it as an approved real-world navigation tool.
Keep the simulation-only warning visible in user-facing work. Store and display
application timestamps in UTC using aviation-style formatting.

## Architecture Guardrails

- Use Next.js App Router, React, TypeScript, and Tailwind CSS.
- Prefer dependency-light custom components over a broad component framework.
- Treat external responses, persisted JSON, request payloads, and environment
  configuration as untrusted boundaries validated with Zod.
- Keep tracker rules in a framework-independent domain layer.
- Implement Save, Pass, Skip, and pre-start SID/STAR inclusion changes through
  typed commands and a pure, deterministic transition engine.
- Use a shared pure domain preview for cascading Pass confirmation; do not
  reimplement cascade selection in the UI.
- Persist complete tracker snapshots; do not introduce event sourcing or a
  visible event history.
- Use server-confirmed mutations with expected snapshot versions and
  compare-and-swap persistence. Do not implement client-side conflict merging
  for MVP.
- Keep server-side authorization checks adjacent to every account-scoped read
  and mutation.
- Keep indexed relational metadata separate from large raw OFP payloads so
  recent trackers can be queried without deserializing them.

Persistence is aggregate-shaped, not relational waypoint rows: `ofp_load` for
indexed metadata, a separate `ofp_raw` table for the complete payload, and a
`tracker` row holding the immutable navlog, the mutable snapshot, and an integer
version. Do not express slot, page, or sliding-window rules in SQL.

Representation and interpretation are separate concerns with a fixed seam.
Representation is the shape of the incoming payload — string-to-number
coercion, collapsed single-element arrays, empty sections — and is validated
with Zod at the integration boundary, in task-list section 8. Interpretation is
the fail-closed classification order, eligibility, origin-row synthesis, and
`RDIS` derivation; it is pure domain logic, owned by task-list section 5 and
already built. Section 5 owns the domain input type. Section 8's schema must
satisfy that type rather than restate it, and must not re-decide any question
interpretation has already settled.

## Domain Invariants

Consult `../project-management/kneeboard/tracker-behavior.md` before changing
tracker logic. In particular:

- Use only the primary origin-to-destination navlog, while displaying every
  point in original route order.
- Airports and computed or informational points remain visible but never consume
  INS slots.
- Eligible fixes use repeating slots 1-9, derived from position in the eligible
  sequence. Only Skip and the SID/STAR controls renumber; Save and Pass never do.
  The minimal snapshot depends on the ordering property under §Memory slots in
  `../project-management/kneeboard/tracker-behavior.md`: because Save takes the
  earliest pending fix, every
  skip after a save is downstream of that saved fix, while any skip before it is
  already reflected in the slot the fix was written into. That slot therefore
  cannot drift once written. Permitting a saved fix to be skipped, or a save out
  of route order, would silently produce wrong slots for waypoints already
  entered into the unit.
- Only the earliest pending fix may be saved.
- Skip is terminal, applies only to queued or pending fixes, consumes no slot,
  and triggers deterministic recalculation.
- Slot release is deferred by one Pass. The most recently passed fix is the
  active leg's FROM waypoint and keeps its slot. A slot is free only when it has
  never been written or holds a passed fix that is not the most recent one.
- Passing a saved fix atomically passes every earlier saved-but-unpassed fix,
  frees every affected slot except the one holding the newly passed fix,
  promotes queued fixes into the freed slots, and recalculates pending and
  queued state. Pass does not rebuild pages.
- Pending fixes are the next eligible unsaved fixes for which a free slot
  exists. States with no pending fix are normal, not stuck.
- The sliding window is the tracker's representation of current INS unit
  contents: the nine most recently saved fixes, always saved or passed, changing
  membership only on Save. It is distinct from pages, which are display
  grouping. There is no "active page"; that concept was replaced.
- SID and STAR inclusion controls lock permanently after the first Save.
- Excluded points between a page's slot 9 and the next page's slot 1 belong to
  the preceding page.
- Derived keypad coordinates are read-only and must handle rounding, degree
  rollover, and all hemispheres correctly.

Do not duplicate these rules independently in UI or persistence code. Call the
shared domain implementation.

## SimBrief Data and Privacy

- Fetch SimBrief only on the server after an authenticated user explicitly
  requests a load.
- Use a numeric Pilot ID stored as a string, capped at 16 digits and validated
  as `^\d{1,16}$` with leading zeros preserved. The cap is a Kneeboard input
  limit, not a SimBrief rule. Do not add username login, flight-generation
  APIs, or Navigraph OAuth.
- The authenticated Load endpoint enforces a 30-second per-account cooldown
  alongside per-action idempotency. Completed idempotency-key replays bypass
  the cooldown and return the existing tracker without contacting SimBrief.
- Claim the per-account cooldown atomically before contacting SimBrief. A
  different action during the interval receives the remaining cooldown; a
  same-key request returns the completed tracker or a retryable in-progress
  response and never starts another fetch. Failed attempts create no tracker
  but retain the short cooldown.
- Bound application-side SimBrief requests with an abort timeout and response
  size limit, and test timeout, oversize, non-success, and invalid-JSON paths
  without contacting the live service.
- Accept only JSON OFPs using the LIDO layout with a detailed navlog.
- Validate and normalize only fields required by the tracker; do not attempt to
  model the complete SimBrief payload.
- Treat raw OFPs, coordinates, Pilot IDs, email addresses, sessions, and
  magic-link tokens as sensitive. Never write them to logs.
- Raw development downloads belong under `.local/simbrief/` and must not be
  committed.
- Use `uv run scripts/fetch_simbrief_ofp.py <pilot-id>` to capture the latest
  generated OFP during development.
- The endpoint returns only the most recent OFP. Verify a generated route covers
  its scenario before fetching, and record each capture in
  `.local/simbrief/manifest.md`.
- Consult `../project-management/kneeboard/simbrief-navlog-findings.md` before writing parsing or
  classification code. It records observed payload structure, the evidence
  behind each classification rule, and the gaps between the payload and
  `../project-management/kneeboard/tracker-behavior.md`.
- Treat the payload as loosely typed at the boundary. SimBrief collapses
  single-element arrays into bare objects and quotes some numeric values, so
  normalize both shapes rather than assuming consistency.
- Sanitize representative OFPs before moving them into tracked fixtures.
- Automated tests must use fixed sanitized fixtures and must never contact live
  SimBrief, Resend, or production infrastructure.

## Implementation Order

Follow `../project-management/kneeboard/task-list.md` and preserve these dependencies:

The unnumbered pre-build execution gate in the sibling task list closed on
2026-08-12. `../project-management/kneeboard/build-execution-strategy.md`
is approved and governs
orchestration: one pull request per numbered section (with a section split
across two pull requests when its diff cannot be reviewed safely as one unit)
and one commit per slice, CodeRabbit as the mandatory review gate on every
section pull request, interactive bounded goals through sections 4 and 5
supervised at each checkpoint by the user or a user-authorized read-only manager,
and a capped loop permitted from section 6 after both complete cleanly. That
graduation was granted on 2026-08-20; it makes a loop available to authorize
rather than authorizing one, and section 7 is excepted and stays interactive. A
manager-supervised run keeps one persistent primary build agent as the sole
writer and integrator; human-only approval boundaries remain with the user.

1. Capture, inspect, map, and sanitize representative SimBrief fixtures.
2. Resolve the remaining implementation-planning decisions.
3. Validate the tracker display model with a throwaway static wireframe before
   domain code depends on it.
4. Establish the reproducible local development foundation, application
   scaffold, test tooling, and CI command parity.
5. Build domain types, domain interpretation of the route, coordinate
   conversion, transitions, and unit tests. Boundary normalization of the
   SimBrief payload belongs to section 8; see the representation and
   interpretation seam under Architecture Guardrails.
6. Add local and production persistence with committed migrations and explicit
   production migration procedures.
7. Establish authentication and account isolation before introducing private
   OFP data flows.
8. Deliver one authenticated vertical slice from OFP load through a working
   tracker.
9. Complete responsive UI, accessibility, manual E2E coverage, migration
   procedures, and production validation.

## Testing and Delivery

- Prioritize tests for boundary validation, coordinate conversion, waypoint
  classification, domain transitions, cascading Pass, deferred slot release,
  sliding window movement, slot and page recalculation on Skip, zero-pending
  states, concurrency conflicts, and load idempotency.
- Run relevant lint, type, and test checks for every change and report exactly
  what was and was not verified.
- Confirm a new assertion fails for the right reason before trusting it, in
  one of two ways. Either it fails at the baseline on the assertion itself,
  never on a missing symbol, an import, or a setup error. Or you remove the
  behavior it guards, watch the assertion fail, then restore it. Removal is
  required when the behavior already exists at the baseline, because a
  baseline run cannot tell a meaningful assertion from an empty one there.
  Lint, type checks, and a green suite all report success on a test that
  asserts nothing, so no gate catches this. Recurring shapes that pass while
  proving nothing are a negative assertion satisfied by the code not running
  at all, a comparison against a mocked rather than the real implementation,
  a branch conditioned on whether a fixture happens to contain the case, a
  bounded search asserting exhaustion it never reached, an assertion over a
  state the implementation cannot produce, and a check that something changed
  or some element matches where the exact value is knowable.
- When a slice must handle a state before the operation that produces it
  exists, build that state directly in its tests and record a forward
  obligation in the slice bound naming the later slice that re-reaches every
  such state through the real operation and compares the result. A directly
  built state can encode something the implementation can never produce, and
  the suite then verifies a fiction while passing.
- Where two constructors can produce the same type, prove one produces output
  identical to the other for every tracked fixture. Two normalizers that must
  agree will otherwise diverge on an edge case that no test covers, and the
  suite stays green while production fails.
- Keep Playwright manual for MVP unless the governing documents are changed.
- Commit Drizzle migrations.
- Never run production migrations automatically during a Vercel build.
- Keep production migrations explicit and manually invoked.
- Do not add preview environments, realtime synchronization, offline support,
  PWA behavior, third-party monitoring, or other deferred infrastructure
  without a deliberate scope change.

## Agent workflow profile

Read by orchestrator skills such as `chore-orchestrate` at resolve. The field
definitions and defaults are in
`.agents/skills/chore-orchestrate/references/repository-profile.md`. The profile
narrows authority and never widens it; the rules elsewhere in this document
still bind every run, including `../project-management/kneeboard/build-execution-strategy.md` keeping
section 7 interactive.

```yaml
autonomy: autonomous
tracking: required            # a Kneeboard issue, a sub-issue of the run issue
coordination_repository: v8chllc/project-management
branch_naming: "type/short-description"
commit_style: conventional
merge_method: rebase          # rebase-only; squash and merge commits are disabled
required_gates:
  - CI workflow (.github/workflows/ci.yml) passing on the pull request head
  - CodeRabbit commit status on the pull request head SHA; poll it as
    WORKFLOW_STANDARDS.md "Awaiting a CodeRabbit response" describes
review_capability: coderabbit  # gate of record; see ../project-management/kneeboard/build-execution-strategy.md §4
journey: none                 # until the Playwright harness exists (#40)
loop_ceiling: 3               # the capped loop granted on 2026-08-20
quality_commands:
  - mise exec -- pnpm lint
  - mise exec -- pnpm typecheck
  - mise exec -- pnpm test
  - mise exec -- pnpm build
release_steps: none
prohibited_actions:
  - never run a production migration; production migrations are manual only
  - never contact live SimBrief, Resend, or production infrastructure from tests
  - never commit raw SimBrief downloads from .local/simbrief/
  - never add deferred infrastructure without a deliberate scope change
deploy_triggers:
  - a push to main, which may reach production at kneeboard.v8ch.com via Vercel
data_sensitivity:
  - raw OFPs, coordinates, Pilot IDs, email addresses, sessions, and magic-link
    tokens; never log, commit, or send them to a live service
  - everything under .local/
synchronized_with: none
```

## Memory Fast-Track Workflow

When explicitly requested by the user, agents may fast-track memory-only updates
so other systems that read `origin/main` can pick them up quickly.

Trigger phrases include:

- "fast-track memory updates"
- "commit and merge memory"
- "push memory to origin"
- "make these memories available to other systems"
- "fast-track memory by direct push" - use only for the direct-push exception

This workflow is allowed only when all pending changes are limited to memory or
memory/procedural-memory guidance files:

- `AGENTS.md`
- `CODING_STANDARDS.md`
- `WORKFLOW_STANDARDS.md`
- `.remember/MEMORY.md`

Daily journals under `.remember/memory/` and lifecycle segments under
`.remember/turns/` are ignored by Git and never enter a fast-track. Curated
memory is the only memory lane other systems can read from `origin/main`.

If any other tracked, staged, modified, deleted, or untracked path is present,
stop and ask the user whether to handle that work separately. Do not include
non-memory files in a memory fast-track.

Required sequence:

1. Confirm the user explicitly requested a memory fast-track.
2. Inspect `git status --short` and fail closed unless only allowed memory paths
   are present.
3. Fetch and integrate the latest `origin/main` before committing.
4. Resolve conflicts only in allowed memory files, updating the single active
   `context` entry instead of duplicating it.
5. Review memory content for obvious secrets or sensitive account data.
6. Run `git diff --check`.
7. Commit with a conventional memory message such as
   `chore(memory): fast-track memory updates`.
8. Prefer a short-lived branch plus a pull request; use `gh pr merge` when available.
9. Use direct push to `origin/main` only when the user explicitly requests
   direct-push fast-tracking.
10. Fetch after merge or push and verify `origin/main` contains the memory
    commit before reporting completion.
