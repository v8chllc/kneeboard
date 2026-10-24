"""Run Playwright against a built app and a disposable local PostgreSQL project.

The runner owns one validated Compose project, its loopback service ports, one
Next.js process group, a loopback SimBrief fixture stub, and Playwright's local browser install. It terminates
both process groups and removes the Compose project
and volume after success, failure, or interruption. It never targets the fixed
development project or a remote database. All commands have finite budgets.
"""

from __future__ import annotations

import json
import os
import re
import socket
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
REQUIRED_SENTINELS = {"email-a", "email-b", "pilot-a", "pilot-b", "session-a", "session-b",
                      "session-repeat-0", "session-repeat-1", "email-tracker-a", "email-tracker-b",
                      "pilot-stub", "session-tracker-a", "session-tracker-b", "navlog-latitude-raw",
                      "navlog-longitude-raw", "navlog-latitude-number", "navlog-longitude-number",
                      "raw-ofp-marker"}


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


def start_captured_app(port: int, env: dict[str, str]) -> tuple[subprocess.Popen[bytes], AppOutput]:
    """Start one built app on a loopback port with captured output and a process group."""
    process = subprocess.Popen(
        ["mise", "exec", "--", "pnpm", "start", "--port", str(port)],
        cwd=db.ROOT, env=env, stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True,
    )
    try:
        return process, AppOutput(process)
    except BaseException as capture_error:
        problems = db.terminate_process_group(process, float(db.TERMINATION_GRACE_SECONDS))
        if problems:
            db.report_cleanup_failure(f"application process cleanup failed: {'; '.join(problems)}", capture_error)
        raise


def verify_private_output(output: AppOutput, values: dict[str, str]) -> None:
    """Fail closed if a captured private value is missing, repeated, or logged."""
    if not REQUIRED_SENTINELS <= values.keys() or not any(key.startswith("token:") for key in values) or not any(key.startswith("fault-token:") for key in values):
        raise AssertionError("log-exclusion sentinels missing")
    if len(set(values.values())) != len(values):
        raise AssertionError("log-exclusion sentinels missing")
    if output.contains_private_value(list(values.values())):
        raise AssertionError("log-exclusion failed")


def verify_structured_output(output: AppOutput) -> None:
    """Require the recent-read failure to reach captured server standard output."""
    records = [json.loads(line) for line in output.data.decode("utf-8", errors="replace").splitlines()
               if line.startswith('{"timestamp":')]
    required_keys = {"timestamp", "severity", "event", "correlationId", "errorCode"}
    if not records or any(set(record) != required_keys for record in records):
        raise AssertionError("structured server log record missing or malformed")
    if not any(record["event"] == "unexpected_server_error" and
               record["errorCode"] == "UNEXPECTED_SERVER_ERROR" for record in records):
        raise AssertionError("recent-read failure did not reach server standard output")


class SentinelReceiver(ThreadingHTTPServer):
    """Receive private journey values over loopback, keeping them in memory."""

    def __init__(self) -> None:
        self.values: dict[str, str] = {}

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:  # noqa: N802
                size = int(self.headers.get("Content-Length", "0"))
                if size < 1 or size > 8192:
                    self.send_error(400)
                    return
                try:
                    payload = json.loads(self.rfile.read(size))
                    identity, value = payload["identity"], payload["value"]
                    if not isinstance(identity, str) or not 1 <= len(identity) <= 128 or not isinstance(value, str) or not 1 <= len(value) <= 4096:
                        raise ValueError("missing sentinel")
                    if identity in self.server.values:  # type: ignore[attr-defined]
                        raise ValueError("duplicate sentinel")
                except (KeyError, ValueError, TypeError):
                    self.send_error(400)
                    return
                self.server.values[identity] = value  # type: ignore[attr-defined]
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
            locations = re.findall(r"(?:sign-in\.pw|mailpit(?:-faults\.pw)?|tracker\.pw)\.ts:\d+:\d+", captured)
            if locations:
                print(f"Playwright failure locations: {', '.join(dict.fromkeys(locations))}")
        if label in ("isolated SMTP rejection integration", "isolated auth integration"):
            if "JOURNEY atomic redemption session count: fail" in result.stdout + result.stderr:
                print("JOURNEY atomic redemption session count: fail")
            locations = re.findall(r"src/server/(?:auth-integration|account-settings\.integration)\.test\.ts:\d+:\d+", result.stdout + result.stderr)
            if locations:
                print(f"Isolated auth assertion locations: {', '.join(dict.fromkeys(locations))}")
        raise AssertionError(f"{label} failed (exit {result.returncode})")
    return result.stdout.strip()


