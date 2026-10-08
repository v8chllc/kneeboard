"""Real-process tests for the database Journey's bounded command execution.

Fixtures are POSIX shell scripts under a temporary directory whose name contains
``kbjfixture``. Each fixture process records its pid in its own file. Every test
arms an independent watchdog: once it expires it keeps SIGKILLing recorded
processes until the test ends, so a test containing several hangs still
finishes. A final cleanup does the same whether or not the test passed. Neither
signals a process group: cleanup must stay safe even if a regression stops the
code under test from creating its own session, when a fixture would share the
test runner's group.
"""

from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path
from unittest import TestCase
from unittest.mock import MagicMock, patch
import ast
import importlib.util
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time


SCRIPT = Path(__file__).resolve().parents[2] / "scripts/db_journey.py"
spec = importlib.util.spec_from_file_location("db_journey", SCRIPT)
assert spec and spec.loader
journey = importlib.util.module_from_spec(spec)
spec.loader.exec_module(journey)

BUDGET = "FIXTURE_TIMEOUT_SECONDS"
LIMIT = 0.5
GRACE = 0.5
SLACK = 1.5
WATCHDOG_SECONDS = 10
WATCHDOG_REPEAT_SECONDS = 0.2
PS = shutil.which("ps") or "/bin/ps"
PS_TIMEOUT_SECONDS = 2
SECRET = "fixture-secret-7f3a91"


