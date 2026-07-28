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
- `pnpm`

Node.js uses the current LTS major selected at implementation time. The planning
baseline is Node.js 24 LTS.

Mise is the checked-in development toolchain manager:

- `mise.toml` pins exact Node.js and `pnpm` tool versions.
- `pnpm-lock.yaml` pins application packages.
- Tool versions should match in local development and GitHub Actions.

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
- Store the complete raw JSON payload privately for every successful load.
- Also normalize the small set of fields required by the tracker.

Pilot ID input is capped at 16 digits and validated as `^\d{1,16}$`. Leading
zeros are preserved and the value is stored as a string. The cap is a Kneeboard
input limit, not a documented SimBrief rule; real IDs are currently six digits.

The authenticated Load endpoint enforces a 30-second per-account cooldown in
addition to per-action idempotency, recorded as a `last_load_at` value on
account settings and checked server-side. Replaying an existing idempotency key
bypasses the cooldown and returns the existing tracker without contacting
SimBrief. A cooldown rejection is a distinct, non-failing response that reports
the remaining wait rather than creating a failed load.

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
- action idempotency key for OFP loading; and
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
- Vitest.

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
- OFP-load idempotency.

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
- [Vercel Git configuration](https://vercel.com/docs/project-configuration/git-configuration)
- [Vercel CLI environment commands](https://vercel.com/docs/cli/env)
- [mise](https://mise.jdx.dev/)
