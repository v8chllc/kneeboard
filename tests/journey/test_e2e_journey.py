"""Focused ownership, pin, budget, and failure checks for the browser Journey."""

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from unittest import TestCase
from unittest.mock import MagicMock, patch


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
SPEC = importlib.util.spec_from_file_location("e2e_journey", ROOT / "scripts/e2e_journey.py")
assert SPEC and SPEC.loader
journey = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(journey)


class E2EJourneyTests(TestCase):
    def test_browser_pin_matches_installed_mapping_and_rejects_change(self) -> None:
        self.assertEqual(journey.browser_metadata()["revision"], "1248")
        with patch.object(journey, "CHROMIUM_REVISION", "wrong"):
            with self.assertRaisesRegex(AssertionError, "headless shell differs"):
                journey.browser_metadata()

    def test_bounded_command_hides_output_and_uses_finite_budget(self) -> None:
        result = journey.db.Completed(1, "sensitive output", "sensitive error")
        original_budget = journey.db.INSTALL_TIMEOUT_SECONDS
        with patch.object(journey.db, "run_bounded", return_value=result) as run:
            with self.assertRaisesRegex(AssertionError, "browser installation failed \\(exit 1\\)") as error:
                journey.checked(["browser"], {}, "INSTALL_TIMEOUT_SECONDS", "browser installation")
        self.assertNotIn("sensitive", str(error.exception))
        self.assertEqual(run.call_args.kwargs["budget"], "INSTALL_TIMEOUT_SECONDS")
        self.assertEqual(journey.db.INSTALL_TIMEOUT_SECONDS, original_budget)
        self.assertEqual(journey.db.budget_seconds("INSTALL_TIMEOUT_SECONDS"), 600)

    def test_isolated_project_and_port_are_used_and_cleaned_on_success(self) -> None:
        process = MagicMock()
        process.returncode = None
        with (
            patch.object(journey.uuid, "uuid4") as uuid4,
            patch.object(journey.db, "free_port", side_effect=[54441, 30041]),
            patch.object(journey, "checked", side_effect=["unix:///local/docker.sock", "", "", ""]) as checked,
            patch.object(journey, "browser_metadata"),
            patch.object(journey, "local") as local,
            patch.object(journey.db, "psql", return_value="kneeboard_test"),
            patch.object(journey.db, "journal", return_value=",".join(map(str, journey.db.EXPECTED_MIGRATIONS))),
            patch.object(journey.subprocess, "Popen", return_value=process) as popen,
            patch.object(journey, "await_app"),
            patch.object(journey.db, "terminate_process_group", return_value=[]),
            patch.object(journey.db, "cleanup_compose") as cleanup,
        ):
            uuid4.return_value.hex = "abcdef12345600000000000000000000"
            journey.main()
        env = local.call_args_list[0].args[1]
        self.assertEqual(env["KNEEBOARD_DB_PROJECT"], "kneeboard_journey_abcdef123456")
        self.assertEqual(env["KNEEBOARD_DB_PORT"], "54441")
        self.assertEqual(local.call_args_list[1].args, ("migrate", env, "test"))
        self.assertEqual(popen.call_args.kwargs["env"]["DATABASE_URL"],
                         "postgresql://kneeboard:local_only_kneeboard@127.0.0.1:54441/kneeboard_test")
        self.assertEqual(checked.call_args.args[0][-2:], ["playwright", "test"])
        cleanup.assert_called_once_with(env, None)

    def test_failure_after_start_preserves_failure_and_cleans_project(self) -> None:
        with (
            patch.object(journey.db, "free_port", return_value=54442),
            patch.object(journey, "checked", return_value="unix:///local/docker.sock"),
            patch.object(journey, "browser_metadata"),
            patch.object(journey, "local", side_effect=AssertionError("start failed")),
            patch.object(journey.db, "cleanup_compose") as cleanup,
        ):
            with self.assertRaisesRegex(AssertionError, "start failed"):
                journey.main()
        self.assertIsInstance(cleanup.call_args.args[1], AssertionError)
        self.assertRegex(cleanup.call_args.args[0]["KNEEBOARD_DB_PROJECT"], r"^kneeboard_journey_[0-9a-f]{12}$")

    def test_browser_failure_stops_app_and_cleans_project(self) -> None:
        process = MagicMock()
        process.returncode = None
        def run(args: list[str], *_args: object, **_kwargs: object) -> str:
            if args[:3] == ["docker", "context", "inspect"]:
                return "unix:///local/docker.sock"
            if args[-2:] == ["playwright", "test"]:
                raise AssertionError("Playwright smoke journey failed (exit 1)")
            return ""
        with (
            patch.object(journey.db, "free_port", side_effect=[54443, 30043]),
            patch.object(journey, "checked", side_effect=run),
            patch.object(journey, "browser_metadata"),
            patch.object(journey, "local"),
            patch.object(journey.db, "psql", return_value="kneeboard_test"),
            patch.object(journey.db, "journal", return_value=",".join(map(str, journey.db.EXPECTED_MIGRATIONS))),
            patch.object(journey.subprocess, "Popen", return_value=process),
            patch.object(journey, "await_app"),
            patch.object(journey.db, "terminate_process_group", return_value=[]) as stop,
            patch.object(journey.db, "cleanup_compose") as cleanup,
        ):
            with self.assertRaisesRegex(AssertionError, "Playwright smoke journey failed"):
                journey.main()
        stop.assert_called_once_with(process, float(journey.db.TERMINATION_GRACE_SECONDS))
        self.assertIsInstance(cleanup.call_args.args[1], AssertionError)

    def test_aggregate_stops_at_each_failing_journey(self) -> None:
        script = json.loads((ROOT / "package.json").read_text())["scripts"]["journey"]
        with tempfile.TemporaryDirectory() as directory:
            pnpm = Path(directory) / "pnpm"
            pnpm.write_text("#!/bin/sh\nprintf '%s\\n' \"$1\" >> \"$CALLS\"\n[ \"$1\" != \"$FAIL\" ]\n")
            pnpm.chmod(0o755)
            calls = Path(directory) / "calls"
            for failing, expected in (("journey:db", ["journey:db"]),
                                      ("journey:e2e", ["journey:db", "journey:e2e"])):
                calls.write_text("")
                env = os.environ | {"PATH": f"{directory}:{os.environ['PATH']}", "CALLS": str(calls), "FAIL": failing}
                result = subprocess.run(["sh", "-c", script], env=env, check=False, capture_output=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(calls.read_text().splitlines(), expected)
