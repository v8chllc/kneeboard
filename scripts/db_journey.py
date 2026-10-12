"""Run the 6a database journey in a disposable, loopback-only Compose project.

Resources: the Journey creates one Compose project named
``kneeboard_journey_<12 hex>`` on a free loopback port, with its own containers
and volume, plus temporary files under ``.local/``. The 6a C-2b check also names a
second, decoy ``kneeboard_journey_<12 hex>`` project through hostile Compose
selectors and asserts that nothing was created under it. The only destructive
actions are database resets inside the Journey's project and
``docker compose down -v`` of the Journey's project and of the decoy name; the
developer's ``kneeboard`` project and databases are never targeted.

Claims: every printed or raised 6a claim label starts with ``6a `` so it is not
confused with the 6b operation claims. The importable checks below
(assert_published_binding, assert_reset_markers, assert_restart_markers,
assert_no_project, table_state, assert_state_unchanged) are shared with
``scripts/db_journey_fitness.py``, which identifies a failing assertion by its
exact label; docs/database-journey-coverage.md maps each label to its claim.

Processes: every command runs through run_bounded in a new session, so the
command and its descendants form one process group the Journey owns. Each command
has a named budget below; on expiry the group receives SIGTERM, then SIGKILL after
TERMINATION_GRACE_SECONDS, and JourneyTimeout is raised. The 6a C-17 application
server is the one long-lived process; it is polled for a bounded startup window
and stopped through the same termination routine. Only groups the Journey
started are signalled.

Errors and cleanup: an assertion, timeout, or interruption after startup still
reaches the bounded Compose teardown in ``main``, which also removes the decoy
name once its adversarial start was attempted. The first failure stays primary
and a cleanup failure is printed beside it; a cleanup failure alone fails the
run. Removal is claimed only when ``down`` exits 0. A timeout before startup
skips teardown. An assertion, timeout, or OS error exits 1 with a one-line
reason; nonzero diagnostics include command lines, numeric exit codes, and
separately labelled redacted output tails, never the environment or stdin.

Environment: POSIX only (macOS and Linux); it relies on sessions, process groups,
and a local Docker socket, and needs ``mise``, ``pnpm``, and Docker Compose.
"""

from __future__ import annotations

import json
import math
import os
import re
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import NamedTuple


ROOT = Path(__file__).resolve().parents[1]
EXPECTED_MIGRATIONS = [1790293061053, 1790294641213]

# Execution budgets, in seconds, for every subprocess the Journey owns. Each is a
# deadline for one command, from launch until it exits and closes its output.
# Tests inject short limits by patching these names; there is no runtime override.
# Calibrated on 2026-10-01 against an Apple Silicon Mac with Docker Desktop and
# against CI step times on ubuntu-latest. Every limit is at least ten times the
# slowest observed run of its operation, so a slow machine or network does not
# time out a healthy run, while a stalled command still ends within minutes.
DOCKER_QUERY_TIMEOUT_SECONDS = 30  # context/inspect and compose ps; observed under 0.1 s
PSQL_TIMEOUT_SECONDS = 30  # one short query through compose exec; observed under 0.2 s
JOURNEY_SQL_TIMEOUT_SECONDS = 60  # scripts/db-journey.sql; observed under 0.1 s
VALIDATION_TIMEOUT_SECONDS = 30  # local-db.sh argument rejections; observed under 0.1 s
# compose up --wait: 22 s with a cold pull of the 668 MB pinned image, 3 s warm.
LOCAL_START_TIMEOUT_SECONDS = 300
LOCAL_COMMAND_TIMEOUT_SECONDS = 60  # local-db.sh stop, reset, verify; observed under 0.3 s
MIGRATE_TIMEOUT_SECONDS = 120  # drizzle-kit migrate through mise and pnpm; observed under 1.3 s
INSTALL_TIMEOUT_SECONDS = 600  # pnpm install --frozen-lockfile; 8 s cold in CI, 20 s locally
LINT_TIMEOUT_SECONDS = 300  # observed 3 s in CI
TYPECHECK_TIMEOUT_SECONDS = 300  # observed 4 s in CI
TEST_TIMEOUT_SECONDS = 600  # full suite, including these timeout tests; observed 15 s
BUILD_TIMEOUT_SECONDS = 900  # next build; observed 10 s in CI
OPERATION_TEST_TIMEOUT_SECONDS = 180  # isolated PostgreSQL operation claims; local run under 15 s
COMPOSE_CLEANUP_TIMEOUT_SECONDS = 60  # down -v --remove-orphans; observed under 0.4 s
GIT_STATUS_TIMEOUT_SECONDS = 30  # git status --porcelain, fitness runner checkout guard; observed under 0.1 s
# Time an owned process group gets after SIGTERM before SIGKILL, and the bound on
# each later wait: reaping the leader and draining its output pipes.
TERMINATION_GRACE_SECONDS = 5

