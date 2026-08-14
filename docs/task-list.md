# Project task list

This checklist consolidates the implementation steps and the representative
SimBrief OFP scenarios needed to begin development. Preserve the MVP boundaries
defined in the planning documents and update those documents deliberately if
implementation reveals a conflict.

## 1. Acquire representative SimBrief OFPs

For valid fixtures, generate each OFP with the LIDO plan format, detailed navlog
enabled, and SIDs and STARs included. Fetch each OFP immediately after
generation because the Pilot ID endpoint returns only the latest generated OFP:

```bash
uv run scripts/fetch_simbrief_ofp.py <pilot-id>
```

Inspect the generated route in SimBrief before fetching. Because the endpoint
returns only the most recent OFP, a scenario that fails its coverage
requirement has to be regenerated and refetched from scratch. Confirm that the
route string actually contains what the scenario is meant to prove — a named
procedure, a coordinate-defined fix, or a sufficient eligible-fix count — rather
than discovering the gap after the capture.

- [x] Generate and fetch a normal domestic OFP.
  - Suggested starting pair: KATL–KORD.
  - Depart from an airport that publishes a named SID. KORD departures are
    radar vectors to the initial route fix, so a KORD departure yields no SID
    fixes and cannot cover the SID inclusion control.
  - Cover named enroute fixes, SID and STAR fixes, airports, computed points
    such as top of climb and top of descent, `DIS`, `RDIS`, and normal flight
    metadata.
- [x] Generate and fetch a long multi-page OFP.
  - Suggested starting pair: KLAX–KJFK.
  - Confirm the primary route contains more than 18 eligible fixes so the
    fixture covers repeated slots 1–9 and at least three pages.
  - Prefer RNAV routing. It produces a denser fix count than VOR-to-VOR
    routing, which makes the eligible-fix threshold easier to clear.
- [x] Generate and fetch an oceanic OFP.
  - Suggested starting pair: KBOS–EGLL.
  - Confirm the generated navlog includes coordinate-defined oceanic fixes. If
    it contains only named oceanic points, adjust the route to include accepted
    coordinate entries.
  - Retain alternate or ETOPS data in the raw payload so parsing can prove that
    only the primary route is selected.
- [x] Generate and fetch a southern/eastern hemisphere OFP.
  - Suggested starting pair: YSSY–NZAA.
  - Use it with the North American fixtures to cover all latitude and longitude
    hemispheres.
- [x] Generate and fetch a LIDO OFP with detailed navlog disabled.
  - Use any short route.
  - Preserve it as a rejection fixture for incomplete OFPs.
- [x] Generate and fetch a non-LIDO OFP with detailed navlog enabled.
  - Reuse the normal domestic route where practical.
  - Preserve it as a rejection fixture for unsupported plan formats.
- [x] Optionally generate and fetch a valid OFP with minimal optional identity
      fields.
  - Inspect how absent airline and flight-number values are represented.
  - Record any required product decision about display fallbacks.
- [x] Record the scenario associated with each timestamped raw download.
  - Keep the record in `.local/simbrief/manifest.md` alongside the downloads.
    The manifest is ignored by Git because it names raw payload files.
- [x] Inspect the returned JSON and document the exact normalized field mapping
      for airports, computed points, SID fixes, STAR fixes, named enroute fixes,
      and coordinate-defined fixes.
  - Findings from the accepted captures are recorded in
    [SimBrief navlog findings](simbrief-navlog-findings.md). Extend that
    document as later scenarios are captured.
- [x] Sanitize selected payloads into deterministic, tracked test fixtures.
  - Remove personal and account-related data.
  - Do not commit unreviewed files from `.local/simbrief/`.