def require_atomic_redemption(result: str) -> None:
    """Require proof emitted only after the isolated redemption assertions pass."""
    if "JOURNEY atomic redemption: pass" not in result:
        raise AssertionError("isolated atomic redemption result missing")


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


def await_port(process: subprocess.Popen[str], port: int) -> None:
    deadline = time.monotonic() + APP_START_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if db.leader_exited(process):
            raise AssertionError("built application exited before startup")
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                return
        except OSError:
            time.sleep(0.2)
    raise AssertionError("built application startup timed out")


def start_simbrief_stub(port: int) -> subprocess.Popen[bytes]:
    """Start the fixture server in its own process group; never inherit a live URL."""
    return subprocess.Popen(
        [sys.executable, "scripts/simbrief_stub.py", "--port", str(port)],
        cwd=db.ROOT, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL, start_new_session=True,
    )


def await_simbrief_stub(process: subprocess.Popen[bytes], port: int) -> None:
    deadline = time.monotonic() + APP_START_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if db.leader_exited(process):
            raise AssertionError("SimBrief stub exited before startup")
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=1) as response:
                if response.status == 204:
                    return
        except (urllib.error.URLError, TimeoutError):
            time.sleep(0.2)
    raise AssertionError("SimBrief stub startup timed out")


def http_response(url: str, *, body: bytes | None = None, origin: str | None = None) -> tuple[int, bytes]:
    """Read a local response, including a deliberately rejected auth request."""
    request = urllib.request.Request(url, data=body, headers={
        "Content-Type": "application/json", **({"Origin": origin} if origin else {}),
    } if body is not None else {}, method="POST" if body is not None else "GET")
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        with error:
            return error.code, error.read()


def mailpit_messages(port: int) -> dict[str, object]:
    status, body = http_response(f"http://127.0.0.1:{port}/api/v1/messages")
    if status != 200:
        raise AssertionError("isolated Mailpit API failed")
    return json.loads(body)


def clear_mailpit(port: int) -> None:
    request = urllib.request.Request(f"http://127.0.0.1:{port}/api/v1/messages",
                                     data=b'{"IDs":[]}', headers={"Content-Type": "application/json"}, method="DELETE")
    with urllib.request.urlopen(request, timeout=5) as response:
        if response.status != 200:
            raise AssertionError("isolated Mailpit clear failed")
    if mailpit_messages(port)["total"] != 0:
        raise AssertionError("isolated Mailpit inbox was not cleared")


