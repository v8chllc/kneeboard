"""Fail-closed checks for the browser journey's non-atomic fitness probe."""

import importlib.util
import signal
import subprocess
import sys
from pathlib import Path
from unittest import TestCase
from unittest.mock import MagicMock, patch


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
SPEC = importlib.util.spec_from_file_location("e2e_journey_fitness", ROOT / "scripts/e2e_journey_fitness.py")
assert SPEC and SPEC.loader
fitness = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fitness)


class E2EJourneyFitnessTests(TestCase):
    def test_interruption_signals_and_reaps_owned_runner(self) -> None:
        process = MagicMock()
        process.communicate.side_effect = [KeyboardInterrupt(), ("", None)]
        with (
            patch.object(fitness.subprocess, "Popen", return_value=process),
            patch.object(fitness.db, "signal_group") as signal_group,
        ):
            with self.assertRaises(KeyboardInterrupt):
                fitness.run_variant(ROOT)
        signal_group.assert_called_once_with(process, signal.SIGINT, [])
        self.assertEqual(process.communicate.call_count, 2)

    def test_timeout_escalates_and_re_raises_original_failure(self) -> None:
        process = MagicMock()
        timeout = subprocess.TimeoutExpired("journey:e2e", 900)
        process.communicate.side_effect = [timeout, subprocess.TimeoutExpired("journey:e2e", 60), ("", None)]
        with (
            patch.object(fitness.subprocess, "Popen", return_value=process),
            patch.object(fitness.db, "signal_group") as signal_group,
        ):
            with self.assertRaises(subprocess.TimeoutExpired) as error:
                fitness.run_variant(ROOT)
        self.assertIs(error.exception, timeout)
        self.assertEqual([call.args[1] for call in signal_group.call_args_list], [signal.SIGINT, signal.SIGKILL])
        self.assertEqual(process.communicate.call_count, 3)

    def test_browser_fitness_command_is_documented(self) -> None:
        readme = (ROOT / "README.md").read_text()
        self.assertIn("mise exec -- python3 scripts/e2e_journey_fitness.py /tmp/kneeboard-browser-fitness", readme)

    def test_only_atomic_session_failure_confirms_non_atomic_mutant(self) -> None:
        fitness.require_expected_failure(1, fitness.EXPECTED_FAILURE)
        with self.assertRaisesRegex(AssertionError, "did not fail the atomic-redemption session assertion"):
            fitness.require_expected_failure(0, fitness.EXPECTED_FAILURE)
        with self.assertRaisesRegex(AssertionError, "did not fail the atomic-redemption session assertion"):
            fitness.require_expected_failure(1, "Playwright Journey failed: unrelated startup failure")
