---
name: proxmox
description: >-
  Credentials, access and out-of-band power control for the HP Proxmox node
  that hosts the pots (walid-mos/agent-sandbox VMs). Load for any Proxmox node
  task, when a pot on the node goes offline or stops answering, and before
  asking the human for a Proxmox, root or Intel AMT password: those are in the
  vault, and this skill says where and how to use them.
---

# Proxmox node

A pot is a walid-mos/agent-sandbox VM running on the node.

## Credentials

The core-vault project holds them in folder `/clients/proxmox`; its project ID and environment are `projectId` and `environment` in the binding `~/.config/agent-secrets/core-vault.json`.

| Name | Holds |
|---|---|
| `PVE_ROOT_PASSWORD` | the node's `root` login (shell and Proxmox web UI) |
| `AMT_ADDRESS` | LAN address of the node's Intel AMT chip; not a secret |
| `AMT_ADMIN_PASSWORD` | the AMT `admin` login |

- Never ask the human for a value stored there; check the names with the names script in `~/.pi/agent/skills/infisical/SKILL.md` first.
- Inject the values into the command that needs them, never into context:

  ```bash
  binding=~/.config/agent-secrets/core-vault.json
  ~/.pi/agent/bin/infisical run --projectId "$(jq -r .projectId "$binding")" --env "$(jq -r .environment "$binding")" \
    --path /clients/proxmox -- <command>
  ```

- A name above missing from the folder: ask once with `ask_user_secret`, destination `infisical`, folder `/clients/proxmox`, under that name. Never store them anywhere else; `/tools/proxmox` stays unused.
- `PVE_ROOT_PASSWORD` is not the AMT password: never send it to the chip.

## Never retry a refused AMT password

Intel AMT delays and then locks out logins after failed attempts. `scripts/amt` makes one login per run and stops on refusal. After a refusal, never rerun it and never try another value: report the refusal to the human; the next attempt waits until the human replaces `AMT_ADMIN_PASSWORD`.

## Reaching the node and the pots

- Node shell: the `ssh` alias of the `# HP Proxmox node` entry in `~/.ssh/config`.
- Pots: walid-mos/agent-sandbox's Proxmox provider (`lib/providers/proxmox.sh`) reaches them through that alias; run a command in one with `SANDBOX=<pot> bin/vm-exec` from an agent-sandbox checkout.
- A pot's LAN address: `~/.config/agent-sandbox/sandboxes/<pot>/sandbox.json`.

## Out-of-band power: `scripts/amt`

When the node stops answering over `ssh`, the AMT chip still reports and controls its power. Run the script through the injection command above, as `<command>`:

- `scripts/amt status`: power state, then the AMT web UI's status and event-log pages.
- `scripts/amt reset`: master bus reset when the node is on, power on when it is off, nothing in any other state. A reset cuts every pot on the node: run it only on the human's go-ahead.
