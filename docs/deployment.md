# Production deployment

This is the runbook for the first production launch of Kneeboard at
`https://kneeboard.v8ch.com`. The sponsor performs every step; an agent never runs
a production operation. The hosting decisions are in
[Technical decisions](technical-decisions.md), and the migration and database
rollback steps are in [Database migrations](database-migrations.md), which stays
the single source for them.

Use placeholders in anything written to the repository. Record no credentials,
tokens, raw OFPs or database rows in any evidence.

## Production settings

Set all eight settings in the Vercel project before the first production
deployment. Values below are placeholders.

| Setting | Value | Note |
| --- | --- | --- |
| `DATABASE_URL` | `postgresql://user:password@host.example/neondb?sslmode=require` | Neon's direct connection string; see Database connection. |
| `BETTER_AUTH_URL` | `https://kneeboard.v8ch.com` | Exactly this value; magic links are built from it. |
| `BETTER_AUTH_SECRET` | generated secret | Generated for production, not the local value. |
| `AUTH_EMAIL_ALLOWLIST` | `first@example.com,second@example.com` | The two launch addresses. Opening registration with `*` is a separate, deliberate step. |
| `MAIL_FROM_EMAIL` | `login@kneeboard.v8ch.com` | A sender on the verified Resend domain. |
| `MAIL_DELIVERY` | `resend` | Exactly `resend`. |
| `RESEND_API_KEY` | Resend API key | Sending access only, if Resend allows it. |
| `SIMBRIEF_BASE_URL` | `https://www.simbrief.com` | Exactly this value. |

The `MAILPIT_*` settings are not set in production.

### Database connection

`DATABASE_URL` holds Neon's direct connection string, not the `-pooler` one, for
both runtime and migration, so the documented migration command works unchanged.
Neon recommends a pooled string for serverless runtimes and a direct connection
for migrations; the direct string is enough for two users. Revisit when the
allowlist opens to `*` or connection errors appear. If the Neon integration
injects different variable names, map `DATABASE_URL` by hand.

## First-launch order

Steps 3 to 5 keep the repository's `main` auto-deploy from shipping an application
with no database or settings. The smoke test follows the domain because magic
links are built from `BETTER_AUTH_URL`.

1. **Neon**: create the production database and confirm its recovery window.
2. **Resend**: add the `kneeboard.v8ch.com` sender domain and its DNS records (see
   DNS), and wait for verification.
3. **Vercel**: create the project with all eight production settings in place
   before the first production deployment.
4. **Migrate**: run the manual production migration at the commit that will deploy,
   following the Manual production procedure in
   [Database migrations](database-migrations.md#manual-production-procedure).
5. **Deploy**: the first production deployment from `main` at that commit.
6. **Domain**: attach `kneeboard.v8ch.com` and confirm HTTPS.
7. **Smoke test**: run the checklist below on that domain only.
8. **Evidence**: record the commit SHA, migration filename, UTC times and each
   check's result on the coordination issue, with no credentials or rows.

## DNS

`v8ch.com` DNS is at Cloudflare, and the Google Workspace records already exist at
the apex. The launch adds only records for the `kneeboard` subdomain: the
project-specific CNAME that Vercel shows, set to DNS-only because Vercel
recommends keeping Cloudflare's proxy off, and the records Resend shows for the
sender domain. The nameservers are not changed, so Workspace mail is untouched.

## Smoke test

Run on `https://kneeboard.v8ch.com` only. For each check, record pass or fail and
the UTC time on the coordination issue. Record no credentials, tokens, raw OFPs or
database rows.

1. **Domain and warning.** The site loads over valid HTTPS, and the
   simulation-only warning is visible signed out and signed in. Record the status
   line from `curl -sI`. Pass: valid HTTPS and the warning visible in both states.
2. **Allowed sign-in.** Request a link for an allowlisted address. Pass: the email
   arrives from the configured sender and the link opens the signed-in home.
   Record the send and receive times and the sender address, not the link.
3. **Rejection.** Request a link for an address that is not on the list and that
   the sponsor can read. Pass: the page response is the same generic one, no email
   arrives within five minutes, and Resend shows no send.
4. **Second allowed address and isolation.** Sign in with the second allowlisted
   address. Pass: its recent-load list is empty, and opening the first account's
   tracker URL gives the generic not-found.
5. **Failed load and logs.** Save a wrong Pilot ID and press Load. Pass: the user
   sees the generic failure, and Vercel's runtime logs show a JSON record with UTC
   time, severity, event, correlation ID and error code. No record contains an
   email address, the Pilot ID, coordinates, a token or a session value.
6. **Live load.** Fix the Pilot ID, wait out the 30-second cooldown, generate a
   LIDO detailed-navlog OFP in SimBrief and press Load. Pass: the tracker appears
   and its flight number, origin and destination match the OFP. Record those three
   values, not the payload.
7. **Tracker and reopen.** Save, Pass and Skip one waypoint each. Pass: state
   survives a reload, and the load appears in recent loads and reopens with no new
   fetch.
8. **OFP size.** Run `scripts/fetch_simbrief_ofp.py` from the sponsor's machine with
   the sponsor's Pilot ID and record the byte count only. Pass: a byte count is
   recorded; it measures a complete OFP against the 8 MiB response bound without
   reading production rows.
9. **Migration evidence.** Record the commit SHA, the migration filename, and the
   result of the two schema-metadata queries in
   [Database migrations](database-migrations.md#manual-production-procedure).
   Pass: both queries show the expected migration and tables.

## Rollback

Application rollback has four rules.

1. By default, fix forward. If the application is wrong, push a fix to `main`,
   which deploys automatically.
2. Instant Rollback removes a bad deployment immediately. On Hobby it reaches only
   the immediately previous deployment, it does not roll back environment
   variables or the database, and it turns off auto-assignment of production
   domains. After it, promote the fixed deployment to undo the rollback, or pushes
   to `main` will not go live.
3. The first deployment has nothing to roll back to. If it is bad, detach
   `kneeboard.v8ch.com` from the project and fix forward.
4. When a migration is involved, use the database path in
   [Database migrations](database-migrations.md#rollback): a corrective migration
   or a Neon restore, chosen with the sponsor. A Vercel rollback does not undo the
   schema, so a schema change must work with the previous deployment.

## Confirm at launch

These points were unverified when this runbook was written. Confirm each and note
the result in the evidence:

- Whether Vercel's project import lets settings be set before the first
  deployment.
- Which variable names the Neon integration injects.
- That a build succeeds without the settings.
