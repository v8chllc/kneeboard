"""Reproduce fitness counterexamples for the strengthened 6a database Journey checks.

Usage, from the repository root:

    mise exec -- python3 scripts/db_journey_fitness.py            # every case
    mise exec -- python3 scripts/db_journey_fitness.py --case c11-tie-order
    mise exec -- python3 scripts/db_journey_fitness.py --list

Each case removes or inverts one guarded behavior and runs the canonical
Journey's own check against the result. A case is ``demonstrated`` only when
the failure carries the exact expected 6a claim label. An unexpected pass, a
different failure, a missing or repeated mutation anchor, or a setup error is
reported as ``not demonstrated``. The positive observations come from the
canonical ``mise exec -- pnpm journey:db``; this runner proves only that the
checks fail for the right reason. It is not part of ``pnpm journey`` or CI.

Mutations never touch the checkout: every case changes the
``scripts/db-journey.sql`` probe text in memory. Most insert synthetic DDL (a
trigger, a dropped or weakened constraint or index) right after the probe's
only transaction start, so the change rolls back with the probe; the C-11
query cases replace one exact query fragment instead.

Resources: all cases share one ``kneeboard_journey_<12 hex>`` Compose project on
a free loopback port. A ``finally`` removes that project, verifies that no
container or volume labelled with it remains, and requires
``git status --porcelain`` to be unchanged. The developer's ``kneeboard``
project is never targeted. All data is synthetic.

Processes and output: every command runs through db_journey's bounded helpers
and their budgets; printed failure lines pass through its credential redaction.
Exit status 0 means every selected case was demonstrated and cleanup verified.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import uuid
from dataclasses import dataclass

import db_journey as db


ROOT = db.ROOT
TRANSACTION_START = "BEGIN;\n"
# The probe's only rollback, so a mutation undoes itself even if the probe passes.
ROLLBACK = "ROLLBACK;"
PROBE = ROOT / "scripts/db-journey.sql"
OBSERVED_CHARACTERS = 1200


def trigger(table: str, timing: str, assignment: str) -> str:
    """DDL for a synthetic trigger that rewrites one supplied field; rolled back with the probe."""
    return (
        "CREATE FUNCTION fitness_mutation() RETURNS trigger LANGUAGE plpgsql AS "
        f"$fitness$ BEGIN {assignment}; RETURN NEW; END $fitness$;\n"
        f"CREATE TRIGGER fitness_mutation BEFORE {timing} ON {table} "
        "FOR EACH ROW EXECUTE FUNCTION fitness_mutation();\n"
    )


@dataclass(frozen=True)
class SqlCase:
    """Run the probe with ``anchor`` (which must occur exactly once) replaced by ``replacement``."""

    name: str
    claim: str
    description: str
    label: str
    replacement: str
    anchor: str = TRANSACTION_START

    def mutated(self) -> str:
        return apply_once(PROBE.read_text(), self.anchor, self.replacement, PROBE.name)


class NotDemonstrated(Exception):
    """The case could not reach, or did not fail at, its intended assertion."""


def apply_once(text: str, anchor: str, replacement: str, source: str) -> str:
    count = text.count(anchor)
    if count != 1:
        raise NotDemonstrated(f"mutation anchor occurs {count} times in {source}, expected exactly once: {anchor!r}")
    return text.replace(anchor, replacement)


def after_start(ddl: str) -> str:
    return TRANSACTION_START + ddl


RECENT_ORDER = "    ORDER BY loaded_at DESC, id DESC LIMIT 10);"
RECENT_FILTER = "    SELECT id::text FROM ofp_load WHERE user_id='journey-a'\n"

SQL_CASES = [
    SqlCase("c4-user-email", "6a C-4", "BEFORE INSERT trigger rewrites each supplied user email",
            "6a C-4: user fields changed",
            after_start(trigger('"user"', "INSERT", "NEW.email := 'altered-' || NEW.email"))),
    SqlCase("c4-session-expiry", "6a C-4", "BEFORE INSERT trigger shifts each supplied session expiry by 1 microsecond",
            "6a C-4: session fields changed",
            after_start(trigger("session", "INSERT", "NEW.expires_at := NEW.expires_at + interval '1 microsecond'"))),
    SqlCase("c4-account-subject", "6a C-4", "BEFORE INSERT trigger rewrites each supplied provider account id",
            "6a C-4: account fields changed",
            after_start(trigger("account", "INSERT", "NEW.account_id := NEW.account_id || '-altered'"))),
    SqlCase("c4-verification-value", "6a C-4", "BEFORE INSERT trigger rewrites each supplied verification value",
            "6a C-4: verification fields changed",
            after_start(trigger("verification", "INSERT", "NEW.value := NEW.value || '-altered'"))),
    SqlCase("c4-rate-limit-last-request", "6a C-4", "BEFORE INSERT trigger adds 1 to each supplied rate-limit last_request",
            "6a C-4: rate-limit fields changed",
            after_start(trigger("rate_limit", "INSERT", "NEW.last_request := NEW.last_request + 1"))),
    SqlCase("c5-null-pilot-id", "6a C-5", "make account_settings.pilot_id NOT NULL",
            "6a C-5: NULL Pilot ID rejected",
            after_start("ALTER TABLE account_settings ALTER COLUMN pilot_id SET NOT NULL;\n")),
    SqlCase("c6-idempotency-key", "6a C-6", "BEFORE INSERT trigger rewrites each supplied ofp_load idempotency key",
            "6a C-6: load metadata changed",
            after_start(trigger("ofp_load", "INSERT", "NEW.idempotency_key := NEW.idempotency_key || '-altered'"))),
    SqlCase("c7-missing-snapshot-version", "6a C-7",
            "weaken tracker_snapshot_version_matches to drop only its version-present requirement "
            "(a mismatched version is still rejected)",
            "6a C-7: missing snapshot version accepted",
            after_start(
                "ALTER TABLE tracker DROP CONSTRAINT tracker_snapshot_version_matches;\n"
                "ALTER TABLE tracker ADD CONSTRAINT tracker_snapshot_version_matches "
                "CHECK ((snapshot ->> 'version')::integer = version);\n")),
    SqlCase("c9-insert-timestamp", "6a C-9", "BEFORE INSERT trigger shifts each reservation accepted_at by 1 microsecond",
            "6a C-9: reservation insert changed key or timestamp",
            after_start(trigger("load_reservation", "INSERT", "NEW.accepted_at := NEW.accepted_at + interval '1 microsecond'"))),
    SqlCase("c9-clear-timestamp", "6a C-9", "BEFORE UPDATE trigger shifts accepted_at by 1 microsecond when the key is cleared",
            "6a C-9: clearing active key changed the reservation",
            after_start(trigger("load_reservation", "UPDATE", "NEW.accepted_at := NEW.accepted_at + interval '1 microsecond'"))),
    SqlCase("c11-tie-order", "6a C-11", "reverse only the returned-order query's inner id tie order (id DESC -> id ASC)",
            "6a C-11: recent-ten membership or order incorrect",
            RECENT_ORDER.replace("id DESC", "id ASC"), anchor=RECENT_ORDER),
    SqlCase("c11-account-filter", "6a C-11", "widen the returned-order query's account filter to include journey-b",
            "6a C-11: recent-ten membership or order incorrect",
            RECENT_FILTER.replace("user_id='journey-a'", "user_id IN ('journey-a','journey-b')"), anchor=RECENT_FILTER),
    SqlCase("c11-row-limit", "6a C-11", "raise the returned-order query's limit from 10 to 11",
            "6a C-11: recent-ten membership or order incorrect",
            RECENT_ORDER.replace("LIMIT 10", "LIMIT 11"), anchor=RECENT_ORDER),
    SqlCase("c11-index", "6a C-11", "drop ofp_load_recent_by_user_idx",
            "6a C-11: recent-load index not used",
            after_start("DROP INDEX ofp_load_recent_by_user_idx;\n")),
]


CASES: dict[str, SqlCase] = {case.name: case for case in SQL_CASES}


def base_env(project: str, port: int) -> dict[str, str]:
    env = os.environ.copy()
    env.update(KNEEBOARD_DB_PROJECT=project, KNEEBOARD_DB_PORT=str(port))
    for name in ("DATABASE_URL", "COMPOSE_FILE", "COMPOSE_PROJECT_NAME", "COMPOSE_ENV_FILES"):
        env.pop(name, None)
    return env


class Registry:
    """Every project name the runner creates, for the final cleanup."""

    def __init__(self) -> None:
        self.projects: list[str] = []

    def new_project(self) -> str:
        project = f"kneeboard_journey_{uuid.uuid4().hex[:12]}"
        self.projects.append(project)
        return project


def psql_args(env: dict[str, str], database: str) -> list[str]:
    return db.compose_args(env) + ["exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-U", "kneeboard", "-d", database, "-Atq"]


def run_probe(env: dict[str, str], text: str) -> db.Completed:
    return db.run_bounded(psql_args(env, "kneeboard_test"), env, budget="JOURNEY_SQL_TIMEOUT_SECONDS", input_text=text)


def sql_failure_line(result: db.Completed, label: str) -> str:
    """Return the probe's ERROR line when it raised exactly ``label``; otherwise NotDemonstrated."""
    if result.returncode == 0:
        raise NotDemonstrated("unexpected pass: the mutated probe completed")
    errors = [line for line in db.redact_userinfo(result.stderr).splitlines() if "ERROR:" in line]
    pattern = re.compile(r"ERROR:\s+" + re.escape(label) + r"(?::|$)")
    for line in errors:
        if pattern.search(line):
            return line.strip()[:OBSERVED_CHARACTERS]
    raise NotDemonstrated(f"failed elsewhere (exit {result.returncode}): {' | '.join(errors)[:OBSERVED_CHARACTERS] or db.safe_tail(result.stderr)}")


