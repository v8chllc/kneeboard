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
- Zod boundary validation
- Pure transition engine with persisted snapshots
- Aggregate persistence: indexed `ofp_load` metadata, a separate `ofp_raw`
  payload table, and a `tracker` row holding navlog, snapshot, and version
- 16-digit Pilot ID input cap as an application limit
- 30-second per-account cooldown on the Load endpoint alongside per-action
  idempotency
- Server-confirmed UI mutations
- Optimistic concurrency
- Stable account-protected tracker URLs

### Services

- Vercel at `kneeboard.v8ch.com`
- Neon Postgres
- Drizzle ORM and committed migrations
- Better Auth magic links
- Resend email
- Fail-closed email allowlist

### Delivery

- `pnpm`
- Node.js LTS and tools pinned with mise
- GitHub Actions for lint, types, and Vitest
- Manual Playwright pre-release suite
- Production-only Vercel deployments during soft launch
- Manual production migrations

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

These are intentionally not filled in by assumption. Each depends on work that
has not happened yet, so each is resolved during the step that makes it
concrete rather than in advance.

1. **Test infrastructure**
   - Choose how manual Playwright tests capture magic links and isolate their
     database.
   - Fixtures must remain sanitized and deterministic.
   - Resolved in section 9 of [the task list](task-list.md), because the
     mechanism depends on how Better Auth and Resend are wired in section 7.
2. **Exact package and tool versions**
   - Resolve current stable compatible versions when scaffolding, then pin them.
   - Resolved in section 5 of [the task list](task-list.md), because versions
     are pinned as they are installed.

## Implementation-plan boundaries

The first implementation plan should:

- preserve the MVP boundaries in these documents;
- begin with the domain types, parser fixtures, and transition tests;
- establish authentication and account isolation before private data flows;
- deliver one vertical slice from authenticated OFP load through a working
  tracker;
- avoid adding deferred infrastructure preemptively; and
- include data migration, rollback, validation evidence, and manual E2E steps.

If implementation reveals a conflict with these decisions, update the
documentation deliberately rather than silently changing behavior in code.
