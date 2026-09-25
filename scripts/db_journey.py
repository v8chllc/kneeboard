"""Run the 6a database journey in a disposable, loopback-only Compose project."""

from __future__ import annotations

import json
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


ROOT = Path(__file__).resolve().parents[1]
EXPECTED_MIGRATIONS = [1790293061053, 1790294641213]


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def command(args: list[str], env: dict[str, str], *, input_text: str | None = None) -> str:
    result = subprocess.run(
        args,
        cwd=ROOT,
        env=env,
        input=input_text,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise AssertionError(f"{' '.join(args)} failed: {result.stderr.strip()} {result.stdout.strip()}")
    return result.stdout.strip()


def psql(database: str, sql: str, env: dict[str, str]) -> str:
    return command(
        ["docker", "compose", "exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-U", "kneeboard", "-d", database, "-Atq"],
        env,
        input_text=sql,
    )


def local(action: str, env: dict[str, str], database: str | None = None) -> None:
    command(["sh", "scripts/local-db.sh", action, *([database] if database else [])], env)


def require(actual: str, expected: str, claim: str) -> None:
    if actual != expected:
        raise AssertionError(f"{claim}: expected {expected!r}, got {actual!r}")
    print(f"{claim}: pass")


def report_cleanup_failure(message: str, earlier: BaseException | None) -> None:
    if earlier is not None:
        print(f"{message}; original failure: {earlier}", file=sys.stderr)
    else:
        raise AssertionError(message)


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
    command(["mise", "exec", "--", "pnpm", "exec", "drizzle-kit", "migrate", f"--config={config}"], env)


def app_runtime(env: dict[str, str]) -> None:
    command(["mise", "exec", "--", "pnpm", "install", "--frozen-lockfile"], env)
    for gate in ("lint", "typecheck", "test"):
        command(["mise", "exec", "--", "pnpm", gate], env)
        print(f"C-17 {gate}: pass")
    command(["mise", "exec", "--", "pnpm", "build"], env)
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
        try:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait(timeout=5)
        except (OSError, subprocess.TimeoutExpired) as error:
            report_cleanup_failure(f"application process cleanup failed: {error}", earlier)
    print("C-17: application responded with simulation warning")


def main() -> None:
    port = free_port()
    project = f"kneeboard_journey_{uuid.uuid4().hex[:12]}"
    env = os.environ.copy()
    env.update(COMPOSE_PROJECT_NAME=project, KNEEBOARD_DB_PORT=str(port))
    env.pop("DATABASE_URL", None)
    env.pop("COMPOSE_FILE", None)
    (ROOT / ".local").mkdir(exist_ok=True)
    compose_started = False
    try:
        docker_host = env.get("DOCKER_HOST", "")
        context_host = command(["docker", "context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], env)
        if (docker_host and not docker_host.startswith(("unix://", "npipe://"))) or not context_host.startswith(("unix://", "npipe://")):
            raise AssertionError("database Journey requires a local Docker socket")
        compose_started = True
        local("start", env)
        container = command(["docker", "compose", "ps", "-q", "postgres"], env)
        running_image = command(["docker", "inspect", "--format", "{{.Config.Image}}", container], env)
        pinned_image = re.search(r"^    image: (.+)$", (ROOT / "compose.yaml").read_text(), re.MULTILINE)
        if not pinned_image or not re.fullmatch(r"postgres:17@sha256:[0-9a-f]{64}", pinned_image.group(1)):
            raise AssertionError("C-1: image pin absent")
        require(running_image, pinned_image.group(1), "C-1 pinned image")
        require(psql("kneeboard_dev", "SELECT current_database();", env), "kneeboard_dev", "C-1 development database")
        require(psql("kneeboard_test", "SELECT current_database();", env), "kneeboard_test", "C-1 test database")

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
        require(command(["docker", "inspect", "--format", "{{.State.Running}}", container], env), "false", "C-2 stop")
        local("start", env)
        require(psql("kneeboard_test", "SELECT current_database();", env), "kneeboard_test", "C-2 restart")
        for invalid in ("production", "postgresql://remote.example.invalid/db"):
            result = subprocess.run(["sh", "scripts/local-db.sh", "reset", invalid], cwd=ROOT, env=env, capture_output=True, text=True)
            if result.returncode != 2:
                raise AssertionError("C-2: remote or unknown target accepted")
        print("C-2: unknown/remote reset targets rejected")
        invalid_port_env = env | {"KNEEBOARD_DB_PORT": "54329/remote"}
        invalid_port = subprocess.run(["sh", "scripts/local-db.sh", "start"], cwd=ROOT, env=invalid_port_env, capture_output=True, text=True)
        if invalid_port.returncode != 2:
            raise AssertionError("C-2: invalid local port accepted")
        print("C-2: invalid port rejected")
        remote_docker_env = env | {"DOCKER_HOST": "tcp://example.invalid:2375"}
        remote_docker = subprocess.run(["sh", "scripts/local-db.sh", "start"], cwd=ROOT, env=remote_docker_env, capture_output=True, text=True)
        if remote_docker.returncode != 2:
            raise AssertionError("C-2: remote Docker endpoint accepted")
        print("C-2: remote Docker endpoint rejected")

        local("migrate", env, "test")
        require(journal("kneeboard_test", env), ",".join(map(str, EXPECTED_MIGRATIONS)), "C-13 migration rerun")
        verify_clean("kneeboard_test", env)
        psql("kneeboard_test", (ROOT / "scripts/db-journey.sql").read_text(), env)
        print("C-4 through C-11: exact database assertions passed")
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
            try:
                cleanup = subprocess.run(["docker", "compose", "down", "-v", "--remove-orphans"], cwd=ROOT, env=env, capture_output=True, text=True)
                if cleanup.returncode != 0:
                    report_cleanup_failure(f"isolated Compose cleanup failed: {cleanup.stderr.strip()}", earlier)
            except OSError as error:
                report_cleanup_failure(f"isolated Compose cleanup failed: {error}", earlier)
    print("Database Journey passed; disposable project removed on exit.")


if __name__ == "__main__":
    try:
        main()
    except (AssertionError, OSError) as error:
        print(f"Database Journey failed: {error}", file=sys.stderr)
        sys.exit(1)