LOCAL_BUDGETS = {
    "start": "LOCAL_START_TIMEOUT_SECONDS",
    "migrate": "MIGRATE_TIMEOUT_SECONDS",
    "stop": "LOCAL_COMMAND_TIMEOUT_SECONDS",
    "reset": "LOCAL_COMMAND_TIMEOUT_SECONDS",
    "verify": "LOCAL_COMMAND_TIMEOUT_SECONDS",
}
GATE_BUDGETS = {
    "lint": "LINT_TIMEOUT_SECONDS",
    "typecheck": "TYPECHECK_TIMEOUT_SECONDS",
    "test": "TEST_TIMEOUT_SECONDS",
}
STDERR_TAIL_CHARACTERS = 500

# Exact 6a claim labels for the checks shared with scripts/db_journey_fitness.py.
C1_BINDING_LABEL = "6a C-1 published loopback binding on the allocated port"
RESET_REMOVAL_LABELS = {
    "dev": "6a C-2 dev reset removes the dev marker",
    "test": "6a C-2 test reset removes the test marker",
}
RESET_SIBLING_LABELS = {
    "dev": "6a C-2 dev reset preserves the exact test marker",
    "test": "6a C-2 test reset preserves the exact dev marker",
}
RESTART_MARKER_LABELS = {
    "dev": "6a C-2 restart retains the exact dev marker",
    "test": "6a C-2 restart retains the exact test marker",
}
NO_DECOY_CONTAINERS_LABEL = "6a C-2b no containers for the caller-selected decoy project"
NO_DECOY_VOLUMES_LABEL = "6a C-2b no volumes for the caller-selected decoy project"
ROLLBACK_LABELS = {
    ("verify-local-schema.sql", "kneeboard_test"): "6a C-15 verify-local-schema.sql leaves every kneeboard_test table unchanged",
    ("verify-local-schema.sql", "kneeboard_dev"): "6a C-15 verify-local-schema.sql leaves every kneeboard_dev table unchanged",
    ("db-journey.sql", "kneeboard_test"): "6a C-15 db-journey.sql leaves every kneeboard_test table unchanged",
}
PERSISTENCE_TABLES = (
    "user", "session", "account", "verification", "rate_limit",
    "account_settings", "load_reservation", "ofp_load", "ofp_raw", "tracker",
)
MARKER_TABLE = "journey_marker"
ABSENT_MARKER = "<absent>"
# One "table=rows:md5" entry per public base table, sorted by name. The md5 covers
# every row's text in sorted order, so any inserted, deleted, or changed row in any
# table changes the entry; "empty" stands for a table with no rows.
TABLE_STATE_SQL = """SELECT string_agg(format('%s=%s', listed.table_name, measured.state), ';' ORDER BY listed.table_name)
FROM information_schema.tables AS listed,
LATERAL (SELECT (xpath('/row/state/text()', query_to_xml(format(
  'SELECT count(*) || '':'' || coalesce(md5(string_agg(stored::text, '','' ORDER BY stored::text)), ''empty'') AS state FROM %I.%I AS stored',
  listed.table_schema, listed.table_name), false, true, '')))[1]::text AS state) AS measured
WHERE listed.table_schema = 'public' AND listed.table_type = 'BASE TABLE';"""


class JourneyTimeout(AssertionError):
    """A Journey command exceeded its budget and its process group was terminated.

    Subclasses AssertionError so the existing exit-1 path and cleanup precedence
    apply unchanged. The message names the command line, the budget and its
    limit, any termination problems, and a capped, credential-redacted tail of
    the command's stderr; it never includes the environment or stdin.
    """

    def __init__(self, args: list[str], budget: str, seconds: float, stderr_tail: str = "", problems: list[str] | None = None) -> None:
        self.command_args = list(args)
        self.budget = budget
        self.seconds = seconds
        self.stderr_tail = stderr_tail
        self.problems = list(problems or [])
        message = f"{' '.join(args)} timed out after {seconds:g} seconds ({budget})"
        if self.problems:
            message += f"; termination problems: {'; '.join(self.problems)}"
        if stderr_tail:
            message += f"; stderr tail: {stderr_tail}"
        super().__init__(message)


