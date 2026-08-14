# Planning status

This document distinguishes settled project direction from deliberately deferred
work and the small number of choices that still belong in implementation
planning.

## Confirmed direction

### Product

- Home flight-simulation INS waypoint-entry tracker
- CIVA/Delco Carousel IV-A and iniBuilds L-1011 Litton LTN-72 context
- LIDO detailed navlog only
- Primary route only
- SimBrief's `general.flight_number` displayed unchanged, including its
  simulator-registration substitution when no airline or flight number is set
- Fail-closed waypoint classification: coordinate-pattern `ltlg` allowlisting
  and exact flagged `via_airway` matches to dedicated SID or STAR identifiers
- Synthesized display-only origin row, because the OFP navlog omits the origin
- `RDIS` derived by summing the leg distances of all following rows
- No FIR boundary rows; FIR data is present in the payload but unused by MVP
- Repeating INS slots 1–9 with deferred release, so the most recently passed fix
  keeps its slot as the active-leg FROM waypoint
- A sliding window representing current INS unit contents, drawn inline over the
  always-visible complete navlog
- Read-only coordinate and distance reference data
- Explicit Save, Pass, and Skip workflow
- Persistent, private trackers and recent-load home screen
- Desktop-first use with mobile-first responsive design

### Application

- Next.js App Router, React, and TypeScript
- Tailwind CSS and custom components
- Framework-independent domain code under `src/domain/`
- Zod boundary validation
- Pure transition engine with persisted snapshots
- Aggregate persistence: indexed `ofp_load` metadata, a separate `ofp_raw`
  payload table, and a `tracker` row holding navlog, snapshot, and version
- 16-digit Pilot ID input cap as an application limit
- 30-second per-account cooldown on the Load endpoint alongside per-action
  idempotency
- Atomic Load-attempt reservation so concurrent requests cannot bypass the
  cooldown or duplicate an in-progress same-key fetch
- Shared pure Pass-cascade preview and typed procedure-inclusion commands
- Server-confirmed UI mutations
- Optimistic concurrency
- Stable account-protected tracker URLs

### Services

- Vercel at `kneeboard.v8ch.com`
- Neon Postgres
- Drizzle ORM and committed migrations
- Better Auth magic links
- Resend email
- Mailpit for local-only email capture
- Fail-closed email allowlist

### Delivery

- `pnpm`
- Node.js LTS and tools pinned with mise
- Reproducible fresh-clone local development before domain implementation
- A local PostgreSQL container with separate development and test databases
- GitHub Actions using the same lint, type, test, and build commands as local
  development
- Manual Playwright pre-release suite
- Production-only Vercel deployments during soft launch
- Manual production migrations

Resolved section 4 toolchain, pinned on 2026-08-13:

- Node.js `24.19.0` and pnpm `11.21.0`
- Next.js `16.3.1`, React `19.2.8`, and React DOM `19.2.8`
- Tailwind CSS `4.3.3` and `@tailwindcss/postcss` `4.3.3`
- ESLint `9.39.5` and `eslint-config-next` `16.3.1`
- TypeScript `5.9.3`, `@types/node` `24.13.3`, `@types/react` `19.2.18`,
  and `@types/react-dom` `19.2.4`
- Vitest `4.1.10`

### Build execution

- One primary build agent working bounded task-list slices as the sole writer
  and integrator, with the surface named at kickoff rather than fixed in the
  documents
- Direct user supervision or routine checkpoint supervision by a
  user-authorized read-only manager with a durable channel to one persistent
  build agent; product authority and explicit-user boundaries remain with the
  user
- One feature branch and pull request per numbered task-list section, with one
  commit per completed slice
- CodeRabbit as the mandatory independent review gate on every section pull
  request, with accepted findings either (a) fixed and affected gates rerun, or
  (b) accepted as-is with a recorded reason, before merge, governed by a
  committed `.coderabbit.yaml`
- Interactive bounded goals through sections 4 and 5, supervised by the user or
  authorized manager at every checkpoint; a capped loop permitted from section
  6 only after both complete cleanly
- Read-only delegation preferred; parallel writing requires separate worktrees
  and explicit approval

## Deferred until after MVP

- General OFP briefing content
- Weather, NOTAM, fuel, weight, or printable views
- Free-form waypoint notes
- Per-unit INS tracking
- Non-contiguous active legs, such as a direct-to that bypasses intermediate
  slots, and the slot-state representation they would require
- Alternate and ETOPS routing
- Restoring skipped waypoints
- Undo
- Resetting a tracker from its raw OFP
- Visible event history or event-sourced persistence
- Archive, delete, export, and older-history browsing
- Realtime synchronization
- Offline operation
- PWA installability
- Light theme
- Preview deployments and preview databases
- Staged production promotion
- Playwright in CI
- Third-party error monitoring
- Application-level field encryption

## Open implementation-planning decisions

This is intentionally not filled in by assumption. Test infrastructure is
resolved during the work that makes it concrete. Package and tool versions were
resolved as part of task-list section 4, and build orchestration was resolved on
2026-08-12 when the pre-build execution gate closed.

1. **Test infrastructure**
   - Mailpit is the local magic-link inbox. Choose how manual Playwright tests
     poll, select, and clear messages through its REST API and isolate their
     database.
   - Fixtures must remain sanitized and deterministic.
   - Resolved in section 9 of [the task list](task-list.md), because the
     mechanism depends on how persistence, Better Auth, and Mailpit are wired
     in sections 6 and 7.

## Implementation-plan boundaries

The first implementation plan should:

- preserve the MVP boundaries in these documents;
- begin with a reproducible local application and test foundation, followed by
  domain types, parser fixtures, and transition tests;
- establish authentication and account isolation before private data flows;
- deliver one vertical slice from authenticated OFP load through a working
  tracker;
- avoid adding deferred infrastructure preemptively; and
- include data migration, rollback, validation evidence, and manual E2E steps.

Execution also follows the approved
[build execution strategy](build-execution-strategy.md), including its approved
orchestration choices and kickoff prompts.

If implementation reveals a conflict with these decisions, update the
documentation deliberately rather than silently changing behavior in code.
