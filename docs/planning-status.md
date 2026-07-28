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
- Repeating INS slots 1–9
- Read-only coordinate and distance reference data
- Explicit Save, Pass, and Skip workflow
- Persistent, private trackers and recent-load home screen
- Desktop-first use with mobile-first responsive design

### Application

- Next.js App Router, React, and TypeScript
- Tailwind CSS and custom components
- Zod boundary validation
- Pure transition engine with persisted snapshots
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

These are intentionally not filled in by assumption:

1. **Persistence shape**
   - Choose aggregate JSON snapshots or normalized waypoint rows.
   - Current recommendation: immutable navlog and mutable tracker-state
     aggregates, with indexed relational metadata and raw OFP storage separated
     from frequently updated state where useful.
2. **Pilot ID defensive length**
   - SimBrief documents numeric Pilot IDs but no maximum.
   - Storage as a string and digits-only validation are decided.
   - Select a generous application input cap without presenting it as a
     SimBrief rule.
3. **No-saved active-page fallback**
   - Page 1 is active before the first Save.
   - The earliest saved-unpassed waypoint otherwise determines the active page.
   - Define the fallback after all saved waypoints are passed while later
     pending fixes remain.
4. **SimBrief request protection**
   - Per-action idempotency is decided.
   - Decide whether the authenticated Load endpoint also needs a small
     per-account cooldown beyond disabling duplicate UI submissions.
5. **Test infrastructure**
   - Choose how manual Playwright tests capture magic links and isolate their
     database.
   - Fixtures must remain sanitized and deterministic.
6. **Exact package and tool versions**
   - Resolve current stable compatible versions when scaffolding, then pin them.

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
