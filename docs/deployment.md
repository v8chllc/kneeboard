# Deployment

This is the sponsor's runbook for Kneeboard production releases at
`https://kneeboard.v8ch.com`. Kneeboard is for home flight simulation only,
never real-world navigation. All production operations below belong to the
sponsor; an agent documenting or reviewing this procedure does not perform
them. The [technical decisions](technical-decisions.md) govern hosting and
application behavior.

Use UTC times. Record no credentials, tokens, raw OFPs or database rows.
Keep private settings in the providers' protected configuration, never in Git
or issue comments.

## Production settings

Keep all eight names set in the Vercel **Production** environment. The examples below
are placeholders; replace account-specific and
secret values in the provider, not in this document. The public constants in
the notes are required exactly as written.

| Setting | Placeholder | Requirement |
| --- | --- | --- |
| `DATABASE_URL` | `<neon-direct-connection-string>` | Neon's direct production PostgreSQL connection string, including its required TLS options; see below. |
| `BETTER_AUTH_URL` | `<canonical-production-url>` | Exactly `https://kneeboard.v8ch.com`. Magic links use this origin. |
| `BETTER_AUTH_SECRET` | `<unique-production-secret>` | Generate a unique production secret of at least 32 characters; do not reuse the local secret. |
| `AUTH_EMAIL_ALLOWLIST` | `first@example.com,second@example.com` | The sponsor's two approved addresses, comma-separated exact matches. Missing or empty rejects everyone; opening to `*` requires a deliberate scope change. |
| `MAIL_FROM_EMAIL` | `<verified-sender-address>` | Use the verified sender `login@kneeboard.v8ch.com`. |
| `MAIL_DELIVERY` | `<production-mail-adapter>` | Exactly `resend`. |
| `RESEND_API_KEY` | `<production-sending-key>` | A production key restricted to sending access and the sender domain where Resend permits it. |
| `SIMBRIEF_BASE_URL` | `<production-simbrief-origin>` | Exactly `https://www.simbrief.com`. |

The `MAILPIT_*` settings are not set in production. Mailpit is local-only.
Do not copy the local environment file into production.

Use Neon's **direct connection string, not the `-pooler` connection string**,
as `DATABASE_URL` for both runtime and migration. This is the settled choice
for the two-address allowlist, keeping the migration procedure unchanged.
Neon recommends pooled connections for serverless runtimes and direct
connections for migrations; revisit this choice when opening the
allowlist to `*`, or when connection errors appear. If the Neon integration
injects different variable names or a pooled URL, explicitly map `DATABASE_URL`
to the direct string without recording it in evidence.

## Recurring release requirements

Use one reviewed commit for the application and matching migrations. `main`
automatically deploys to Vercel production; non-`main` preview deployments remain
disabled. A Vercel build never runs migrations. Confirm required production
settings before deploying; a successful build does not authorize running without
them.