- [x] Derive synthetic fixture variants for cases that should not be forced
      through SimBrief:
  - exactly 9 and 10 eligible fixes;
  - page boundaries with excluded points;
  - coordinate rounding that carries `60.0` minutes into the next degree;
  - malformed or inconsistent numeric values;
  - empty sections and missing required fields; and
  - repeated identifiers and other classification ambiguities found during
    inspection.
  - The deterministic variants and their expected acceptance outcomes are
    catalogued in [`tests/fixtures/simbrief`](../tests/fixtures/simbrief/README.md).

## 2. Resolve implementation-planning decisions

- [x] Confirm relational indexed metadata with immutable navlog data and a
      mutable aggregate JSON tracker snapshot.
- [x] Select a generous defensive Pilot ID length cap and document it as an
      application limit rather than a SimBrief rule.
- [x] Define the sliding window representing INS unit contents, replacing the
      active-page concept and its no-saved fallback.
- [x] Select a small per-account cooldown for the authenticated OFP load
      endpoint in addition to per-action idempotency.

Two implementation-planning decisions remain open in
[Planning status](planning-status.md). Package and tool versions are pinned as
they are installed in section 4. Mailpit is the local magic-link inbox, while
the exact Playwright polling, inbox-reset, and database-isolation mechanism
depends on how Better Auth, Mailpit, and persistence are wired in sections 6
and 7; that choice is carried in section 9. The build-orchestration choices and
kickoff prompts were resolved in the pre-build execution gate below.

## 3. Validate the tracker display model

Build a throwaway static wireframe before writing domain code, so the sliding
window and waypoint state encoding are validated visually while nothing depends
on them yet.

- [x] Build `docs/prototypes/tracker-wireframe.html` as plain HTML and CSS with
      no JavaScript, no build step, and no dependencies.
- [x] Transcribe rows from the sanitized fixtures rather than inventing routes.
      Use `valid-domestic.json`, `valid-ten-boundary-cases.json`, and
      `valid-exactly-nine.json`.
- [x] Render these scenarios:
  - fresh load, before the first Save;
  - mid-cruise, with the window bracketing saved and passed fixes and exactly
    one pending fix;
  - the same tracker after the next Save, proving the window moves on Save and
    not on Pass;
  - a skip that renumbers slots, rebuilds pages, and leaves the window
    bracketing a skipped row;
  - a page boundary where an excluded point after slot 9 belongs to the
    preceding page, including coordinate rollover; and
  - a navlog of nine or fewer eligible fixes, where nothing is ever queued.
- [x] Resolve the display questions it exists to answer: distinguishing queued,
      pending, saved, passed, skipped, and ineligible rows without relying on
      color alone; how the window bracket is drawn across excluded and skipped
      rows and across page divisions; whether queued fixes show slot numbers;
      how page divisions are presented; and behavior at phone width.
  - Phone layout is the one unresolved question. The two-line reflow is
    directionally right but needs refinement, deferred to the responsive work in
    section 9.
- [x] Record the resolved display decisions in the governing documents. The
      wireframe is a reference drawing and is not carried into application code.
  - Recorded under "Row display" in
    [Product decisions](product-decisions.md).

## Pre-build execution gate

Closed 2026-08-12. The first four items closed the repository-audit gaps; the
remaining items resolved the build technique. The approved orchestration choices
and kickoff prompts are recorded in
[Build execution strategy](build-execution-strategy.md).

- [x] Define atomic OFP-load cooldown and in-progress idempotency semantics,
      including same-key replay, concurrent different-key actions, failure, and
      abandoned-reservation behavior.
- [x] Require typed expected-version commands for procedure inclusion and a
      shared pure Pass preview for cascade confirmation.
- [x] Require an application-side SimBrief abort timeout, response-size limit,
      mocked failure tests, and no live-service calls from automated tests.
- [x] Refresh curated project memory for the authoritative post-transfer clone,
      the `src/domain/` decision, and the current pre-build status.
- [x] Review and approve the
      [build execution strategy](build-execution-strategy.md).
