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
8. `CODING_STANDARDS.md`
9. `WORKFLOW_STANDARDS.md`

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

For `chore-orchestrate`, `feature-orchestrate`, or `supervise`, start the agent
from the parent Kneeboard workspace. Their Codex and Claude Code copies, role
agents, and lifecycle hooks live there rather than in this application checkout.
Read this repository's profile and product rules during every run.

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

Follow [CODING_STANDARDS.md — Architecture Guardrails](CODING_STANDARDS.md#architecture-guardrails).

## Domain Invariants

Follow [CODING_STANDARDS.md — Domain Invariants](CODING_STANDARDS.md#domain-invariants).

## SimBrief Data and Privacy

Follow [CODING_STANDARDS.md — SimBrief Data and Privacy](CODING_STANDARDS.md#simbrief-data-and-privacy).

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
   interpretation seam in `CODING_STANDARDS.md` under Architecture Guardrails.
6. Add local and production persistence with committed migrations and explicit
   production migration procedures.
7. Establish authentication and account isolation before introducing private
   OFP data flows.
8. Deliver one authenticated vertical slice from OFP load through a working
   tracker.
9. Complete responsive UI, accessibility, manual E2E coverage, migration
   procedures, and production validation.

## Testing and Delivery

Follow [CODING_STANDARDS.md — Testing](CODING_STANDARDS.md#testing).

- Run relevant lint, type, and test checks for every change and report exactly
  what was and was not verified.
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
`../.agents/skills/chore-orchestrate/references/repository-profile.md` in the
parent workspace. The profile
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
journey: "automated: mise exec -- pnpm journey:db" # local database Journey; #40 owns the later manual Playwright harness
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

## Workspace Memory

Curated Kneeboard decision history now lives in the parent workspace's
`../.remember/MEMORY.md`. Its memory fast-track applies to that workspace
repository only. Product rules and current acceptance criteria remain in the
governing documents under `../project-management/kneeboard/`,
`CODING_STANDARDS.md`, and this file.
