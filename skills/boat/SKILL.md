---
name: boat
description: >-
  Run jobs too heavy for a pot on Boat through workspace, with runtime Infisical injection and collected results. Load for full E2E suites, large builds, Boat account setup, sizing, cost estimates, sandbox lifecycle or troubleshooting. Read the private client recipe when the job needs client services or credentials.
---

# Boat

Run heavy repository jobs, especially full E2E suites, on Boat. Keep them off the HP pots. Use `--boat-type small` by default and an explicit `--boat-ttl` on every job. Read the private client recipe for its measured size, setup and command. Interactive development belongs to `~/.pi/agent/skills/worktree/cloud.md`.

## Before a job

Inside a pot, prefix Boat account and lifecycle commands with `/opt/agent-sandbox/session/with-vault --with boat`. On the Mac use the signed-in CLI.

1. Check `boat --no-update status --json` for `account.signedIn`. Follow [pot-setup.md](pot-setup.md) for a missing installation or expired pot key. A Mac uses `boat login` if its operator has not signed in.
2. Read `boat --no-update limits --all --json` for available types, starts, concurrency and billing restrictions. Read current sizes and prices at https://docs.boat.dev/machines.md and https://docs.boat.dev/pricing.md.
3. Prepare the source, setup and run name using [source-inputs.md](source-inputs.md). Read the [standing budget](budget.md) for launch conditions and refusals.

## Run a job

Use `scripts/job` on both the Mac and pots. It checks the budget using the size and TTL it passes to Workspace, then delegates only when the budget or an explicit exception allows the start. Use a fresh run name unique to this attempt so Workspace stops the VM after collection and leaves it available for the usage read. See `scripts/job --help` for the supported flags and `workspace job --help` for upload and result size limits.

```bash
~/.pi/agent/skills/boat/scripts/job "$RUN_NAME" \
  --push "$SOURCE_EXPORT" --boat-type small --boat-ttl 20m \
  --setup "$SETUP_SCRIPT" --command "$JOB_COMMAND" --artifact "$REPORT_PATH"
```

Add `--env NAME` for each required runtime variable. Select only artifacts the command creates, or omit `--artifact` for logs only. Inspect artifacts before publishing them because workspace returns them unchanged.

The caller trusts its setup and command as it does when running that repository locally. Workspace sends selected values on SSH stdin and masks their exact bytes in collected logs. This does not isolate hostile same-user processes, prevent deliberate encoded disclosure or sanitize artifacts. Do not upload a production credential to an untrusted checkout. For stronger client isolation, follow the private recipe rather than claiming this generic job provides it.

## Finish

Follow [operations.md](operations.md#cleanup-and-cost) for every exit. Verify stop, collect usage before deletion, verify deletion, and report results and actual usage together.

For a full Playwright suite, read the private client's measurement recipe before choosing shard count. Use measured peak memory, CPU and wall time to fit the budget and TTL. Give every shard its own database and storage, collect blob reports, then merge them.

## References

- [pot-setup.md](pot-setup.md): install CLIs and grant or renew each pot's access.
- [source-inputs.md](source-inputs.md): prepare a committed source export and explicit inputs before an upload.
- [budget.md](budget.md): check the standing budget before each start.
- [operations.md](operations.md): stop, recover, inspect usage, snapshots and remote access, and register temporary files before setup or probes.