- [x] Decide the agent surface, commit and pull-request cadence, delegation
      limits, parallel-write policy, mandatory review checkpoints, and status
      limits for a long-running build.
  - The surface is deliberately left unspecified. The strategy names the
    capabilities a surface must provide; kickoff selects direct user supervision
    or a surface profile that connects a read-only manager to one persistent
    primary build agent.
  - One pull request per numbered section, one commit per slice, and a
    mandatory CodeRabbit review triaged and resolved on every section pull
    request before merge.
- [x] Decide whether the first build uses interactive bounded goals only or a
      capped Ralph-style loop after the manual workflow proves reliable.
  - Interactive bounded goals through sections 4 and 5. A capped loop is
    permitted from section 6 only after both complete without an unreported
    gate failure or a late-discovered divergence. Interactive checkpoints may
    be supervised directly by the user or by a user-authorized read-only manager;
    human-only approval boundaries do not transfer.
- [x] Write and approve the kickoff prompts, including the local-release-
      candidate definition, manager and build-agent roles, production-operation
      boundary, verification evidence, and stop conditions.
- [x] Add `.coderabbit.yaml` so the review gate runs on a deliberate
      configuration from the first pull request onward, rather than on
      CodeRabbit's default profile.
- [x] Commit the completed planning artifacts, begin from a clean current
      feature branch, and confirm the pre-build gate is closed.

## 4. Establish the local development foundation

Create a reproducible local environment before domain implementation begins.
Every later section extends this environment in the same change that introduces
a new runtime dependency, so the application remains locally runnable and
testable throughout development.

- [ ] Scaffold Next.js App Router, React, and TypeScript in the repository root,
      using the `src/` layout.
- [ ] Establish `src/domain/` as the framework-independent domain location,
      without adding tracker behavior during scaffolding.
- [ ] Configure Tailwind CSS and a minimal dark, high-contrast page that keeps
      the simulation-only warning visible from the first runnable build.
- [ ] Add `mise.toml` with pinned Node.js and `pnpm` versions.
- [ ] Resolve and pin current compatible package and tool versions as they are
      installed, then record the resolution in
      [Planning status](planning-status.md).
- [ ] Commit `pnpm-lock.yaml` and configure canonical `dev`, `build`, `start`,
      `lint`, `typecheck`, `test`, and `test:watch` scripts.
- [ ] Configure ESLint, TypeScript checks, and Vitest, including a minimal smoke
      test proving the test command is operational.
- [ ] Add a non-secret `.env.example`, keep `.env.local` ignored, and document
      that environment validation grows with each introduced service.
- [ ] Document the fresh-clone workflow, prerequisites, localhost URL, and
      canonical commands in `README.md`.
- [ ] Verify the development server, production build and start, lint, type
      checks, and tests locally.
- [ ] Add GitHub Actions that run the same install, lint, type-check, test, and
      build commands used locally.
- [ ] Tune the committed `.coderabbit.yaml` now that the stack exists: confirm
      the ESLint and Actions tooling settings against the real configuration,
      and extend the path instructions to the directories scaffolding created.

## 5. Build the domain foundation

- [ ] Define framework-independent domain types and typed commands.
- [ ] Implement coordinate conversion and formatting.
- [ ] Implement waypoint classification and eligibility rules.
- [ ] Implement repeating slot assignment and page construction.
- [ ] Implement the pure typed-command transition engine for Save, Pass, Skip,
      and pre-start SID/STAR inclusion changes.
- [ ] Implement a pure Pass preview that returns the same ordered cascade the
      Pass command will validate and apply.
- [ ] Add Vitest coverage for valid transitions, invalid commands, cascading
      Pass, Skip recalculation, procedure controls, deferred slot release,
      sliding window movement, coordinate boundaries, and deterministic replay
      of snapshot plus command.

## 6. Add persistence

- [ ] Add a pinned local PostgreSQL container before application persistence
      depends on a database, with separate development and test databases.
- [ ] Add and document local commands to start, stop, migrate, and reset the
      databases without touching production resources.
