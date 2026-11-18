import os
import shutil
import subprocess
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

MAGPIE_TIMEOUT_SECONDS = 300
SNAPSHOT_ARGUMENTS = ("usage", "--csv", "all")


@dataclass(frozen=True)
class Snapshot:
    status: str
    path: Path | None


def find_magpie(fallback):
    found = shutil.which("magpie")
    if found:
        return Path(found)
    if fallback.is_file() and os.access(fallback, os.X_OK):
        return fallback
    return None


def capture(magpie, descriptor):
    try:
        with os.fdopen(descriptor, "wb") as stream:
            completed = subprocess.run([magpie, *SNAPSHOT_ARGUMENTS], stdin=subprocess.DEVNULL, stdout=stream,
                                       stderr=subprocess.DEVNULL, timeout=MAGPIE_TIMEOUT_SECONDS, check=False)
        return completed.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


@contextmanager
def price_snapshot(fallback):
    magpie = find_magpie(fallback)
    if magpie is None:
        yield Snapshot("magpie-missing", None)
        return
    descriptor, name = tempfile.mkstemp(prefix="usage-export-snapshot-", suffix=".csv")
    path = Path(name)
    try:
        is_taken = capture(magpie, descriptor)
        yield Snapshot("taken", path) if is_taken else Snapshot("magpie-failed", None)
    finally:
        path.unlink(missing_ok=True)
