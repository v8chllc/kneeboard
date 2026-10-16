"""Focused ownership, pin, budget, and failure checks for the browser Journey."""

import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import threading
import urllib.error
import urllib.request
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
    def test_receiver_keeps_all_private_sentinels_in_memory(self) -> None:
        receiver = journey.SentinelReceiver()
        thread = threading.Thread(target=receiver.serve_forever, daemon=True)
        thread.start()
        try:
            body = json.dumps({"identity": "token:synthetic", "value": "synthetic-value"}).encode()
            with urllib.request.urlopen(urllib.request.Request(
                f"http://127.0.0.1:{receiver.server_port}/", data=body,
                headers={"Content-Type": "application/json"}, method="POST",
            ), timeout=2) as response:
                self.assertEqual(response.status, 204)
            self.assertEqual(receiver.values, {"token:synthetic": "synthetic-value"})
            short = json.dumps({"identity": "token:synthetic", "value": "other-value"}).encode()
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(urllib.request.Request(
                    f"http://127.0.0.1:{receiver.server_port}/", data=short,
                    headers={"Content-Type": "application/json"}, method="POST",
                ), timeout=2)
            self.assertEqual(error.exception.code, 400)
            error.exception.close()
            self.assertEqual(receiver.values, {"token:synthetic": "synthetic-value"})
        finally:
            receiver.shutdown()
            receiver.server_close()
            thread.join(timeout=2)

    def test_fixed_database_inspection_rejects_a_journey_account(self) -> None:
        with patch.object(journey, "checked", side_effect=["local-container", "t", "0", "t", "1"]) as checked:
            with self.assertRaisesRegex(AssertionError, "journey account appeared in a fixed database"):
                journey.fixed_database_isolation({}, ("journey-a@example.invalid", "journey-b@example.invalid"))
        self.assertEqual(len(checked.call_args_list), 5)
        self.assertIn("kneeboard_test", checked.call_args.args[0])
        self.assertIn('FROM "user" WHERE email IN', checked.call_args.args[0][-1])
        self.assertNotIn("account_settings", checked.call_args.args[0][-1])

    def test_output_capture_fails_when_a_deliberate_sentinel_is_logged(self) -> None:
        process = MagicMock(stdout=io.BytesIO(b"ordinary app output\nprivate-sentinel\n"))
        output = journey.AppOutput(process)
        self.assertTrue(output.contains_private_value(["private-sentinel"]))
        self.assertFalse(output.contains_private_value(["missing-sentinel"]))
        values = {identity: f"synthetic-{identity}" for identity in journey.REQUIRED_SENTINELS}
        values["token:one"] = "private-sentinel"
        values["fault-token:one"] = "synthetic-fault-token"
        with self.assertRaisesRegex(AssertionError, "log-exclusion failed"):
            journey.verify_private_output(output, values)
        with self.assertRaisesRegex(AssertionError, "log-exclusion sentinels missing"):
            journey.verify_private_output(output, {key: value for key, value in values.items() if key != "fault-token:one"})
        with self.assertRaisesRegex(AssertionError, "log-exclusion sentinels missing"):
            journey.verify_private_output(output, values | {"token:duplicate": "private-sentinel"})

    def test_output_capture_detects_second_account_pilot_id(self) -> None:
        process = MagicMock(stdout=io.BytesIO(b"ordinary app output\n00246802\n"))
        output = journey.AppOutput(process)
        self.assertTrue(output.contains_private_value(["00135791", "00246802"]))

    def test_output_capture_fails_closed_on_overflow(self) -> None:
        process = MagicMock(stdout=io.BytesIO(b"x" * (journey.OUTPUT_LIMIT_BYTES + 1)))
        output = journey.AppOutput(process)
        with self.assertRaisesRegex(AssertionError, "application output capture incomplete"):
            output.contains_private_value(["private-sentinel"])

    def test_output_capture_fails_closed_on_stalled_pipe(self) -> None:
        release = threading.Event()

        class StalledStream:
            def read(self, _size: int) -> bytes:
                release.wait(timeout=10)
                return b""

        output = journey.AppOutput(MagicMock(stdout=StalledStream()))
        try:
            with patch.object(output.thread, "join", wraps=output.thread.join) as join:
                with self.assertRaisesRegex(AssertionError, "application output capture incomplete"):
                    output.contains_private_value(["private-sentinel"])
                join.assert_called_once_with(timeout=5)
        finally:
            release.set()
            output.thread.join(timeout=2)

    def test_runtime_probe_fails_when_missing_allowlist_sends_mail(self) -> None:
        process = MagicMock(returncode=None)
        with (
            patch.object(journey.db, "free_port", return_value=30444),
            patch.object(journey.subprocess, "Popen", return_value=process),
            patch.object(journey, "AppOutput") as output,
            patch.object(journey, "await_port"),
            patch.object(journey, "clear_mailpit"),
            patch.object(journey, "http_response", side_effect=lambda url, **_kwargs: (200, b"null") if url.endswith("/get-session") else (200, b"{}")),
            patch.object(journey, "mailpit_messages", return_value={"total": 1, "messages": []}),
            patch.object(journey.db, "terminate_process_group", return_value=[]),
        ):
            output.return_value.contains_private_value.return_value = False
            with self.assertRaisesRegex(AssertionError, "missing allowlist delivery failed"):
                journey.auth_runtime_probes({"BETTER_AUTH_SECRET": "synthetic-secret"}, 8025)

    def test_runtime_probe_rejects_404_for_valid_configuration(self) -> None:
        process = MagicMock(returncode=None)
        with (
            patch.object(journey.db, "free_port", return_value=30446),
            patch.object(journey.subprocess, "Popen", return_value=process),
            patch.object(journey, "AppOutput"),
            patch.object(journey, "await_port"),
            patch.object(journey, "clear_mailpit"),
            patch.object(journey, "http_response", return_value=(404, b"Not Found")),
            patch.object(journey.db, "terminate_process_group", return_value=[]),
        ):
            with self.assertRaisesRegex(AssertionError, "valid missing auth configuration was rejected"):
                journey.auth_runtime_probes({"BETTER_AUTH_SECRET": "synthetic-secret"}, 8025)

    def test_runtime_probe_fails_when_invalid_production_auth_starts(self) -> None:
        process = MagicMock(returncode=None)
        current_env: dict[str, str] = {}

        def start(_args: object, **kwargs: object) -> MagicMock:
            current_env.clear()
            current_env.update(kwargs["env"])  # type: ignore[arg-type]
            return process

        with (
            patch.object(journey.db, "free_port", return_value=30445),
            patch.object(journey.subprocess, "Popen", side_effect=start),
            patch.object(journey, "AppOutput") as output,
            patch.object(journey, "await_port"),
            patch.object(journey, "clear_mailpit"),
            patch.object(journey, "http_response", side_effect=lambda url, **_kwargs: ((404, b"Not Found") if current_env.get("NODE_ENV") == "production" else (200, b"null")) if url.endswith("/get-session") else (200, b"{}")),
            patch.object(journey, "mailpit_messages", side_effect=lambda _port: {
                "total": 1 if current_env.get("AUTH_EMAIL_ALLOWLIST") == "*" else 0,
                "messages": [{"To": [{"Address": "policy-wildcard@example.invalid"}]}],
            }),
            patch.object(journey.db, "terminate_process_group", return_value=[]),
        ):
            output.return_value.contains_private_value.return_value = False
            with self.assertRaisesRegex(AssertionError, "invalid production-mailpit auth configuration was accepted"):
                journey.auth_runtime_probes({"BETTER_AUTH_SECRET": "synthetic-secret"}, 8025)

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
            patch.object(journey.db, "free_port", side_effect=[54441, 10241, 8021, 30041]),
            patch.object(journey, "checked", side_effect=["unix:///local/docker.sock", "", "", "", "", "", "", "", ""]) as checked,
            patch.object(journey, "browser_metadata"),
            patch.object(journey, "local") as local,
            patch.object(journey, "SentinelReceiver") as receiver,
            patch.object(journey, "AppOutput") as output,
            patch.object(journey, "fixed_database_isolation") as fixed,
            patch.object(journey, "auth_runtime_probes") as probes,
            patch.object(journey, "clear_mailpit"),
            patch.object(journey.db, "psql", return_value="kneeboard_test"),
            patch.object(journey.db, "journal", return_value=",".join(map(str, journey.db.EXPECTED_MIGRATIONS))),
            patch.object(journey.subprocess, "Popen", return_value=process) as popen,
            patch.object(journey, "await_app"),
            patch.object(journey.db, "terminate_process_group", return_value=[]),
            patch.object(journey.db, "cleanup_compose") as cleanup,
        ):
            uuid4.return_value.hex = "abcdef12345600000000000000000000"
            receiver.return_value.values = {identity: f"synthetic-{identity}" for identity in journey.REQUIRED_SENTINELS} | {"token:one": "synthetic-token", "fault-token:one": "synthetic-fault-token"}
            receiver.return_value.server_port = 12345
            output.return_value.contains_private_value.return_value = False
            journey.main()
        env = local.call_args_list[0].args[1]
        self.assertEqual(env["KNEEBOARD_DB_PROJECT"], "kneeboard_journey_abcdef123456")
        self.assertEqual(env["KNEEBOARD_DB_PORT"], "54441")
        self.assertEqual(env["KNEEBOARD_MAILPIT_SMTP_PORT"], "10241")
        self.assertEqual(local.call_args_list[1].args, ("migrate", env, "test"))
        self.assertEqual(popen.call_args.kwargs["env"]["DATABASE_URL"],
                         "postgresql://kneeboard:local_only_kneeboard@127.0.0.1:54441/kneeboard_test")
        self.assertTrue(any(call.args[0][-2:] == ["playwright", "test"] for call in checked.call_args_list))
        self.assertTrue(any("tests/journey/mailpit-chaos.compose.yaml" in call.args[0] for call in checked.call_args_list))
        self.assertEqual(checked.call_args.args[0][-2:], ["-t", "leaves no redeemable link after a delivery failure"])
        probes.assert_called_once()
        fixed.assert_called_once()
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
            patch.object(journey.db, "free_port", side_effect=[54443, 10243, 8023, 30043]),
            patch.object(journey, "checked", side_effect=run),
            patch.object(journey, "browser_metadata"),
            patch.object(journey, "local"),
            patch.object(journey, "SentinelReceiver") as receiver,
            patch.object(journey, "AppOutput"),
            patch.object(journey.db, "psql", return_value="kneeboard_test"),
            patch.object(journey.db, "journal", return_value=",".join(map(str, journey.db.EXPECTED_MIGRATIONS))),
            patch.object(journey.subprocess, "Popen", return_value=process),
            patch.object(journey, "await_app"),
            patch.object(journey.db, "terminate_process_group", return_value=[]) as stop,
            patch.object(journey.db, "cleanup_compose") as cleanup,
        ):
            receiver.return_value.server_port = 12345
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
