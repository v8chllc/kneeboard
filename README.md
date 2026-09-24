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
have been captured, mapped, and sanitized into tracked fixtures; the core
product and application-architecture decisions are resolved; and the tracker
display model has been validated against a static wireframe.

Task-list section 4 is complete. The pinned Next.js scaffold, canonical local
quality commands, CI command parity, and review configuration are established.
Task-list section 5 is complete. The framework-independent domain layer and its
unit tests cover route interpretation, coordinates, slot and page assignment,
and tracker transitions.

The pre-build execution gate is closed. The structured agent workflow,
checkpoint cadence, delegation boundaries, review gates, and the manager and
primary build-agent kickoff prompts are approved and recorded in
[Build execution strategy](https://github.com/v8chllc/project-management/blob/main/kneeboard/build-execution-strategy.md). Implementation
proceeds one task-list section per pull request, with a section split across
two pull requests when its diff cannot be reviewed safely as one unit.

The next milestone is task-list section 6: local PostgreSQL and the persistence
schema in one pull request, followed by concurrent tracker and OFP-load behavior
in a second pull request. Section 6a pilots the `feature-orchestrate` workflow.

## About this repository

Kneeboard is built in the open as a demonstration of engineering process. The
planning documents are deliberate artifacts in the private
[`project-management` repository](https://github.com/v8chllc/project-management/tree/main/kneeboard),
so access to that repository is required to read the links below.

- The decision documents record the reasoning behind each choice, not only the
  choice itself. Where a model proved wrong, the correction and its rationale
  are documented rather than quietly replaced. The replacement of the original
  "active page" concept with the sliding window is one such case, caught while
  the cost was a document rather than a transition engine and its test suite.
- The deferred list in [Planning status](https://github.com/v8chllc/project-management/blob/main/kneeboard/planning-status.md) is scope
  discipline rather than a backlog. Each entry is something consciously
  excluded from the MVP, recorded so that it stays excluded until it is chosen
  deliberately.
- Test fixtures contain no real account data. Raw SimBrief payloads never enter
  version control, and every tracked fixture is produced by an allowlisting
  sanitizer that rebuilds the document from a small set of approved fields with
  synthetic coordinates, distances, and flight identities. Only public aviation
  reference data — airport codes, published procedure identifiers, and waypoint
  names — is retained.
- The private [Kneeboard workspace](https://github.com/v8chllc/kneeboard-workspace)
  holds curated decision history in `.remember/MEMORY.md`. It records revisions
  and false starts; workspace journals and lifecycle segments stay local and
  are not tracked. Access to that repository is required to read the memory.

## Documentation

- [Product decisions](https://github.com/v8chllc/project-management/blob/main/kneeboard/product-decisions.md) — audience, MVP experience,
  screens, data shown, failure behavior, and explicit non-goals.
- [Tracker behavior](https://github.com/v8chllc/project-management/blob/main/kneeboard/tracker-behavior.md) — waypoint eligibility,
  coordinate formatting, slot sequencing, state transitions, passing semantics,
  and page construction.
- [Technical decisions](https://github.com/v8chllc/project-management/blob/main/kneeboard/technical-decisions.md) — stack, integration,
  persistence, authentication, security, deployment, testing, and operations.
- [SimBrief navlog findings](https://github.com/v8chllc/project-management/blob/main/kneeboard/simbrief-navlog-findings.md) — observed OFP
  payload structure, classification evidence, and gaps against documented
  tracker behavior.
- [Planning status](https://github.com/v8chllc/project-management/blob/main/kneeboard/planning-status.md) — confirmed direction, deferred
  work, and the few implementation choices that remain open.
- [Project task list](https://github.com/v8chllc/project-management/blob/main/kneeboard/task-list.md) — representative SimBrief fixture
  scenarios and the ordered path from local development setup through MVP
  release.
- [Build execution strategy](https://github.com/v8chllc/project-management/blob/main/kneeboard/build-execution-strategy.md) — the approved
  structured-agent workflow, delegation boundaries, quality gates, approved
  orchestration choices, and the manager and primary build-agent kickoff
  prompts.
- [Tracker wireframe](https://github.com/v8chllc/project-management/blob/main/kneeboard/prototypes/tracker-wireframe.html) — a throwaway
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

### Local application

Prerequisites:

- [mise](https://mise.jdx.dev/) installed;
- Git; and
- a shell supported by mise.

From a fresh clone, inspect the checked-in `mise.toml`, then run:

```bash
mise trust
mise install
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm dev
```

Open <http://localhost:3000>. The page should display the simulation-only
warning. No environment variables are required by the current scaffold.
`.env.example` grows only when later sections introduce services; local secrets
belong in the ignored `.env.local` file.

The canonical local commands are:

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the development server. |
| `pnpm build` | Create the production build. |
| `pnpm start` | Serve an existing production build. |
| `pnpm lint` | Run ESLint. |
| `pnpm typecheck` | Run TypeScript without emitting files. |
| `pnpm test` | Run the Vitest suite once. |
| `pnpm test:watch` | Run Vitest in interactive watch mode. |

With mise activated in the shell, run the commands directly. Otherwise prefix
them with `mise exec --`, as in the fresh-clone procedure above. To exercise the
production runtime locally:

```bash
mise exec -- pnpm build
mise exec -- pnpm start
```

### Local PostgreSQL

Docker Compose runs PostgreSQL 17.6 on `127.0.0.1:54329`. It creates separate
`kneeboard_dev` and `kneeboard_test` databases in a project-owned Docker volume.
The fixed credentials in `.env.example` are for this local container only.

From this repository root:

```bash
sh scripts/local-db.sh start
sh scripts/local-db.sh stop
sh scripts/local-db.sh reset dev  # destroys only the local development database
sh scripts/local-db.sh reset test # destroys only the local test database
```

Reset drops and recreates the selected database. The first start creates both
databases; later starts preserve them. Run migrations after a reset once they
are added. These commands address the local Compose service and do not accept a
remote database URL.

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
