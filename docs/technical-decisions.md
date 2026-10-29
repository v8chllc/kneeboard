# Technical decisions

## Architecture principles

- Keep the MVP small and dependency-light.
- Treat external data and environment configuration as untrusted boundaries.
- Put tracker rules in a framework-independent domain layer.
- Keep server authorization checks adjacent to every account-scoped read and
  mutation.
- Prefer explicit, server-confirmed state changes over optimistic UI rollback.
- Preserve future options without building deferred capabilities now.

## Application stack

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- Dependency-light custom components rather than a broad component framework
- Zod
- Neon Postgres
- Drizzle ORM and Drizzle Kit
- Better Auth
- Resend
- Vitest
- Playwright
- Mailpit for local-only email capture
- `pnpm`

Node.js uses the current LTS major selected at implementation time. The planning
baseline is Node.js 24 LTS.

Mise is the checked-in development toolchain manager:

- `mise.toml` pins exact Node.js and `pnpm` tool versions.
- `pnpm-lock.yaml` pins application packages.
- Tool versions should match in local development and GitHub Actions.

## Local development

Local development is established before domain implementation. The initial
scaffold creates one root Next.js project using the `src/` layout, with
framework-independent tracker code under `src/domain/`. The Next.js development
server runs the frontend and backend route handlers together.

The checked-in local workflow provides canonical commands for development,
production build and start, linting, type checking, and Vitest. GitHub Actions
uses those same commands. A fresh clone must be able to install its pinned tools
and dependencies, run the application on localhost, and pass every currently
applicable check using documented steps.

`.env.example` contains only non-secret examples. `.env.local` is ignored, and
Zod validation expands as each service is introduced rather than declaring
unused configuration in advance.

Persistence development uses a pinned ordinary PostgreSQL container with
separate development and test databases. This keeps routine development
self-contained and prevents accidental access to production Neon resources.
Local start, stop, migration, and reset commands are documented when persistence
is added. Production migrations remain separate and manually invoked.

Authentication development uses a pinned Mailpit container as an SMTP sink and
browser-visible inbox. It is local-only and is never deployed or used as a
production delivery path. Its REST API is the integration point for
deterministic magic-link inspection and cleanup in Playwright. The application
selects Mailpit locally and Resend in production through validated server
configuration; production fails closed when Resend is missing. The Mailpit image
is pinned for reproducibility and reviewed for compatibility and known security
issues when introduced.

Every implementation section extends the local environment in the same change
that adds a new runtime dependency. The application must remain locally runnable
and testable after each section.

## SimBrief integration

The server fetches:

```text
GET https://www.simbrief.com/api/xml.fetcher.php?userid={pilot_id}&json=1
```

Decisions:

- Fetch server-side; never expose the integration as a browser-to-SimBrief call.
- Use Pilot ID only.
- Do not use SimBrief username, SimBrief plan-generation APIs, or Navigraph
  OAuth.
- Fetch only after an authenticated user's explicit Load action.
- Do not reuse a prior response for a later explicit load.
- Use the JSON response.
- Require LIDO layout and detailed navlog.
- Treat HTTP, parsing, layout, and navlog failures as failed loads.
- Abort the upstream request after 20 seconds, below the 30-second load
  reservation. Limit the streamed response to 8 MiB before JSON parsing;
  `Content-Length` alone is insufficient because it can be absent or false.
  The largest valid sanitized fixture is 9,581 bytes. This is a limited basis:
  sanitized fixtures cannot establish the size of complete raw OFPs, and no raw
  capture is currently available locally. Measure a fresh capture when one is
  available before treating 8 MiB as a measured production bound.
- Take the origin from required `SIMBRIEF_BASE_URL` server configuration with
  no local fallback. Production accepts exactly `https://www.simbrief.com`.
  Development and test accept only an explicit loopback HTTP origin. Reject
  credentials, path, query, or fragment. Never point automated tests or journeys
  at live SimBrief.
- Store the complete raw JSON payload privately for every successful load.
- Also normalize the small set of fields required by the tracker.

