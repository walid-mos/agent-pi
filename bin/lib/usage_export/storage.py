import fcntl
import json
import os
import secrets
import sqlite3
import stat
import tempfile
from contextlib import contextmanager
from pathlib import Path

from .schema import encode

PRIVATE_DIRECTORY = 0o700
PRIVATE_FILE = 0o600


def private_directory(path):
    path.mkdir(mode=PRIVATE_DIRECTORY, parents=True, exist_ok=True)
    if path.is_symlink() or not path.is_dir():
        raise ValueError("expected private directory")
    os.chmod(path, PRIVATE_DIRECTORY)


def open_private(path):
    descriptor = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, PRIVATE_FILE)
    if not stat.S_ISREG(os.fstat(descriptor).st_mode):
        os.close(descriptor)
        raise ValueError("expected private regular file")
    os.fchmod(descriptor, PRIVATE_FILE)
    return os.fdopen(descriptor, "r+b")


def initialize(database):
    database.executescript("""
        PRAGMA cache_size=-2048;
        PRAGMA temp_store=FILE;
        CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS mappings (kind TEXT, ref TEXT, value TEXT, PRIMARY KEY(kind, ref));
        CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY, day TEXT, stamp TEXT, kind TEXT, response TEXT, request TEXT,
            estimate_key TEXT, late INTEGER, event TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS events_day ON events(day, stamp, id);
        CREATE INDEX IF NOT EXISTS events_response ON events(response);
        CREATE INDEX IF NOT EXISTS events_request ON events(request);
        CREATE INDEX IF NOT EXISTS events_estimate ON events(estimate_key);
        CREATE TABLE IF NOT EXISTS estimates (key TEXT PRIMARY KEY, amount REAL, matches INTEGER);
        CREATE TABLE IF NOT EXISTS seen (id TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS dirty (day TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS published (day TEXT PRIMARY KEY, entry TEXT NOT NULL);
    """)


@contextmanager
def state_database(path):
    private_directory(path)
    with open_private(path / "lock") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with open_private(path / "usage.sqlite"):
            pass
        database = sqlite3.connect(path / "usage.sqlite")
        try:
            initialize(database)
            with database:
                yield database
        finally:
            database.close()


def identity(database):
    row = database.execute("SELECT value FROM metadata WHERE key='identity'").fetchone()
    if row:
        result = json.loads(row[0])
        return {**result, "salt": bytes.fromhex(result["salt"])}
    result = {key: secrets.token_hex(32) for key in ("host_uuid", "source_ref", "salt")}
    database.execute("INSERT INTO metadata VALUES ('identity', ?)", (encode(result),))
    database.commit()
    return {**result, "salt": bytes.fromhex(result["salt"])}


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def atomic_write(path, contents):
    descriptor, pending = tempfile.mkstemp(prefix=".pending-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(contents)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(pending, path)
        sync_directory(path.parent)
    finally:
        Path(pending).unlink(missing_ok=True)