def auth_runtime_probes(app_env: dict[str, str], mailpit_port: int) -> None:
    """Restart the built app for policy and invalid production boundary cases."""
    cases = (
        ("missing", None, False, False),
        ("empty", "", False, False),
        ("wildcard", "*", True, False),
        ("production-mailpit", "*", False, True),
        ("production-no-resend", "*", False, True),
        ("production-no-secret", "*", False, True),
        ("production-default-secret", "*", False, True),
    )
    for name, allowlist, expect_mail, invalid in cases:
        clear_mailpit(mailpit_port)
        port = db.free_port()
        env = app_env | {"BETTER_AUTH_URL": f"http://localhost:{port}", "NODE_ENV": "development"}
        if allowlist is None:
            env.pop("AUTH_EMAIL_ALLOWLIST", None)
        else:
            env["AUTH_EMAIL_ALLOWLIST"] = allowlist
        if invalid:
            env.update(NODE_ENV="production", BETTER_AUTH_URL="https://kneeboard.invalid",
                       MAIL_DELIVERY="resend", RESEND_API_KEY="dummy-local-probe-key")
            if name == "production-mailpit":
                env["MAIL_DELIVERY"] = "mailpit"
            elif name == "production-no-resend":
                env.pop("RESEND_API_KEY")
            elif name == "production-no-secret":
                env.pop("BETTER_AUTH_SECRET")
            elif name == "production-default-secret":
                env["BETTER_AUTH_SECRET"] = "better-auth-secret-12345678901234567890"
        process = subprocess.Popen(["mise", "exec", "--", "pnpm", "start", "--port", str(port)],
                                   cwd=db.ROOT, env=env, stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
        output = AppOutput(process)
        private = ["dummy-local-probe-key", env.get("BETTER_AUTH_SECRET", ""), f"policy-{name}@example.invalid"]
        try:
            await_port(process, port)
            if invalid:
                status, body = http_response(f"http://127.0.0.1:{port}/api/auth/get-session")
                if status != 500 or any(value.encode() in body for value in private if value):
                    raise AssertionError(f"invalid {name} auth configuration was accepted or exposed")
            else:
                status, body = http_response(f"http://127.0.0.1:{port}/api/auth/get-session")
                if status != 200 or json.loads(body) is not None:
                    raise AssertionError(f"valid {name} auth configuration was rejected")
                address = private[-1]
                status, body = http_response(f"http://127.0.0.1:{port}/api/auth/sign-in/magic-link",
                                             body=json.dumps({"email": address}).encode(),
                                             origin=f"http://localhost:{port}")
                if status != 200 or address.encode() in body:
                    raise AssertionError(f"{name} allowlist response failed")
                messages = mailpit_messages(mailpit_port)
                if (messages["total"] == 1) != expect_mail:
                    raise AssertionError(f"{name} allowlist delivery failed")
                if expect_mail:
                    recipients = messages["messages"][0]["To"]
                    if not any(item["Address"] == address for item in recipients):
                        raise AssertionError("wildcard delivered to wrong address")
        finally:
            earlier = sys.exc_info()[1]
            problems = db.terminate_process_group(process, float(db.TERMINATION_GRACE_SECONDS))
            if problems:
                db.report_cleanup_failure(f"application process cleanup failed: {'; '.join(problems)}", earlier)
        if output.contains_private_value([value for value in private if value]):
            raise AssertionError(f"{name} private value appeared in app output")
        print(f"JOURNEY {name} auth boundary: pass")
    clear_mailpit(mailpit_port)


def main() -> None:
    project = f"kneeboard_journey_{uuid.uuid4().hex[:12]}"
    database_port = db.free_port()
    smtp_port = db.free_port()
    mailpit_port = db.free_port()
    app_port = db.free_port()
    stub_port = db.free_port()
    email_a = f"journey-a-{project[-12:]}@example.invalid"
    email_b = f"journey-b-{project[-12:]}@example.invalid"
    email_tracker_a = f"journey-tracker-a-{project[-12:]}@example.invalid"
    email_tracker_b = f"journey-tracker-b-{project[-12:]}@example.invalid"
    env = os.environ.copy()
    env.update(KNEEBOARD_DB_PROJECT=project, KNEEBOARD_DB_PORT=str(database_port),
               KNEEBOARD_MAILPIT_SMTP_PORT=str(smtp_port), KNEEBOARD_MAILPIT_UI_PORT=str(mailpit_port))
    env.pop("DATABASE_URL", None)
    env.pop("SIMBRIEF_BASE_URL", None)
    env.pop("COMPOSE_FILE", None)
    compose_started = False
    stub_process: subprocess.Popen[bytes] | None = None
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
                       AUTH_EMAIL_ALLOWLIST=f"{email_a},{email_b},{email_tracker_a},{email_tracker_b}",
                       MAIL_FROM_EMAIL="login@kneeboard.local", MAIL_DELIVERY="mailpit",
                       MAILPIT_SMTP_HOST="127.0.0.1", MAILPIT_SMTP_PORT=str(smtp_port),
                       TEST_DATABASE_URL=app_env["DATABASE_URL"])
        stub_process = start_simbrief_stub(stub_port)
        await_simbrief_stub(stub_process, stub_port)
        app_env["SIMBRIEF_BASE_URL"] = f"http://127.0.0.1:{stub_port}"
        for test_file in ("src/server/auth-integration.test.ts", "src/server/account-settings.integration.test.ts"):
            result = checked(["mise", "exec", "--", "pnpm", "exec", "vitest", "run", test_file,
                              "--reporter=verbose"],
                    app_env | {"AUTH_JOURNEY_ISOLATED": "1", "NODE_ENV": "test"},
                    "OPERATION_TEST_TIMEOUT_SECONDS", "isolated auth integration")
            if test_file == "src/server/auth-integration.test.ts":
                require_atomic_redemption(result)
                print("JOURNEY atomic redemption: pass")
        print("JOURNEY auth integration: pass")
        checked(["mise", "exec", "--", "pnpm", "build"], app_env | {"NODE_ENV": "production"},
                "BUILD_TIMEOUT_SECONDS", "application build")
        receiver = SentinelReceiver()
        receiver_thread = threading.Thread(target=receiver.serve_forever, daemon=True)
        receiver_thread.start()
        app_env["NODE_ENV"] = "development"  # Built app, local-only Mailpit configuration.
        process, output = start_captured_app(app_port, app_env)
        try:
            await_app(process, app_port)
            browser_env = app_env | {"PLAYWRIGHT_BASE_URL": f"http://localhost:{app_port}",
                                     "SIMBRIEF_STUB_URL": f"http://127.0.0.1:{stub_port}",
                                     "MAILPIT_API_URL": f"http://127.0.0.1:{mailpit_port}",
                                     "JOURNEY_EMAIL_A": email_a, "JOURNEY_EMAIL_B": email_b,
                                     "JOURNEY_TRACKER_EMAIL_A": email_tracker_a,
                                     "JOURNEY_TRACKER_EMAIL_B": email_tracker_b,
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
        verify_structured_output(output)
        print("JOURNEY structured server logging: pass")
        auth_runtime_probes(app_env, mailpit_port)
        checked(["docker", "compose", "-f", "compose.yaml", "-f", "tests/journey/mailpit-chaos.compose.yaml",
                 "-p", project, "up", "-d", "--no-deps", "--force-recreate", "--wait", "mailpit"],
                env, "DOCKER_QUERY_TIMEOUT_SECONDS", "isolated Mailpit SMTP rejection startup")
        clear_mailpit(mailpit_port)
        checked(["mise", "exec", "--", "pnpm", "exec", "vitest", "run", "src/server/auth-integration.test.ts",
                 "-t", "leaves no redeemable link after a delivery failure"],
                app_env | {"AUTH_JOURNEY_ISOLATED": "1", "MAILPIT_CHAOS_ISOLATED": "1",
                           "MAILPIT_JOURNEY_SMTP_PORT": str(smtp_port),
                           "MAILPIT_JOURNEY_UI_PORT": str(mailpit_port), "NODE_ENV": "test"},
                "OPERATION_TEST_TIMEOUT_SECONDS", "isolated SMTP rejection integration")
        print("JOURNEY local SMTP rejection: pass")
    finally:
        earlier = sys.exc_info()[1]
        if stub_process is not None:
            problems = db.terminate_process_group(stub_process, float(db.TERMINATION_GRACE_SECONDS))
            if problems:
                db.report_cleanup_failure(f"SimBrief stub cleanup failed: {'; '.join(problems)}", earlier)
        if compose_started:
            db.cleanup_compose(env, earlier)
    print("Playwright Journey passed; disposable project removed on exit.")


if __name__ == "__main__":
    try:
        main()
    except (AssertionError, OSError, ValueError, KeyError, FileNotFoundError) as error:
        print(f"Playwright Journey failed: {error}", file=sys.stderr)
        sys.exit(1)
