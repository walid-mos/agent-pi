# Boat operations

Extends "Finish" in `SKILL.md`. Workspace owns job creation and result collection. Use the Boat CLI for final usage, deletion evidence and recovery.

## Cleanup and cost

The named job needs its sandbox to remain readable after stop. Check the environment's [data retention](https://docs.boat.dev/data-retention.md) before launch. Use an environment that preserves stopped sandboxes until the receipt is collected.

1. Preserve workspace stdout, stderr and the exit status for every launch, including partial provisioning. Record the VM ID and result path as soon as they appear. Keep the setup and command statuses, logs and selected artifacts, including on nonzero exit. A setup or collection failure can leave the VM running. Use `workspace stop NAME` for a recorded VM or `boat --no-update stop ID --json` for an unrecorded one. Confirm `boat --no-update info ID --json` reports `sandbox.state` as `stopped`. Report the command, VM ID, TTL deadline and error if the stop fails, and retry while you still own the VM. The TTL is the backstop.
2. Once stopped, save `boat --no-update usage ID --json` beside the results. Verify the lowercase `seconds` and `dollars` fields, and `running: false` when present. This is exact metered compute in default-equivalent seconds and dollars, even when included in the plan. Label any read made before stop as a running sample and read again after stop. Record a separately confirmed start fee if there is one. The usage endpoint returns 404 after deletion. If usage or artifact recovery fails, report the missing evidence and keep the VM stopped while resolving it. Use workspace's `.remote` record to identify any missing output.
3. After collection, run `boat --no-update delete ID --yes --json` for the exact owned VM ID. Confirm `boat --no-update info ID --json` returns not found for that exact ID in the same environment. If Boat returns a deletion operation, check `boat --no-update deletion status OPERATION_ID --json` for completion and report any pending erasure. Once the VM is absent, use `workspace remove NAME` to clear its local record, if workspace recorded it. Verify the name is absent from `workspace list`. A stopped disk can still contain credentials and test output, so finish deletion promptly.
4. Report the source commit, VM ID, size and TTL, setup and command outcomes, log and artifact paths, exact usage and deletion evidence. If a start was refused, record the full provider error available in the launch output and `nextStartAt` when supplied. A nonzero exit can follow VM creation. An ID in the output starts the stop, usage and deletion procedure even on failure. Retry only after the restriction clears and a fresh budget check passes. After an ambiguous timeout, check the workspace record and the task's environment for a VM before retrying. Never reuse the failed run's name to retry an unattended job.

## Local temporary ownership

Before creating a preview, source export or account/status probe output, choose its exact private root path and a run ID. Record them outside the disposable root, together with its marker path, purpose, source commit when relevant, and each explicit extra input. Register idempotent cleanup on success, failure and interruption before populating the root. Create the marker with that run ID and keep probe results private. Keep records and markers outside upload contents.

Cleanup validates the recorded absolute root and marker against this run before removing only that root and its recorded children. Refuse symlink roots, a missing or mismatched marker, or an unexpected path. A second cleanup treats an already removed owned root as success. Never discover deletion targets through a name prefix or a broad `/tmp/boat-*` glob. A later owner first reconciles a stopped run's record and marker before removing its leftovers.

Retain only explicitly selected nonsecret deliverables outside the disposable root. Register previews and probe results as disposable even when they contain only account/login metadata. If ownership cannot be proved, leave the exact path untouched and report it for the creating task's owner to reconcile and clean. The installed skill remains the canonical copy, so a temporary preview is not an installation.

## Access and environment

Workspace's provider checks its environment before every start and resume. Keep GitHub access, secret injection and agent credentials off there. Its sandbox-only Boat key is for that VM's lifecycle. A pot's control key belongs in the vault, outside the Boat VM.

Use `boat ssh ID` for manual inspection. Runtime values go over stdin rather than command text. Boat's API exec stores command history, so keep credentials out of `boat exec`. Read https://docs.boat.dev/ssh-access.md for SSH and file transfer details.

Tailnet enrollment and preview links belong to `~/.pi/agent/skills/tailnet-links/SKILL.md`. Load that skill before joining a VM or sharing a server. A batch test job normally needs neither.
