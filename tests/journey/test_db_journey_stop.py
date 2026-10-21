"""C-2 checks the container selected immediately before stop, without Docker."""

from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch
import importlib.util
import re


SCRIPT = Path(__file__).resolve().parents[2] / "scripts/db_journey.py"
spec = importlib.util.spec_from_file_location("db_journey", SCRIPT)
assert spec and spec.loader
journey = importlib.util.module_from_spec(spec)
spec.loader.exec_module(journey)


class StopContainerTests(TestCase):
    def test_stop_inspects_current_container_after_recreation(self) -> None:
        image = re.search(r"^    image: (.+)$", (journey.ROOT / "compose.yaml").read_text(), re.MULTILINE)
        assert image
        ids = iter(("startup-container", "current-stop-container"))
        events: list[tuple[str, str]] = []
        starts = 0

        def command(args: list[str], env: dict[str, str], **_: object) -> str:
            if args[:2] == ["docker", "context"]:
                return "unix:///local/docker.sock"
            if args[-3:] == ["ps", "-q", "postgres"]:
                selected = next(ids)
                events.append(("select", selected))
                return selected
            if args[:3] == ["docker", "inspect", "--format"]:
                template, container = args[3:]
                if template == "{{.Config.Image}}":
                    return image.group(1)
                if template == "{{.State.Running}}":
                    events.append(("inspect", container))
                    if container != "current-stop-container":
                        raise RuntimeError(f"docker inspect: no such object: {container}")
                    return "false"
            self.fail(f"unexpected command: {args}")

        def local(action: str, env: dict[str, str], *args: str) -> None:
            nonlocal starts
            if action == "start":
                starts += 1
                if starts == 2:
                    raise AssertionError("reached restart after C-2 stop")
            if action == "stop":
                events.append(("stop", ""))

        output = StringIO()
        with (
            patch.object(journey, "free_port", return_value=54339),
            patch.object(journey, "command", side_effect=command),
            patch.object(journey, "local", side_effect=local),
            patch.object(journey, "psql", side_effect=lambda database, *_: database),
            patch.object(journey, "assert_published_binding"),
            patch.object(journey, "write_markers"),
            patch.object(journey, "assert_reset_markers"),
            patch.object(journey, "cleanup_compose"),
            redirect_stdout(output),
        ):
            with self.assertRaisesRegex(AssertionError, "reached restart after C-2 stop"):
                journey.main()

        self.assertEqual(events[-3:], [
            ("select", "current-stop-container"),
            ("stop", ""),
            ("inspect", "current-stop-container"),
        ])
        self.assertIn("6a C-2 stop: pass", output.getvalue())
