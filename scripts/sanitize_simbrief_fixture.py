#!/usr/bin/env -S uv run --script
#
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///

"""Create a deterministic, allowlisted SimBrief parser fixture."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Sequence

REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
SOURCE_DIRECTORY = REPOSITORY_ROOT / ".local" / "simbrief"
OUTPUT_DIRECTORY = REPOSITORY_ROOT / "tests" / "fixtures" / "simbrief"
COORDINATE_IDENT = re.compile(
    r"^(?P<lat>[0-9]{2})(?P<ns>[NS])(?P<lon>[0-9]{3})(?P<ew>[EW])$"
)


class SanitizeError(RuntimeError):
    """Raised when a source capture cannot produce the requested fixture."""


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    """Parse fixture-generation arguments."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="raw capture under .local/simbrief")
    parser.add_argument(
        "destination",
        type=Path,
        help="fixture filename under tests/fixtures/simbrief",
    )
    parser.add_argument("--flight-number", required=True)
    parser.add_argument("--airline", default="TST")
    parser.add_argument(
        "--coordinate-profile",
        choices=("northwest", "southeast"),
        default="northwest",
    )
    parser.add_argument(
        "--generated-at",
        default="1767225600",
        help="synthetic Unix-seconds string",
    )
    parser.add_argument("--allow-missing-navlog", action="store_true")
    parser.add_argument("--include-registration", action="store_true")
    parser.add_argument("--include-route-decoys", action="store_true")
    args = parser.parse_args(argv)
    if re.fullmatch(r"[0-9]+", args.generated_at) is None:
        parser.error("--generated-at must contain ASCII digits only")
    if args.destination.suffix.lower() != ".json":
        parser.error("destination must use a .json suffix")
    return args


def require_within(path: Path, directory: Path, label: str) -> Path:
    """Resolve a path and require it to remain within the expected directory."""
    resolved = path.resolve()
    try:
        resolved.relative_to(directory.resolve())
    except ValueError as error:
        raise SanitizeError(f"{label} must stay within {directory}") from error
    return resolved


def require_object(value: Any, path: str) -> dict[str, Any]:
    """Require an object at a source path."""
    if not isinstance(value, dict):
        raise SanitizeError(f"{path} must be an object")
    return value


def require_string(source: dict[str, Any], key: str, path: str) -> str:
    """Require a string field without printing its value."""
    value = source.get(key)
    if not isinstance(value, str):
        raise SanitizeError(f"{path}.{key} must be a string")
    return value


def procedure_identifier(
    source: dict[str, Any], key: str, *, allow_empty_object: bool
) -> str | dict[str, Any]:
    """Preserve the observed empty-object shape only for the rejection fixture."""
    value = source.get(key)
    if isinstance(value, str):
        return value
    if allow_empty_object and value == {}:
        return {}
    raise SanitizeError(f"general.{key} must be a string")


def normalize_fix_list(value: Any) -> list[dict[str, Any]]:
    """Normalize SimBrief's one-or-many fix shape for fixture generation."""
    candidates = value if isinstance(value, list) else [value]
    if not candidates or not all(isinstance(item, dict) for item in candidates):
        raise SanitizeError("navlog.fix must contain one or more objects")
    return candidates


def coordinate_for(index: int, profile: str) -> tuple[str, str]:
    """Return deterministic synthetic coordinates for a row index."""
    offset = max(index + 1, 0) * 0.125
    if profile == "southeast":
        latitude = -(30.0 + offset)
        longitude = 150.0 + offset
    else:
        latitude = 30.0 + offset
        longitude = -(100.0 + offset)
    return f"{latitude:.6f}", f"{longitude:.6f}"


def coordinate_from_ident(identifier: str) -> tuple[str, str] | None:
    """Derive exact integer-degree coordinates from an observed coordinate fix."""
    match = COORDINATE_IDENT.fullmatch(identifier)
    if match is None:
        return None
    latitude = int(match.group("lat")) * (-1 if match.group("ns") == "S" else 1)
    longitude = int(match.group("lon")) * (-1 if match.group("ew") == "W" else 1)
    if abs(latitude) > 90 or abs(longitude) > 180:
        raise SanitizeError(
            "coordinate identifier is outside latitude/longitude bounds"
        )
    return f"{latitude:.6f}", f"{longitude:.6f}"


