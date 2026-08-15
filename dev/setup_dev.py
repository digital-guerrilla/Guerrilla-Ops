from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path


MIN_NODE_VERSION = (20, 19, 0)
REPO_ROOT = Path(__file__).resolve().parent.parent
DEV_ROOT = REPO_ROOT / "dev"
VENV_ROOT = REPO_ROOT / ".venv"
REQUIREMENTS = DEV_ROOT / "requirements-build.txt"


def command_path(name: str) -> str:
    executable = shutil.which(name)
    if not executable:
        raise RuntimeError(
            f"{name} was not found on PATH. Install it and rerun this script."
        )
    return executable


def run(command: list[str], cwd: Path) -> None:
    print(f"+ {' '.join(command)}")
    subprocess.run(command, cwd=cwd, check=True)


def version_tuple(version: str) -> tuple[int, int, int]:
    numbers = version.lstrip("v").split(".")
    try:
        return tuple(int(part) for part in (numbers + ["0", "0"])[:3])
    except ValueError as exc:
        raise RuntimeError(f"Could not parse Node.js version: {version}") from exc


def ensure_node() -> str:
    node = command_path("node")
    result = subprocess.run([node, "--version"], capture_output=True, text=True, check=True)
    version = result.stdout.strip()
    if version_tuple(version) < MIN_NODE_VERSION:
        minimum = ".".join(str(part) for part in MIN_NODE_VERSION)
        raise RuntimeError(f"Node.js {minimum} or newer is required; found {version}.")
    print(f"Node.js {version}")
    return command_path("npm.cmd" if os.name == "nt" else "npm")


def ensure_virtual_environment() -> Path:
    python = VENV_ROOT / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    if not python.exists():
        print(f"Creating virtual environment: {VENV_ROOT}")
        run([sys.executable, "-m", "venv", str(VENV_ROOT)], REPO_ROOT)
    return python


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Set up the Guerrilla Ops development environment.")
    parser.add_argument(
        "--skip-tests",
        action="store_true",
        help="Install dependencies without running the JavaScript regression suite.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        npm = ensure_node()
        python = ensure_virtual_environment()
        run([str(python), "-m", "pip", "install", "-r", str(REQUIREMENTS)], REPO_ROOT)
        run([npm, "ci"], DEV_ROOT)
        if not args.skip_tests:
            run([npm, "test"], DEV_ROOT)
    except subprocess.CalledProcessError as exc:
        return exc.returncode or 1
    except RuntimeError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    print("\nDevelopment environment is ready.")
    print("Start the app with: npm run dev (from dev/)")
    print("Build offline with: npm run test:build (from dev/)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