- [ ] Configure Neon Postgres, Drizzle ORM, and Drizzle Kit.
- [ ] Define account settings, OFP load metadata, raw OFP, immutable normalized
      navlog, mutable tracker snapshot, ownership, version, idempotency, and UTC
      timestamp persistence.
- [ ] Add indexed metadata for the 10 most recent loads per account.
- [ ] Create and commit database migrations.
- [ ] Verify committed migrations against an empty local database.
- [ ] Implement optimistic concurrency for tracker mutations.
- [ ] Implement atomic OFP-load attempt reservation, cooldown enforcement,
      same-key in-progress handling, and per-action idempotency.
- [ ] Test simultaneous same-key and different-key load requests, failure
      cooldown behavior, expired reservations, and the final uniqueness guard.
- [ ] Document migration, rollback, and validation procedures.

## 7. Establish authentication and account isolation

- [ ] Configure Better Auth database-backed magic links.
- [ ] Add a pinned Mailpit container for local-only SMTP capture and document
      the local magic-link inbox workflow.
- [ ] Configure environment-specific delivery: Mailpit locally and Resend in
      production, with production failing closed if Resend is not configured.
- [ ] Implement and test the fail-closed email allowlist.
- [ ] Enable database-backed authentication rate limiting.
- [ ] Validate server environment configuration with Zod.
- [ ] Scope every settings, load, tracker read, and tracker mutation to the
      authenticated account.
- [ ] Verify logs exclude raw OFPs, coordinates, Pilot IDs, email addresses,
      sessions, and magic-link tokens.

## 8. Deliver the first vertical slice

- [ ] Sign in through an email magic link.
- [ ] Configure and persist a numeric SimBrief Pilot ID.
- [ ] Load the latest OFP through an explicit authenticated action.
- [ ] Bound the SimBrief client with a documented abort timeout and response-size
      limit, and test timeout, oversize, non-success, and invalid-JSON responses
      through a mocked transport.
- [ ] Validate and normalize a detailed LIDO navlog.
- [ ] Create a private persistent tracker for every successful explicit load.
- [ ] Display the tracker at a stable account-protected URL.
- [ ] Complete the essential Save, Pass, cascading Pass, and Skip workflow.
- [ ] Return server-confirmed state and handle stale snapshot versions.

## 9. Finish MVP readiness

- [ ] Build the recent-load home screen.
- [ ] Complete responsive desktop, tablet, and phone layouts. The wireframe's
      two-line phone reflow is a starting point that still needs refinement.
- [ ] Verify keyboard operation, visible focus, touch targets, contrast, and
      non-color status indicators.
- [ ] Add privacy-conscious structured server logging.
- [ ] Define how Playwright polls, reads, and clears the Mailpit inbox through
      its REST API and establish an isolated Playwright database strategy, then
      record the resolution in
      [Planning status](planning-status.md). Fixtures must remain sanitized and
      deterministic, and tests must never contact live services.
- [ ] Create the manual Playwright journeys for authentication and setup, valid
      OFP loading, and the essential tracker workflow.
- [ ] Run the manual Playwright pre-release suite.
- [ ] Configure the production Vercel project and `kneeboard.v8ch.com`.
- [ ] Configure Neon and Resend production resources and secrets.
- [ ] Run production migrations manually and capture validation evidence.
- [ ] Validate deployment, rollback instructions, and the simulation-only
      safety messaging.

## References

- [Product decisions](product-decisions.md)
- [Tracker behavior](tracker-behavior.md)
- [Technical decisions](technical-decisions.md)
- [Planning status](planning-status.md)
- [Build execution strategy](build-execution-strategy.md)
- [SimBrief latest OFP data](https://developers.navigraph.com/docs/simbrief/fetching-ofp-data)
- [SimBrief OFP options](https://developers.navigraph.com/docs/simbrief/using-the-api#ofp-options)
