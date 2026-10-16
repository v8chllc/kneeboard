"""Fail-closed checks for the browser journey's non-atomic fitness probe."""

import importlib.util
import sys
from pathlib import Path
from unittest import TestCase


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
SPEC = importlib.util.spec_from_file_location("e2e_journey_fitness", ROOT / "scripts/e2e_journey_fitness.py")
assert SPEC and SPEC.loader
fitness = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fitness)


class E2EJourneyFitnessTests(TestCase):
    def test_only_simultaneous_cookie_failure_confirms_non_atomic_mutant(self) -> None:
        fitness.require_expected_failure(1, fitness.EXPECTED_FAILURE)
        with self.assertRaisesRegex(AssertionError, "did not fail the simultaneous-redemption cookie assertion"):
            fitness.require_expected_failure(0, fitness.EXPECTED_FAILURE)
        with self.assertRaisesRegex(AssertionError, "did not fail the simultaneous-redemption cookie assertion"):
            fitness.require_expected_failure(1, "Playwright Journey failed: unrelated startup failure")
