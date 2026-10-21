"""The local stub answers only the fetcher's contract on loopback."""

import json
import sys
import threading
import urllib.error
import urllib.request
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
import simbrief_stub  # noqa: E402
from simbrief_stub import FETCHER_PATH, RESERVED_IDS, StubServer  # noqa: E402


class SimbriefStubTests(TestCase):
    def setUp(self) -> None:
        self.server = StubServer(0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.assertFalse(self.thread.is_alive())

    def test_loopback_only_and_real_fetcher_query(self) -> None:
        self.assertEqual(self.server.server_address[0], "127.0.0.1")
        self.assertEqual(RESERVED_IDS["100001"], "valid-multi-page.json")
        with urllib.request.urlopen(f"{self.base}{FETCHER_PATH}?userid=100001&json=1", timeout=2) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.headers.get_content_type(), "application/json")
            self.assertEqual(json.load(response), json.loads((ROOT / "tests/fixtures/simbrief/valid-multi-page.json").read_text()))
        with urllib.request.urlopen(f"{self.base}/__requests", timeout=2) as response:
            self.assertEqual(json.load(response), {"100001": 1})

    def test_unknown_id_and_wrong_path_or_query_are_rejected(self) -> None:
        for path in (
            f"{FETCHER_PATH}?userid=999999&json=1",
            f"{FETCHER_PATH}?userid=100001&json=0",
            f"{FETCHER_PATH}?userid=100001",
            f"{FETCHER_PATH}?userid=100001&json=1&extra=1",
            "/wrong?userid=100001&json=1",
        ):
            with self.subTest(path=path), self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(f"{self.base}{path}", timeout=2)
            self.assertEqual(error.exception.code, 404)
            error.exception.close()
        with urllib.request.urlopen(f"{self.base}/__requests", timeout=2) as response:
            self.assertEqual(json.load(response), {"999999": 1})

    def test_main_closes_its_listener_after_keyboard_interrupt(self) -> None:
        with (
            patch.object(sys, "argv", ["simbrief_stub.py", "--port", "8765"]),
            patch.object(simbrief_stub, "StubServer") as server_type,
            patch("builtins.print"),
        ):
            server_type.return_value.serve_forever.side_effect = KeyboardInterrupt
            simbrief_stub.main()
        server_type.assert_called_once_with(8765)
        server_type.return_value.serve_forever.assert_called_once_with(poll_interval=0.2)
        server_type.return_value.server_close.assert_called_once_with()
