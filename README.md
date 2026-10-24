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

Task-list section 6 is merged: local PostgreSQL, the persistence schema, tracker
mutation concurrency, and atomic OFP-load reservation, cooldown and idempotency,
plus the local Playwright journey harness. Production Neon provisioning is not
established and belongs to section 9.

Task-list sections 7 and 8 are complete: authentication and account isolation
protect the authenticated OFP load flow, and users can open and operate the
resulting persistent tracker. The next milestone is task-list section 9:
responsive refinement, accessibility, recent loads, and production validation.
Sections run through the `feature-orchestrate` workflow, and the sponsor merges
every pull request.

## About this repository

Kneeboard is built in the open as a demonstration of engineering process. Its
governing decisions are documented in this repository.

- The decision documents record the reasoning behind each choice, not only the
  choice itself. Where a model proved wrong, the correction and its rationale
  are documented rather than quietly replaced. The replacement of the original
  "active page" concept with the sliding window is one such case, caught while
  the cost was a document rather than a transition engine and its test suite.
- Deferred scope is deliberate. Features excluded from the MVP stay excluded
  until they are chosen explicitly, rather than becoming an implicit backlog.
- Test fixtures contain no real account data. Raw SimBrief payloads never enter
  version control, and every tracked fixture is produced by an allowlisting
  sanitizer that rebuilds the document from a small set of approved fields with
  synthetic coordinates, distances, and flight identities. Only public aviation
  reference data — airport codes, published procedure identifiers, and waypoint
  names — is retained.

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
- Vitest unit tests and a lean local Playwright end-to-end suite
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

Before starting sign-in, start local PostgreSQL and Mailpit as described below,
and migrate the development database. Copy `.env.example` to the ignored
`.env.local`, replace `BETTER_AUTH_SECRET` with the output of
`openssl rand -base64 32`, and set `AUTH_EMAIL_ALLOWLIST` to the exact email
addresses allowed to sign in. The checked-in address is an example only;
copying it unchanged permits no real user. An unset or empty allowlist rejects
everyone; `*` deliberately permits any valid address. Keep local secrets in
`.env.local` and never commit them.

Open <http://localhost:3000>. Enter an allowed email address, then open the
sign-in message at <http://127.0.0.1:8025> and follow its link. On the signed-in
home, enter a 1–16 digit SimBrief Pilot ID, including any leading zeros, and
save it. Saving only validates and stores the value; it does not contact
SimBrief. Use **Sign out** to end the session. Both home states show the
simulation-only warning.

To try the OFP-to-tracker flow without contacting SimBrief, run the fixture
stub in a second terminal:

```bash
python3 scripts/simbrief_stub.py --port 8765
```

Keep `SIMBRIEF_BASE_URL=http://127.0.0.1:8765` in `.env.local`, then start the
application with `mise exec -- pnpm dev`. Sign in, save reserved Pilot ID
`100001`, and press **Load latest OFP**. The stub serves the tracked multi-page
LIDO fixture; `100002` serves the domestic fixture, `100003` the non-LIDO
rejection fixture, and `100004` the route with repeated waypoint identifiers
and boundary cases. Unknown IDs return HTTP 404. The stub binds to loopback
only and stops with Ctrl-C. The automated `pnpm journey:e2e` command starts
its own stub on an allocated loopback port and shuts it down with the isolated
application and database.

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
| `pnpm journey:db` | Run the isolated database Journey. |
| `pnpm journey:e2e` | Build and test sign-in in Chromium with isolated PostgreSQL and Mailpit. |
| `pnpm journey` | Run both Journeys in order, stopping if either fails. |

With mise activated in the shell, run the commands directly. Otherwise prefix
them with `mise exec --`, as in the fresh-clone procedure above. To exercise the
production runtime locally:

```bash
mise exec -- pnpm build
mise exec -- pnpm start
```

### Local Mailpit

Start the local-only mail inbox separately from PostgreSQL:

```bash
docker compose -f compose.yaml -p kneeboard up -d mailpit
```

Read captured mail at <http://127.0.0.1:8025>. Mailpit accepts SMTP at
`127.0.0.1:1025`; both ports bind only to loopback. To stop it, run
`docker compose -f compose.yaml -p kneeboard stop mailpit`. The container has no
persistent volume. The image is pinned to the multi-platform digest of Mailpit
v1.31.4, released 2026-10-03. This version includes the earlier SMTP and API
security fixes in the 1.31 series; the service is never deployed or started by
CI. The later browser journey will use its REST API to read and clear messages.

