import fcntl
import hashlib
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
MAX_LINE_BYTES = 1024 * 1024


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


@contextmanager
def read_only_database(path):
    database = sqlite3.connect((path / "usage.sqlite").as_uri() + "?mode=ro", uri=True)
    try:
        yield database
    finally:
        database.close()


def load_metadata(database, key):
    row = database.execute("SELECT value FROM metadata WHERE key=?", (key,)).fetchone()
    return json.loads(row[0]) if row else None


def save_metadata(database, key, value):
    database.execute("INSERT OR REPLACE INTO metadata VALUES (?, ?)", (key, encode(value)))


def mark_dirty(database, day):
    database.execute("INSERT OR IGNORE INTO dirty VALUES (?)", (day,))


def rewrite_event(database, identifier, day, event):
    database.execute("UPDATE events SET event=? WHERE id=?", (encode(event), identifier))
    mark_dirty(database, day)


def identity(database):
    result = load_metadata(database, "identity")
    if result is None:
        result = {key: secrets.token_hex(32) for key in ("host_uuid", "source_ref", "salt")}
        save_metadata(database, "identity", result)
        database.commit()
    return {**result, "salt": bytes.fromhex(result["salt"])}


def read_json(path, limit):
    with path.open("rb") as stream:
        encoded = stream.read(limit + 1)
    if len(encoded) > limit:
        raise ValueError("file too large")
    return json.loads(encoded)


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def file_digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


class HashingWriter:
    def __init__(self, stream):
        self.stream = stream
        self.hash = hashlib.sha256()

    def write(self, data):
        self.hash.update(data)
        return self.stream.write(data)

    def flush(self):
        self.stream.flush()


def write_durably(directory, write, name_for):
    descriptor, pending = tempfile.mkstemp(prefix=".pending-", dir=directory)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            hashing = HashingWriter(stream)
            write(hashing)
            stream.flush()
            os.fsync(stream.fileno())
        digest = hashing.hash.hexdigest()
        target = directory / name_for(digest)
        os.replace(pending, target)
        sync_directory(directory)
        return target, digest
    finally:
        Path(pending).unlink(missing_ok=True)
