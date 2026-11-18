# Nightly usage proposals

`runNightly` joins validated Usage #2 snapshots and owner-approved session aggregates by enrolled host and UTC day. It sends numeric evidence to a model adapter and returns one cited recommendation or a coverage report. `writeLocalReport` publishes JSON in an existing owner-controlled directory. The UTC day and report status name the file. A completed report cannot be overwritten, and a later complete report can sit beside a partial report.

## Evidence and schedule

The composition entry point takes the reviewed Usage #2 `decodeSnapshot` from `pipeline/dailySnapshot.ts` at `USAGE_CONTRACT_REVISION` in `daily-usage.ts`. The decoder validates the exact host and date and rejects fields outside the published contract. Keep the production adapter pinned to the published source. The revision field comes from the trusted composition code. It is not an attestation that an arbitrary module has the expected source.

Use 02:00 Europe/Paris as the intended slot. The local scheduler supplies the first valid slot after the spring gap and identifies each occurrence of the autumn fold. `runNightly` records the slot and uses the latest closed UTC day at that slot. A retry or wake catch-up passes the original slot and the actual invocation time. Both autumn occurrences resolve to the same UTC day. Missing snapshots, invalid snapshots, missing summaries and unapproved sources appear in coverage. Any incomplete host skips the model. Summer uploads may still be pending at UTC midnight. Retry explicitly against the original day.

R2 version 1 supplies daily aggregates only. Counts and token totals from native sessions may overlap with the usage ledger. Compare each source on its own. API-equivalent estimates do not measure subscription charges or allowance.

## Owner-side reads

The owner verifies paths, format, identity and coverage in each environment. Pi stores native JSONL in `~/.pi/agent/sessions`. Claude Code stores native JSONL in `~/.claude/projects`. Supply lines from approved files to `parseNativeSessionFile` on that host. An owner-side reader must establish store coverage, exclude Claude backend sessions launched by Magpie and consolidate each approved source into one daily summary. Keep raw session files and timestamps, paths, identifiers, prompts, arguments and results on the owner host. The nightly input accepts aggregates for the source labels configured for that host. It rejects extra fields and mismatched dates or host labels. The existing owner transport supplies the verified origin. No new transport is required.

The Pi `/dump` format has a separate structural check and stays outside the nightly feed. `readApprovedDump` runs only in the owner environment. Pass the permit from the owner's approval record and the expected scope from the owner-side caller. Supply the owner approval store's atomic consume operation. It returns success only for the exact unspent approved record and denies revoked or consumed permits. The permit binds an opaque permit ID, host, `pi-dump` source, canonical absolute file, `read` operation and expiry. The check returns the permit ID and day-limited counts or a denial code. Use a regular file in an owner-controlled directory with no concurrent writers. Keep the file, its path and its contents on the owner host. A permit for one file authorizes that structural read only. Any subsequent read, another source, excerpts or model submission needs its own approval.

## Native Claude activation

The expected model is `claude-fable-5-2`, supported by Claude Code 2.1.321 or later. The offline adapter proves the response contract. It receives numeric facts, the available recommendation IDs and an empty tool list. The trusted native adapter must extract the served model from structured provider metadata, reject any fallback or mixed-model result, and return that metadata separately from the model's selected recommendation. The proposal renderer accepts only reviewed recommendation IDs and citations to facts from the same run. Free-form model text cannot become a proposal or action.

Before enabling execution, the Mac owner must verify the resolved Claude path and version, effective subscription sign-in, Keychain access under the job login, plan or seat, model picker eligibility, allowance and reset, paid credit setting and cap, and any organization policy. Check effective API keys, gateway, credential helpers and model overrides by presence and effect. Keep values private. Use native safe mode to preserve subscription auth. Bare mode skips saved subscription auth. Print mode can spend usage credits without prompting, and API credentials can take precedence. Use an allowlisted environment, disable tools and persistence, and verify isolation under the actual job context. A separate owner-authorized synthetic inference may establish structured served-model metadata and billing behavior. R2 read access and the exact aggregate fields approved for Anthropic disclosure require independent verification. Raw excerpts require a separate decision.

## Offline proof

Run `node --experimental-transform-types --test tests/nightly-usage-optimizer.test.ts 'tests/optimizer-*.test.ts'`. The tests use only synthetic JSONL, a disposable Pi dump, a disposable report directory and a fixture model. To exercise the original Usage #2 validator, extract `pipeline/dailySnapshot.ts` and its local imports from `USAGE_CONTRACT_REVISION` into a disposable directory, set `NIGHTLY_FIXTURE_VALIDATOR` to the absolute validator path and run `tests/optimizer-nightly-flow.test.ts` with the same Node options.

| Boundary | Check |
| --- | --- |
| Owner-approved file | Deny an expired or spent permit, a symlink or a different host, source, file or operation. Export the permit ID and numeric counts only. |
| Nightly input | Reject unapproved or mismatched structured evidence and skip the model on incomplete coverage. |
| Model and output | Reject an unverified selector, returned fallback, invented citation or injected prose. Write the report locally once per day and status. |
| Production credentials and process | The fixture has no credential or process to pass to a model. Before adding the native runner, verify source isolation, child environment, config lookup, subprocesses, local writes and network access under the job login. |
