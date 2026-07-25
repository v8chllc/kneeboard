#!/usr/bin/env -S uv run --script
#
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///

"""Fetch the latest SimBrief OFP JSON for development inspection."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

SIMBRIEF_ENDPOINT = "https://www.simbrief.com/api/xml.fetcher.php"
REQUEST_TIMEOUT_SECONDS = 30
MAX_RESPONSE_BYTES = 50 * 1024 * 1024
REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIRECTORY = REPOSITORY_ROOT / ".local" / "simbrief"


class FetchError(RuntimeError):
    """Raised when SimBrief does not return a usable OFP payload."""


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    """Parse and validate the command-line interface."""
    parser = argparse.ArgumentParser(
        description="Fetch the latest SimBrief OFP JSON for a Pilot ID."
    )
    parser.add_argument("pilot_id", help="numeric SimBrief Pilot ID")
    args = parser.parse_args(argv)

    if re.fullmatch(r"[0-9]+", args.pilot_id) is None:
        parser.error("pilot_id must contain ASCII digits only")

    return args


def fetch_ofp(pilot_id: str) -> bytes:
    """Fetch and validate the latest SimBrief OFP JSON payload."""
    query = urlencode({"userid": pilot_id, "json": "1"})
    request = Request(
        f"{SIMBRIEF_ENDPOINT}?{query}",
        headers={
            "Accept": "application/json",
            "User-Agent": "kneeboard-development-tool/1",
        },
    )

    try:
        with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            payload = response.read(MAX_RESPONSE_BYTES + 1)
    except HTTPError as error:
        raise FetchError(
            f"SimBrief returned HTTP {error.code} ({error.reason})"
        ) from error
    except (TimeoutError, URLError) as error:
        reason = getattr(error, "reason", error)
        raise FetchError(f"Unable to reach SimBrief: {reason}") from error

    if len(payload) > MAX_RESPONSE_BYTES:
        raise FetchError(
            f"SimBrief response exceeded the {MAX_RESPONSE_BYTES // (1024 * 1024)} MiB limit"
        )

    try:
        document = json.loads(payload)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise FetchError("SimBrief returned a response that was not valid JSON") from error

    if not isinstance(document, dict):
        raise FetchError("SimBrief returned JSON whose top level was not an object")

    return payload


def save_payload(
    payload: bytes,
    output_directory: Path = OUTPUT_DIRECTORY,
    *,
    captured_at: datetime | None = None,
) -> Path:
    """Atomically save a payload under a UTC timestamped filename."""
    output_directory.mkdir(parents=True, exist_ok=True)
    timestamp = captured_at or datetime.now(timezone.utc)
    filename = f"ofp-{timestamp:%Y%m%dT%H%M%S.%fZ}.json"
    destination = output_directory / filename

    descriptor, temporary_name = tempfile.mkstemp(
        prefix=".ofp-",
        suffix=".tmp",
        dir=output_directory,
    )
    temporary_path = Path(temporary_name)

    try:
        with os.fdopen(descriptor, "wb") as temporary_file:
            temporary_file.write(payload)
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
        os.replace(temporary_path, destination)
    except BaseException:
        temporary_path.unlink(missing_ok=True)
        raise

    return destination


def main(argv: Sequence[str] | None = None) -> int:
    """Run the command-line tool."""
    args = parse_args(argv)

    try:
        payload = fetch_ofp(args.pilot_id)
        destination = save_payload(payload)
    except FetchError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    except OSError as error:
        print(f"error: Unable to save the SimBrief response: {error}", file=sys.stderr)
        return 1

    print(f"Saved SimBrief OFP to {destination.relative_to(REPOSITORY_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