class FixtureTestCase(TestCase):
    """Owns fixture scripts, their recorded pids, a watchdog, and final cleanup."""

    def setUp(self) -> None:
        self.directory = Path(tempfile.mkdtemp(prefix="kbjfixture-"))
        self.pids = self.directory / "pids"
        self.pids.mkdir()
        self.watchdog_fired = threading.Event()
        self.finished = threading.Event()
        self.watchdog = threading.Thread(target=self.watch, daemon=True)
        self.watchdog.start()
        self.addCleanup(self.cleanup)
        patcher = patch.multiple(journey, create=True, FIXTURE_TIMEOUT_SECONDS=LIMIT, TERMINATION_GRACE_SECONDS=GRACE)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.env = os.environ | {"PIDS": str(self.pids), "FIXTURE_DIR": str(self.directory), "FIXTURE_SECRET": SECRET}
        self.script(
            "stubborn_child.sh",
            "trap '' TERM\n"
            "echo $$ > \"$PIDS/child.$$\"\n"
            "while :; do sleep 0.1; done\n",
        )

    def script(self, name: str, body: str) -> list[str]:
        path = self.directory / name
        path.write_text("#!/bin/sh\n" + body)
        return ["sh", str(path)]

    def recorded(self) -> dict[str, int]:
        pids = {}
        for path in self.pids.iterdir():
            text = path.read_text().strip()
            if text:
                pids[path.name] = int(text)
        return pids

    def is_fixture(self, pid: int) -> bool:
        """Accept only a live process running a script from this test's fixture directory.

        The lookup is bounded; a pid whose lookup fails or times out is reported
        and left unsignalled, and the caller's loop continues.
        """
        if pid <= 1 or pid in (os.getpid(), os.getpgrp()):
            return False
        try:
            result = subprocess.run(  # noqa: S603 - fixed argv; the pid is an int
                [PS, "-o", "args=", "-p", str(pid)], capture_output=True, text=True, check=False, timeout=PS_TIMEOUT_SECONDS
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            print(f"fixture cleanup could not verify pid {pid}; not signalled: {error}", file=sys.stderr)
            return False
        return str(self.directory) in result.stdout

    def kill_fixtures(self) -> None:
        for pid in self.recorded().values():
            if self.is_fixture(pid):
                try:
                    os.kill(pid, signal.SIGKILL)
                except OSError:
                    pass

    def watch(self) -> None:
        if self.finished.wait(WATCHDOG_SECONDS):
            return
        self.watchdog_fired.set()
        while True:
            self.kill_fixtures()
            if self.finished.wait(WATCHDOG_REPEAT_SECONDS):
                return

    def cleanup(self) -> None:
        self.finished.set()
        self.watchdog.join(timeout=5)
        self.kill_fixtures()
        shutil.rmtree(self.directory, ignore_errors=True)

    def outcome(self, args: list[str], **kwargs: object) -> tuple[object, float]:
        """Run the helper, returning its result or exception and the elapsed seconds."""
        started = time.monotonic()
        try:
            result: object = journey.run_bounded(args, self.env, budget=BUDGET, **kwargs)
        except BaseException as error:  # noqa: BLE001 - the test inspects any outcome
            result = error
        elapsed = time.monotonic() - started
        self.assertFalse(self.watchdog_fired.is_set(), "helper did not return before the watchdog")
        return result, elapsed

    def assert_gone(self, *names: str) -> None:
        """Each name matches a pid file of that name or ``<name>.<pid>``; all must have exited."""
        pids = self.recorded()
        for name in names:
            matches = {key: pid for key, pid in pids.items() if key == name or key.startswith(f"{name}.")}
            self.assertTrue(matches, f"fixture {name} never recorded its pid")
            for key, pid in matches.items():
                deadline = time.monotonic() + 2
                while True:
                    try:
                        os.kill(pid, 0)
                    except ProcessLookupError:
                        break
                    except PermissionError:
                        break  # macOS reports an unreaped zombie this way
                    if time.monotonic() > deadline:
                        self.fail(f"fixture {key} (pid {pid}) is still running")
                    time.sleep(0.05)

    def assert_timeout(self, result: object, elapsed: float) -> None:
        self.assertIsInstance(result, journey.JourneyTimeout, f"expected a timeout, got {result!r}")
        self.assertGreaterEqual(elapsed, LIMIT)
        self.assertLess(elapsed, LIMIT + 2 * GRACE + SLACK)


class BoundedCommandTests(FixtureTestCase):
    def test_success_keeps_output_and_exit_semantics(self) -> None:
        args = ["sh", "-c", "printf ' out \\n'; printf err >&2"]
        self.assertEqual(journey.run_bounded(args, self.env, budget=BUDGET), journey.Completed(0, " out \n", "err"))
        self.assertEqual(journey.command(args, self.env, budget=BUDGET), "out")
        self.assertEqual(journey.command(["cat"], self.env, budget=BUDGET, input_text="SELECT 1;\n"), "SELECT 1;")
        self.assertEqual(journey.command(["cat"], self.env, budget=BUDGET), "")

    def test_nonzero_exit_keeps_diagnostics(self) -> None:
        args = ["sh", "-c", "echo partial; echo broken >&2; exit 3"]
        self.assertEqual(journey.run_bounded(args, self.env, budget=BUDGET), journey.Completed(3, "partial\n", "broken\n"))
        with self.assertRaises(AssertionError) as raised:
            journey.command(args, self.env, budget=BUDGET)
        self.assertNotIsInstance(raised.exception, journey.JourneyTimeout)
        self.assertEqual(str(raised.exception), f"{' '.join(args)} failed with exit code 3; stderr tail: broken; stdout tail: partial")

    def test_nonzero_exit_redacts_each_stream_before_independent_caps(self) -> None:
        url = f"postgresql://user:{SECRET}@127.0.0.1/db"
        # The URL starts before the raw tail boundary, but its userinfo ends inside it.
        padding = "x" * (journey.STDERR_TAIL_CHARACTERS - 50)
        args = self.script(
            "failed.sh",
            f"printf '%s\\n' '{url}{padding}' >&2\n"
            f"printf '%s\\n' '{url}{padding}'\n"
            "exit 7\n",
        )
        with self.assertRaises(AssertionError) as raised:
            journey.command(args, self.env, budget=BUDGET)
        message = str(raised.exception)
        self.assertIn(f"{' '.join(args)} failed with exit code 7", message)
        self.assertNotIn(SECRET, message)
        self.assertNotIn("user:", message)
        self.assertEqual(message.count("postgresql://***@127.0.0.1/db"), 2)
        stderr, stdout = message.split("; stderr tail: ", 1)[1].split("; stdout tail: ", 1)
        self.assertTrue(stderr.endswith(padding))
        self.assertTrue(stdout.endswith(padding))
        self.assertLessEqual(len(stderr), journey.STDERR_TAIL_CHARACTERS)
        self.assertLessEqual(len(stdout), journey.STDERR_TAIL_CHARACTERS)

    def test_nonzero_exit_caps_both_streams_independently(self) -> None:
        args = self.script("long_failed.sh", "printf '%0600d' 0 | tr 0 e >&2\nprintf '%0600d' 0 | tr 0 o\nexit 5\n")
        with self.assertRaises(AssertionError) as raised:
            journey.command(args, self.env, budget=BUDGET)
        stderr, stdout = str(raised.exception).split("; stderr tail: ", 1)[1].split("; stdout tail: ", 1)
        self.assertEqual(stderr, "e" * journey.STDERR_TAIL_CHARACTERS)
        self.assertEqual(stdout, "o" * journey.STDERR_TAIL_CHARACTERS)

    def test_nonzero_exit_omits_empty_stream_labels_and_redacts_command_argument(self) -> None:
        url = f"postgresql://user:{SECRET}@127.0.0.1/db"
        args = ["sh", "-c", "exit 9", url]
        with self.assertRaises(AssertionError) as raised:
            journey.command(args, self.env, budget=BUDGET)
        message = str(raised.exception)
        self.assertIn("postgresql://***@127.0.0.1/db failed with exit code 9", message)
        self.assertNotIn(SECRET, message)
        self.assertNotIn("stderr tail:", message)
        self.assertNotIn("stdout tail:", message)

    def test_hang_and_sigterm_ignoring_descendant_are_stopped(self) -> None:
        args = self.script(
            "hang.sh",
            "echo $$ > \"$PIDS/leader\"\n"
            "echo fixture-stderr-line >&2\n"
            "sh \"$FIXTURE_DIR/stubborn_child.sh\" &\n"
            "while :; do sleep 0.1; done\n",
        )
        result, elapsed = self.outcome(args)
        self.assert_timeout(result, elapsed)
        self.assert_gone("leader", "child")
        message = str(result)
        self.assertEqual(
            message,
            f"{' '.join(args)} timed out after {LIMIT:g} seconds ({BUDGET}); stderr tail: fixture-stderr-line",
        )
        self.assertNotIn(SECRET, message)
        self.assertEqual(result.problems, [])

    def test_sigterm_ignoring_leader_is_escalated(self) -> None:
        args = self.script(
            "stubborn_leader.sh",
            "trap '' TERM\n"
            "echo $$ > \"$PIDS/leader\"\n"
            "while :; do sleep 0.1; done\n",
        )
        result, elapsed = self.outcome(args)
        self.assert_timeout(result, elapsed)
        self.assert_gone("leader")
        self.assertEqual(result.problems, [])

    def test_descendant_holding_inherited_pipe_after_leader_exits(self) -> None:
        args = self.script(
            "orphaning.sh",
            "echo $$ > \"$PIDS/leader\"\n"
            "sh \"$FIXTURE_DIR/stubborn_child.sh\" &\n"
            "exit 0\n",
        )
        result, elapsed = self.outcome(args)
        self.assert_timeout(result, elapsed)
        self.assert_gone("leader", "child")
        self.assertEqual(result.problems, [])

    def test_graceful_exit_during_grace_ends_the_wait_early(self) -> None:
        args = self.script(
            "graceful.sh",
            "trap 'exit 0' TERM\n"
            "echo $$ > \"$PIDS/leader\"\n"
            "while :; do sleep 0.05; done\n",
        )
        with patch.object(journey, "TERMINATION_GRACE_SECONDS", 5):
            result, elapsed = self.outcome(args)
        self.assertIsInstance(result, journey.JourneyTimeout)
        self.assertLess(elapsed, LIMIT + SLACK, "termination waited out the grace period after the leader exited")
        self.assert_gone("leader")
        self.assertEqual(result.problems, [])

    def test_already_exited_leaders_need_no_signals(self) -> None:
        reaped = subprocess.Popen(["true"], start_new_session=True)
        reaped.wait()
        unreaped = subprocess.Popen(["true"], start_new_session=True)
        deadline = time.monotonic() + 2
        while not journey.leader_exited(unreaped) and time.monotonic() < deadline:
            time.sleep(0.02)
        for process in (reaped, unreaped):
            started = time.monotonic()
            self.assertEqual(journey.terminate_process_group(process, 5), [])
            self.assertLess(time.monotonic() - started, 1)
            self.assertEqual(process.returncode, 0)

    def test_interruption_terminates_the_group(self) -> None:
        args = self.script(
            "interrupted.sh",
            "echo $$ > \"$PIDS/leader\"\n"
            "sh \"$FIXTURE_DIR/stubborn_child.sh\" &\n"
            "while :; do sleep 0.1; done\n",
        )

        def interrupt(signum: int, frame: object) -> None:
            raise KeyboardInterrupt

        previous = signal.signal(signal.SIGALRM, interrupt)
        try:
            with patch.object(journey, "FIXTURE_TIMEOUT_SECONDS", 30):
                signal.setitimer(signal.ITIMER_REAL, LIMIT)
                result, elapsed = self.outcome(args)
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
            signal.signal(signal.SIGALRM, previous)
        self.assertIsInstance(result, KeyboardInterrupt)
        self.assertLess(elapsed, LIMIT + 2 * GRACE + SLACK)
        self.assert_gone("leader", "child")

    def test_budget_must_be_a_named_finite_positive_limit(self) -> None:
        for name, value in (("FIXTURE_TIMEOUT_SECONDS", 0), ("FIXTURE_TIMEOUT_SECONDS", float("inf")), ("FIXTURE_TIMEOUT_SECONDS", True)):
            with self.subTest(value=value), patch.object(journey, name, value):
                with self.assertRaisesRegex(ValueError, "unknown or unbounded Journey budget"):
                    journey.run_bounded(["true"], self.env, budget=name)
        for name in ("MISSING_TIMEOUT_SECONDS", "TERMINATION_GRACE_SECONDS"):
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "unknown or unbounded Journey budget"):
                journey.run_bounded(["true"], self.env, budget=name)

    def test_timeout_diagnostics_redact_url_credentials(self) -> None:
        args = self.script(
            "leaky.sh",
            "echo $$ > \"$PIDS/leader\"\n"
            "echo \"connect postgresql://kneeboard:$FIXTURE_SECRET@127.0.0.1:5432/db\" >&2\n"
            "while :; do sleep 0.1; done\n",
        )
        result, elapsed = self.outcome(args)
        self.assert_timeout(result, elapsed)
        self.assertNotIn(SECRET, str(result))
        self.assertIn("postgresql://***@127.0.0.1:5432/db", str(result))


