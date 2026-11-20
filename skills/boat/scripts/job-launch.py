import argparse
from decimal import Decimal, InvalidOperation
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tomllib

PROVIDER = "boat"
JOB_COMMAND = ("workspace", "job")
VALUE_OPTIONS = ("push", "setup", "command", "workdir")
REPEATED_OPTIONS = ("artifact", "env")
CONTROL_VARIABLES = {"BOAT_API_KEY", "BOAT_ENVIRONMENT"}


class LaunchRefused(Exception):
    pass


def parse_job():
    parser = argparse.ArgumentParser(description="Run one fresh, budget-checked Boat job.", allow_abbrev=False)
    parser.add_argument("name", help="Unused run name so Workspace retains the stopped VM for its usage receipt")
    parser.add_argument("--provider", choices=(PROVIDER,), default=PROVIDER)
    parser.add_argument("--boat-type", default="small")
    parser.add_argument("--boat-ttl", required=True)
    parser.add_argument("--serialized", action="store_true", help="External reservation excludes every other account launcher")
    parser.add_argument("--approved-max-dollars", help="Walid's approved charge ceiling for this one run")
    for option in VALUE_OPTIONS:
        parser.add_argument(f"--{option}", required=option == "command")
    for option in REPEATED_OPTIONS:
        parser.add_argument(f"--{option}", action="append", default=[])
    return parser.parse_args()


def validate_environment(names):
    for name in names:
        if name in CONTROL_VARIABLES:
            raise LaunchRefused("the pot's Boat control key and environment never travel to a VM")
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
            raise LaunchRefused("pass application variable names with --env NAME")


def verify_fresh_job(name):
    if not name or name.startswith("-"):
        raise LaunchRefused("supply a fresh Workspace run name")
    config_home = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")
    config_path = config_home / "workspace/config.toml"
    try:
        config = tomllib.loads(config_path.read_text())
    except FileNotFoundError:
        config = {}
    if "from" in config.get("providers", {}).get(PROVIDER, {}):
        raise LaunchRefused(f"remove the saved-snapshot source from {config_path} before a budgeted job")
    listing = subprocess.check_output(("workspace", "list"), text=True)
    names = {line.split()[0] for line in listing.splitlines() if line.strip()}
    if name in names:
        raise LaunchRefused("the run name is already in Workspace; use a fresh name")


def workspace_arguments(job):
    command = (*JOB_COMMAND, job.name, f"--provider={job.provider}",
               f"--boat-type={job.boat_type}", f"--boat-ttl={job.boat_ttl}")
    for option in VALUE_OPTIONS:
        value = getattr(job, option)
        if value is not None:
            command += (f"--{option}={value}",)
    return command + tuple(f"--{option}={value}" for option in REPEATED_OPTIONS for value in getattr(job, option))


def check_budget(job):
    command = (sys.executable, "-B", str(Path(__file__).with_name("budget")), job.boat_type, job.boat_ttl)
    if job.serialized:
        command += ("--serialized",)
    reply = subprocess.check_output(command, text=True)
    budget = json.loads(reply)
    print(reply.rstrip(), file=sys.stderr, flush=True)
    return budget


def can_launch(budget, approved_maximum):
    if budget["decision"] == "fits":
        return True
    if budget["decision"] != "over-budget" or approved_maximum is None:
        return False
    ceiling = Decimal(approved_maximum)
    return ceiling.is_finite() and Decimal(budget["maximumChargeDollars"]) <= ceiling


def main():
    job = parse_job()
    try:
        validate_environment(job.env)
        verify_fresh_job(job.name)
        command = workspace_arguments(job)
        budget = check_budget(job)
        if not can_launch(budget, job.approved_max_dollars):
            raise LaunchRefused(f"{budget['decision']}: budget did not authorize this launch; see budget.md")
        os.execvp(command[0], command)
    except (LaunchRefused, OSError, ValueError, InvalidOperation, subprocess.CalledProcessError) as error:
        sys.exit(f"job: {error}")


if __name__ == "__main__":
    main()
