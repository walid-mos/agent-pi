# agent-pi

Shared [Pi](https://github.com/earendil-works/pi) setup: extensions, coding skills, agents, prompts, themes, model routing and vendored Pi packages. The checkout is the agent home, normally `~/.pi/agent`.

## Install

Requires Node.js 24+ and pnpm.

```bash
git clone https://github.com/walid-mos/agent-pi.git ~/.pi/agent
node ~/.pi/agent/bin/setup.ts
```

Setup installs locked dependencies, validates external overlays, merges `settings.pinned.json` into untracked `settings.json`, and generates untracked `models.json` from `models.pinned.json`. Missing settings start from `settings.defaults.json`. Existing model choices, authentication, sessions and private client files survive.

The shared model catalog uses a local Magpie gateway. Set a different endpoint when installing on a machine that uses a remote gateway:

```bash
MAGPIE_BASE_URL=https://gateway.example.com/v1 node ~/.pi/agent/bin/setup.ts
```

The URL comes from `MAGPIE_BASE_URL`, then an existing `models.json`, then the shared catalog. A later setup without the variable keeps the existing URL. Change catalog entries in `models.pinned.json`.

## Update

```bash
git -C ~/.pi/agent pull --ff-only
node ~/.pi/agent/bin/setup.ts
```

Before the first update that replaces tracked `models.json`, save its gateway URL outside the checkout and supply it through `MAGPIE_BASE_URL` to setup. Git removes the old tracked file during that update. Subsequent updates preserve the generated file.

## External overlays

Keep organization resources in a separate checkout. Register its absolute path in untracked `~/.pi/agent/overlays.json`:

```json
["/absolute/path/to/organization-agents"]
```

Each checkout is a Pi local package with a `package.json` `pi` manifest. Setup appends it to the pinned packages and installs its locked dependencies when present. Pi loads its skills, extensions, prompts and themes in place. Instructions live in those skills or extensions. Its root `AGENTS.md` governs edits inside that checkout through Pi's normal project context discovery.

Setup records managed package sources in untracked `setup-packages.json`. Remove a root from `overlays.json` and rerun setup to disable it. Unrelated user package registrations, a user's filtered entry for a managed source, and the external checkout survive. Register the root again to re-enable it.

Optional root `skills.json` and `magpie-routing.json` add project scope and routing entries after private client overlays. Routing blocks retain client-name order followed by registered-root array order, before scoped base rules and after explicit directives. Duplicate skills or configuration keys fail before settings or models are written. Registering an overlay trusts its code with Pi's permissions. See [ARCHITECTURE.md](ARCHITECTURE.md#repository-and-overlays) for ownership rules.

## Shared skills

`skills/` in `walid-mos/agent-pi` is the authoritative home of shared owned skills for Macs and pots. Edit their instructions, references and templates here. Dotfiles manages machine configuration, not skill content. Third-party skills keep their own recorded provenance under [Licenses](#licenses).

Pi discovers the checkout's `skills/` automatically when this checkout is its agent home. Normal source sync carries skills to pots without another source or overlay registration. New sessions and children discover them after sync. An existing session needs an explicit read of the updated `SKILL.md` or a human-triggered `/reload` to refresh its catalog. Source availability alone does not prove a particular machine has synced it.

For Hermes, merge this into the active profile's `config.yaml`, normally `~/.hermes/config.yaml`, preserving other settings:

```yaml
skills:
  external_dirs:
    - ~/.pi/agent/skills
```

Use the actual agent-home path for a nonstandard installation. [Hermes external directories](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills#external-skill-directories) load skills in place, including their relative resources. Replace a shared `~/.agents/skills` registration with this path. Remove stale copies of the moved skill from local, project and other configured skill directories only through reviewed machine cleanup, since they can shadow the shared directory. Preserve unrelated external registrations. `external_dirs` does not make files read-only. Review shared skill edits in this repository.

Verify `html-report-design` with Pi's `/skill:html-report-design` and Hermes's `hermes skills list` and `skill_view(name="html-report-design")`. Confirm the resolved `SKILL.md` and its template manifest, CSS and starter all come from the same agent-pi checkout. Installing or syncing the source does not verify an already running Hermes session.

## Isolated agent homes

Clone into a disposable directory and run its own `bin/setup.ts`. Start Pi with `PI_CODING_AGENT_DIR` set to that checkout. Setup refuses a variable pointing elsewhere, so an isolated install cannot overwrite the normal agent home.

## Private state and machine dependencies

`.gitignore` is an allowlist. Sign-ins, sessions, caches, `overlays.json`, `dotfiles.json`, generated models and settings, and `client/` stay outside version control. `client/<name>/` holds private client skills and configuration.

Provider keys come from shell exports populated by the machine's Infisical binding in `~/.config/agent-secrets`. The `infisical` skill owns secret access. `bin/pi-token-pull` consumes shared Codex authentication and `bin/pi-token-sync` publishes it from the signing-in machine. See [bin/README.md](bin/README.md).

### Dotfiles roles

The `dotfiles-sync` and `dotfiles-pull` skills and `bin/chezmoi-reconcile` keep a chezmoi source repository in one-way sync. Untracked `dotfiles.json` in the agent home gives the machine its role:

```json
{ "role": "publisher", "consumers": ["laptop"] }
```

- `publisher`: its live config is truth. It pushes through `dotfiles-sync`, and `chezmoi-reconcile` drops each managed target deleted live from the source. `consumers` lists the SSH hosts a publisher session updates through `dotfiles-pull`.
- `consumer`: the remote is truth. `dotfiles-pull` stashes local source changes and applies the remote. `consumers` is not read.

Keep one publisher per source repository. Without the file, `chezmoi-reconcile` does nothing and both skills stop and ask for it.

## Pots human dialogs

The question and secret tools support explicit pot opt-in, shared terminal/Discord settlement and private browser handoff. See [configuration, destination support and rollout](extensions/lib/human-dialog/README.md). Work-center startup approvals use the broker independently of Pi worker tools.

## Source audit

`fallow-plugin-pi.json` registers the Pi extension entrypoints, their required `Component.invalidate` hook, and the setup command as developer tooling. It also registers `bin/lib/pi-token.mjs`, whose callers are extensionless Node executables that Fallow does not parse. `.fallowrc.json` identifies the viewer CSS URL filled by Python `str.format` at request time and the HTML report stylesheets loaded through the skill's template manifest.

## Licenses

Third-party vendored skills and packages keep their upstream license beside a `SOURCE.md` naming the upstream and revision. Moving owned skills here transfers maintenance to agent-pi. Their previous location belongs in the move's pull request as historical provenance.