class Completed(NamedTuple):
    """Exit status and captured text output of a bounded command."""

    returncode: int
    stdout: str
    stderr: str


def budget_seconds(budget: str) -> float:
    """Return the current value of a named budget constant, which must be finite and positive."""
    value = globals().get(budget) if budget.endswith("_TIMEOUT_SECONDS") else None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
        raise ValueError(f"unknown or unbounded Journey budget: {budget}")
    return float(value)


def leader_exited(process: subprocess.Popen) -> bool:
    """Report whether the group leader has exited, without reaping it.

    An unreaped leader keeps its pid, and so its process-group id, from being
    reused, which keeps a later group signal aimed at the group this Journey
    created. Python before 3.13 on macOS lacks os.waitid; there this reports
    True only once the whole group has exited, which macOS signals by refusing
    signal 0 to a group whose only member is the unreaped leader. Until then
    callers wait out their grace period instead of ending it early.
    """
    if process.returncode is not None:
        return True
    if not hasattr(os, "waitid"):
        try:
            os.killpg(process.pid, 0)
        except (PermissionError, ProcessLookupError):
            return True
        except OSError:
            return False
        return False
    try:
        return os.waitid(os.P_PID, process.pid, os.WEXITED | os.WNOHANG | os.WNOWAIT) is not None
    except ChildProcessError:
        return True


def signal_group(process: subprocess.Popen, sig: signal.Signals, problems: list[str]) -> None:
    if process.returncode is not None:
        # The leader was reaped, so its pid may now identify an unrelated group.
        return
    try:
        os.killpg(process.pid, sig)
    except ProcessLookupError:
        pass
    except PermissionError as error:
        # macOS refuses to signal a group whose only member is an unreaped leader.
        if not leader_exited(process):
            problems.append(f"{error} ({sig.name} to process group {process.pid})")
    except OSError as error:
        problems.append(f"{error} ({sig.name} to process group {process.pid})")


def terminate_process_group(process: subprocess.Popen, grace: float) -> list[str]:
    """Stop and reap a process group the Journey started with start_new_session.

    Sends SIGTERM to the group, waits up to ``grace`` seconds for the leader to
    exit, then sends SIGKILL to the group so descendants that ignore SIGTERM or
    outlive the leader also stop, and finally reaps the leader within ``grace``.
    Both signals are sent before the leader is reaped, and no signal is sent
    once it has been, so they go only to the group led by ``process``. Returns problems, such as a refused signal or a
    leader that never exited, as text for the caller to report; never raises for
    them. Descendants are reparented and reaped by the system, not here.
    """
    problems: list[str] = []
    signal_group(process, signal.SIGTERM, problems)
    deadline = time.monotonic() + grace
    while not leader_exited(process) and time.monotonic() < deadline:
        time.sleep(0.05)
    signal_group(process, signal.SIGKILL, problems)
    try:
        process.wait(timeout=grace)
    except subprocess.TimeoutExpired:
        problems.append(f"process {process.pid} did not exit within {grace:g} seconds of SIGKILL")
    return problems


def output_text(value: str | bytes | None) -> str:
    if isinstance(value, bytes):
        return value.decode(errors="replace")
    return value or ""


def redact_userinfo(text: str) -> str:
    return re.sub(r"([A-Za-z][A-Za-z0-9+.-]*://)[^\s/@]+@", r"\1***@", text)


def safe_tail(text: str) -> str:
    return redact_userinfo(text.strip())[-STDERR_TAIL_CHARACTERS:]


