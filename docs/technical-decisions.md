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
- Bound the upstream request with an explicit abort timeout and response-size
  limit. Select the concrete values against captured payload sizes and the
  deployed runtime when the integration is implemented; they must be finite,
  documented, and covered by automated tests.
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
   retryable in-progress response and never starts a second fetch.
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
- Initial target tier is Vercel Hobby while the project remains personal and
  non-commercial; confirm eligibility and limits at deployment time.
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

Playwright is required for MVP but does not run in CI/CD initially. It is a lean,
documented manual pre-release suite run against local or test infrastructure.
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

- magic-link sign-in and Pilot ID setup;
- loading a valid OFP into a new tracker; and
- completing the essential Save, Pass, cascade-confirmation, and Skip workflow.

## Observability

Use privacy-conscious structured server logs in Vercel for:

- authentication delivery failures;
- OFP fetch and validation failures;
- tracker command failures;
- stale-version conflicts; and
- unexpected server errors.

Logs identify operation types and correlation identifiers, not sensitive
payloads. Sentry or another third-party monitoring dependency is deferred.

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
