# Pot access

Extends "Before a job" in `SKILL.md`. These scripts prepare access without starting a billed sandbox.

## Operator on the Mac

Load the Infisical skill and use the machine-authenticated shell. Run:

```bash
~/.pi/agent/skills/boat/scripts/pot-access POT
```

The script prepares one Boat environment for that pot through `workspace setup`, creates a scoped expiring key, and stores it with the environment name under the pot's vault project. It prints only public metadata. Its constants own the key lifetime, actions and vault location. Rerunning replaces the key and revokes earlier keys with the same pot name after the replacement is stored.

Add exactly the printed names and path to the pot's `onRequest.boat` group in the Mac's sandbox configuration. From the agent-sandbox checkout, inspect `bin/vm-config` and its callees, then run `SANDBOX=POT ./bin/vm-config` only when they rewrite configuration without restarting the session. Do not restart a pot for this setup. The next broker request reads the group.

The control key can create, inspect, SSH into, stop and delete its own resources within its pot's environment. It can read that environment and account limits. It cannot administer billing, keys, other environments or account credentials. The vault remains its only source, and the pot's Boat CLI reads it from the environment at each command, so no key file is written. Running the plain `boat` CLI outside that environment shows a signed-out session, which is expected.

## Inside the pot

Install the Boat and workspace CLIs once:

```bash
~/.pi/agent/skills/boat/scripts/install
```

The installer builds the public workspace repository in a temporary Docker container with bounded CPU and no vault variables. This first installation needs Docker and network access. To validate an unmerged workspace change, pass `--ref BRANCH`. Subsequent heavy repository builds run on Boat.

Sign in through the broker:

```bash
/opt/agent-sandbox/session/with-vault --with boat \
  ~/.pi/agent/skills/boat/scripts/sign-in
```

The script checks the key, creates workspace's config if absent and checks the selected environment without starting a VM. If workspace already has a config, it reports the exact environment line it needs. Keep the existing file and edit only that provider option.

Run jobs through `~/.pi/agent/skills/boat/scripts/job`, which wraps `workspace job` in that same vault reader. It refuses to forward the control key to a VM.

Check `boat --no-update status --json`, `boat --no-update limits --json` and `workspace job --help`, each through `with-vault --with boat` when it must reach the account. An expired or refused key needs `pot-access POT` on the Mac followed by `sign-in` in that pot. The job itself does not need the control key or vault identity in its runtime environment.

For an application command, obtain only its required runtime variables through the application project's Infisical injection and pass their names with `workspace job --env NAME`. Installation and setup finish before workspace sends them to the VM. Never pass an Infisical machine credential through `--env` or put it in a repository script.
