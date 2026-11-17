# Upstream source

- Repository: https://github.com/walid-mos/dotfiles
- Revision: `bcb45e5cc27133b658986ce33a7168001d46fa52`
- Directory: `dot_agents/skills/html-report-design/`
- Vendored: 2026-11-17
- License: upstream supplies no license file or license declaration for this skill.

The upstream directory is the single authoritative source. All files except this
`SOURCE.md` are a pristine snapshot. Change design rules, CSS and templates in
upstream, then refresh this dependency. Do not edit the copied files here.

## Placement

Pi discovers this snapshot at `~/.pi/agent/skills/html-report-design/SKILL.md`.
The shared `pi` source sync and the normal `bin/setup.ts` installation carry it
with the agent home. No external overlay registration or dotfiles access is
needed. The upstream text describes its original `~/.agents/skills/` placement.
Resolve its relative references from this installed skill directory.

New Pi sessions and children discover it after source sync. A session whose
catalog was loaded earlier needs an explicit read of the installed `SKILL.md`
or a human-triggered `/reload`. This change does not update a running session.

## Refresh

From a clean agent-pi task worktree, fetch the upstream repository into a
disposable checkout. Select and review a full immutable commit ID, then export
only this directory into a temporary staging directory:

```sh
git -C "$upstream_checkout" archive "$revision" dot_agents/skills/html-report-design/ | tar -x -C "$staging_directory" --strip-components=3
```

Inspect every staged file for private data, runtime reports and unexpected
executables or symlinks before publication. Replace the snapshot files with the
staged bytes, removing any files upstream deleted. Preserve this provenance file
and update its revision, vendored date and license statement. Compare the full
relative file list and SHA-256 hashes with the selected upstream tree, excluding
only this `SOURCE.md`. Resolve every manifest CSS and starter path under
`templates/` and check the starter's relative stylesheet link. Commit the reviewed
snapshot and provenance together. Keep formatter exclusions for this directory.
