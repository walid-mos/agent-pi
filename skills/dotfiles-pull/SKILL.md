---
name: dotfiles-pull
description: >-
    Pull dotfiles changes from the remote (walid-mos/dotfiles) into the chezmoi
    source repo and apply them to the live config. Direction rule: the
    publisher is the source of truth, so on a consumer remote is truth — pull
    always, without exception, locally or over ssh from the publisher. Use when
    the user asks to pull / récupérer / sync les dotfiles depuis le repo. On
    the publisher local is truth: use dotfiles-sync instead; pulling the
    publisher itself is explicit screw-up recovery only.
---

# dotfiles Pull

chezmoi source repo: `~/.local/share/chezmoi`, remote `walid-mos/dotfiles`.
Companion skill: `dotfiles-sync` owns the push direction — never push from here.

**1. Pick the target.** Read the role and `consumers` of the session machine in `~/.pi/agent/dotfiles.json` ("Dotfiles roles" in `~/.pi/agent/README.md`). When the file is missing, stop and ask the user to create it.

- Session on a consumer → this machine is the target, remote is truth. Run steps 3 and 4 locally, unconditionally, no confirmation.
- Session on the publisher → each host in `consumers` is a default target, or only the one the user names; remote is truth there. Run steps 3 and 4 on each, each command as one single-quoted argument to ssh, unconditionally, no confirmation:

    ```bash
    ssh <consumer> 'chezmoi git -- status --short'
    ```

    When ssh does not answer, that consumer is unreachable: say so and go on with the next.

- The publisher itself, only when the user names it → local is truth here. This run is only legitimate as screw-up recovery; go to step 2.

**2. (Publisher only) confirm.** Show `chezmoi git -- status --short`, state that these local source changes will be set aside, and proceed only on explicit approval.

**3. Make remote win.** In the target's source repo:

```bash
chezmoi git -- stash push --include-untracked -m "pre-pull $(date +%F-%H%M)"   # only when status is non-empty
chezmoi git -- pull --ff-only
```

If `pull --ff-only` fails (diverged history), force remote truth:

```bash
chezmoi git -- reset --hard origin/$(chezmoi git -- branch --show-current)
```

The stash keeps whatever was discarded recoverable. Never pop, drop, or delete it in this flow.

**4. Apply.**

```bash
chezmoi apply
```

**5. Report.** Up to date or the `--stat` summary of what the pull brought in, plus the stash name if one was created. Never echo the content of stashed files (secrets may be among them).
