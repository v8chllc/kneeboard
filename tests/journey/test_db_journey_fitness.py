"""Docker-free checks that every fitness mutation still targets the current sources.

A fitness case proves an assertion only if its mutation applies and its expected
label is one the canonical Journey can actually raise. These tests fail when a
source edit moves an anchor, duplicates it, or renames a label, before anyone
mistakes a stale case for evidence.
"""

import importlib.util
import re
import sys
from pathlib import Path
from unittest import TestCase


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
SPEC = importlib.util.spec_from_file_location("db_journey_fitness", ROOT / "scripts/db_journey_fitness.py")
assert SPEC and SPEC.loader
fitness = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = fitness  # dataclasses resolve annotations through sys.modules
SPEC.loader.exec_module(fitness)

JOURNEY_SQL = (ROOT / "scripts/db-journey.sql").read_text()
RAISE_TEXTS = re.findall(r"RAISE EXCEPTION '([^']*)'", JOURNEY_SQL)


class FitnessAnchorTests(TestCase):
    def test_every_case_anchor_occurs_exactly_once(self) -> None:
        for case in fitness.CASES.values():
            with self.subTest(case=case.name):
                self.assertNotEqual(case.mutated(), JOURNEY_SQL)
                self.assertEqual(JOURNEY_SQL.count(case.anchor), 1, case.anchor)

    def test_probe_has_one_transaction_start_and_one_rollback(self) -> None:
        self.assertEqual(fitness.PROBE, ROOT / "scripts/db-journey.sql")
        self.assertEqual(JOURNEY_SQL.count(fitness.TRANSACTION_START), 1)
        self.assertEqual(JOURNEY_SQL.count(fitness.ROLLBACK), 1)
        self.assertNotIn("COMMIT", JOURNEY_SQL)
        verify_sql = (ROOT / "scripts/verify-local-schema.sql").read_text()
        self.assertEqual(verify_sql.count(fitness.TRANSACTION_START), 1)
        self.assertEqual(verify_sql.count(fitness.ROLLBACK), 1)
        self.assertNotIn("COMMIT", verify_sql)

    def test_cases_keep_every_mutation_inside_the_rolled_back_transaction(self) -> None:
        for case in fitness.CASES.values():
            with self.subTest(case=case.name):
                self.assertNotEqual(case.anchor, fitness.ROLLBACK)
                self.assertNotIn("COMMIT", case.replacement.upper())
                self.assertEqual(case.mutated().count(fitness.ROLLBACK), 1)

    def test_sql_raise_texts_are_unique_and_labelled_6a(self) -> None:
        self.assertGreater(len(RAISE_TEXTS), 30)
        self.assertEqual(len(RAISE_TEXTS), len(set(RAISE_TEXTS)))
        for text in RAISE_TEXTS:
            self.assertRegex(text, r"^6a C-\d+a?: ")

    def test_every_expected_label_exists_exactly_once(self) -> None:
        for case in fitness.CASES.values():
            with self.subTest(case=case.name):
                self.assertTrue(case.label.startswith(f"{case.claim}:"))
                matching = [text for text in RAISE_TEXTS if text == case.label or text.startswith(f"{case.label}:")]
                self.assertEqual(len(matching), 1, matching)

    def test_every_strengthened_sql_claim_has_a_case(self) -> None:
        claims = {case.claim for case in fitness.CASES.values()}
        self.assertEqual(claims, {f"6a C-{n}" for n in ("4", "5", "6", "7", "9", "11")})
        self.assertIn("c11-tie-order", fitness.CASES)
        self.assertEqual(fitness.CASES["c11-tie-order"].replacement, fitness.RECENT_ORDER.replace("id DESC", "id ASC"))
