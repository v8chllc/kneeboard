"""Focused failure-path tests for the database Journey's cleanup handling."""

from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch
import importlib.util


SCRIPT = Path(__file__).resolve().parents[2] / "scripts/db_journey.py"
spec = importlib.util.spec_from_file_location("db_journey", SCRIPT)
assert spec and spec.loader
journey = importlib.util.module_from_spec(spec)
spec.loader.exec_module(journey)


class CleanupFailureTests(TestCase):
    def test_claim_failure_survives_compose_cleanup_failure(self) -> None:
        stderr = StringIO()
        cleanup = SimpleNamespace(returncode=1, stderr="cleanup refused")
        with (
            patch.object(journey, "free_port", return_value=54339),
            patch.object(journey, "command", return_value="unix:///local/docker.sock"),
            patch.object(journey, "local", side_effect=AssertionError("C-11: recent-load order wrong")),
            patch.object(journey.subprocess, "run", return_value=cleanup) as run,
            redirect_stderr(stderr),
        ):
            with self.assertRaisesRegex(AssertionError, "C-11: recent-load order wrong"):
                journey.main()
        self.assertEqual(run.call_args.args[0], ["docker", "compose", "down", "-v", "--remove-orphans"])
        self.assertEqual(run.call_args.kwargs["timeout"], journey.COMPOSE_CLEANUP_TIMEOUT_SECONDS)
        self.assertIn("isolated Compose cleanup failed: cleanup refused", stderr.getvalue())
        self.assertIn("original failure: C-11: recent-load order wrong", stderr.getvalue())

    def test_compose_cleanup_failure_alone_is_reported(self) -> None:
        with patch.object(journey.subprocess, "run", return_value=SimpleNamespace(returncode=1, stderr="cleanup refused")):
            with self.assertRaisesRegex(AssertionError, "isolated Compose cleanup failed: cleanup refused"):
                journey.cleanup_compose({}, None)

    def test_claim_failure_survives_compose_cleanup_timeout(self) -> None:
        stderr = StringIO()
        timeout = journey.subprocess.TimeoutExpired(["docker", "compose", "down"], 60)
        with (
            patch.object(journey, "free_port", return_value=54339),
            patch.object(journey, "command", return_value="unix:///local/docker.sock"),
            patch.object(journey, "local", side_effect=AssertionError("C-11: recent-load order wrong")),
            patch.object(journey.subprocess, "run", side_effect=timeout) as run,
            redirect_stderr(stderr),
        ):
            with self.assertRaisesRegex(AssertionError, "C-11: recent-load order wrong"):
                journey.main()
        self.assertEqual(run.call_args.kwargs["timeout"], journey.COMPOSE_CLEANUP_TIMEOUT_SECONDS)
        self.assertIn("isolated Compose cleanup failed", stderr.getvalue())
        self.assertIn("timed out after 60 seconds", stderr.getvalue())
        self.assertIn("original failure: C-11: recent-load order wrong", stderr.getvalue())

    def test_compose_cleanup_timeout_alone_is_reported(self) -> None:
        timeout = journey.subprocess.TimeoutExpired(["docker", "compose", "down"], 60)
        with patch.object(journey.subprocess, "run", side_effect=timeout) as run:
            with self.assertRaisesRegex(AssertionError, "isolated Compose cleanup failed:.*timed out after 60 seconds"):
                journey.cleanup_compose({}, None)
        self.assertEqual(run.call_args.kwargs["timeout"], journey.COMPOSE_CLEANUP_TIMEOUT_SECONDS)

    def test_runtime_claim_survives_process_cleanup_failure(self) -> None:
        process = MagicMock()
        process.pid = 12345
        process.poll.return_value = None
        response = MagicMock()
        response.status = 200
        response.read.return_value = b"no simulation warning"
        stderr = StringIO()
        with (
            patch.object(journey, "command", return_value=""),
            patch.object(journey, "free_port", return_value=54340),
            patch.object(journey.subprocess, "Popen", return_value=process),
            patch.object(journey.urllib.request, "urlopen") as urlopen,
            patch.object(journey.os, "killpg", side_effect=OSError("terminate refused")),
            redirect_stderr(stderr),
            redirect_stdout(StringIO()),
        ):
            urlopen.return_value.__enter__.return_value = response
            with self.assertRaisesRegex(AssertionError, "C-17: runtime page or simulation warning missing"):
                journey.app_runtime({})
        self.assertIn("application process cleanup failed: terminate refused", stderr.getvalue())
        self.assertIn("original failure: C-17", stderr.getvalue())
