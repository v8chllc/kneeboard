"""Run Playwright against a built app and a disposable local PostgreSQL project.

The runner owns one validated Compose project and loopback port, one Next.js
process group, and Playwright's local browser install. It removes the project
and volume after success, failure, or interruption. It never targets the fixed
development project or a remote database. All commands have finite budgets.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import db_journey as db


PLAYWRIGHT_VERSION = "1.64.0"
CHROMIUM_REVISION = "1248"
CHROMIUM_VERSION = "156.0.8078.4"
APP_START_TIMEOUT_SECONDS = 60
OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024
EXPECTED_PRIVATE_VALUES = 19  # Two accounts, five rate links, two repeats, and one concurrent link.


class AppOutput:
    """Drain app output into bounded memory without writing or relaying it."""

    def __init__(self, process: subprocess.Popen[bytes]) -> None:
        self.data = bytearray()
        self.overflow = False
        assert process.stdout is not None
        self.stream = process.stdout
        self.thread = threading.Thread(target=self._drain, daemon=True)
        self.thread.start()

    def _drain(self) -> None:
        while chunk := self.stream.read(4096):
            if len(self.data) + len(chunk) > OUTPUT_LIMIT_BYTES:
                self.overflow = True
            else:
                self.data.extend(chunk)

    def contains_private_value(self, values: list[str]) -> bool:
        self.thread.join(timeout=5)
        if self.thread.is_alive() or self.overflow:
            raise AssertionError("application output capture incomplete")
        return any(value.encode() in self.data for value in values)


def verify_private_output(output: AppOutput, values: list[str]) -> None:
    """Fail closed if a captured private value is missing, repeated, or logged."""
    if len(values) != EXPECTED_PRIVATE_VALUES or len(set(values)) != EXPECTED_PRIVATE_VALUES:
        raise AssertionError("log-exclusion sentinels missing")
    if output.contains_private_value(values):
        raise AssertionError("log-exclusion failed")


class SentinelReceiver(ThreadingHTTPServer):
    """Receive private journey values over loopback, keeping them in memory."""

    def __init__(self) -> None:
        self.values: list[str] = []

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:  # noqa: N802
                size = int(self.headers.get("Content-Length", "0"))
                if size < 1 or size > 8192:
                    self.send_error(400)
                    return
                try:
                    payload = json.loads(self.rfile.read(size))
                    values = payload["values"]
                    if not isinstance(values, list) or not 8 <= len(values) <= 32 or not all(
                        isinstance(value, str) and 0 < len(value) <= 4096 for value in values
                    ):
                        raise ValueError("missing sentinel")
                except (KeyError, ValueError, TypeError):
                    self.send_error(400)
                    return
                self.server.values = values  # type: ignore[attr-defined]
                self.send_response(204)
                self.end_headers()

            def log_message(self, _format: str, *_args: object) -> None:
                pass

        super().__init__(("127.0.0.1", 0), Handler)


def browser_metadata() -> dict[str, str]:
    """Read the browser mapping from the exact installed Playwright dependency."""
    package = (db.ROOT / "node_modules/@playwright/test").resolve()
    package_json = json.loads((package / "package.json").read_text())
    if package_json["version"] != PLAYWRIGHT_VERSION:
        raise AssertionError("Playwright package version differs from the committed pin")
    playwright = (package.parents[1] / "playwright").resolve()
    browsers = json.loads((playwright.parent / "playwright-core/browsers.json").read_text())["browsers"]
    shell = next((item for item in browsers if item["name"] == "chromium-headless-shell"), None)
    if shell is None or shell["revision"] != CHROMIUM_REVISION or shell["browserVersion"] != CHROMIUM_VERSION:
        raise AssertionError("Chromium headless shell differs from the committed pin")
    return shell


def checked(args: list[str], env: dict[str, str], budget: str, label: str) -> str:
    """Run a bounded command without relaying unredacted subprocess output."""
    seconds = db.budget_seconds(budget)
    try:
        result = db.run_bounded(args, env, budget=budget)
    except (db.JourneyTimeout, OSError):
        raise AssertionError(f"{label} failed or exceeded its {seconds:g}s budget") from None
    if result.returncode != 0:
        if label == "Playwright sign-in journey":
            captured = result.stdout + result.stderr
            for line in captured.splitlines():
                if line.strip().startswith("JOURNEY ") and not any(character in line for character in ("@", "http", "token")):
                    print(line.strip())
            locations = re.findall(r"(?:sign-in\.pw|mailpit)\.ts:\d+:\d+", captured)
            if locations:
                print(f"Playwright failure locations: {', '.join(dict.fromkeys(locations))}")
        raise AssertionError(f"{label} failed (exit {result.returncode})")
    return result.stdout.strip()


def local(action: str, env: dict[str, str], database: str | None = None) -> None:
    """Use the existing validated local-db wrapper, hiding its failure output."""
    try:
        db.local(action, env, database)
    except (AssertionError, OSError):
        raise AssertionError(f"isolated database {action} failed") from None


def await_app(process: subprocess.Popen[str], port: int) -> None:
    """Wait a finite time for the built application to answer on loopback."""
    deadline = time.monotonic() + APP_START_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if db.leader_exited(process):
            raise AssertionError("built application exited before startup")
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=1) as response:
                if response.status == 200:
                    return
        except (urllib.error.URLError, TimeoutError):
            time.sleep(0.2)
    raise AssertionError("built application startup timed out")


def fixed_database_isolation(env: dict[str, str], emails: tuple[str, str]) -> None:
    """Read only the journey identities in any running fixed local databases."""
    compose = ["docker", "compose", "-f", "compose.yaml", "-p", "kneeboard"]
    container = checked([*compose, "ps", "-q", "postgres"], env,
                        "DOCKER_QUERY_TIMEOUT_SECONDS", "fixed database inspection")
    if not container:
        print("JOURNEY fixed database isolation: pass (fixed project stopped)")
        return
    # The addresses are generated from a UUID above, never supplied by callers.
    quoted = ",".join("'" + address + "'" for address in emails)
    for database in ("kneeboard_dev", "kneeboard_test"):
        exists = checked([*compose, "exec", "-T", "postgres", "psql", "-U", "kneeboard", "-d", database,
                          "-Atqc", "SELECT to_regclass('public.user') IS NOT NULL"],
                         env, "DOCKER_QUERY_TIMEOUT_SECONDS", "fixed schema inspection")
        if exists == "f":
            continue
        count = checked([*compose, "exec", "-T", "postgres", "psql", "-U", "kneeboard", "-d", database,
                         "-Atqc", f'SELECT count(*) FROM "user" WHERE email IN ({quoted})'],
                        env, "DOCKER_QUERY_TIMEOUT_SECONDS", "fixed account inspection")
        if count != "0":
            raise AssertionError("journey account appeared in a fixed database")
    print("JOURNEY fixed database isolation: pass")


def main() -> None:
    project = f"kneeboard_journey_{uuid.uuid4().hex[:12]}"
    database_port = db.free_port()
    smtp_port = db.free_port()
    mailpit_port = db.free_port()
    app_port = db.free_port()
    email_a = f"journey-a-{project[-12:]}@example.invalid"
    email_b = f"journey-b-{project[-12:]}@example.invalid"
    env = os.environ.copy()
    env.update(KNEEBOARD_DB_PROJECT=project, KNEEBOARD_DB_PORT=str(database_port),
               KNEEBOARD_MAILPIT_SMTP_PORT=str(smtp_port), KNEEBOARD_MAILPIT_UI_PORT=str(mailpit_port))
    env.pop("DATABASE_URL", None)
    env.pop("COMPOSE_FILE", None)
    compose_started = False
    try:
        docker_host = env.get("DOCKER_HOST", "")
        context_host = checked(
            ["docker", "context", "inspect", "--format", "{{.Endpoints.docker.Host}}"],
            env, "DOCKER_QUERY_TIMEOUT_SECONDS", "Docker context check",
        )
        if (docker_host and not docker_host.startswith(("unix://", "npipe://"))) or not context_host.startswith(("unix://", "npipe://")):
            raise AssertionError("browser Journey requires a local Docker socket")

        browser_metadata()
        checked(["mise", "exec", "--", "pnpm", "exec", "playwright", "install", "chromium", "--only-shell"],
                env, "INSTALL_TIMEOUT_SECONDS", "browser installation")

        compose_started = True
        local("start", env)
        local("migrate", env, "test")
        checked(["docker", "compose", "-f", "compose.yaml", "-p", project, "up", "-d", "--wait", "mailpit"],
                env, "DOCKER_QUERY_TIMEOUT_SECONDS", "isolated Mailpit startup")
        try:
            db.require(db.psql("kneeboard_test", "SELECT current_database();", env), "kneeboard_test", "E2E isolated database")
            db.require(db.journal("kneeboard_test", env), ",".join(map(str, db.EXPECTED_MIGRATIONS)), "E2E migrations")
        except (AssertionError, OSError):
            raise AssertionError("isolated database readiness failed") from None

        app_env = env.copy()
        app_env["DATABASE_URL"] = f"postgresql://kneeboard:local_only_kneeboard@127.0.0.1:{database_port}/kneeboard_test"
        app_env.update(BETTER_AUTH_URL=f"http://localhost:{app_port}",
                       BETTER_AUTH_SECRET="isolated-journey-secret-with-32-characters",
                       AUTH_EMAIL_ALLOWLIST=f"{email_a},{email_b}",
                       MAIL_FROM_EMAIL="login@kneeboard.local", MAIL_DELIVERY="mailpit",
                       MAILPIT_SMTP_HOST="127.0.0.1", MAILPIT_SMTP_PORT=str(smtp_port),
                       TEST_DATABASE_URL=app_env["DATABASE_URL"])
        for test_file in ("src/server/auth-integration.test.ts", "src/server/account-settings.integration.test.ts"):
            checked(["mise", "exec", "--", "pnpm", "exec", "vitest", "run", test_file],
                    app_env | {"AUTH_JOURNEY_ISOLATED": "1", "NODE_ENV": "test"},
                    "OPERATION_TEST_TIMEOUT_SECONDS", "isolated auth integration")
        print("JOURNEY auth integration: pass")
        checked(["mise", "exec", "--", "pnpm", "build"], app_env | {"NODE_ENV": "production"},
                "BUILD_TIMEOUT_SECONDS", "application build")
        receiver = SentinelReceiver()
        receiver_thread = threading.Thread(target=receiver.serve_forever, daemon=True)
        receiver_thread.start()
        app_env["NODE_ENV"] = "development"  # Built app, local-only Mailpit configuration.
        process = subprocess.Popen(
            ["mise", "exec", "--", "pnpm", "start", "--port", str(app_port)],
            cwd=db.ROOT, env=app_env, stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True,
        )
        output = AppOutput(process)
        try:
            await_app(process, app_port)
            browser_env = app_env | {"PLAYWRIGHT_BASE_URL": f"http://localhost:{app_port}",
                                     "MAILPIT_API_URL": f"http://127.0.0.1:{mailpit_port}",
                                     "JOURNEY_EMAIL_A": email_a, "JOURNEY_EMAIL_B": email_b,
                                     "JOURNEY_SENTINEL_PORT": str(receiver.server_port)}
            result = checked(["mise", "exec", "--", "pnpm", "exec", "playwright", "test"], browser_env,
                             "OPERATION_TEST_TIMEOUT_SECONDS", "Playwright sign-in journey")
            for line in result.splitlines():
                if line.startswith("JOURNEY ") and line.endswith(": pass"):
                    print(line)
        finally:
            earlier = sys.exc_info()[1]
            problems = db.terminate_process_group(process, float(db.TERMINATION_GRACE_SECONDS))
            if problems:
                db.report_cleanup_failure(f"application process cleanup failed: {'; '.join(problems)}", earlier)
            receiver.shutdown()
            receiver.server_close()
            receiver_thread.join(timeout=5)
        verify_private_output(output, receiver.values)
        print("JOURNEY log-exclusion: pass")
        fixed_database_isolation(env, (email_a, email_b))
    finally:
        earlier = sys.exc_info()[1]
        if compose_started:
            db.cleanup_compose(env, earlier)
    print("Playwright Journey passed; disposable project removed on exit.")


if __name__ == "__main__":
    try:
        main()
    except (AssertionError, OSError, ValueError, KeyError, FileNotFoundError) as error:
        print(f"Playwright Journey failed: {error}", file=sys.stderr)
        sys.exit(1)
