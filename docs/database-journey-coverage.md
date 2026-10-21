# Database Journey coverage map

This map links the section 6a storage claims strengthened in
[v8chllc/kneeboard#52](https://github.com/v8chllc/kneeboard/issues/52) to the
committed checks that prove them and, for the SQL-probe claims, the
counterexamples that prove those checks fail for the right reason.

Claim IDs use two separate namespaces. **6a** claims are the database Journey's
Compose lifecycle and SQL-probe claims, checked by `scripts/db_journey.py` and
`scripts/db-journey.sql`. **6b** claims are application-operation claims,
checked by `src/db/db-journey.test.ts`. The canonical Journey runs both. A 6b
test can overlap a 6a obligation, and the map credits that overlap, but it never
stands in for the 6a check: the 6b tests exercise different operations.

## How to reproduce

Positive observations come from the canonical Journey:

```bash
mise exec -- pnpm journey:db
```

Each 6a check prints `<label>: pass` or a summary line. The SQL claims run inside
one rolled-back `DO` block, so the line
`6a C-4 through 6a C-11: exact database assertions passed` means every
assertion in `scripts/db-journey.sql` passed.

Fitness counterexamples come from the committed runner:

```bash
mise exec -- python3 scripts/db_journey_fitness.py              # all cases
mise exec -- python3 scripts/db_journey_fitness.py --case c11-tie-order
mise exec -- python3 scripts/db_journey_fitness.py --list
```

Each case removes or inverts one guarded behavior in a disposable context. It
counts as demonstrated only if the canonical check fails with the exact expected
label. An unexpected pass, a different failure, or a setup error is reported as
not demonstrated. Every case is a SQL case: it changes the
`scripts/db-journey.sql` probe text in memory. All cases share one
`kneeboard_journey_<id>` project. The runner removes that project, then verifies
that no containers or volumes remain and that `git status` is unchanged.
`tests/journey/test_db_journey_fitness.py` runs in `pnpm test` without Docker.
It fails if a source edit moves a mutation anchor or renames an expected label.

## Status key

- **Strengthened**: a gap named in the issue. The check is new or now exact.
  Each SQL-probe claim has at least one fitness case.
- **Existing guard**: already satisfied at the baseline and kept unchanged
  apart from the `6a` label prefix. It is a regression guard, not new evidence.
  Fitness is shown only where the same case also covers it.

Locators give a file and the assertion's label, not a line number. Search the
file for the label.

## Coverage

| 6a claim | Constituent obligation | Status | Check locator | Positive output | Fitness case → expected failure | Related 6b |
| --- | --- | --- | --- | --- | --- | --- |
| C-1 | Published binding is loopback on the allocated port | Strengthened | `scripts/db_journey.py` `assert_published_binding`, `6a C-1 published loopback binding on the allocated port` | `6a C-1 published loopback binding on the allocated port: pass` | None | None |
| C-1 | Running image is the pinned digest | Existing guard | `scripts/db_journey.py` `6a C-1 pinned image` | `6a C-1 pinned image: pass` | None | None |
| C-1 | Both databases exist under their exact names | Existing guard | `scripts/db_journey.py` `6a C-1 development database`, `6a C-1 test database` | `... : pass` for each | None | None |
| C-2 | Each selected reset removes its own marker | Strengthened | `scripts/db_journey.py` `assert_reset_markers`, `6a C-2 dev reset removes the dev marker`, `6a C-2 test reset removes the test marker` | `... : pass` for each | None | None |
| C-2 | Each reset preserves the exact sibling marker | Existing guard, now an exact marker | `scripts/db_journey.py` `assert_reset_markers`, `6a C-2 dev reset preserves the exact test marker`, `6a C-2 test reset preserves the exact dev marker` | `... : pass` for each | None | None |
| C-2 | Both exact markers survive stop and start | Strengthened | `scripts/db_journey.py` `assert_restart_markers`, `6a C-2 restart retains the exact dev marker`, `6a C-2 restart retains the exact test marker` | `... : pass` for each | None | None |
| C-2 | Stop stops the container current at the stop boundary, even if Compose replaced the startup container; restart reconnects; unknown, remote, invalid-port, and remote-Docker inputs exit 2 | Existing guard; current-ID regression test | `scripts/db_journey.py` `6a C-2 stop`, `tests/journey/test_db_journey_stop.py`, `6a C-2 restart`, `6a C-2: ...` rejection lines | `6a C-2 stop: pass`, `6a C-2 restart: pass`, `6a C-2: ... rejected` | `test_stop_inspects_current_container_after_recreation` fails on the stale startup ID; a fresh-pull Journey with the fix removed fails at `docker inspect` with `no such object` | None |
| C-4 | Every supplied user, session, account, verification, and rate-limit field round-trips exactly | Strengthened | `scripts/db-journey.sql` `6a C-4: user fields changed`, `6a C-4: session fields changed`, `6a C-4: account fields changed`, `6a C-4: verification fields changed`, `6a C-4: rate-limit fields changed` | `6a C-4 through 6a C-11: exact database assertions passed` | `c4-user-email`, `c4-session-expiry`, `c4-account-subject`, `c4-verification-value`, `c4-rate-limit-last-request` (an insert trigger changes one supplied field) → the matching label | None |
| C-4 | All ten persistence tables exist | Existing guard | `scripts/db-journey.sql` `6a C-4: required table missing` | Same summary line | None | None |
| C-5 | A NULL Pilot ID is accepted and stored as NULL | Strengthened | `scripts/db-journey.sql` `6a C-5: NULL Pilot ID rejected`, `6a C-5: NULL Pilot ID not stored as NULL` | Same summary line | `c5-null-pilot-id` (column made `NOT NULL`) → `6a C-5: NULL Pilot ID rejected` | None |
| C-5 | Leading zeros are preserved; letters and 17 digits are rejected | Existing guard | `scripts/db-journey.sql` `6a C-5: leading zeros changed`, `6a C-5: letters accepted`, `6a C-5: seventeen digits accepted` | Same summary line | None | None |
| C-6 | Every supplied `ofp_load` column round-trips exactly | Strengthened | `scripts/db-journey.sql` `6a C-6: load metadata changed` | Same summary line | `c6-idempotency-key` (an insert trigger changes the key) → `6a C-6: load metadata changed` | 6b C-12 compares persisted metadata written by the load operation |
| C-6 | Raw JSON is equal and kept out of the metadata table | Existing guard | `scripts/db-journey.sql` `6a C-6: raw JSON changed`, `6a C-6: raw payload is in metadata table` | Same summary line | None | 6b C-12 compares raw JSON written by the load operation |
| C-7 | A snapshot without a version is rejected | Strengthened | `scripts/db-journey.sql` `6a C-7: missing snapshot version accepted` | Same summary line | `c7-missing-snapshot-version` (the check keeps only version equality) → `6a C-7: missing snapshot version accepted` | None |
| C-7 | Navlog and snapshot round-trip exactly at version 1; a mismatched version is rejected | Existing guard | `scripts/db-journey.sql` `6a C-7: tracker aggregate round trip or initial version failed`, `6a C-7: mismatched snapshot version accepted` | Same summary line | None | 6b C-12 compares the navlog and initial tracker written by the load operation |
| C-9 | The exact active key and microsecond timestamp are stored; clearing the key leaves that timestamp unchanged | Strengthened | `scripts/db-journey.sql` `6a C-9: reservation insert changed key or timestamp`, `6a C-9: clearing active key changed the reservation` | Same summary line | `c9-insert-timestamp` (insert trigger shifts it 1 µs) and `c9-clear-timestamp` (update trigger shifts it 1 µs) → the matching label | 6b C-6 to C-11 exercise reservation claims through the application |
| C-9 | An active key without a timestamp and a second reservation for an account are rejected | Existing guard | `scripts/db-journey.sql` `6a C-9: active key without attempt accepted`, `6a C-9: duplicate account reservation accepted` | Same summary line | None | None |
| C-11 | Returned order is compared directly, with no second sort, proving the timestamp/ID descending tie order, the ten-row limit, and the account filter | Strengthened | `scripts/db-journey.sql` `6a C-11: recent-ten membership or order incorrect` | Same summary line | `c11-tie-order` (inner `id DESC` becomes `id ASC`), `c11-account-filter`, `c11-row-limit` → `6a C-11: recent-ten membership or order incorrect` | None |
| C-11 | The query uses the recent-load index and never reads raw payloads | Existing guard | `scripts/db-journey.sql` `6a C-11: recent-load index not used`, `6a C-11: metadata query touches raw table` | Same summary line | `c11-index` (index dropped) → `6a C-11: recent-load index not used` | None |

The other 6a claims (C-7a, C-8, C-8a, C-10, C-13, C-14, and C-17) were already
fully covered and are unchanged apart from the `6a` label prefix.

## Not proved here

This Journey uses synthetic storage states. It does not prove authentication,
account isolation through the application, sign-in or UI behavior, or the
load-to-tracker flow. The F-1 to F-4 forward obligations must re-reach these
states through the real application operations in later sections. The 6b tests
cover only the application operations they name.
