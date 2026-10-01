"""Real-process tests for the database Journey's bounded command execution.

Fixtures are POSIX shell scripts under a temporary directory whose name contains
``kbjfixture``. Each records its pid, every test arms an independent watchdog
that SIGKILLs the recorded processes if the code under test hangs, and a final
cleanup does the same whether or not the test passed.
"""

from pathlib import Path
from unittest import TestCase
from unittest.mock import patch
import importlib.util
import os
import shutil
import signal
import subprocess
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
WATCHDOG_SECONDS = 15
SECRET = "fixture-secret-7f3a91"


class FixtureTestCase(TestCase):
    """Owns fixture scripts, their recorded pids, a watchdog, and final cleanup."""

    def setUp(self) -> None:
        self.directory = Path(tempfile.mkdtemp(prefix="kbjfixture-"))
        self.pids = self.directory / "pids"
        self.pids.mkdir()
        self.watchdog_fired = threading.Event()
        self.watchdog = threading.Timer(WATCHDOG_SECONDS, self.kill_fixtures, kwargs={"from_watchdog": True})
        self.watchdog.daemon = True
        self.watchdog.start()
        self.addCleanup(self.cleanup)
        patcher = patch.multiple(journey, create=True, FIXTURE_TIMEOUT_SECONDS=LIMIT, TERMINATION_GRACE_SECONDS=GRACE)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.env = os.environ | {"PIDS": str(self.pids), "FIXTURE_DIR": str(self.directory), "FIXTURE_SECRET": SECRET}
        self.script(
            "stubborn_child.sh",
            "trap '' TERM\n"
            "echo $$ > \"$PIDS/child\"\n"
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

    def kill_fixtures(self, from_watchdog: bool = False) -> None:
        if from_watchdog:
            self.watchdog_fired.set()
        for name, pid in self.recorded().items():
            # Leaders were started in their own session, so pid == pgid.
            sender = os.killpg if name.startswith("leader") else os.kill
            try:
                sender(pid, signal.SIGKILL)
            except OSError:
                pass

    def cleanup(self) -> None:
        self.watchdog.cancel()
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
        pids = self.recorded()
        for name in names:
            self.assertIn(name, pids, f"fixture {name} never recorded its pid")
            deadline = time.monotonic() + 2
            while True:
                try:
                    os.kill(pids[name], 0)
                except ProcessLookupError:
                    break
                except PermissionError:
                    break  # macOS reports an unreaped zombie this way
                if time.monotonic() > deadline:
                    self.fail(f"fixture {name} (pid {pids[name]}) is still running")
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
        self.assertEqual(str(raised.exception), f"{' '.join(args)} failed: broken partial")

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
