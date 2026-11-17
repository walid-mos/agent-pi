# Pot access

Extends "Before a job" in `SKILL.md`. These scripts prepare access without starting a billed sandbox.

## Operator on the Mac

Load the Infisical skill and use the machine-authenticated shell. Run:

```bash
~/.pi/agent/skills/boat/scripts/pot-access POT
```

The script prepares one Boat environment for that pot through `workspace setup`, creates a scoped expiring key, and stores it with the environment name under the pot's vault project. It prints only public metadata. Its constants own the key lifetime, actions and vault location. Rerunning replaces the key and revokes earlier keys with the same pot name after the replacement is stored. If the environment write then fails, the stored new key survives and earlier keys are still revoked. The script reports the incomplete rotation because a failed write may have committed. Reconcile the printed vault path and retry. A failed first key write instead revokes the new key and leaves previous keys untouched.

Add exactly the printed names and path to the pot's `onRequest.boat` group in the Mac's sandbox configuration. From the agent-sandbox checkout, inspect `bin/vm-config` and its callees, then run `SANDBOX=POT ./bin/vm-config` only when they rewrite configuration without restarting the session. Do not restart a pot for this setup. The next broker request reads the group.

The control key can create, inspect, SSH into, stop and delete its own resources within its pot's environment. It can read that environment and account limits. It cannot administer billing, keys, other environments or account credentials. The vault remains its only source, and the pot's Boat CLI reads it from the environment at each command, so no key file is written. Running the plain `boat` CLI outside that environment shows a signed-out session, which is expected.

## Inside the pot

Install the Boat and workspace CLIs once:

```bash
~/.pi/agent/skills/boat/scripts/install
```

The installer builds the public workspace repository in a temporary Docker container with bounded CPU and no vault variables. It needs Docker, curl, coreutils and network access. It checks `workspace job --help` before downloading Boat or installing either CLI. Until workspace PR8 reaches `main`, the default fails with that prerequisite. To validate an unmerged workspace change, review its source and pass `--ref BRANCH`. Subsequent heavy repository builds run on Boat.

The Boat binary must match the platform digest owned by `scripts/install` before it becomes executable. The reviewed values came from the official [distribution checksum metadata](https://boat.dev/api/boat/cli/download?platform=linux-x64&channel=prod&integrity=sha256) on 2026-11-17. The official [installer](https://boat.dev/install) fetches those sums and the binary from the same origin. This pins the reviewed bytes locally and detects a later changed download, but the initial metadata is trusted through HTTPS only. The inspected distribution supplies no independent signature. The `prod` URL is mutable, so a release can make installation fail until an owner reviews new metadata and changes the pins. Downloading fresh sums beside a binary would not authenticate a compromised origin.

Sign in through the broker:

```bash
/opt/agent-sandbox/session/with-vault --with boat \
  ~/.pi/agent/skills/boat/scripts/sign-in
```

The script requires Python 3.11+ and reads the exact `[providers.boat].environment` value with its standard TOML parser. It checks the key, creates workspace's config if absent and checks the selected environment without starting a VM. A matching value in another table does not count. Keep an existing file and correct only that provider option if the script refuses it.

Run jobs through `~/.pi/agent/skills/boat/scripts/job`, which wraps `workspace job` in that same vault reader. It refuses to forward the control key to a VM.

Check `boat --no-update status --json`, `boat --no-update limits --json` and `workspace job --help`, each through `with-vault --with boat` when it must reach the account. An expired or refused key needs `pot-access POT` on the Mac followed by `sign-in` in that pot. The job itself does not need the control key or vault identity in its runtime environment.

For an application command, obtain only its required runtime variables through the application project's Infisical injection and pass their names with `workspace job --env NAME`. Installation and setup finish before workspace sends them to the VM. Never pass an Infisical machine credential through `--env` or put it in a repository script.