class JourneyRoutingTests(FixtureTestCase):
    """Drive main() and cleanup_compose() against a fake docker on PATH; no daemon is contacted."""

    def setUp(self) -> None:
        super().setUp()
        self.log = self.directory / "docker.log"
        self.log.touch()
        bin_directory = self.directory / "bin"
        bin_directory.mkdir()
        docker = bin_directory / "docker"
        docker.write_text(
            "#!/bin/sh\n"
            "printf '%s\\n' \"$*\" >> \"$DOCKER_LOG\"\n"
            "case \"$1 $*\" in\n"
            "  context*) step=context ;;\n"
            "  *' up '*) step=up ;;\n"
            "  *' down '*) step=down ;;\n"
            "  *) step=other ;;\n"
            "esac\n"
            "case \" $FAKE_DOCKER_HANG \" in\n"
            "  *\" $step \"*)\n"
            "    trap '' TERM\n"
            "    echo $$ > \"$PIDS/docker-$step\"\n"
            "    sh \"$FIXTURE_DIR/stubborn_child.sh\" &\n"
            "    while :; do sleep 0.1; done ;;\n"
            "esac\n"
            "if [ \"$step\" = context ]; then echo unix:///fake/docker.sock; exit 0; fi\n"
            "if [ \"$step\" = down ] && [ -n \"$FAKE_DOWN_STATUS\" ]; then echo down refused >&2; exit \"$FAKE_DOWN_STATUS\"; fi\n"
            "exit 0\n"
        )
        docker.chmod(0o755)
        self.env |= {"PATH": f"{bin_directory}:{os.environ['PATH']}", "DOCKER_LOG": str(self.log)}
        self.env.pop("DOCKER_HOST", None)
        self.project_env = self.env | {"KNEEBOARD_DB_PROJECT": "kneeboard_journey_0123456789ab"}

    def run_main(self, hang: str, *, down_status: str = "", **budgets: float) -> tuple[object, float, str, str]:
        stdout, stderr = StringIO(), StringIO()
        environ = self.env | {"FAKE_DOCKER_HANG": hang, "FAKE_DOWN_STATUS": down_status}
        started = time.monotonic()
        with (
            patch.dict(os.environ, environ, clear=True),
            patch.multiple(journey, **budgets),
            redirect_stdout(stdout),
            redirect_stderr(stderr),
        ):
            try:
                journey.main()
                result: object = None
            except BaseException as error:  # noqa: BLE001 - the test inspects any outcome
                result = error
        elapsed = time.monotonic() - started
        self.assertFalse(self.watchdog_fired.is_set(), "Journey did not return before the watchdog")
        self.assertNotIn("Database Journey passed", stdout.getvalue())
        return result, elapsed, stdout.getvalue(), stderr.getvalue()

    def logged(self) -> list[str]:
        return self.log.read_text().splitlines()

    def down_lines(self) -> list[str]:
        return [line for line in self.logged() if " down " in f"{line} "]

    def test_timeout_before_startup_skips_compose_cleanup(self) -> None:
        result, elapsed, _, _ = self.run_main("context", DOCKER_QUERY_TIMEOUT_SECONDS=LIMIT)
        self.assert_timeout(result, elapsed)
        self.assertEqual(result.budget, "DOCKER_QUERY_TIMEOUT_SECONDS")
        self.assert_gone("docker-context", "child")
        self.assertEqual(self.logged(), ["context inspect --format {{.Endpoints.docker.Host}}"])
        self.assertEqual(self.down_lines(), [])

    def test_timeout_after_startup_cleans_up_only_the_journey_project(self) -> None:
        result, elapsed, _, stderr = self.run_main("up", LOCAL_START_TIMEOUT_SECONDS=LIMIT)
        self.assert_timeout(result, elapsed)
        self.assertEqual(result.budget, "LOCAL_START_TIMEOUT_SECONDS")
        self.assert_gone("docker-up", "child")
        project = result.command_args[3]
        self.assertRegex(project, r"^kneeboard_journey_[0-9a-f]{12}$")
        self.assertEqual(result.command_args, ["sh", "scripts/local-db.sh", "--journey-project", project, "start"])
        root = journey.ROOT
        prefix = f"compose --project-directory {root} -f {root / 'compose.yaml'} -p {project}"
        self.assertIn(f"{prefix} up -d --wait postgres", self.logged())
        self.assertEqual(self.down_lines(), [f"{prefix} down -v --remove-orphans"])
        self.assertEqual(stderr, "")

    def test_timeout_stays_primary_when_cleanup_fails(self) -> None:
        result, elapsed, _, stderr = self.run_main("up", down_status="1", LOCAL_START_TIMEOUT_SECONDS=LIMIT)
        self.assert_timeout(result, elapsed)
        self.assertEqual(result.budget, "LOCAL_START_TIMEOUT_SECONDS")
        project = result.command_args[3]
        self.assertIn(f"down -v --remove-orphans failed with exit code 1; stderr tail: down refused; removal of {project} not confirmed; original failure: ", stderr)
        self.assertIn("timed out after 0.5 seconds (LOCAL_START_TIMEOUT_SECONDS)", stderr)

    def test_timeout_stays_primary_when_cleanup_times_out(self) -> None:
        result, elapsed, _, stderr = self.run_main("up down", LOCAL_START_TIMEOUT_SECONDS=LIMIT, COMPOSE_CLEANUP_TIMEOUT_SECONDS=LIMIT)
        self.assertIsInstance(result, journey.JourneyTimeout, f"expected the start timeout, got {result!r}")
        self.assertEqual(result.budget, "LOCAL_START_TIMEOUT_SECONDS")
        self.assertLess(elapsed, 2 * (LIMIT + 2 * GRACE) + SLACK)
        self.assert_gone("docker-up", "docker-down", "child")
        project = result.command_args[3]
        self.assertRegex(stderr, rf"isolated Compose cleanup failed: .* down -v --remove-orphans timed out after 0.5 seconds \(COMPOSE_CLEANUP_TIMEOUT_SECONDS\); removal of {project} not confirmed; original failure: ")

    def test_stalled_compose_teardown_alone_fails_without_claiming_removal(self) -> None:
        environ = self.project_env | {"FAKE_DOCKER_HANG": "down"}
        started = time.monotonic()
        with patch.object(journey, "COMPOSE_CLEANUP_TIMEOUT_SECONDS", LIMIT), redirect_stdout(StringIO()) as stdout:
            with self.assertRaises(AssertionError) as raised:
                journey.cleanup_compose(environ, None)
        elapsed = time.monotonic() - started
        self.assertFalse(self.watchdog_fired.is_set(), "cleanup did not return before the watchdog")
        self.assertLess(elapsed, LIMIT + 2 * GRACE + SLACK)
        self.assert_gone("docker-down", "child")
        message = str(raised.exception)
        self.assertTrue(message.startswith("isolated Compose cleanup failed: "), message)
        self.assertIn("timed out after 0.5 seconds (COMPOSE_CLEANUP_TIMEOUT_SECONDS)", message)
        self.assertTrue(message.endswith("; removal of kneeboard_journey_0123456789ab not confirmed"), message)
        self.assertEqual(stdout.getvalue(), "")

    def test_compose_cleanup_failure_alone_fails(self) -> None:
        environ = self.project_env | {"FAKE_DOWN_STATUS": "1"}
        with self.assertRaises(AssertionError) as raised:
            journey.cleanup_compose(environ, None)
        message = str(raised.exception)
        self.assertIn("down -v --remove-orphans failed with exit code 1; stderr tail: down refused", message)
        self.assertTrue(message.endswith("; removal of kneeboard_journey_0123456789ab not confirmed"))

    def test_successful_compose_cleanup_reports_nothing(self) -> None:
        with redirect_stderr(StringIO()) as stderr:
            journey.cleanup_compose(self.project_env, None)
        self.assertEqual(stderr.getvalue(), "")
        self.assertEqual(len(self.down_lines()), 1)

    def test_termination_problems_are_appended_to_the_timeout(self) -> None:
        real = journey.terminate_process_group

        def refusing(process: subprocess.Popen, grace: float) -> list[str]:
            return real(process, grace) + ["fixture: SIGKILL refused"]

        args = self.script("hang_again.sh", "echo $$ > \"$PIDS/leader\"\nwhile :; do sleep 0.1; done\n")
        with patch.object(journey, "terminate_process_group", refusing):
            result, elapsed = self.outcome(args)
        self.assert_timeout(result, elapsed)
        self.assertEqual(result.problems, ["fixture: SIGKILL refused"])
        self.assertIn(f"timed out after 0.5 seconds ({BUDGET}); termination problems: fixture: SIGKILL refused", str(result))


