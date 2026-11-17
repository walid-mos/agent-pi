---
name: boat
description: >-
  Run jobs too heavy for a pot on Boat through workspace, with runtime Infisical injection and collected results. Load for full E2E suites, large builds, Boat account setup, sizing, cost estimates, sandbox lifecycle or troubleshooting. Read the private client recipe when the job needs client services or credentials.
---

# Boat

Run heavy repository jobs with `workspace job`. Use `--boat-type small` and an explicit `--boat-ttl` on every job. Read `workspace job --help` for flags and collection limits. Interactive development belongs to `~/.pi/agent/skills/worktree/cloud.md`.

## Before a job

Inside a pot, run Boat account checks through `/opt/agent-sandbox/session/with-vault --with boat`. Read [pot-setup.md](pot-setup.md) when access is missing.

1. Check `boat --no-update status --json` for `account.signedIn`. For a missing pot installation or expired key, follow [pot-setup.md](pot-setup.md). A Mac uses `boat login` if its operator has not signed in.
2. Read `boat --no-update limits --json` for available types, starts, concurrency and billing restrictions. Read current sizes and prices from https://docs.boat.dev/machines.md and https://docs.boat.dev/pricing.md. The docs index is https://docs.boat.dev/llms.txt. Keep those facts there.
3. Obtain spending approval for the number of small VMs, TTL, maximum charge, purpose and cleanup before starting them. Compute the ceiling as VM count × TTL in hours × the current small hourly price, plus any start surcharge reported by limits. A budget estimate grants no approval. Keep concurrency within both the approval and the live limits.
4. Split dependency installation into `--setup`. Inject only the command's named variables with `--env NAME` after setup succeeds. Load `~/.pi/agent/skills/infisical/SKILL.md` before obtaining project secrets. Read the client's recipe for its project, allowed names and local services.

## Run a job

Inside a pot's repository checkout, `scripts/job` wraps `workspace job` in its vault reader. On the Mac, call `workspace job` directly.

```bash
~/.pi/agent/skills/boat/scripts/job --push . --boat-type small --boat-ttl 20m \
  --setup /absolute/path/install-dependencies.sh \
  --command 'pnpm test' --artifact reports
```

The wrapper shares workspace's flags. Read `workspace job --help` for them.

Use an artifact path that the command actually creates, or omit `--artifact` for logs only. `--push` uploads tracked and unignored files without Git history or a GitHub token. Inspect this selection for credentials before upload. Keep `.env`, credentials and generated output ignored.
Workspace prints the result directory and returns the remote command's exit status. Inspect its setup log, command log, status files and artifact archive even when the exit is nonzero. Artifacts are unmodified command output. Select only intended reports and inspect them before publishing.

The caller trusts its setup and command as it does when running that repository locally. Workspace sends selected values on SSH stdin and masks their exact bytes in collected logs. This does not isolate hostile same-user processes, prevent deliberate encoded disclosure or sanitize artifacts. Do not upload a production credential to an untrusted checkout. For stronger client isolation, follow the private recipe rather than claiming this generic job provides it.

## Finish

Read [operations.md](operations.md) for cleanup, recovery and cost evidence before ending a job. Report the VM id, source revision, command exit, log/artifact locations, actual charge and confirmed stopped or deleted state. Preserve a failed VM only as workspace documents, and stop it immediately while investigating so that its TTL is not the cleanup plan.

For a full Playwright suite, read the private client's measurement recipe before choosing shard count. A small VM can be slower than the HP. Choose shard count and workers from measured peak memory, CPU, wall time and the approved charge ceiling. Give every shard its own database and storage, collect blob reports, then merge them.

## References

- [pot-setup.md](pot-setup.md): install CLIs and grant or renew each pot's access.
- [operations.md](operations.md): stop, recover, inspect usage, snapshots and remote access.
