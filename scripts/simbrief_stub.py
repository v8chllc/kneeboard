"""Local, fixture-backed SimBrief fetcher for browser journeys and manual trials.

Run ``python3 scripts/simbrief_stub.py --port 8765``. It binds to 127.0.0.1
only, never forwards a request, and emits no Pilot IDs or OFP data to logs.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from urllib.parse import parse_qs, urlsplit


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures" / "simbrief"
RESERVED_IDS: dict[str, str] = json.loads((FIXTURES / "stub-map.json").read_text())
FETCHER_PATH = "/api/xml.fetcher.php"


class StubServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, port: int = 8765) -> None:
        self.requests: Counter[str] = Counter()
        self.request_lock = Lock()
        super().__init__(("127.0.0.1", port), StubHandler)


class StubHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        parsed = urlsplit(self.path)
        if parsed.path == "/health" and not parsed.query:
            self.send_response(204)
            self.end_headers()
            return
        if parsed.path == "/__requests" and not parsed.query:
            with self.server.request_lock:  # type: ignore[attr-defined]
                counts = dict(self.server.requests)  # type: ignore[attr-defined]
            self._json(json.dumps(counts).encode())
            return
        query = parse_qs(parsed.query, keep_blank_values=True)
        if parsed.path != FETCHER_PATH or set(query) != {"userid", "json"} or len(query["userid"]) != 1 or query["json"] != ["1"]:
            self.send_error(404, "Unknown fetcher request")
            return
        pilot_id = query["userid"][0]
        with self.server.request_lock:  # type: ignore[attr-defined]
            self.server.requests[pilot_id] += 1  # type: ignore[attr-defined]
        fixture = RESERVED_IDS.get(pilot_id)
        if fixture is None:
            self.send_error(404, "Unknown Pilot ID")
            return
        self._json((FIXTURES / fixture).read_bytes())

    def _json(self, body: bytes) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format: str, *_args: object) -> None:
        pass


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("port must be between 1 and 65535")
    server = StubServer(args.port)
    try:
        print(f"Local SimBrief stub listening on 127.0.0.1:{server.server_port}", flush=True)
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
