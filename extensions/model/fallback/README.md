# Direct recovery models

`config.json` keeps the ordered fallback chain. A `codex-group/<id>` entry reads the named group from `~/.config/magpie/providers.json` at each failover and takes its first direct `codex/model:effort` member. `extensions/lib/magpie-codex.ts` owns that lookup. It maps the member to Pi's built-in `openai-codex` provider and applies its effort after switching models. No gateway request is involved. Nested `group/` members are not followed.

Keep the group reference in the chain when editing it through `/models`. Saving toggles or reordering entries preserves the reference. The picker displays it as configured. Do not replace it with a resolved model ID if later Magpie membership changes should apply.

A missing or invalid configuration, missing group, absent Codex member, malformed member, unsupported effort, or a derived model absent from the capability catalog produces a visible warning naming the skipped entry and its repair. Members must declare an effort listed in `EFFORTS` in `extensions/lib/magpie-codex.ts`. The resolver also rejects Anthropic model names. An entry without configured credentials is skipped in silence, like any plain chain entry; chained steps continue to the next usable target, including the independent Inco provider. If none is usable, fallback reports exhaustion and leaves the interrupted request unfinished.

Cooldowns and chain ordering use the resolved direct model identity. Each hop runs at its own level: a group entry at its member's effort, a plain entry at the session's level, and every end of fallback (recovery, exhaustion, a manual pick) restores the level saved when the fallback began. Model switches do not rewrite the group reference or Magpie's configuration.

On the Mac, edit Magpie's group membership. Pots receive the same group definitions through agent-sandbox's `router-seed`. Restore or seed that file when the warning names a missing configuration. Pi capability metadata belongs in `models.pinned.json`, which setup copies to `models.json`. Adding a capability entry makes a model resolvable but does not select it.