Run the canonical local quality commands and full local Journey suite documented
in [README.md](../README.md#local-application) before release. For a schema change,
follow the [manual production procedure](database-migrations.md#manual-production-procedure)
at the reviewed commit, including a usable Neon recovery point, compatibility
and release-order review, explicit migration and schema-metadata validation. Do
not deploy if migration or validation fails.

Confirm the Vercel deployment succeeds at the reviewed commit, then perform all
nine release-validation checks below on `https://kneeboard.v8ch.com`. Record the
commit SHA, applicable migration filename, UTC times and results on the
authorized release work item without credentials, tokens, raw OFPs or rows.

## DNS

`v8ch.com` DNS is at Cloudflare. Add only records for the `kneeboard` subdomain:
the project-specific CNAME that Vercel shows, set to **DNS-only**, and the
records Resend shows for its sender domain. Do not substitute a generic CNAME
target. Keep the existing apex and Google Workspace mail records intact.
The nameservers are not changed.

## Release validation

The sponsor performs these checks on `https://kneeboard.v8ch.com` only, after
the domain and HTTPS are ready. Use separate browser sessions for the two
accounts. Record each result and UTC time on the release work item. The
account addresses, Pilot IDs and tracker URLs are private operating inputs,
not evidence to publish.

1. **Domain and warning**: Open the domain signed out and signed in. Pass:
   HTTPS is valid, the site loads, and the simulation-only warning is visible
   in both states. Record the HTTP status line from `curl -sI` against the
   domain and the warning result; record no credentials, tokens, raw OFPs or rows.
2. **Allowed sign-in**: Request a magic link for the first allowlisted address.
   Pass: an email arrives from the configured sender and its link opens the
   signed-in home. Record send and receive UTC times and the configured sender,
   never the recipient or link; record no credentials, tokens, raw OFPs or rows.
3. **Rejection**: Request a link for a non-allowlisted address the sponsor can
   read. Pass: the page gives the same generic response, no email arrives within
   five minutes, and Resend shows no send. Record the observation window and
   result only; record no credentials, tokens, raw OFPs or rows.
4. **Second allowed address and isolation**: Sign in with the second approved
   address in its own session. Pass: it shows only that account's loads (or an
   empty list if it has none). After check 6 creates the first account's tracker, try its
   URL as the second account: access must give the generic not-found response.
   Record both results
   without the addresses or URL; record no credentials, tokens, raw OFPs or rows.
5. **Failed load and logs**: As the first account, save a syntactically valid
   wrong Pilot ID and press **Load latest OFP**. Pass: the user sees the generic
   failure and Vercel runtime logs show a JSON record with UTC `timestamp`,
   `severity`, `event`, `correlationId` and `errorCode`. Inspect that no record
   contains an email address, Pilot ID, coordinates, token or session value.
   Record the field-presence and privacy results only; record no credentials,
   tokens, raw OFPs or rows.
6. **Live load**: Correct the first account's Pilot ID, wait out the 30-second
   cooldown, generate a LIDO OFP with a detailed navlog in SimBrief, and press
   **Load latest OFP**. Pass: a tracker appears and its flight number, origin
   and destination match the OFP. Record those three displayed values and the
   result, never the payload; record no credentials, tokens, raw OFPs or rows.
7. **Tracker and reopen**: On that tracker, Save, Pass and Skip one eligible
   waypoint each. Pass: the state survives reload, the load appears in recent
   loads, and reopening it restores the same state without a new fetch. Record
   the results without waypoint data or tracker URLs; record no credentials,
   tokens, raw OFPs or rows.
8. **OFP size**: On the sponsor's machine, use the README's
   [capture procedure](../README.md#fetch-a-simbrief-ofp) with the sponsor's
   Pilot ID, then measure the saved file's byte count locally. Keep the capture
   under the ignored `.local/simbrief/` directory. Pass: the complete OFP is
   measured and fits the application's 8 MiB response bound (8,388,608 bytes).
   If it does not fit, stop and resolve the bound before declaring release
   validation passed. Record the byte count only; record no credentials, tokens,
   raw OFPs or rows.
9. **Migration evidence**: Compare the deploying commit and migration filename
   with the evidence from the two schema-metadata queries in the
   [manual production procedure](database-migrations.md#manual-production-procedure).
   Pass: the migration journal and expected-table metadata confirm the migration
   at that commit. Record the commit SHA, migration filename, UTC time and
   validation result only; record no credentials, tokens, raw OFPs or rows.

## Application rollback

1. **Default**: fix forward. A reviewed fix merged to `main` deploys
   automatically during normal operation.
2. **Existing deployment**: Instant Rollback on Hobby reaches only the
   immediately previous production deployment. It does not roll back environment
   variables or the database. It turns off production domain auto-assignment;
   after fixing the application, promote the fixed deployment to restore
   auto-assignment. Until then, pushes to `main` do not go live automatically.
3. **No usable previous deployment**: Detach `kneeboard.v8ch.com` from the
   project and fix forward; restore the domain only after validating the fix.
4. **Migration involved**: A Vercel rollback does not undo the schema. Follow
   [database rollback](database-migrations.md#rollback) and choose the recovery
   path with the sponsor: a reviewed forward corrective migration or a Neon
   restore. A schema change must remain compatible with the previous deployment.

## Provider references

- [Vercel Instant Rollback](https://vercel.com/docs/instant-rollback)
- [Vercel custom domains](https://vercel.com/docs/domains/working-with-domains/add-a-domain)
- [Vercel guidance on Cloudflare proxies](https://vercel.com/kb/guide/can-i-use-a-proxy-on-top-of-my-vercel-deployment)
- [Neon connection pooling](https://neon.com/docs/connect/connection-pooling)