def run_bounded(args: list[str], env: dict[str, str], *, budget: str, input_text: str | None = None) -> Completed:
    """Run one command from the repository root under a named, finite budget.

    The command runs in a new session, so it and every descendant form one
    process group that this call owns. stdin is ``input_text`` or /dev/null;
    stdout and stderr are captured as text. The budget covers launch through the
    leader's exit and EOF on both output pipes, so a descendant that holds an
    inherited pipe open also counts against it.

    On expiry the group is terminated (see terminate_process_group), output is
    drained for at most TERMINATION_GRACE_SECONDS more, the pipes are closed, and
    JourneyTimeout is raised. An interruption such as KeyboardInterrupt also
    terminates the group before propagating, because a new session no longer
    receives the terminal's signals. Launch failures raise OSError. A nonzero
    exit is returned, not raised. The worst case is the budget plus three grace
    periods (signal wait, leader reap, pipe drain).
    """
    seconds = budget_seconds(budget)
    grace = float(TERMINATION_GRACE_SECONDS)
    process = subprocess.Popen(
        args,
        cwd=ROOT,
        env=env,
        stdin=subprocess.PIPE if input_text is not None else subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=True,
    )
    try:
        stdout, stderr = process.communicate(input_text, timeout=seconds)
    except subprocess.TimeoutExpired as expired:
        problems = terminate_process_group(process, grace)
        stderr = output_text(expired.stderr)
        try:
            # A retried communicate keeps the output already read.
            stderr = output_text(process.communicate(timeout=grace)[1])
        except subprocess.TimeoutExpired as held:
            stderr = output_text(held.stderr) or stderr
            problems.append(f"output pipes still open {grace:g} seconds after termination")
        finally:
            close_pipes(process)
        raise JourneyTimeout(args, budget, seconds, safe_tail(stderr), problems) from None
    except BaseException:
        terminate_process_group(process, grace)
        close_pipes(process)
        raise
    return Completed(process.returncode, stdout, stderr)


def close_pipes(process: subprocess.Popen) -> None:
    for stream in (process.stdin, process.stdout, process.stderr):
        if stream is not None:
            try:
                stream.close()
            except OSError:
                pass


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def command(args: list[str], env: dict[str, str], *, budget: str, input_text: str | None = None) -> str:
    """Run a bounded command and return its stripped stdout; raise AssertionError on a nonzero exit."""
    result = run_bounded(args, env, budget=budget, input_text=input_text)
    if result.returncode != 0:
        detail = f"{' '.join(redact_userinfo(arg) for arg in args)} failed with exit code {result.returncode}"
        for label, output in (("stderr", result.stderr), ("stdout", result.stdout)):
            tail = safe_tail(output)
            if tail:
                detail += f"; {label} tail: {tail}"
        raise AssertionError(detail)
    return result.stdout.strip()


def psql(database: str, sql: str, env: dict[str, str], *, budget: str = "PSQL_TIMEOUT_SECONDS") -> str:
    return command(
        compose_args(env) + ["exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-U", "kneeboard", "-d", database, "-Atq"],
        env,
        budget=budget,
        input_text=sql,
    )


def local(action: str, env: dict[str, str], database: str | None = None) -> None:
    command(
        ["sh", "scripts/local-db.sh", "--journey-project", env["KNEEBOARD_DB_PROJECT"], action, *([database] if database else [])],
        env,
        budget=LOCAL_BUDGETS[action],
    )


def compose_args(env: dict[str, str]) -> list[str]:
    return ["docker", "compose", "--project-directory", str(ROOT), "-f", str(ROOT / "compose.yaml"), "-p", env["KNEEBOARD_DB_PROJECT"]]


def require(actual: str, expected: str, claim: str) -> None:
    if actual != expected:
        raise AssertionError(f"{claim}: expected {expected!r}, got {actual!r}")
    print(f"{claim}: pass")


def report_cleanup_failure(message: str, earlier: BaseException | None) -> None:
    if earlier is not None:
        print(f"{message}; original failure: {earlier}", file=sys.stderr)
    else:
        raise AssertionError(message)


def cleanup_compose(env: dict[str, str], earlier: BaseException | None) -> None:
    """Remove the Journey's own Compose project, containers, and volumes.

    Destroys only the uniquely named project in ``env``. The command is bounded
    by COMPOSE_CLEANUP_TIMEOUT_SECONDS and its process group is terminated on
    expiry. Only exit status 0 counts as removal; a nonzero exit, launch failure,
    or timeout is reported as unconfirmed removal through report_cleanup_failure,
    so an earlier failure stays primary. A Docker CLI exit does not prove the
    daemon finished; a stalled daemon is reported, not waited out.
    """
    project = env["KNEEBOARD_DB_PROJECT"]
    args = compose_args(env) + ["down", "-v", "--remove-orphans"]
    try:
        cleanup = run_bounded(args, env, budget="COMPOSE_CLEANUP_TIMEOUT_SECONDS")
    except (OSError, JourneyTimeout) as error:
        detail = str(error)
    else:
        if cleanup.returncode == 0:
            return
        detail = f"{' '.join(redact_userinfo(arg) for arg in args)} failed with exit code {cleanup.returncode}"
        tail = safe_tail(cleanup.stderr)
        if tail:
            detail += f"; stderr tail: {tail}"
    report_cleanup_failure(f"isolated Compose cleanup failed: {detail}; removal of {project} not confirmed", earlier)


