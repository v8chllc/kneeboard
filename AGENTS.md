# Agent Guidance

## Start Here

Before planning or changing application behavior, read:

1. `README.md`
2. `docs/product-decisions.md`
3. `docs/tracker-behavior.md`
4. `docs/technical-decisions.md`
5. `docs/planning-status.md`
6. `docs/task-list.md`

The decision documents are the source of truth. `docs/task-list.md` records
execution order but does not override product, domain, or technical decisions.

Application implementation has not begun. Development tooling and planning
artifacts may already exist, so inspect the repository and working tree before
assuming a blank slate.

## Working Agreement

- Research the existing decisions, implementation, and relevant upstream
  documentation before proposing a solution.
- Present findings, options, and trade-offs before making material code or
  architecture changes.
- Keep changes small, dependency-light, and limited to the approved MVP.
- Do not silently resolve an open decision from `docs/planning-status.md`.
  Propose a choice and update the governing documentation deliberately after
  approval.
- If implementation conflicts with documented behavior, stop and surface the
  conflict rather than quietly changing behavior.
- Preserve unrelated user changes in a dirty working tree.
- Do not implement deferred features or infrastructure "for later."

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
- Implement Save, Pass, and Skip through typed commands and a pure,
  deterministic transition engine.
- Persist complete tracker snapshots; do not introduce event sourcing or a
  visible event history.
- Use server-confirmed mutations with expected snapshot versions and
  compare-and-swap persistence. Do not implement client-side conflict merging
  for MVP.
- Keep server-side authorization checks adjacent to every account-scoped read
  and mutation.
- Keep indexed relational metadata separate from large raw OFP payloads so
  recent trackers can be queried without deserializing them.

The exact persistence representation remains open until explicitly resolved in
`docs/planning-status.md`.

## Domain Invariants

Consult `docs/tracker-behavior.md` before changing tracker logic. In particular:

- Use only the primary origin-to-destination navlog, while displaying every
  point in original route order.
- Airports and computed or informational points remain visible but never consume
  INS slots.
- Eligible fixes use repeating slots 1-9.
- Only the earliest pending fix may be saved.
- Skip is terminal, applies only to queued or pending fixes, consumes no slot,
  and triggers deterministic recalculation.
- Passing a saved fix atomically passes every earlier saved-but-unpassed fix,
  releases all affected slots, promotes queued fixes, and recalculates pages.
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
- Use a numeric Pilot ID stored as a string. Do not add username login,
  flight-generation APIs, or Navigraph OAuth.
- Accept only JSON OFPs using the LIDO layout with a detailed navlog.
- Validate and normalize only fields required by the tracker; do not attempt to
  model the complete SimBrief payload.
- Treat raw OFPs, coordinates, Pilot IDs, email addresses, sessions, and
  magic-link tokens as sensitive. Never write them to logs.
- Raw development downloads belong under `.local/simbrief/` and must not be
  committed.
- Use `uv run scripts/fetch_simbrief_ofp.py <pilot-id>` to capture the latest
  generated OFP during development.
- Sanitize representative OFPs before moving them into tracked fixtures.
- Automated tests must use fixed sanitized fixtures and must never contact live
  SimBrief, Resend, or production infrastructure.

## Implementation Order

Follow `docs/task-list.md` and preserve these dependencies:

1. Capture, inspect, map, and sanitize representative SimBrief fixtures.
2. Resolve the remaining implementation-planning decisions.
3. Build domain types, parsing, coordinate conversion, transitions, and unit
   tests.
4. Scaffold the application and CI.
5. Establish authentication and account isolation before introducing private
   OFP data flows.
6. Deliver one authenticated vertical slice from OFP load through a working
   tracker.
7. Complete responsive UI, accessibility, manual E2E coverage, migration
   procedures, and production validation.

## Testing and Delivery

- Prioritize tests for boundary validation, coordinate conversion, waypoint
  classification, domain transitions, cascading Pass, slot/page recalculation,
  concurrency conflicts, and load idempotency.
- Run relevant lint, type, and test checks for every change and report exactly
  what was and was not verified.
- Keep Playwright manual for MVP unless the governing documents are changed.
- Commit Drizzle migrations.
- Never run production migrations automatically during a Vercel build.
- Keep production migrations explicit and manually invoked.
- Do not add preview environments, realtime synchronization, offline support,
  PWA behavior, third-party monitoring, or other deferred infrastructure
  without a deliberate scope change.

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
- `.remember/memory/*.md`

If any other tracked, staged, modified, deleted, or untracked path is present,
stop and ask the user whether to handle that work separately. Do not include
non-memory files in a memory fast-track.

Required sequence:

1. Confirm the user explicitly requested a memory fast-track.
2. Inspect `git status --short` and fail closed unless only allowed memory paths
   are present.
3. Fetch and integrate the latest `origin/main` before committing.
4. Resolve conflicts only in allowed memory files; preserve journal chronology
   and update the single active `context` entry instead of duplicating it.
5. Review memory content for obvious secrets or sensitive account data.
6. Run `git diff --check`.
7. Commit with a conventional memory message such as
   `chore(memory): fast-track memory updates`.
8. Prefer a short-lived branch plus a pull request; use `gh pr merge` when available.
9. Use direct push to `origin/main` only when the user explicitly requests
   direct-push fast-tracking.
10. Fetch after merge or push and verify `origin/main` contains the memory
    commit before reporting completion.