Pilot ID input is capped at 16 digits and validated as `^\d{1,16}$`. Leading
zeros are preserved and the value is stored as a string. The cap is a Kneeboard
input limit, not a documented SimBrief rule; real IDs are currently six digits.

The authenticated Load endpoint enforces a 30-second per-account cooldown in
addition to per-action idempotency. The cooldown is claimed atomically before
contacting SimBrief and its timestamp records the start of the accepted attempt,
not only a successful load. This prevents simultaneous actions with different
keys from both passing the cooldown check.

The account's active key and attempt time form a short-lived in-progress
reservation. Request handling follows this order:

1. A completed load for the same account and idempotency key returns its
   existing tracker without contacting SimBrief or checking the cooldown.
2. The same key while its accepted attempt is still running receives a
   retryable in-progress response and never starts a second fetch. The
   reservation enforces this for its 30-second lifetime; the SimBrief abort
   timeout, which must be shorter than that lifetime, ensures no accepted
   attempt is still running when its reservation expires.
3. A different key during the 30-second interval receives a distinct,
   non-failing response reporting the remaining wait.
4. A failed attempt creates no tracker and clears its active reservation, but
   retains the short cooldown before that account may try again.
5. An abandoned reservation expires with the cooldown so it cannot block the
   account indefinitely.

A unique account-plus-idempotency-key constraint remains the final defense
against duplicate successful loads. The reservation's exact columns are chosen
with the section 6 schema, but these externally visible semantics are fixed.

SimBrief publishes no formal JSON Schema. Its JSON mirrors XML and may represent
numbers as strings and empty sections as empty strings.

Zod is used at the integration boundary to:

- validate the fields the MVP actually consumes;
- normalize inconsistent numeric and empty values;
- reject non-LIDO or incomplete plans;
- produce field-specific diagnostic information; and
- prevent invalid data from creating a tracker.

The application should not attempt to schema-model the entire OFP. The complete
raw payload is retained separately and unchanged in meaning.

## Tracker application layer

The implementation direction is reducer plus snapshot, not event sourcing.

1. An authenticated transport receives a typed command and expected tracker
   version.
2. The application layer loads the account-owned snapshot.
3. A pure transition engine validates and derives the next state.
4. Persistence writes the state with compare-and-swap versioning.
5. The confirmed next state is returned to the UI.

This keeps event-like domain modeling without event streams, projections,
replay, event-schema migrations, or retained history.

The snapshot is minimal rather than materialized. `TrackerSnapshot` holds a
`version`, `procedureInclusion`, and `waypoints` as `routeIndex` plus `state`.
Slot assignment, page membership, the sliding window, and the procedure-controls
lock are all derived from those facts rather than stored alongside them, so no
consumer can read a stale copy of a rule the domain owns.

Pending and queued are the exception that proves the shape: they *are* stored in
`waypoints[].state`, following the five-state model at
[tracker behavior](tracker-behavior.md), and they are recalculated from the
remaining facts on every transition. The safeguard is that recalculation never
consults the previous pending or queued values, and `recalculateSnapshot` is
proven idempotent by test.

Reversing this after section 6 persists snapshots would be expensive, because
every persisted row would carry the old shape and need migrating.

## Persistence requirements

Neon Postgres is the system of record.

Required persisted concepts:

- Better Auth users, sessions, verifications, and rate-limit counters;
- account settings, including SimBrief Pilot ID;
- successful OFP load identity and searchable metadata;
- complete raw SimBrief JSON;
- immutable normalized primary navlog;
- current mutable tracker snapshot;
- snapshot version;
- account ownership;
- action idempotency key for OFP loading;
- the account's short-lived active Load key and accepted-attempt timestamp used
  for atomic cooldown reservation; and
- UTC creation and update timestamps.

Indexed metadata must support the 10 most recent loads per account without
deserializing raw OFPs.

The recent-load read selects only `ofp_load` metadata and the joined tracker ID
for the authenticated account. It orders by `loaded_at DESC, ofp_load.id DESC`
and limits to 10, using `ofp_load_recent_by_user_idx`. It never reads `ofp_raw`,
the navlog, or the snapshot. The server returns a typed display record with UTC
ISO instants; the view formats them with the existing aviation UTC formatter.