class ExecutionRoutingTests(TestCase):
    def test_only_the_bounded_helper_and_app_runtime_launch_processes(self) -> None:
        tree = ast.parse(SCRIPT.read_text())
        launchers = {"run", "Popen", "call", "check_call", "check_output", "getoutput", "getstatusoutput", "system", "popen"}
        found = set()
        for function in ast.walk(tree):
            if not isinstance(function, ast.FunctionDef):
                continue
            for node in ast.walk(function):
                if (
                    isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Attribute)
                    and isinstance(node.func.value, ast.Name)
                    and node.func.value.id in {"subprocess", "os"}
                    and (node.func.attr in launchers or node.func.attr.startswith(("spawn", "exec")))
                ):
                    found.add((function.name, f"{node.func.value.id}.{node.func.attr}"))
        self.assertEqual(found, {("run_bounded", "subprocess.Popen"), ("app_runtime", "subprocess.Popen")})
        self.assertNotIn("subprocess.run(", SCRIPT.read_text())

    def live_server(self, script: str) -> subprocess.Popen:
        process = subprocess.Popen(["sh", "-c", script], start_new_session=True)

        def stop() -> None:
            if process.returncode is None:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except OSError:
                    pass
                process.wait(timeout=5)

        self.addCleanup(stop)
        return process

    def run_app_runtime(self, process: subprocess.Popen, urlopen_effect: object) -> tuple[object, list[tuple[int, int, object]]]:
        """Run app_runtime against ``process``, recording each killpg as (pgid, signal, leader returncode)."""
        calls: list[tuple[int, int, object]] = []
        real_killpg, real_sleep = os.killpg, time.sleep

        def recording_killpg(pgid: int, sig: int) -> None:
            calls.append((pgid, sig, process.returncode))
            real_killpg(pgid, sig)

        with (
            patch.object(journey, "command", return_value=""),
            patch.object(journey, "free_port", return_value=54341),
            patch.object(journey.subprocess, "Popen", return_value=process),
            patch.object(journey.urllib.request, "urlopen", **urlopen_effect),
            patch.object(journey.time, "sleep", side_effect=lambda seconds: real_sleep(min(seconds, 0.05))),
            patch.object(journey.os, "killpg", side_effect=recording_killpg),
            redirect_stdout(StringIO()),
        ):
            try:
                journey.app_runtime({})
                outcome: object = None
            except BaseException as error:  # noqa: BLE001 - the test inspects any outcome
                outcome = error
        return outcome, calls

    def test_app_runtime_stops_a_responding_server_through_the_group(self) -> None:
        process = self.live_server("sleep 30")
        response = MagicMock(status=200)
        response.read.return_value = b"For home flight simulation only."
        urlopen = MagicMock()
        urlopen.return_value.__enter__.return_value = response
        outcome, calls = self.run_app_runtime(process, {"new": urlopen})
        self.assertIsNone(outcome)
        self.assertIn((process.pid, signal.SIGTERM, None), calls)
        self.assertIsNotNone(process.returncode)

    def test_server_exiting_during_startup_is_signalled_only_before_it_is_reaped(self) -> None:
        process = self.live_server("exit 3")
        refused = {"side_effect": journey.urllib.error.URLError("connection refused")}
        outcome, calls = self.run_app_runtime(process, refused)
        self.assertEqual(str(outcome), "C-17: application exited before responding")
        self.assertEqual(process.returncode, 3)
        self.assertIn(signal.SIGTERM, [sig for _, sig, _ in calls], "the exited server's group was never signalled before reaping")
        self.assertEqual([call for call in calls if call[2] is not None], [], "a reaped leader's pid was signalled")

    def test_reaped_leader_is_never_signalled(self) -> None:
        process = subprocess.Popen(["true"], start_new_session=True)
        process.wait()
        with patch.object(journey.os, "killpg") as killpg:
            self.assertEqual(journey.terminate_process_group(process, 5), [])
        killpg.assert_not_called()