Local configuration uses `MAIL_DELIVERY=mailpit`, `MAIL_FROM_EMAIL`, and the
loopback SMTP host and port from `.env.local`. Production requires an HTTPS
`BETTER_AUTH_URL`, `MAIL_DELIVERY=resend`, `RESEND_API_KEY`, and a valid
`MAIL_FROM_EMAIL`. `DATABASE_URL` and a unique 32-character-or-longer
`BETTER_AUTH_SECRET` are required in every environment. Server configuration
validation gives a generic error and does not print rejected values.

### Local PostgreSQL

Docker Compose runs PostgreSQL 17.6 on `127.0.0.1:54329`. It creates separate
`kneeboard_dev` and `kneeboard_test` databases in a project-owned Docker volume.
The fixed credentials in `.env.example` are for this local container only.

From this repository root:

```bash
sh scripts/local-db.sh start
sh scripts/local-db.sh migrate dev
sh scripts/local-db.sh migrate test
sh scripts/local-db.sh verify test
sh scripts/local-db.sh stop
sh scripts/local-db.sh reset dev  # destroys only the local development database
sh scripts/local-db.sh reset test # destroys only the local test database
```

Reset drops and recreates the selected database. The first start creates both
databases; later starts preserve them. Run the matching migration command after
a reset. Routine commands pin this repository's `compose.yaml` and `kneeboard`
project, set the local URL themselves, and do not accept a remote database URL.
The Journey uses a separate validated project name and temporary loopback port.
`pnpm db:generate` creates reviewable SQL from `src/db/schema.ts`; commit the
generated migration. The generic `pnpm db:migrate` requires an explicit
`DATABASE_URL`; the local script sets it to a fixed loopback URL. Direct
invocation against production requires
separate authorization. `verify` runs
synthetic schema probes in a rolled-back transaction.
The [migration runbook](docs/database-migrations.md) covers empty-database
validation, manual production migration, and rollback.

For the section 6a database Journey, run `mise exec -- pnpm journey:db`. It
creates and removes its own Compose project and volume on a temporary loopback
port, exercises migration and database behavior, and checks the built local
application. For the browser sign-in Journey, run `mise exec -- pnpm journey:e2e`.
It checks the pinned Playwright and Chromium headless shell versions, installs
the browser if needed, migrates its own isolated database, starts Mailpit on
temporary loopback ports, then builds and starts the local application.
Chromium requests and redeems links, saves and reloads Pilot IDs for two
accounts, checks validation, link reuse, rate limiting, sign-out, and the
warning. The Journey reads and clears Mailpit messages through its REST API
and checks in-memory app output for private values without printing them.
Run `mise exec -- pnpm journey` to run both Journeys in order.
These Journeys run locally, by a person or an agent, and never in CI. Existing
development and test databases are left intact by both Journeys.

Every command the Journey runs has a finite time budget, from 30 seconds for a
Docker query to 15 minutes for the production build; the values and their
measured basis are in `scripts/db_journey.py`. A command that exceeds its budget
is stopped with its child processes, and the Journey fails with the command and
budget it exceeded. Once database startup begins, a failure or timeout still
removes the Journey's own Compose project; if that removal fails or times out,
the run reports it rather than claiming the project was removed. A failed
removal can leave containers, a volume, or both. List leftover projects with
`docker compose ls -a`, which finds containers, and with
`docker volume ls --filter label=com.docker.compose.project --format '{{.Label "com.docker.compose.project"}}'`,
which finds a volume whose containers are already gone. Remove each
`kneeboard_journey_<id>` project from the repository root with
`docker compose -p kneeboard_journey_<id> down -v --remove-orphans`. The
Journey supports macOS and Linux only.

The [database Journey coverage map](docs/database-journey-coverage.md) links
each section 6a claim to its committed check and its fitness evidence. To show
that the strengthened SQL checks fail for the right reason, run
`mise exec -- python3 scripts/db_journey_fitness.py`. It removes or inverts each
guarded behavior in a disposable project and requires the exact claim label to
fail. Then it removes the project it created. Add `--case <name>` to rerun one
case, or `--list` to show them all.

Run the auth-endpoint concurrency fitness check alongside `journey:e2e` and
the database fitness check:

```bash
mise exec -- python3 scripts/e2e_journey_fitness.py /tmp/kneeboard-auth-fitness
```

The scratch directory must be outside this repository and needs room for a
temporary copy of tracked sources and local dependencies. The check changes only
that copy of Better Auth, runs the isolated database-backed auth endpoint test,
and requires the atomic-redemption session assertion to fail. It removes its
temporary copy on success or failure; the empty scratch directory may be removed
afterward. Like the Journeys, run this locally and never in CI.

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