class SqlProject:
    """The one disposable project all SQL cases share, with a migrated test database."""

    def __init__(self, registry: Registry) -> None:
        self.env = base_env(registry.new_project(), db.free_port())
        self.started = False

    def start(self) -> None:
        self.started = True
        db.local("start", self.env)
        db.local("migrate", self.env, "test")
        control = run_probe(self.env, PROBE.read_text())
        if control.returncode != 0:
            raise NotDemonstrated(f"control: unmutated {PROBE.name} failed: {db.safe_tail(control.stderr)}")
        print(f"CONTROL unmutated {PROBE.name}: pass", flush=True)

    def run(self, case: SqlCase) -> str:
        return sql_failure_line(run_probe(self.env, case.mutated()), case.label)


def git_status() -> str:
    return db.command(["git", "status", "--porcelain"], os.environ.copy(), budget="GIT_STATUS_TIMEOUT_SECONDS")


def cleanup(registry: Registry) -> list[str]:
    """Remove every named project; return problems instead of raising."""
    problems: list[str] = []
    for project in registry.projects:
        env = base_env(project, 54329)
        try:
            db.cleanup_compose(env, None)
        except (AssertionError, OSError) as error:
            problems.append(str(error))
        try:
            containers, volumes = db.project_resources(project, env)
        except (AssertionError, OSError) as error:
            problems.append(f"could not list resources of {project}: {error}")
        else:
            if containers or volumes:
                problems.append(f"{project} still has containers {containers!r} or volumes {volumes!r}")
    return problems


