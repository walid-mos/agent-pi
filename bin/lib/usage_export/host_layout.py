from dataclasses import dataclass
from pathlib import Path

WINDOW_DAYS = 35
TIMEZONE = "Europe/Paris"


@dataclass(frozen=True)
class HostLayout:
    ledger: Path
    state: Path
    output: Path
    catalog: Path
    magpie: Path


def host_layout(home):
    return HostLayout(ledger=home / ".config" / "magpie" / "usage.jsonl",
                      state=home / ".local" / "state" / "agent-usage-export",
                      output=home / "Public" / "deliverables" / "agent-usage-export" / "v1",
                      catalog=home / ".config" / "agent-usage-export" / "catalog.json",
                      magpie=home / ".local" / "bin" / "magpie")
