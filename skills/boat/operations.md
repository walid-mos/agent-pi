# Boat operations

Extends "Finish" in `SKILL.md`. Workspace owns job creation and result collection. Use the provider CLI for inspection and recovery when the workspace record is unavailable.

## Cleanup and cost

Capture the VM id printed by workspace. For a recorded named job, `workspace stop NAME` stops it and `workspace remove NAME` deletes it. A disposable job is deleted after successful collection unless `--keep` is explicit. A failed setup, transfer or collection can leave the VM running for inspection. Stop it before inspecting.

```bash
boat --no-update stop ID --json
boat --no-update info ID --json
boat --no-update usage ID --json
```

Confirm the returned sandbox state has stopped. Save the usage response beside the result directory. If stopping fails, report the exact command, VM id, deadline and error, then retry within the approved scope. The provider's TTL remains the backstop after caller failure.

When the workspace ledger could not save a new VM, cleanup by id through Boat:

```bash
boat --no-update delete ID --yes --json
```

Deletion discards that VM's data. Collect results and usage before deletion when recovering manually. Check `boat --no-update list --all --json` for resources owned by this task and leave other tasks' VMs alone.

A stopped sandbox's disk can contain runtime credentials and test output. Delete it when its results are collected. Store only a credential-free toolchain in a saved snapshot. Read https://docs.boat.dev/snapshots.md and https://docs.boat.dev/data-retention.md for current retention and stop/resume behavior.

## Local temporary ownership

Before creating a preview, source export or account/status probe output, choose its exact private root path and a run ID. Record them outside the disposable root, together with its marker path, purpose, source commit when relevant, and each explicit extra input. Register idempotent cleanup on success, failure and interruption before populating the root. Create the marker with that run ID and keep probe results private. Keep records and markers outside upload contents.

Cleanup validates the recorded absolute root and marker against this run before removing only that root and its recorded children. Refuse symlink roots, a missing or mismatched marker, or an unexpected path. A second cleanup treats an already removed owned root as success. Never discover deletion targets through a name prefix or a broad `/tmp/boat-*` glob. A later owner first reconciles a stopped run's record and marker before removing its leftovers.

Retain only explicitly selected nonsecret deliverables outside the disposable root. Register previews and probe results as disposable even when they contain only account/login metadata. If ownership cannot be proved, leave the exact path untouched and report it for the creating task's owner to reconcile and clean. The installed skill remains the canonical copy, so a temporary preview is not an installation.

## Access and environment

Workspace's provider checks its environment before every start and resume. Keep GitHub access, secret injection and agent credentials off there. Its sandbox-only Boat key is for that VM's lifecycle. A pot's control key belongs in the vault, outside the Boat VM.

Use `boat ssh ID` for manual inspection. Runtime values go over stdin rather than command text. Boat's API exec stores command history, so keep credentials out of `boat exec`. Read https://docs.boat.dev/ssh-access.md for SSH and file transfer details.

Tailnet enrollment and preview links belong to `~/.pi/agent/skills/tailnet-links/SKILL.md`. Load that skill before joining a VM or sharing a server. A batch test job normally needs neither.
