"""Focused failure-path tests for the database Journey's cleanup handling."""

from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path
from unittest import TestCase
from unittest.mock import MagicMock, patch
import importlib.util


SCRIPT = Path(__file__).resolve().parents[2] / "scripts/db_journey.py"
spec = importlib.util.spec_from_file_location("db_journey", SCRIPT)
assert spec and spec.loader
journey = importlib.util.module_from_spec(spec)
spec.loader.exec_module(journey)
PROJECT_ENV = {"KNEEBOARD_DB_PROJECT": "kneeboard_journey_123456789abc"}


class CleanupFailureTests(TestCase):
    def test_claim_failure_survives_compose_cleanup_failure(self) -> None:
        stderr = StringIO()
        cleanup = journey.Completed(returncode=1, stdout="", stderr="cleanup refused")
        with (
            patch.object(journey, "free_port", return_value=54339),
            patch.object(journey, "command", return_value="unix:///local/docker.sock"),
            patch.object(journey, "local", side_effect=AssertionError("C-11: recent-load order wrong")),
            patch.object(journey, "run_bounded", return_value=cleanup) as run,
            redirect_stderr(stderr),
        ):
            with self.assertRaisesRegex(AssertionError, "C-11: recent-load order wrong"):
                journey.main()
        self.assertEqual(run.call_args.args[0], journey.compose_args(run.call_args.args[1]) + ["down", "-v", "--remove-orphans"])
        self.assertEqual(run.call_args.kwargs["budget"], "COMPOSE_CLEANUP_TIMEOUT_SECONDS")
        self.assertEqual(journey.COMPOSE_CLEANUP_TIMEOUT_SECONDS, 60)
        self.assertIn("isolated Compose cleanup failed: ", stderr.getvalue())
        self.assertIn("failed with exit code 1; stderr tail: cleanup refused", stderr.getvalue())
        self.assertIn("original failure: C-11: recent-load order wrong", stderr.getvalue())

    def test_compose_cleanup_failure_alone_is_reported(self) -> None:
        with patch.object(journey, "run_bounded", return_value=journey.Completed(returncode=1, stdout="", stderr="cleanup refused")):
            with self.assertRaisesRegex(AssertionError, "failed with exit code 1; stderr tail: cleanup refused"):
                journey.cleanup_compose(PROJECT_ENV, None)

    def test_compose_cleanup_nonzero_redacts_stderr_and_keeps_precedence(self) -> None:
        secret = "cleanup-secret-4bc12"
        url = f"postgresql://user:{secret}@127.0.0.1/db"
        cleanup = journey.Completed(17, "ignored stdout", f"refused {url}\n")
        with patch.object(journey, "run_bounded", return_value=cleanup):
            with self.assertRaises(AssertionError) as raised:
                journey.cleanup_compose(PROJECT_ENV, None)
        message = str(raised.exception)
        self.assertIn("docker compose", message)
        self.assertIn("down -v --remove-orphans failed with exit code 17", message)
        self.assertIn("stderr tail: refused postgresql://***@127.0.0.1/db", message)
        self.assertIn("removal of kneeboard_journey_123456789abc not confirmed", message)
        self.assertNotIn(secret, message)
        self.assertNotIn("ignored stdout", message)

        stderr = StringIO()
        earlier = AssertionError("earlier claim")
        with patch.object(journey, "run_bounded", return_value=cleanup), redirect_stderr(stderr):
            journey.cleanup_compose(PROJECT_ENV, earlier)
        self.assertIn("original failure: earlier claim", stderr.getvalue())
        self.assertIn("failed with exit code 17", stderr.getvalue())
        self.assertNotIn(secret, stderr.getvalue())

    def test_compose_cleanup_nonzero_caps_stderr_and_omits_empty_tail(self) -> None:
        cleanup = journey.Completed(4, "", "z" * (journey.STDERR_TAIL_CHARACTERS + 100))
        with patch.object(journey, "run_bounded", return_value=cleanup):
            with self.assertRaises(AssertionError) as raised:
                journey.cleanup_compose(PROJECT_ENV, None)
        tail = str(raised.exception).split("; stderr tail: ", 1)[1].split("; removal of ", 1)[0]
        self.assertEqual(tail, "z" * journey.STDERR_TAIL_CHARACTERS)

        with patch.object(journey, "run_bounded", return_value=journey.Completed(4, "", "")):
            with self.assertRaises(AssertionError) as raised:
                journey.cleanup_compose(PROJECT_ENV, None)
        self.assertIn("failed with exit code 4; removal of", str(raised.exception))
        self.assertNotIn("stderr tail:", str(raised.exception))

    def test_claim_failure_survives_compose_cleanup_timeout(self) -> None:
        stderr = StringIO()
        timeout = journey.JourneyTimeout(["docker", "compose", "down"], "COMPOSE_CLEANUP_TIMEOUT_SECONDS", 60)
        with (
            patch.object(journey, "free_port", return_value=54339),
            patch.object(journey, "command", return_value="unix:///local/docker.sock"),
            patch.object(journey, "local", side_effect=AssertionError("C-11: recent-load order wrong")),
            patch.object(journey, "run_bounded", side_effect=timeout) as run,
            redirect_stderr(stderr),
        ):
            with self.assertRaisesRegex(AssertionError, "C-11: recent-load order wrong"):
                journey.main()
        self.assertEqual(run.call_args.kwargs["budget"], "COMPOSE_CLEANUP_TIMEOUT_SECONDS")
        self.assertIn("isolated Compose cleanup failed", stderr.getvalue())
        self.assertIn("timed out after 60 seconds", stderr.getvalue())
        self.assertIn("original failure: C-11: recent-load order wrong", stderr.getvalue())

    def test_compose_cleanup_timeout_alone_is_reported(self) -> None:
        timeout = journey.JourneyTimeout(["docker", "compose", "down"], "COMPOSE_CLEANUP_TIMEOUT_SECONDS", 60)
        with patch.object(journey, "run_bounded", side_effect=timeout) as run:
            with self.assertRaisesRegex(AssertionError, "isolated Compose cleanup failed:.*timed out after 60 seconds"):
                journey.cleanup_compose(PROJECT_ENV, None)
        self.assertEqual(run.call_args.kwargs["budget"], "COMPOSE_CLEANUP_TIMEOUT_SECONDS")

    def test_runtime_claim_survives_process_cleanup_failure(self) -> None:
        process = MagicMock()
        process.pid = 12345
        process.returncode = None
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
            patch.object(journey, "leader_exited", return_value=False),
            patch.object(journey, "TERMINATION_GRACE_SECONDS", 0),
            redirect_stderr(stderr),
            redirect_stdout(StringIO()),
        ):
            urlopen.return_value.__enter__.return_value = response
            with self.assertRaisesRegex(AssertionError, "C-17: runtime page or simulation warning missing"):
                journey.app_runtime({})
        self.assertIn("application process cleanup failed: terminate refused", stderr.getvalue())
        self.assertIn("original failure: C-17", stderr.getvalue())