def journal(database: str, env: dict[str, str]) -> str:
    return psql(database, "SELECT string_agg(created_at::text, ',' ORDER BY created_at) FROM drizzle.__drizzle_migrations;", env)


def postgres_container(env: dict[str, str]) -> str:
    return command(compose_args(env) + ["ps", "-q", "postgres"], env, budget="DOCKER_QUERY_TIMEOUT_SECONDS")


def assert_published_binding(container: str, env: dict[str, str]) -> None:
    """6a C-1: Docker publishes PostgreSQL only on 127.0.0.1, at the allocated port.

    Reads the running container's actual port bindings rather than compose.yaml,
    and requires exactly one binding for 5432/tcp: host address 127.0.0.1 and
    host port ``KNEEBOARD_DB_PORT``. Another loopback spelling, an extra or
    all-interfaces binding, or a different port fails C1_BINDING_LABEL.
    """
    ports = json.loads(command(["docker", "inspect", "--format", "{{json .NetworkSettings.Ports}}", container], env, budget="DOCKER_QUERY_TIMEOUT_SECONDS"))
    actual = ports.get("5432/tcp") if isinstance(ports, dict) else ports
    expected = [{"HostIp": "127.0.0.1", "HostPort": env["KNEEBOARD_DB_PORT"]}]
    require(json.dumps(actual, sort_keys=True), json.dumps(expected, sort_keys=True), C1_BINDING_LABEL)


def marker_value(name: str, env: dict[str, str]) -> str:
    """Return the marker text in ``kneeboard_<name>``, or ABSENT_MARKER when its table does not exist."""
    database = f"kneeboard_{name}"
    if psql(database, f"SELECT to_regclass('public.{MARKER_TABLE}') IS NULL;", env) == "t":
        return ABSENT_MARKER
    return psql(database, f"SELECT coalesce(string_agg(label, ',' ORDER BY label), '') FROM {MARKER_TABLE};", env)


def write_markers(env: dict[str, str]) -> None:
    """Replace the marker table in both Journey databases with one exact synthetic row each."""
    for name in ("dev", "test"):
        psql(f"kneeboard_{name}", f"DROP TABLE IF EXISTS {MARKER_TABLE}; CREATE TABLE {MARKER_TABLE} (label text); INSERT INTO {MARKER_TABLE} VALUES ('{name}-marker');", env)


def drop_markers(env: dict[str, str]) -> None:
    for name in ("dev", "test"):
        psql(f"kneeboard_{name}", f"DROP TABLE IF EXISTS {MARKER_TABLE};", env)


def assert_reset_markers(selected: str, env: dict[str, str]) -> None:
    """6a C-2: after resetting ``selected``, its marker is gone and the sibling's marker is exact.

    Call after write_markers and ``reset <selected>``. A no-op reset fails
    RESET_REMOVAL_LABELS; a reset of the wrong database fails RESET_SIBLING_LABELS.
    """
    sibling = "test" if selected == "dev" else "dev"
    require(marker_value(selected, env), ABSENT_MARKER, RESET_REMOVAL_LABELS[selected])
    require(marker_value(sibling, env), f"{sibling}-marker", RESET_SIBLING_LABELS[selected])


def assert_restart_markers(env: dict[str, str]) -> None:
    """6a C-2: after write_markers, stop, and start, both exact markers are still present.

    A stop that destroys the volume or a database fails RESTART_MARKER_LABELS.
    """
    for name in ("dev", "test"):
        require(marker_value(name, env), f"{name}-marker", RESTART_MARKER_LABELS[name])


def project_resources(project: str, env: dict[str, str]) -> tuple[str, str]:
    """Return the ids of all containers and the names of all volumes labelled with Compose ``project``."""
    label = f"label=com.docker.compose.project={project}"
    containers = command(["docker", "ps", "-aq", "--filter", label], env, budget="DOCKER_QUERY_TIMEOUT_SECONDS")
    volumes = command(["docker", "volume", "ls", "-q", "--filter", label], env, budget="DOCKER_QUERY_TIMEOUT_SECONDS")
    return containers, volumes


def assert_no_project(project: str, env: dict[str, str]) -> None:
    """6a C-2b: no container or volume exists for the caller-selected decoy ``project``."""
    containers, volumes = project_resources(project, env)
    require(containers, "", NO_DECOY_CONTAINERS_LABEL)
    require(volumes, "", NO_DECOY_VOLUMES_LABEL)