Every tracker mutation uses optimistic concurrency:

- snapshots have an integer version, initially 1;
- the client submits its expected version;
- the update succeeds only where the persisted version matches;
- a success increments the version; and
- a mismatch returns a stale-state response instructing the user to reload.

The MVP does not merge concurrent changes.

Normalized waypoints and mutable state are persisted as aggregates rather than
relational waypoint rows, because the tracker is read and transitioned as one
domain object. A single-row compare-and-swap update is then atomic without a
multi-row transaction, and no slot, page, or sliding-window rule is expressed in
SQL.

The physical shape is:

- `ofp_load` — indexed metadata only: account, idempotency key, flight number,
  origin, destination, OFP generation time, and load time. This table alone
  satisfies the 10-most-recent-loads query.
- `ofp_raw` — a separate table keyed by load, holding the complete raw SimBrief
  payload so that large blobs are never touched by metadata queries.
- `tracker` — account, load, immutable normalized navlog, mutable snapshot,
  integer version, and UTC timestamps.

The navlog and the snapshot share the `tracker` row. At roughly a hundred
waypoints the pair is tens of kilobytes, and Postgres rewrites the row on update
regardless, so separating them would add a join without reducing write cost.

## Authentication and account isolation

Authentication uses Better Auth's magic-link plugin with Resend delivery.

- Tokens are hashed at rest, single-use, and short-lived.
- Users and sessions are database backed.
- Every settings, load, and tracker operation is scoped to the authenticated
  account on the server.
- Authentication responses are generic so callers cannot discover whether an
  address is registered or allowed.
- Better Auth's rate limiter is enabled with database storage; in-memory
  serverless counters are not sufficient.

### Fail-closed email allowlist

`AUTH_EMAIL_ALLOWLIST` is a comma-separated environment value with these
semantics:

- missing: reject all addresses;
- empty: reject all addresses;
- one or more normalized email addresses: allow exact matches only; and
- `*`: explicitly permit any valid email address.

The checked-in `.env.example` will contain:

```dotenv
AUTH_EMAIL_ALLOWLIST=example@email.local
```

Copying the defaults therefore permits no real user. Opening registration later
requires the deliberate `*` value.

## Environment validation and secrets

Zod validates server environment configuration and fails closed when required
values are missing or malformed.

Expected protected values include:

- database connection;
- Better Auth secret and canonical application URL;
- Resend credentials and sender configuration; and
- email allowlist.

Validation is environment-specific: local development accepts the explicitly
configured Mailpit path without Resend credentials, while production requires
Resend and must not permit the local delivery adapter.

Secrets must remain server-only. Logs must not include raw OFPs, coordinates,
Pilot IDs, email addresses, session tokens, or magic-link tokens.

MVP relies on TLS plus Vercel/Neon provider-managed encryption at rest. It does
not add application-level field encryption.

## Hosting and email

- Host the Next.js application on Vercel.
- Production runs on Vercel Hobby because the deployment has no commercial
  function: no payments, advertising or sales. It may be shown as an example
  of the author's work. Move to Pro if Vercel treats that as commercial use.
- Production domain is `kneeboard.v8ch.com`.
- Resend is the email provider.
- Mailpit captures email in local development only.
- Resend domain verification should use the kneeboard subdomain.
- A sender such as `Kneeboard <login@kneeboard.v8ch.com>` is the current
  direction.
- Neon is connected through Vercel's integration where practical.

## Soft-launch deployment

The initial production deployment is intentionally lean:

- `main` automatically deploys to the Vercel production environment.
- Non-`main` preview deployments are disabled.
- There is no staged promotion pipeline.
- Production database migrations are explicit, manual terminal operations.
- Migrations never run automatically during a Vercel build.
- Drizzle Kit migration files are committed to the repository.

Vercel CLI may inject production environment variables into a local migration
process without writing them to a file:

```bash
vercel env run -e production -- pnpm db:migrate
```

No custom deployment or migration automation is required for MVP. Preview
environments, isolated preview databases, promotion, and stronger deployment
gates will be reconsidered after the application stabilizes.

