"""Run Playwright against a built app and a disposable local PostgreSQL project.

The runner owns one validated Compose project and loopback port, one Next.js
process group, and Playwright's local browser install. It removes the project
and volume after success, failure, or interruption. It never targets the fixed
development project or a remote database. All commands have finite budgets.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

import db_journey as db


PLAYWRIGHT_VERSION = "1.64.0"
CHROMIUM_REVISION = "1248"
CHROMIUM_VERSION = "156.0.8078.4"
BROWSER_INSTALL_TIMEOUT_SECONDS = 600
PLAYWRIGHT_TIMEOUT_SECONDS = 180
APP_START_TIMEOUT_SECONDS = 60


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


def checked(args: list[str], env: dict[str, str], budget: str, seconds: float, label: str) -> str:
    """Run a bounded command without relaying unredacted subprocess output."""
    setattr(db, budget, seconds)
    try:
        result = db.run_bounded(args, env, budget=budget)
    except (db.JourneyTimeout, OSError):
        raise AssertionError(f"{label} failed or exceeded its {seconds:g}s budget") from None
    if result.returncode != 0:
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


def main() -> None:
    project = f"kneeboard_journey_{uuid.uuid4().hex[:12]}"
    database_port = db.free_port()
    env = os.environ.copy()
    env.update(KNEEBOARD_DB_PROJECT=project, KNEEBOARD_DB_PORT=str(database_port))
    env.pop("DATABASE_URL", None)
    env.pop("COMPOSE_FILE", None)
    compose_started = False
    try:
        docker_host = env.get("DOCKER_HOST", "")
        context_host = checked(
            ["docker", "context", "inspect", "--format", "{{.Endpoints.docker.Host}}"],
            env, "DOCKER_QUERY_TIMEOUT_SECONDS", db.DOCKER_QUERY_TIMEOUT_SECONDS,
            "Docker context check",
        )
        if (docker_host and not docker_host.startswith(("unix://", "npipe://"))) or not context_host.startswith(("unix://", "npipe://")):
            raise AssertionError("browser Journey requires a local Docker socket")

        browser_metadata()
        checked(["mise", "exec", "--", "pnpm", "exec", "playwright", "install", "chromium", "--only-shell"],
                env, "BROWSER_INSTALL_TIMEOUT_SECONDS", BROWSER_INSTALL_TIMEOUT_SECONDS, "browser installation")

        compose_started = True
        local("start", env)
        local("migrate", env, "test")
        try:
            db.require(db.psql("kneeboard_test", "SELECT current_database();", env), "kneeboard_test", "E2E isolated database")
            db.require(db.journal("kneeboard_test", env), ",".join(map(str, db.EXPECTED_MIGRATIONS)), "E2E migrations")
        except (AssertionError, OSError):
            raise AssertionError("isolated database readiness failed") from None

        app_env = env.copy()
        app_env["DATABASE_URL"] = f"postgresql://kneeboard:local_only_kneeboard@127.0.0.1:{database_port}/kneeboard_test"
        checked(["mise", "exec", "--", "pnpm", "build"], app_env,
                "BUILD_TIMEOUT_SECONDS", db.BUILD_TIMEOUT_SECONDS, "application build")
        app_port = db.free_port()
        process = subprocess.Popen(
            ["mise", "exec", "--", "pnpm", "start", "--port", str(app_port)],
            cwd=db.ROOT, env=app_env, stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True,
        )
        try:
            await_app(process, app_port)
            browser_env = app_env | {"PLAYWRIGHT_BASE_URL": f"http://127.0.0.1:{app_port}"}
            checked(["mise", "exec", "--", "pnpm", "exec", "playwright", "test"], browser_env,
                    "PLAYWRIGHT_TIMEOUT_SECONDS", PLAYWRIGHT_TIMEOUT_SECONDS, "Playwright smoke journey")
        finally:
            earlier = sys.exc_info()[1]
            problems = db.terminate_process_group(process, float(db.TERMINATION_GRACE_SECONDS))
            if problems:
                db.report_cleanup_failure(f"application process cleanup failed: {'; '.join(problems)}", earlier)
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