def table_state(database: str, env: dict[str, str]) -> str:
    """Return the row count and ordered-row md5 of every public base table in ``database``.

    The ten persistence tables must be present, so a missing table cannot make
    two states compare equal. Read-only.
    """
    state = psql(database, TABLE_STATE_SQL, env)
    tables = {entry.split("=", 1)[0] for entry in state.split(";")} if state else set()
    missing = sorted(set(PERSISTENCE_TABLES) - tables)
    if missing:
        raise AssertionError(f"6a C-15: persistence tables missing from {database} state: {', '.join(missing)}")
    return state


def assert_state_unchanged(before: str, after: str, label: str) -> None:
    """6a C-15: a probe left every table as it found it; on failure, name each changed table."""
    if after != before:
        old = dict(entry.split("=", 1) for entry in before.split(";"))
        new = dict(entry.split("=", 1) for entry in after.split(";"))
        changed = [f"{table} {old.get(table)} -> {new.get(table)}" for table in sorted(old.keys() | new.keys()) if old.get(table) != new.get(table)]
        raise AssertionError(f"{label}: expected every table unchanged, changed {'; '.join(changed)}")
    print(f"{label}: pass")


def verify_clean(database: str, env: dict[str, str]) -> None:
    """Run the rolled-back ``local verify`` probe and require every table in ``database`` unchanged."""
    before = table_state(database, env)
    local("verify", env, database.removeprefix("kneeboard_"))
    assert_state_unchanged(before, table_state(database, env), ROLLBACK_LABELS[("verify-local-schema.sql", database)])


def old_migration(env: dict[str, str], port: int, temporary: Path) -> None:
    old = temporary / "old-drizzle"
    (old / "meta").mkdir(parents=True)
    (old / "0000_initial_persistence.sql").write_bytes((ROOT / "drizzle/0000_initial_persistence.sql").read_bytes())
    (old / "meta/0000_snapshot.json").write_bytes((ROOT / "drizzle/meta/0000_snapshot.json").read_bytes())
    full_journal = json.loads((ROOT / "drizzle/meta/_journal.json").read_text())
    full_journal["entries"] = full_journal["entries"][:1]
    (old / "meta/_journal.json").write_text(json.dumps(full_journal))
    config = temporary / "old-drizzle.config.ts"
    config.write_text(
        'import { defineConfig } from "drizzle-kit";\n'
        f'export default defineConfig({{ dialect: "postgresql", schema: "./src/db/schema.ts", out: {json.dumps(str(old))}, '
        f'dbCredentials: {{ url: "postgresql://kneeboard:local_only_kneeboard@127.0.0.1:{port}/kneeboard_dev" }} }});\n'
    )
    command(["mise", "exec", "--", "pnpm", "exec", "drizzle-kit", "migrate", f"--config={config}"], env, budget="MIGRATE_TIMEOUT_SECONDS")


def app_runtime(env: dict[str, str]) -> None:
    command(["mise", "exec", "--", "pnpm", "install", "--frozen-lockfile"], env, budget="INSTALL_TIMEOUT_SECONDS")
    for gate in ("lint", "typecheck", "test"):
        command(["mise", "exec", "--", "pnpm", gate], env, budget=GATE_BUDGETS[gate])
        print(f"6a C-17 {gate}: pass")
    command(["mise", "exec", "--", "pnpm", "build"], env, budget="BUILD_TIMEOUT_SECONDS")
    print("6a C-17 build: pass")
    port = free_port()
    process = subprocess.Popen(
        ["mise", "exec", "--", "pnpm", "start", "--port", str(port)],
        cwd=ROOT,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    try:
        # Bounded startup window: 60 polls of at most a 1 s request plus 0.2 s.
        for _ in range(60):
            if leader_exited(process):
                raise AssertionError("6a C-17: application exited before responding")
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=1) as response:
                    body = response.read().decode()
                    if response.status != 200 or "For home flight simulation only." not in body:
                        raise AssertionError("6a C-17: runtime page or simulation warning missing")
                    break
            except (urllib.error.URLError, TimeoutError):
                time.sleep(0.2)
        else:
            raise AssertionError("6a C-17: application startup timed out")
    finally:
        earlier = sys.exc_info()[1]
        problems = terminate_process_group(process, float(TERMINATION_GRACE_SECONDS))
        if problems:
            report_cleanup_failure(f"application process cleanup failed: {'; '.join(problems)}", earlier)
    print("6a C-17: application responded with simulation warning")


