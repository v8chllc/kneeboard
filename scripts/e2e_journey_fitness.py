"""Prove the isolated auth-endpoint exercise rejects a non-atomic token consumer.

Copies tracked sources and local dependencies into the supplied scratch directory,
changes only that disposable dependency copy, and runs the isolated Journey's
database-backed auth endpoint test there. The Journey owns and removes its
Compose project; this script removes the scratch copy on every exit. No remote service
or fixed local database is used.
"""

from __future__ import annotations

import shutil
import signal
import subprocess
import sys
import tempfile
from pathlib import Path

import db_journey as db


ROOT = Path(__file__).resolve().parents[1]
EXPECTED_FAILURE = "JOURNEY atomic redemption session count: fail"
CONSUME_ANCHOR = "\t\t\t\t\t\tconst row = await txAdapter.consumeOne({"
FOLLOWING_ANCHOR = "\n\t\t\t\t\t\tif (!row) return null;"


def copy_sources(destination: Path) -> None:
    """Copy tracked files and local packages without including private .local data."""
    paths = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT).decode().split("\0")
    for relative in filter(None, paths):
        source = ROOT / relative
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    packages = ROOT / "node_modules"
    if not packages.is_dir():
        raise AssertionError("local dependencies are required for auth endpoint fitness")
    if sys.platform == "darwin":
        subprocess.run(["cp", "-cR", str(packages), str(destination / "node_modules")], check=True)
    else:
        shutil.copytree(packages, destination / "node_modules", symlinks=True)


def mutate_consumer(destination: Path) -> None:
    """Replace atomic delete-and-return with read-then-delete in the scratch copy."""
    matches = list((destination / "node_modules/.pnpm").glob(
        "better-auth@1.7.6*/node_modules/better-auth/dist/db/internal-adapter.mjs",
    ))
    if len(matches) != 1:
        raise AssertionError("expected exactly one pinned Better Auth adapter")
    source = matches[0]
    text = source.read_text()
    if text.count(CONSUME_ANCHOR) != 1:
        raise AssertionError("non-atomic mutation anchor moved")
    start = text.index(CONSUME_ANCHOR)
    end = text.index(FOLLOWING_ANCHOR, start)
    text = text[:start] + "\t\t\t\t\t\tconst row = latest;" + text[end:]
    source.write_text(text)


def require_expected_failure(returncode: int, output: str) -> None:
    """Reject a green mutant or failure outside the atomic session assertion."""
    if returncode == 0 or EXPECTED_FAILURE not in output:
        raise AssertionError("non-atomic variant did not fail the atomic-redemption session assertion")


def run_variant(variant: Path) -> tuple[int, str]:
    """Signal and reap the owned runner on timeout or any exceptional exit."""
    process = subprocess.Popen(
        ["mise", "exec", "--", "pnpm", "journey:e2e"], cwd=variant,
        text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True,
    )
    try:
        output, _ = process.communicate(timeout=900)
    except BaseException as earlier:
        problems: list[str] = []
        try:
            # Let the Journey remove its own Compose project and app groups first.
            db.signal_group(process, signal.SIGINT, problems)
            try:
                process.communicate(timeout=60)
            except subprocess.TimeoutExpired:
                db.signal_group(process, signal.SIGKILL, problems)
                try:
                    process.communicate(timeout=60)
                except subprocess.TimeoutExpired:
                    problems.append("fitness runner did not exit after SIGKILL")
        except BaseException as cleanup_error:
            problems.append(f"fitness runner cleanup raised {type(cleanup_error).__name__}")
        if problems:
            db.report_cleanup_failure(f"fitness runner cleanup failed: {'; '.join(problems)}", earlier)
        raise
    return process.returncode, output


def main(scratch: Path) -> None:
    if ROOT == scratch or ROOT in scratch.parents:
        raise AssertionError("fitness scratch must be outside the repository")
    scratch.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="non-atomic-", dir=scratch) as directory:
        variant = Path(directory)
        copy_sources(variant)
        mutate_consumer(variant)
        returncode, output = run_variant(variant)
        require_expected_failure(returncode, output)
    print("Non-atomic consume fitness: atomic-redemption session assertion failed as expected")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python3 scripts/e2e_journey_fitness.py <scratch-directory>")
    main(Path(sys.argv[1]).resolve())
