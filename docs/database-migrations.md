# Database migrations

The schema source is `src/db/schema.ts`, including Better Auth's generated
tables in `src/db/auth-schema.ts`. Drizzle Kit generates reviewable SQL and
metadata under `drizzle/`. Commit those files with each schema change. The
application build and Vercel deployment never run migrations.

## Local migration and validation

From the Kneeboard repository root, with Docker and mise installed:

```bash
sh scripts/local-db.sh start
sh scripts/local-db.sh reset test
sh scripts/local-db.sh migrate test
sh scripts/local-db.sh verify test
sh scripts/local-db.sh migrate test
```

The test database is disposable. The second migrate checks that applying an
already recorded migration is harmless. `verify` checks the table set, the
recent-load index, separation of raw payloads, account ownership, action-key
uniqueness, and tracker/snapshot version agreement using synthetic rows in a
rolled-back transaction. Run the same migration and verification commands with
`dev` to update the development database. `reset dev` deletes its local data.
The local script fixes the URL to `127.0.0.1:54329` and accepts only `dev` or
`test`.

For a schema edit, run `mise exec -- pnpm db:generate`, review the generated SQL
for data loss and compatibility with the deployed application, then perform the
empty-database test above. Run `mise exec -- pnpm lint`, `typecheck`, `test`, and
`build` before publishing the change. Drizzle records applied migrations in
`drizzle.__drizzle_migrations`; rerunning `migrate` applies only pending files.

## Manual production procedure

Production migration is a separate, explicitly authorized terminal operation.
Do not put `db:migrate` in a build, startup script, or deployment hook. The
operator uses a reviewed commit with its matching application release and:

1. Confirm the committed SQL was applied and verified on an empty local test
   database. Review whether the new schema is compatible with the currently
   deployed application and plan the release order.
2. Confirm the Neon production branch and its recovery window. Record the UTC
   start time and establish a restorable pre-migration point using Neon's
   backup/restore controls. Do not proceed without a usable recovery point.
3. In the linked Vercel project, run the migration explicitly, without writing
   the production connection string to a local file:

   ```bash
   vercel env run -e production -- pnpm db:migrate
   ```

4. Confirm success from the migration command and inspect only schema metadata
   in the Neon SQL editor, for example:

   ```sql
   SELECT id, created_at FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 5;
   SELECT to_regclass('public.ofp_load'), to_regclass('public.ofp_raw'),
          to_regclass('public.tracker');
   ```

   Record the commit SHA, migration filename, UTC time, and validation result.
   Do not copy application rows, raw OFPs, credentials, or session values into
   logs or evidence.

## Rollback

Drizzle Kit has no automatic down migration in this workflow. If a local
migration is wrong, correct the schema and generate a new migration, or reset
the disposable database and replay committed migrations. Do not edit a SQL file
that has already been applied to a shared database or delete its journal row.

If a production migration fails or the new schema misbehaves, stop further
application writes and inspect the actual schema and Drizzle migration journal.
For a change that must preserve writes made after migration, prepare and review
a forward corrective migration. If reverting the whole database to its
pre-migration state is acceptable, use the recorded Neon recovery point and
its restore workflow; that choice also discards writes made after the recovery
point. Validate the recovered schema and application before resuming writes.
Choose the recovery path with the sponsor; do not run a production restore from
an automated script.

References: [Drizzle generate](https://orm.drizzle.team/docs/drizzle-kit-generate),
[Drizzle migrate](https://orm.drizzle.team/docs/drizzle-kit-migrate),
[Vercel environment command](https://vercel.com/docs/cli/env), and
[Neon point-in-time restore](https://neon.com/blog/announcing-point-in-time-restore).
