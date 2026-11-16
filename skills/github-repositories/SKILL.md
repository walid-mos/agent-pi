---
name: github-repositories
description: >-
  Naming, owner, local folder and topics (tags) of GitHub repositories: the
  walid-mos rules and the base an organization overlay extends. Load before
  creating, renaming, transferring or setting the topics of a repository.
---

# GitHub repositories

This file holds the shared rules and the walid-mos owner. A NextNodeSolutions repository follows `skills/nextnode-repositories/SKILL.md` in the NextNode overlay, whose root is listed in `~/.pi/agent/overlays.json`; that skill is the only reference for the organization and extends the rules below. GitHub holds each repository's current topics: `gh repo list <owner> --json name,repositoryTopics`.

## Create a repository

1. Pick the owner and the name by "Naming" below.
2. Create it: `gh repo create walid-mos/<name>`.
3. Set its topics by "Topics" below: `gh repo edit <owner>/<name> --add-topic <kind>,<status>[,<domain>…][,<stack>…]`.
4. Put its checkout in the folder "Local folders" names.

Done when `gh repo view <owner>/<name> --json repositoryTopics` shows exactly one `kind-` topic and one `status-` topic.

## Naming

1. Use lowercase kebab-case ASCII. Leave out an owner prefix (`nextnode-`), a year, a version (`-v2`) and a tech suffix (`-astro`, `-app`).
2. Name client or product work after the brand or the domain, without the TLD (`example-shop`, `example-studio`).
3. Name internal work by what it is, in one or two nouns (`infrastructure`, `toolkit`, `workspace`, `agent-sandbox`).
4. Name several repositories under one brand `<brand>-<part>` (`example-archive`, `example-workspace`).
5. Name the role, never a tool it uses today (no `colima`, `sealskin`, `circleci` in a new name).
6. walid-mos holds the person's own config and utilities (`dotfiles`, `agent-*`).

Rename or transfer an existing repository only when the gain beats the cost. Never reuse a retired name. A new repository under it ends GitHub's redirect and breaks every old link.

## Local folders

Checkouts live under `~/Development`:

| Folder | Holds | Kinds |
| --- | --- | --- |
| `tools/` | Our own workstation and agent tooling | `tool`, `harness` |

Two paths are fixed by their tools: `~/.pi/agent` (agent-pi) and `~/.local/share/chezmoi` (dotfiles). Third-party clones (`tools/terraform-mcp-server`) stay in `tools/` and get no topics.

## Topics

GitHub topics are lowercase letters, digits and hyphens, with at most 20 per repository. Topics on public repositories are public.

| Dimension | Rule | Values |
| --- | --- | --- |
| kind | exactly 1 | `kind-harness`: the agent setup and the machines agents run on. `kind-tool`: a utility for our own workstation or daily use, never shipped. |
| status | exactly 1 | `status-active`: feature work in the last ~60 days. `status-stable`: live, fixes only. `status-deprecated`: replaced, kept running until its users move, then archived. Archived repositories keep GitHub's own archived flag on top. |
| domain | 0 to 2 | `website` (public, no sign-in), `webapp` (sign-in, stored data), `ci-cd`, `ai-agents`, `developer-tools` |
| stack | any | `typescript`, `rust`, `swift`, `astro`, `react`, `hono`, `threejs`, `strapi`, `cloudflare-workers`, `docker` |

Prefixes (`kind-`, `status-`) only go on our own dimensions, so `topic:kind-tool` filters exactly. Domain and stack use GitHub's common topics so public pages link to the shared topic lists. Add a new value to the table that owns it first, this one or an overlay skill's, then apply it. Never invent one on a single repository.

Search by topic: `gh search repos --owner walid-mos --topic kind-tool`, or `topic:status-deprecated` on github.com.
