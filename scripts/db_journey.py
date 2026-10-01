"""Run the 6a database journey in a disposable, loopback-only Compose project."""

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
# Tests inject short limits by patching these names.
DOCKER_QUERY_TIMEOUT_SECONDS = 30  # docker context/inspect and compose ps
PSQL_TIMEOUT_SECONDS = 30  # one short query through compose exec
JOURNEY_SQL_TIMEOUT_SECONDS = 60  # scripts/db-journey.sql
VALIDATION_TIMEOUT_SECONDS = 30  # local-db.sh argument rejections
LOCAL_START_TIMEOUT_SECONDS = 300  # compose up --wait, including an image pull
LOCAL_COMMAND_TIMEOUT_SECONDS = 60  # local-db.sh stop, reset, and verify
MIGRATE_TIMEOUT_SECONDS = 120  # drizzle-kit migrate through mise and pnpm
INSTALL_TIMEOUT_SECONDS = 600  # pnpm install --frozen-lockfile
LINT_TIMEOUT_SECONDS = 300
TYPECHECK_TIMEOUT_SECONDS = 300
TEST_TIMEOUT_SECONDS = 600  # the full pnpm test suite
BUILD_TIMEOUT_SECONDS = 900  # next build
COMPOSE_CLEANUP_TIMEOUT_SECONDS = 60
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
    created. Python before 3.13 on macOS lacks os.waitid; there the leader is
    reaped as soon as it exits, and a later group signal relies on surviving
    members keeping the group id in use.
    """
    if process.returncode is not None:
        return True
    if not hasattr(os, "waitid"):
        return process.poll() is not None
    try:
        return os.waitid(os.P_PID, process.pid, os.WEXITED | os.WNOHANG | os.WNOWAIT) is not None
    except ChildProcessError:
        return True


def signal_group(process: subprocess.Popen, sig: signal.Signals, problems: list[str]) -> None:
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
    Both signals are sent before the leader is reaped. Signals go only to the
    group led by ``process``. Returns problems, such as a refused signal or a
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


def safe_tail(text: str) -> str:
    redacted = re.sub(r"([A-Za-z][A-Za-z0-9+.-]*://)[^\s/@]+@", r"\1***@", text.strip())
    return redacted[-STDERR_TAIL_CHARACTERS:]


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
        raise AssertionError(f"{' '.join(args)} failed: {result.stderr.strip()} {result.stdout.strip()}")
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
    try:
        cleanup = run_bounded(compose_args(env) + ["down", "-v", "--remove-orphans"], env, budget="COMPOSE_CLEANUP_TIMEOUT_SECONDS")
    except (OSError, JourneyTimeout) as error:
        detail = str(error)
    else:
        if cleanup.returncode == 0:
            return
        detail = cleanup.stderr.strip()
    report_cleanup_failure(f"isolated Compose cleanup failed: {detail}; removal of {project} not confirmed", earlier)


def journal(database: str, env: dict[str, str]) -> str:
    return psql(database, "SELECT string_agg(created_at::text, ',' ORDER BY created_at) FROM drizzle.__drizzle_migrations;", env)


def verify_clean(database: str, env: dict[str, str]) -> None:
    local("verify", env, database.removeprefix("kneeboard_"))
    require(psql(database, "SELECT count(*) FROM \"user\" WHERE id LIKE 'schema-user-%';", env), "0", "C-15 probe rollback")


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
        print(f"C-17 {gate}: pass")
    command(["mise", "exec", "--", "pnpm", "build"], env, budget="BUILD_TIMEOUT_SECONDS")
    print("C-17 build: pass")
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
        for _ in range(60):
            if process.poll() is not None:
                raise AssertionError("C-17: application exited before responding")
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=1) as response:
                    body = response.read().decode()
                    if response.status != 200 or "For home flight simulation only." not in body:
                        raise AssertionError("C-17: runtime page or simulation warning missing")
                    break
            except (urllib.error.URLError, TimeoutError):
                time.sleep(0.2)
        else:
            raise AssertionError("C-17: application startup timed out")
    finally:
        earlier = sys.exc_info()[1]
        problems = terminate_process_group(process, float(TERMINATION_GRACE_SECONDS))
        if problems:
            report_cleanup_failure(f"application process cleanup failed: {'; '.join(problems)}", earlier)
    print("C-17: application responded with simulation warning")


def main() -> None:
    port = free_port()
    project = f"kneeboard_journey_{uuid.uuid4().hex[:12]}"
    env = os.environ.copy()
    env.update(KNEEBOARD_DB_PROJECT=project, KNEEBOARD_DB_PORT=str(port))
    env.pop("DATABASE_URL", None)
    env.pop("COMPOSE_FILE", None)
    (ROOT / ".local").mkdir(exist_ok=True)
    compose_started = False
    try:
        docker_host = env.get("DOCKER_HOST", "")
        context_host = command(["docker", "context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], env, budget="DOCKER_QUERY_TIMEOUT_SECONDS")
        if (docker_host and not docker_host.startswith(("unix://", "npipe://"))) or not context_host.startswith(("unix://", "npipe://")):
            raise AssertionError("database Journey requires a local Docker socket")
        compose_started = True
        local("start", env)
        container = command(compose_args(env) + ["ps", "-q", "postgres"], env, budget="DOCKER_QUERY_TIMEOUT_SECONDS")
        running_image = command(["docker", "inspect", "--format", "{{.Config.Image}}", container], env, budget="DOCKER_QUERY_TIMEOUT_SECONDS")
        pinned_image = re.search(r"^    image: (.+)$", (ROOT / "compose.yaml").read_text(), re.MULTILINE)
        if not pinned_image or not re.fullmatch(r"postgres:17@sha256:[0-9a-f]{64}", pinned_image.group(1)):
            raise AssertionError("C-1: image pin absent")
        require(running_image, pinned_image.group(1), "C-1 pinned image")
        require(psql("kneeboard_dev", "SELECT current_database();", env), "kneeboard_dev", "C-1 development database")
        require(psql("kneeboard_test", "SELECT current_database();", env), "kneeboard_test", "C-1 test database")

        with tempfile.TemporaryDirectory(dir=ROOT / ".local") as directory:
            decoy = Path(directory) / "compose.yaml"
            decoy.write_text("services:\n  postgres:\n    image: postgres:17\n    entrypoint: ['sh', '-c', 'sleep 600']\n")
            decoy_env = Path(directory) / "alternate.env"
            decoy_env.write_text("COMPOSE_PROJECT_NAME=alternate_target\n")
            local("start", env | {"COMPOSE_FILE": str(decoy), "COMPOSE_PROJECT_NAME": "alternate_target", "COMPOSE_ENV_FILES": str(decoy_env)})
        selected_container = command(compose_args(env) + ["ps", "-q", "postgres"], env, budget="DOCKER_QUERY_TIMEOUT_SECONDS")
        require(command(["docker", "inspect", "--format", "{{.Config.Image}}", selected_container], env, budget="DOCKER_QUERY_TIMEOUT_SECONDS"), pinned_image.group(1), "C-2b pinned Postgres image")
        require(command(["docker", "inspect", "--format", '{{index .Config.Labels "com.docker.compose.project"}}', selected_container], env, budget="DOCKER_QUERY_TIMEOUT_SECONDS"), project, "C-2b adversarial Compose project ignored")
        require(psql("kneeboard_test", "SELECT current_database();", env), "kneeboard_test", "C-2b adversarial Compose file ignored")

        for database in ("dev", "test"):
            local("migrate", env, database)
            psql(f"kneeboard_{database}", f"CREATE TABLE journey_marker (label text); INSERT INTO journey_marker VALUES ('{database}');", env)
        local("reset", env, "dev")
        require(psql("kneeboard_test", "SELECT label FROM journey_marker;", env), "test", "C-2 dev reset preserves test")
        local("migrate", env, "dev")
        psql("kneeboard_dev", "CREATE TABLE journey_marker (label text); INSERT INTO journey_marker VALUES ('dev');", env)
        local("reset", env, "test")
        require(psql("kneeboard_dev", "SELECT label FROM journey_marker;", env), "dev", "C-2 test reset preserves dev")
        local("migrate", env, "test")
        local("stop", env)
        require(command(["docker", "inspect", "--format", "{{.State.Running}}", container], env, budget="DOCKER_QUERY_TIMEOUT_SECONDS"), "false", "C-2 stop")
        local("start", env)
        require(psql("kneeboard_test", "SELECT current_database();", env), "kneeboard_test", "C-2 restart")
        for invalid in ("production", "postgresql://remote.example.invalid/db"):
            result = run_bounded(["sh", "scripts/local-db.sh", "reset", invalid], env, budget="VALIDATION_TIMEOUT_SECONDS")
            if result.returncode != 2:
                raise AssertionError("C-2: remote or unknown target accepted")
        print("C-2: unknown/remote reset targets rejected")
        invalid_port_env = env | {"KNEEBOARD_DB_PORT": "54329/remote"}
        invalid_port = run_bounded(["sh", "scripts/local-db.sh", "start"], invalid_port_env, budget="VALIDATION_TIMEOUT_SECONDS")
        if invalid_port.returncode != 2:
            raise AssertionError("C-2: invalid local port accepted")
        print("C-2: invalid port rejected")
        remote_docker_env = env | {"DOCKER_HOST": "tcp://example.invalid:2375"}
        remote_docker = run_bounded(["sh", "scripts/local-db.sh", "start"], remote_docker_env, budget="VALIDATION_TIMEOUT_SECONDS")
        if remote_docker.returncode != 2:
            raise AssertionError("C-2: remote Docker endpoint accepted")
        print("C-2: remote Docker endpoint rejected")
        invalid_project = run_bounded(["sh", "scripts/local-db.sh", "--journey-project", "alternate_target", "reset", "test"], env, budget="VALIDATION_TIMEOUT_SECONDS")
        if invalid_project.returncode != 2:
            raise AssertionError("C-2b: arbitrary Compose project accepted")
        print("C-2b: arbitrary Compose project rejected")

        local("migrate", env, "test")
        require(journal("kneeboard_test", env), ",".join(map(str, EXPECTED_MIGRATIONS)), "C-13 migration rerun")
        verify_clean("kneeboard_test", env)
        psql("kneeboard_test", (ROOT / "scripts/db-journey.sql").read_text(), env, budget="JOURNEY_SQL_TIMEOUT_SECONDS")
        print("C-4 through C-11: exact database assertions passed")
        print("C-7a positive versions and C-8a orphan/cascade assertions passed")
        require(psql("kneeboard_test", "SELECT count(*) FROM \"user\" WHERE id LIKE 'journey-%';", env), "0", "C-15 journey rollback")

        local("reset", env, "dev")
        with tempfile.TemporaryDirectory(dir=ROOT / ".local") as directory:
            old_migration(env, port, Path(directory))
        require(journal("kneeboard_dev", env), str(EXPECTED_MIGRATIONS[0]), "C-14 old migration state")
        require(psql("kneeboard_dev", "SELECT count(*) FROM pg_constraint WHERE conname = 'account_provider_account_unique';", env), "0", "C-14 old constraint absent")
        local("migrate", env, "dev")
        require(journal("kneeboard_dev", env), ",".join(map(str, EXPECTED_MIGRATIONS)), "C-14 upgrade journal")
        require(psql("kneeboard_dev", "SELECT count(*) FROM pg_constraint WHERE conname = 'account_provider_account_unique';", env), "1", "C-14 upgraded constraint")
        verify_clean("kneeboard_dev", env)
        app_runtime(env)
    finally:
        earlier = sys.exc_info()[1]
        if compose_started:
            cleanup_compose(env, earlier)
    print("Database Journey passed; disposable project removed on exit.")


if __name__ == "__main__":
    try:
        main()
    except (AssertionError, OSError) as error:
        print(f"Database Journey failed: {error}", file=sys.stderr)
        sys.exit(1)
