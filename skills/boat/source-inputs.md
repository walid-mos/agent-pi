# Job source inputs

Extends "Run a job" in `SKILL.md`. Prepare source before obtaining runtime credentials or starting a VM.

## Committed source export

Use an owned clean export of a reviewed commit as the default upload. Do not pass the incidental working checkout to `--push`. Workspace selects tracked files and unignored untracked files, including hidden local registries and reports. A clean `git status` and ignore rules alone do not prove an upload is safe. Tracked credentials are still included.

1. Commit the intended source changes and record the full commit ID. Review that commit's tracked content for credentials and private metadata. If the needed changes cannot be committed and reviewed, stop rather than uploading a dirty checkout.
2. Register the export directory and cleanup before populating it, following [local temporary ownership](operations.md#local-temporary-ownership). Use a fresh private directory. Keep its ownership marker outside the directory passed to `--push`.
3. Export the chosen commit into an empty `source` child. With `REPOSITORY`, `COMMIT` and `SOURCE_EXPORT` set to the recorded repository, full commit and child path, run:

   ```bash
   set -o pipefail
   git -C "$REPOSITORY" archive --format=tar "$COMMIT" | tar -xf - -C "$SOURCE_EXPORT"
   ```

   `git archive` honors `export-ignore` attributes and does not supply submodule contents. Check the resulting files against the job's actual build inputs. Handle submodules, LFS objects or omitted build files through an explicit reviewed input list, or stop if a complete safe export cannot be made.
4. Workspace requires a Git work tree even for an export. Initialize only that new export and stage its reviewed files so workspace can select them:

   ```bash
   git -C "$SOURCE_EXPORT" -c init.templateDir= init --quiet
   git -C "$SOURCE_EXPORT" add --force --all
   ```

5. Preserve additional required inputs explicitly. Name each nonsecret file, its source and its destination in the ownership record, inspect its content, and copy only that file into the export. Stage only those named destinations. Never copy a whole incidental checkout, agent home, client directory, registry, report directory or local environment file. Runtime secrets use `--env NAME`. The reviewed dependency installer travels separately through `--setup` and need not be copied into the export.
6. Review the final `git ls-files --cached` list and file contents in the export. Ensure there are no unexpected untracked files, symlinks to private paths or modifications after review. Pass the absolute `SOURCE_EXPORT` path to `--push` and record the source commit and explicit extra inputs with the result. Keep setup and package installs out of the local export so they cannot add incidental upload files.

The export removes local incidental state from the default input. It does not make a committed secret safe or isolate hostile build code. Rebuild and review the export when its inputs change.

## Setup and preflights

1. Read the private client recipe. List required tools, generated artifacts and services. Put installation, dependency builds and required artifact checks in `--setup`, in dependency order. Use the same package and test resolution as the actual run. Preflight the committed scripts and inputs locally without running the heavy suite or changing test configuration to make a probe pass.
2. Derive resource names from a fresh run ID. Check each provider's allowed characters and byte limit, including generated suffixes. If shortening a name, preserve its unique part and use the same final name in creation, reachability checks and teardown. Record the run name and exact resource identities before use. Register cleanup before provisioning, and leave existing resources alone.
3. Load `~/.pi/agent/skills/infisical/SKILL.md` before obtaining the application's required runtime variables. Confirm availability by name and pass only those names with `--env NAME`. Put checks that require the VM in setup before expensive client operations. Once workspace injects runtime variables, start the command with any credential-dependent reachability checks, before tests or client writes. Probe the actual scoped endpoints without logging values.

Only run reviewed setup and command code with the named credentials. Workspace's log masking covers exact values. Use the private recipe where a client needs stronger isolation.