def operation_journey(env: dict[str, str], port: int) -> None:
    """Exercise 6b operations only against this Journey's disposable test database."""
    operation_env = env.copy()
    operation_env["TEST_DATABASE_URL"] = f"postgresql://kneeboard:local_only_kneeboard@127.0.0.1:{port}/kneeboard_test"
    operation_env["DB_JOURNEY_ISOLATED"] = "1"
    output = command(
        ["mise", "exec", "--", "pnpm", "exec", "vitest", "run", "src/db/db-journey.test.ts", "--reporter=verbose"],
        operation_env,
        budget="OPERATION_TEST_TIMEOUT_SECONDS",
    )
    for claim in range(1, 15):
        if not any(re.search(rf"\bC-{claim}\b", line) and ("✓" in line or "passed" in line)
                   for line in output.splitlines()):
            raise AssertionError(f"6b operation C-{claim} did not report a passing assertion")
        print(f"6b C-{claim}: pass")


def main() -> None:
    port = free_port()
    project = f"kneeboard_journey_{uuid.uuid4().hex[:12]}"
    decoy_project = f"kneeboard_journey_{uuid.uuid4().hex[:12]}"
    env = os.environ.copy()
    env.update(KNEEBOARD_DB_PROJECT=project, KNEEBOARD_DB_PORT=str(port))
    env.pop("DATABASE_URL", None)
    env.pop("COMPOSE_FILE", None)
    (ROOT / ".local").mkdir(exist_ok=True)
    compose_started = False
    decoy_attempted = False
    try:
        docker_host = env.get("DOCKER_HOST", "")
        context_host = command(["docker", "context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], env, budget="DOCKER_QUERY_TIMEOUT_SECONDS")
        if (docker_host and not docker_host.startswith(("unix://", "npipe://"))) or not context_host.startswith(("unix://", "npipe://")):
            raise AssertionError("database Journey requires a local Docker socket")
        compose_started = True
        local("start", env)
        container = postgres_container(env)
        running_image = command(["docker", "inspect", "--format", "{{.Config.Image}}", container], env, budget="DOCKER_QUERY_TIMEOUT_SECONDS")
        pinned_image = re.search(r"^    image: (.+)$", (ROOT / "compose.yaml").read_text(), re.MULTILINE)
        if not pinned_image or not re.fullmatch(r"postgres:17@sha256:[0-9a-f]{64}", pinned_image.group(1)):
            raise AssertionError("6a C-1: image pin absent")
        require(running_image, pinned_image.group(1), "6a C-1 pinned image")
        assert_published_binding(container, env)
        require(psql("kneeboard_dev", "SELECT current_database();", env), "kneeboard_dev", "6a C-1 development database")
        require(psql("kneeboard_test", "SELECT current_database();", env), "kneeboard_test", "6a C-1 test database")

        with tempfile.TemporaryDirectory(dir=ROOT / ".local") as directory:
            decoy = Path(directory) / "compose.yaml"
            decoy.write_text("services:\n  postgres:\n    image: postgres:17\n    entrypoint: ['sh', '-c', 'sleep 600']\n")
            decoy_env = Path(directory) / "alternate.env"
            decoy_env.write_text(f"COMPOSE_PROJECT_NAME={decoy_project}\n")
            decoy_attempted = True
            local("start", env | {"COMPOSE_FILE": str(decoy), "COMPOSE_PROJECT_NAME": decoy_project, "COMPOSE_ENV_FILES": str(decoy_env)})
        selected_container = postgres_container(env)
        require(command(["docker", "inspect", "--format", "{{.Config.Image}}", selected_container], env, budget="DOCKER_QUERY_TIMEOUT_SECONDS"), pinned_image.group(1), "6a C-2b pinned Postgres image")
        require(command(["docker", "inspect", "--format", '{{index .Config.Labels "com.docker.compose.project"}}', selected_container], env, budget="DOCKER_QUERY_TIMEOUT_SECONDS"), project, "6a C-2b adversarial Compose project ignored")
        require(psql("kneeboard_test", "SELECT current_database();", env), "kneeboard_test", "6a C-2b adversarial Compose file ignored")
        assert_no_project(decoy_project, env)

        for database in ("dev", "test"):
            local("migrate", env, database)
        for selected in ("dev", "test"):
            write_markers(env)
            local("reset", env, selected)
            assert_reset_markers(selected, env)
            local("migrate", env, selected)
        write_markers(env)
        local("stop", env)
        require(command(["docker", "inspect", "--format", "{{.State.Running}}", container], env, budget="DOCKER_QUERY_TIMEOUT_SECONDS"), "false", "6a C-2 stop")
        local("start", env)
        require(psql("kneeboard_test", "SELECT current_database();", env), "kneeboard_test", "6a C-2 restart")
        assert_restart_markers(env)
        drop_markers(env)
        for invalid in ("production", "postgresql://remote.example.invalid/db"):
            result = run_bounded(["sh", "scripts/local-db.sh", "reset", invalid], env, budget="VALIDATION_TIMEOUT_SECONDS")
            if result.returncode != 2:
                raise AssertionError("6a C-2: remote or unknown target accepted")
        print("6a C-2: unknown/remote reset targets rejected")
        invalid_port_env = env | {"KNEEBOARD_DB_PORT": "54329/remote"}
        invalid_port = run_bounded(["sh", "scripts/local-db.sh", "start"], invalid_port_env, budget="VALIDATION_TIMEOUT_SECONDS")
        if invalid_port.returncode != 2:
            raise AssertionError("6a C-2: invalid local port accepted")
        print("6a C-2: invalid port rejected")
        remote_docker_env = env | {"DOCKER_HOST": "tcp://example.invalid:2375"}
        remote_docker = run_bounded(["sh", "scripts/local-db.sh", "start"], remote_docker_env, budget="VALIDATION_TIMEOUT_SECONDS")
        if remote_docker.returncode != 2:
            raise AssertionError("6a C-2: remote Docker endpoint accepted")
        print("6a C-2: remote Docker endpoint rejected")
        invalid_project = run_bounded(["sh", "scripts/local-db.sh", "--journey-project", "alternate_target", "reset", "test"], env, budget="VALIDATION_TIMEOUT_SECONDS")
        if invalid_project.returncode != 2:
            raise AssertionError("6a C-2b: arbitrary Compose project accepted")
        print("6a C-2b: arbitrary Compose project rejected")

        local("migrate", env, "test")
        require(journal("kneeboard_test", env), ",".join(map(str, EXPECTED_MIGRATIONS)), "6a C-13 migration rerun")
        verify_clean("kneeboard_test", env)
        before_journey = table_state("kneeboard_test", env)
        psql("kneeboard_test", (ROOT / "scripts/db-journey.sql").read_text(), env, budget="JOURNEY_SQL_TIMEOUT_SECONDS")
        print("6a C-4 through 6a C-11: exact database assertions passed")
        print("6a C-7a positive versions and 6a C-8a orphan/cascade assertions passed")
        assert_state_unchanged(before_journey, table_state("kneeboard_test", env), ROLLBACK_LABELS[("db-journey.sql", "kneeboard_test")])
        operation_journey(env, port)

        local("reset", env, "dev")
        with tempfile.TemporaryDirectory(dir=ROOT / ".local") as directory:
            old_migration(env, port, Path(directory))
        require(journal("kneeboard_dev", env), str(EXPECTED_MIGRATIONS[0]), "6a C-14 old migration state")
        require(psql("kneeboard_dev", "SELECT count(*) FROM pg_constraint WHERE conname = 'account_provider_account_unique';", env), "0", "6a C-14 old constraint absent")
        local("migrate", env, "dev")
        require(journal("kneeboard_dev", env), ",".join(map(str, EXPECTED_MIGRATIONS)), "6a C-14 upgrade journal")
        require(psql("kneeboard_dev", "SELECT count(*) FROM pg_constraint WHERE conname = 'account_provider_account_unique';", env), "1", "6a C-14 upgraded constraint")
        verify_clean("kneeboard_dev", env)
        app_runtime(env)
    finally:
        earlier = sys.exc_info()[1]
        # The decoy name is removed only after its adversarial start was attempted,
        # so a failure before then issues exactly one down, for the Journey project.
        targets = ([env] if compose_started else []) + ([env | {"KNEEBOARD_DB_PROJECT": decoy_project}] if decoy_attempted else [])
        cleanup_failure: AssertionError | None = None
        for target in targets:
            try:
                cleanup_compose(target, earlier or cleanup_failure)
            except AssertionError as error:
                cleanup_failure = error
        if cleanup_failure is not None:
            raise cleanup_failure
    print("Database Journey passed; disposable project removed on exit.")


if __name__ == "__main__":
    try:
        main()
    except (AssertionError, OSError) as error:
        print(f"Database Journey failed: {error}", file=sys.stderr)
        sys.exit(1)
