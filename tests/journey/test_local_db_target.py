"""Check every local Compose operation pins the repository target."""

import os
import subprocess
import tempfile
from pathlib import Path
from unittest import TestCase


ROOT = Path(__file__).resolve().parents[2]
PROJECT = "kneeboard_journey_123456789abc"


class LocalDbTargetTests(TestCase):
    def test_compose_actions_pin_file_directory_and_project(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            docker = temporary / "docker"
            docker.write_text(
                "#!/bin/sh\n"
                "if [ \"$1\" = context ]; then echo unix:///local/docker.sock; exit 0; fi\n"
                "printf '%s\\n' \"$@\" > \"$DB_TARGET_CAPTURE\"\n"
            )
            docker.chmod(0o755)
            decoy = temporary / "compose.yaml"
            decoy.write_text("services:\n  wrong_target:\n    image: postgres:17\n")
            capture = temporary / "args"
            env = os.environ | {
                "PATH": f"{temporary}:{os.environ['PATH']}",
                "DB_TARGET_CAPTURE": str(capture),
                "COMPOSE_FILE": str(decoy),
                "COMPOSE_PROJECT_NAME": "wrong_target",
                "COMPOSE_ENV_FILES": str(decoy),
            }
            for action in (("start",), ("stop",), ("verify", "test"), ("reset", "test")):
                compose_command = {"start": "up", "stop": "stop", "verify": "exec", "reset": "exec"}[action[0]]
                for prefix, expected_project in (((), "kneeboard"), (("--journey-project", PROJECT), PROJECT)):
                    with self.subTest(action=action, project=expected_project):
                        result = subprocess.run(
                            ["sh", "scripts/local-db.sh", *prefix, *action],
                            cwd=ROOT,
                            env=env,
                            capture_output=True,
                            text=True,
                        )
                        self.assertEqual(result.returncode, 0, result.stderr)
                        args = capture.read_text().splitlines()
                        self.assertEqual(
                            args[:8],
                            ["compose", "--project-directory", str(ROOT), "-f", str(ROOT / "compose.yaml"), "-p", expected_project, compose_command],
                        )

    def test_arbitrary_journey_project_is_rejected(self) -> None:
        result = subprocess.run(
            ["sh", "scripts/local-db.sh", "--journey-project", "wrong_target", "reset", "test"],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("Invalid isolated database Journey project", result.stderr)