def run(selected: list[SqlCase]) -> int:
    registry = Registry()
    before_status = git_status()
    results: list[tuple[str, bool]] = []
    problems: list[str] = []
    try:
        project = SqlProject(registry)
        print(f"SQL PROJECT {project.env['KNEEBOARD_DB_PROJECT']}", flush=True)
        project.start()
        for case in selected:
            print(f"CASE {case.name} ({case.claim}): {case.description}", flush=True)
            print(f"  expected assertion: {case.label}", flush=True)
            try:
                print(f"  mutation: {PROBE.name} in memory, anchor found once", flush=True)
                observed = project.run(case)
            except NotDemonstrated as error:
                print(f"  observed: {error}", flush=True)
                print("  result: NOT DEMONSTRATED", flush=True)
                results.append((case.name, False))
            else:
                print(f"  observed: {observed}", flush=True)
                print("  result: demonstrated", flush=True)
                results.append((case.name, True))
    finally:
        problems = cleanup(registry)
        try:
            after_status = git_status()
        except (AssertionError, OSError) as error:
            problems.append(f"git status failed: {error}")
        else:
            if after_status != before_status:
                problems.append("git status --porcelain changed during the run")
        for problem in problems:
            print(f"CLEANUP PROBLEM {problem}", file=sys.stderr, flush=True)
        if not problems:
            print(f"CLEANUP VERIFIED {len(registry.projects)} projects removed with no containers or volumes left; "
                  "git status --porcelain unchanged", flush=True)
    failed = [name for name, ok in results if not ok]
    print(f"SUMMARY demonstrated {len(results) - len(failed)} of {len(results)}"
          + (f"; not demonstrated: {', '.join(failed)}" if failed else ""), flush=True)
    return 0 if not failed and not problems and len(results) == len(selected) else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Reproduce 6a database Journey fitness counterexamples.")
    parser.add_argument("--case", action="append", choices=sorted(CASES), help="run only this case; repeatable")
    parser.add_argument("--list", action="store_true", help="list cases and their expected labels")
    args = parser.parse_args(argv)
    if args.list:
        for case in CASES.values():
            print(f"{case.name}\t{case.claim}\t{case.label}")
        return 0
    selected = [CASES[name] for name in args.case] if args.case else list(CASES.values())
    return run(selected)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (AssertionError, OSError, NotDemonstrated) as error:
        print(f"Database Journey fitness run failed: {db.redact_userinfo(str(error))}", file=sys.stderr)
        sys.exit(1)