## CI and testing

GitHub Actions runs on pull requests and pushes to `main`:

- lint;
- TypeScript checks; and
- Vitest; and
- a production build.

Playwright is required for MVP but does not run in CI/CD initially. Its journeys
are a lean, documented suite run locally, by a person or an agent, against local
or test infrastructure, and never in CI. They are built section by section once
the journey harness exists, and the full suite runs as the pre-release check.
E2E-on-PR is deferred until app behavior and test flows are stable.

Tests use sanitized, fixed SimBrief fixtures and never call live SimBrief,
Resend, or production infrastructure.

High-value unit coverage includes:

- Zod payload validation and normalization;
- LIDO and detailed-navlog rejection;
- coordinate conversion;
- waypoint classification;
- the transition engine and its invalid commands;
- cascading Pass behavior;
- slot and page recalculation;
- optimistic-concurrency conflicts; and
- OFP-load idempotency, including same-key in-progress requests and concurrent
  different-key cooldown claims; and
- SimBrief timeout, oversize, non-success, and invalid-JSON responses through a
  mocked transport.

The initial Playwright journeys are:

- a harness smoke journey, built with the journey harness;
- magic-link sign-in and Pilot ID setup, built in section 7;
- loading a valid OFP into a new tracker, built in section 8; and
- completing the essential Save, Pass, cascade-confirmation, and Skip workflow,
  built in section 8.

## Observability

Use privacy-conscious structured server logs in Vercel for:

- authentication delivery failures;
- OFP fetch and validation failures;
- tracker command failures;
- stale-version conflicts; and
- unexpected server errors.

Each failure emits one JSON object to standard server output with exactly
`timestamp`, `severity`, `event`, `correlationId`, and `errorCode`. `timestamp`
is a UTC ISO instant. `severity` is `warning` or `error`. `correlationId` is a
fresh random UUID generated for the operation, independently of account IDs,
Pilot IDs, tracker URLs, and session values. Event and error-code pairs are
fixed:

| Event | Error code |
| --- | --- |
| `authentication_delivery_failure` | `AUTH_DELIVERY_FAILED` |
| `ofp_fetch_failure` | `OFP_FETCH_FAILED` |
| `ofp_validation_failure` | `OFP_VALIDATION_FAILED` |
| `tracker_command_failure` | `TRACKER_COMMAND_FAILED` |
| `stale_version_conflict` | `STALE_VERSION` |
| `unexpected_server_error` | `UNEXPECTED_SERVER_ERROR` |

The server-only logger accepts only a fixed event, matching error code, and
severity. It never accepts or serializes an exception, request, headers, URL,
account identifier, arbitrary context, request body, raw upstream error, OFP,
coordinate, Pilot ID, email, session value, or magic-link token. A handled
failure is logged once at its safe result boundary; an unexpected exception is
logged once at its catch boundary. The records are for Vercel's standard output
capture. Sentry and other monitoring dependencies remain deferred.

## Synchronization

The database is authoritative across browsers and devices. State is refreshed on
navigation, reopen, or explicit reload.

Realtime subscriptions, server push, and cross-device live updates are deferred.
Snapshot versioning provides conflict detection and a foundation for that future
work without implementing it now.

## References

- [SimBrief latest OFP fetcher](https://developers.navigraph.com/docs/simbrief/fetching-ofp-data)
- [Zod basics](https://zod.dev/basics)
- [Better Auth magic links](https://better-auth.com/docs/plugins/magic-link)
- [Better Auth rate limiting](https://better-auth.com/docs/concepts/rate-limit)
- [Drizzle with Neon](https://orm.drizzle.team/docs/tutorials/drizzle-with-neon)
- [Better Auth Drizzle adapter](https://better-auth.com/docs/adapters/drizzle)
- [Neon on the Vercel Marketplace](https://vercel.com/marketplace/neon)
- [Resend pricing](https://resend.com/pricing)
- [Mailpit](https://mailpit.axllent.org/)
- [Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration)
- [Vercel CLI environment commands](https://vercel.com/docs/cli/env)
- [mise](https://mise.jdx.dev/)