def sanitize_fix(raw_fix: dict[str, Any], index: int, profile: str) -> dict[str, str]:
    """Allowlist a navlog row and replace coordinates and distance."""
    identifier = require_string(raw_fix, "ident", "navlog.fix[]")
    latitude, longitude = coordinate_from_ident(identifier) or coordinate_for(
        index, profile
    )
    return {
        "ident": identifier,
        "type": require_string(raw_fix, "type", "navlog.fix[]"),
        "is_sid_star": require_string(raw_fix, "is_sid_star", "navlog.fix[]"),
        "via_airway": require_string(raw_fix, "via_airway", "navlog.fix[]"),
        "pos_lat": latitude,
        "pos_long": longitude,
        "distance": str(10 + (index % 7)),
    }


def sanitize_document(raw: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    """Build the minimal upstream-shaped fixture document."""
    params = require_object(raw.get("params"), "params")
    general = require_object(raw.get("general"), "general")
    origin = require_object(raw.get("origin"), "origin")
    destination = require_object(raw.get("destination"), "destination")
    navlog = require_object(raw.get("navlog"), "navlog")

    raw_fixes = navlog.get("fix")
    if raw_fixes is None:
        if not args.allow_missing_navlog:
            raise SanitizeError(
                "navlog.fix is absent; pass --allow-missing-navlog intentionally"
            )
        fixes: list[dict[str, str]] = []
    else:
        if args.allow_missing_navlog:
            raise SanitizeError(
                "navlog.fix is present but --allow-missing-navlog was passed"
            )
        fixes = [
            sanitize_fix(raw_fix, index, args.coordinate_profile)
            for index, raw_fix in enumerate(normalize_fix_list(raw_fixes))
        ]

    origin_latitude, origin_longitude = coordinate_for(-1, args.coordinate_profile)
    if fixes:
        destination_latitude = fixes[-1]["pos_lat"]
        destination_longitude = fixes[-1]["pos_long"]
    else:
        destination_latitude, destination_longitude = coordinate_for(
            1, args.coordinate_profile
        )

    document: dict[str, Any] = {
        "params": {
            "ofp_layout": require_string(params, "ofp_layout", "params"),
            "time_generated": args.generated_at,
        },
        "general": {
            "flight_number": args.flight_number,
            "icao_airline": args.airline,
            "sid_ident": procedure_identifier(
                general, "sid_ident", allow_empty_object=args.allow_missing_navlog
            ),
            "star_ident": procedure_identifier(
                general, "star_ident", allow_empty_object=args.allow_missing_navlog
            ),
            "route_distance": str(sum(int(fix["distance"]) for fix in fixes)),
        },
        "origin": {
            "icao_code": require_string(origin, "icao_code", "origin"),
            "pos_lat": origin_latitude,
            "pos_long": origin_longitude,
        },
        "destination": {
            "icao_code": require_string(destination, "icao_code", "destination"),
            "pos_lat": destination_latitude,
            "pos_long": destination_longitude,
        },
        "navlog": {} if raw_fixes is None else {"fix": fixes},
    }

    if args.include_registration:
        document["aircraft"] = {"reg": args.flight_number}
    if args.include_route_decoys:
        document["alternate_navlog"] = {"fix": {"ident": "SANITIZED-ALTERNATE-DECOY"}}
        document["etops"] = {"marker": "SANITIZED-ETOPS-DECOY"}

    return document


def main(argv: Sequence[str] | None = None) -> int:
    """Generate one sanitized fixture."""
    args = parse_args(argv)
    try:
        source = require_within(args.source, SOURCE_DIRECTORY, "source")
        destination = require_within(args.destination, OUTPUT_DIRECTORY, "destination")
        if not source.is_file():
            raise SanitizeError("source must be an existing file")
        raw = json.loads(source.read_text(encoding="utf-8"))
        document = sanitize_document(require_object(raw, "document"), args)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(
            json.dumps(document, indent=2, ensure_ascii=True) + "\n",
            encoding="utf-8",
            newline="\n",
        )
    except (OSError, json.JSONDecodeError, SanitizeError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    print(f"Saved sanitized fixture to {destination.relative_to(REPOSITORY_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
