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

- [ ] Generate and fetch a normal domestic OFP.
  - Suggested starting pair: KORD–KATL.
  - Cover named enroute fixes, SID and STAR fixes, airports, computed points
    such as top of climb and top of descent, `DIS`, `RDIS`, and normal flight
    metadata.
- [ ] Generate and fetch a long multi-page OFP.
  - Suggested starting pair: KLAX–KJFK.
  - Confirm the primary route contains more than 18 eligible fixes so the
    fixture covers repeated slots 1–9 and at least three pages.
- [ ] Generate and fetch an oceanic OFP.
  - Suggested starting pair: KBOS–EGLL.
  - Confirm the generated navlog includes coordinate-defined oceanic fixes. If
    it contains only named oceanic points, adjust the route to include accepted
    coordinate entries.
  - Retain alternate or ETOPS data in the raw payload so parsing can prove that
    only the primary route is selected.
- [ ] Generate and fetch a southern/eastern hemisphere OFP.
  - Suggested starting pair: YSSY–NZAA.
  - Use it with the North American fixtures to cover all latitude and longitude
    hemispheres.
- [ ] Generate and fetch a LIDO OFP with detailed navlog disabled.
  - Use any short route.
  - Preserve it as a rejection fixture for incomplete OFPs.
- [ ] Generate and fetch a non-LIDO OFP with detailed navlog enabled.
  - Reuse the normal domestic route where practical.
  - Preserve it as a rejection fixture for unsupported plan formats.
- [ ] Optionally generate and fetch a valid OFP with minimal optional identity
      fields.
  - Inspect how absent airline and flight-number values are represented.
  - Record any required product decision about display fallbacks.
- [ ] Record the scenario associated with each timestamped raw download.
- [ ] Inspect the returned JSON and document the exact normalized field mapping
      for airports, computed points, SID fixes, STAR fixes, named enroute fixes,
      and coordinate-defined fixes.
- [ ] Sanitize selected payloads into deterministic, tracked test fixtures.
  - Remove personal and account-related data.
  - Do not commit unreviewed files from `.local/simbrief/`.
- [ ] Derive synthetic fixture variants for cases that should not be forced
      through SimBrief:
  - exactly 9 and 10 eligible fixes;
  - page boundaries with excluded points;
  - coordinate rounding that carries `60.0` minutes into the next degree;
  - malformed or inconsistent numeric values;
  - empty sections and missing required fields; and
  - repeated identifiers and other classification ambiguities found during
    inspection.

## 2. Resolve implementation-planning decisions

- [ ] Confirm relational indexed metadata with immutable navlog data and a
      mutable aggregate JSON tracker snapshot.
- [ ] Select a generous defensive Pilot ID length cap and document it as an
      application limit rather than a SimBrief rule.
- [ ] Confirm that when no saved waypoint remains, the active page falls back
      to the page containing the earliest pending waypoint.
- [ ] Select a small per-account cooldown for the authenticated OFP load
      endpoint in addition to per-action idempotency.
- [ ] Define a test-only magic-link capture mechanism and an isolated Playwright
      database strategy.
- [ ] Resolve and pin current compatible package and tool versions during
      scaffolding.

## 3. Build the domain foundation

- [ ] Define framework-independent domain types and typed commands.
- [ ] Implement coordinate conversion and formatting.
- [ ] Implement waypoint classification and eligibility rules.
- [ ] Implement repeating slot assignment and page construction.
- [ ] Implement the pure Save, Pass, and Skip transition engine.
- [ ] Add Vitest coverage for valid transitions, invalid commands, cascading
      Pass, Skip recalculation, procedure controls, active-page movement,
      coordinate boundaries, and deterministic replay of snapshot plus command.

## 4. Scaffold the application

- [ ] Scaffold Next.js App Router, React, and TypeScript.
- [ ] Configure Tailwind CSS and the initial dark, high-contrast theme.
- [ ] Configure linting and TypeScript checks.
- [ ] Add `mise.toml` with pinned Node.js and `pnpm` versions.
- [ ] Configure Vitest.
- [ ] Add GitHub Actions for linting, type checks, and Vitest.

## 5. Add persistence

- [ ] Configure Neon Postgres, Drizzle ORM, and Drizzle Kit.
- [ ] Define account settings, OFP load metadata, raw OFP, immutable normalized
      navlog, mutable tracker snapshot, ownership, version, idempotency, and UTC
      timestamp persistence.
- [ ] Add indexed metadata for the 10 most recent loads per account.
- [ ] Create and commit database migrations.
- [ ] Implement optimistic concurrency for tracker mutations.
- [ ] Implement per-action OFP-load idempotency.
- [ ] Document migration, rollback, and validation procedures.

## 6. Establish authentication and account isolation

- [ ] Configure Better Auth database-backed magic links.
- [ ] Configure Resend delivery.
- [ ] Implement and test the fail-closed email allowlist.
- [ ] Enable database-backed authentication rate limiting.
- [ ] Validate server environment configuration with Zod.
- [ ] Scope every settings, load, tracker read, and tracker mutation to the
      authenticated account.
- [ ] Verify logs exclude raw OFPs, coordinates, Pilot IDs, email addresses,
      sessions, and magic-link tokens.

## 7. Deliver the first vertical slice

- [ ] Sign in through an email magic link.
- [ ] Configure and persist a numeric SimBrief Pilot ID.
- [ ] Load the latest OFP through an explicit authenticated action.
- [ ] Validate and normalize a detailed LIDO navlog.
- [ ] Create a private persistent tracker for every successful explicit load.
- [ ] Display the tracker at a stable account-protected URL.
- [ ] Complete the essential Save, Pass, cascading Pass, and Skip workflow.
- [ ] Return server-confirmed state and handle stale snapshot versions.

## 8. Finish MVP readiness

- [ ] Build the recent-load home screen.
- [ ] Complete responsive desktop, tablet, and phone layouts.
- [ ] Verify keyboard operation, visible focus, touch targets, contrast, and
      non-color status indicators.
- [ ] Add privacy-conscious structured server logging.
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
- [SimBrief latest OFP data](https://developers.navigraph.com/docs/simbrief/fetching-ofp-data)
- [SimBrief OFP options](https://developers.navigraph.com/docs/simbrief/using-the-api#ofp-options)
