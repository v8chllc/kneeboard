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
db = fitness.db

JOURNEY_SQL = (ROOT / "scripts/db-journey.sql").read_text()
JOURNEY_PY = (ROOT / "scripts/db_journey.py").read_text()
RAISE_TEXTS = re.findall(r"RAISE EXCEPTION '([^']*)'", JOURNEY_SQL)


class FitnessAnchorTests(TestCase):
    def test_every_case_anchor_occurs_exactly_once(self) -> None:
        for case in fitness.CASES.values():
            with self.subTest(case=case.name):
                if isinstance(case, fitness.SqlCase):
                    source = fitness.SQL_PROBES[case.probe].read_text()
                    self.assertNotEqual(case.mutated(), source)
                else:
                    source = (ROOT / case.source).read_text()
                self.assertEqual(source.count(case.anchor), 1, case.anchor)

    def test_each_probe_has_one_transaction_start_and_one_rollback(self) -> None:
        for name, path in fitness.SQL_PROBES.items():
            with self.subTest(probe=name):
                text = path.read_text()
                self.assertEqual(text.count(fitness.TRANSACTION_START), 1)
                self.assertEqual(text.count(fitness.ROLLBACK), 1)

    def test_sql_raise_texts_are_unique_and_labelled_6a(self) -> None:
        self.assertGreater(len(RAISE_TEXTS), 30)
        self.assertEqual(len(RAISE_TEXTS), len(set(RAISE_TEXTS)))
        for text in RAISE_TEXTS:
            self.assertRegex(text, r"^6a C-\d+a?: ")

    def test_every_expected_label_exists_exactly_once(self) -> None:
        python_labels = {
            db.C1_BINDING_LABEL, db.NO_DECOY_CONTAINERS_LABEL, db.NO_DECOY_VOLUMES_LABEL,
            *db.RESET_REMOVAL_LABELS.values(), *db.RESET_SIBLING_LABELS.values(),
            *db.RESTART_MARKER_LABELS.values(), *db.ROLLBACK_LABELS.values(),
        }
        for case in fitness.CASES.values():
            with self.subTest(case=case.name):
                self.assertTrue(case.label.startswith(f"{case.claim} ") or case.label.startswith(f"{case.claim}:"))
                if case.label in python_labels:
                    self.assertEqual(JOURNEY_PY.count(f'"{case.label}"'), 1)
                else:
                    matching = [text for text in RAISE_TEXTS if text == case.label or text.startswith(f"{case.label}:")]
                    self.assertEqual(len(matching), 1, matching)

    def test_every_strengthened_claim_has_a_case(self) -> None:
        claims = {case.claim for case in fitness.CASES.values()}
        self.assertEqual(claims, {f"6a C-{n}" for n in ("1", "2", "2b", "4", "5", "6", "7", "9", "11", "15")})
        self.assertIn("c11-tie-order", fitness.CASES)
        self.assertEqual(fitness.CASES["c11-tie-order"].replacement, fitness.RECENT_ORDER.replace("id DESC", "id ASC"))
