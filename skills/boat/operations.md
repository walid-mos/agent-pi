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

## Access and environment

Workspace's provider checks its environment before every start and resume. Keep GitHub access, secret injection and agent credentials off there. Its sandbox-only Boat key is for that VM's lifecycle. A pot's control key belongs in the vault, outside the Boat VM.

Use `boat ssh ID` for manual inspection. Runtime values go over stdin rather than command text. Boat's API exec stores command history, so keep credentials out of `boat exec`. Read https://docs.boat.dev/ssh-access.md for SSH and file transfer details.

Tailnet enrollment and preview links belong to `~/.pi/agent/skills/tailnet-links/SKILL.md`. Load that skill before joining a VM or sharing a server. A batch test job normally needs neither.
