# kneeboard

Kneeboard is a web-based waypoint-entry tracker for home flight simulation. It
loads the latest SimBrief LIDO Operational Flight Plan (OFP), converts eligible
route fixes into keypad-ready coordinates, and helps a pilot manage the repeating
1–9 memory slots of a CIVA or Litton inertial navigation system.

The MVP is designed around the CIVA/Delco Carousel IV-A and the three Litton
LTN-72 units modeled in the iniBuilds Lockheed L-1011 TriStar. It is not intended
for real-world navigation.

## Status

Planning is complete through the display model. Representative SimBrief OFPs
have been captured, mapped, and sanitized into tracked fixtures; the
core product and application-architecture decisions are resolved; and the
tracker display model has been validated against a static wireframe. The web
application has not been scaffolded yet.

The pre-build execution gate is closed. The structured agent workflow,
checkpoint cadence, delegation boundaries, review gates, and final kickoff
prompt are approved and recorded in
[Build execution strategy](docs/build-execution-strategy.md). Implementation
proceeds one task-list section per pull request, with a section split across
two pull requests when its diff cannot be reviewed safely as one unit.

The next milestone is a reproducible local development foundation: the pinned
toolchain, runnable Next.js scaffold, canonical build and test commands, and CI
command parity. The framework-independent domain layer under `src/domain/`
follows immediately: types and typed commands, coordinate conversion, waypoint
classification, slot and page assignment, and the pure transition engine with
unit tests.

## About this repository

Kneeboard is built in the open as a demonstration of engineering process, so the
planning documents are deliberate artifacts rather than scratch notes.

- The decision documents record the reasoning behind each choice, not only the
  choice itself. Where a model proved wrong, the correction and its rationale
  are documented rather than quietly replaced. The replacement of the original
  "active page" concept with the sliding window is one such case, caught while
  the cost was a document rather than a transition engine and its test suite.
- The deferred list in [Planning status](docs/planning-status.md) is scope
  discipline rather than a backlog. Each entry is something consciously
  excluded from the MVP, recorded so that it stays excluded until it is chosen
  deliberately.
- Test fixtures contain no real account data. Raw SimBrief payloads never enter
  version control, and every tracked fixture is produced by an allowlisting
  sanitizer that rebuilds the document from a small set of approved fields with
  synthetic coordinates, distances, and flight identities. Only public aviation
  reference data — airport codes, published procedure identifiers, and waypoint
  names — is retained.
- `.remember/` holds working session notes kept alongside the documents. They
  record how decisions were reached, including revisions and false starts.

## Documentation

- [Product decisions](docs/product-decisions.md) — audience, MVP experience,
  screens, data shown, failure behavior, and explicit non-goals.
- [Tracker behavior](docs/tracker-behavior.md) — waypoint eligibility,
  coordinate formatting, slot sequencing, state transitions, passing semantics,
  and page construction.
- [Technical decisions](docs/technical-decisions.md) — stack, integration,
  persistence, authentication, security, deployment, testing, and operations.
- [SimBrief navlog findings](docs/simbrief-navlog-findings.md) — observed OFP
  payload structure, classification evidence, and gaps against documented
  tracker behavior.
- [Planning status](docs/planning-status.md) — confirmed direction, deferred
  work, and the few implementation choices that remain open.
- [Project task list](docs/task-list.md) — representative SimBrief fixture
  scenarios and the ordered path from local development setup through MVP
  release.
- [Build execution strategy](docs/build-execution-strategy.md) — the approved
  structured-agent workflow, delegation boundaries, quality gates, approved
  orchestration choices, and the final kickoff prompt.
- [Tracker wireframe](docs/prototypes/tracker-wireframe.html) — a throwaway
  static drawing of the navlog, waypoint states, and sliding window across six
  fixture-derived scenarios. Open it in a browser; it is a reference artifact
  and is not carried into application code.

## MVP at a glance

1. A user signs in through an email magic link.
2. The user configures a numeric SimBrief Pilot ID.
3. An explicit **Load latest OFP** action fetches and validates a detailed LIDO
   navlog.
4. A new, persistent tracker is created for every successful load, even when the
   source OFP has not changed.
5. The tracker displays all primary-route navlog points while assigning eligible
   fixes to repeating INS memory slots 1–9.
6. The user records each fix as saved, then passed, or terminally skips a queued
   or pending fix.

## Selected stack

- Next.js App Router, React, and TypeScript
- Tailwind CSS with dependency-light custom components
- Zod for runtime boundary validation
- Neon Postgres with Drizzle ORM and committed Drizzle Kit migrations
- Better Auth magic links delivered by Resend
- Vercel hosting at `kneeboard.v8ch.com`
- Vitest unit tests and a lean manual Playwright end-to-end suite
- `pnpm`, with Node.js LTS and tool versions pinned by mise
- Local PostgreSQL for development and tests, plus Mailpit for local-only magic
  link capture

## Development tools

### Fetch a SimBrief OFP

After generating an OFP in SimBrief with the LIDO plan format and detailed
navlog enabled, fetch its JSON payload by passing the account's numeric Pilot ID:

```bash
uv run scripts/fetch_simbrief_ofp.py <pilot-id>
```

The script retrieves the account's latest generated OFP and saves the response
under `.local/simbrief/` with a UTC timestamped filename. This directory is
ignored by Git because raw OFPs can contain personal and account-related data.
Do not move an unreviewed payload into a tracked fixture directory. Sanitize any
payload selected for test coverage before committing it.

## Safety

Kneeboard is for home flight simulation only. It must not be represented as an
approved navigation tool or used for real-world flight operations.
