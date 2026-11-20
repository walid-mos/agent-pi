# Nightly usage proposals

`runNightly` joins validated Usage #2 snapshots and owner-approved session aggregates by enrolled host and UTC day. It sends numeric evidence to a model adapter and returns one cited recommendation or a coverage report. `writeLocalReport` publishes JSON in an existing owner-controlled directory. The UTC day and report status name the file. A completed report cannot be overwritten, and a later complete report can sit beside a partial report.

## Evidence and schedule

The composition entry point takes the reviewed Usage #2 `decodeSnapshot` from `pipeline/dailySnapshot.ts` at `USAGE_CONTRACT_REVISION` in `daily-usage.ts`. The decoder validates the exact host and date and rejects fields outside the published contract. Keep the production adapter pinned to the published source. The revision field comes from the trusted composition code. It is not an attestation that an arbitrary module has the expected source.

The scheduled command uses the latest due 02:00 Europe/Paris slot, 03:00 on the spring transition, and the first 02:00 on the autumn transition. `runNightly` records that slot and uses the latest closed UTC day at that instant. Summer 02:00 coincides with UTC midnight, when snapshots and session aggregates may still be pending. A scheduled tick retries the same day until the next slot is due. After a longer outage, run any older slot explicitly. Missing snapshots, invalid snapshots, missing summaries and unapproved sources appear in coverage. Any incomplete host skips the model. Complete coverage also needs an eligible action with measured facts. Each proposal cites one host and source group, with positive input tokens and turns for an input budget, complete positive routing duration and event count for latency, or positive workload failures and event count for reliability.

R2 version 1 supplies daily aggregates only. Counts and token totals from native sessions may overlap with the usage ledger. Compare each source on its own. API-equivalent estimates do not measure subscription charges or allowance.

## Owner-side reads

Set up one owner-controlled approval file per enrolled host and native source. For a recurring export, set `hostId`, `source` (`pi` or `claude-code`) and `directories`, a list of canonical absolute project directories. Pi project directories are under `~/.pi/agent/sessions`. Claude Code project directories are under `~/.claude/projects`. Approve the direct JSONL files in each directory, including future files. For Claude Code, use directories that the owner can verify contain only approved native sessions. A directory mixed with Magpie backend sessions needs an owner-verified way to separate those files before it can be approved.

```sh
node extensions/commands/usage/optimizer/export-owner-sessions.ts /absolute/approval.json --scheduled /absolute/aggregate-outbox
```

`--scheduled` uses the same Paris slot and UTC evidence day as the consumer. Pass a closed UTC date to replay an older day. The collector scans direct entries only, up to 16 directories, 1,024 directory entries and 256 regular JSONL files of up to 16 MiB each. For a one-off export the owner can instead supply `hostId`, `source`, `day` and the exact `files`. An explicitly empty one-off list certifies that the owner verified there were no sessions that day.

The parser measures assistant responses and compactions. Headers, non-assistant messages and other metadata do not establish measured coverage. A measured record needs a valid calendar timestamp with an explicit UTC offset. Each assistant response needs both token counts and an assistant role. The collector counts Pi session header IDs and entry IDs once and refuses copies with different measurements. For Claude Code each measured record needs a transcript `uuid`. Copies of a UUID must agree on session, timestamp, record kind, response and request IDs when present, and token counts. Distinct UUIDs can represent blocks of the same response (`message.id`). When those blocks agree on session, UTC day, request identity when present, and input count, the collector uses the largest cumulative output count. Conflicts stop the export. Native IDs stay in memory on the owner host. With no measurements, the collector reports `missing` and publishes no new file. On success it reports `published` with the name `<hostId>.<UTC day>.<source>.json`. The approved handoff transfers only the aggregate named by the current successful run. Keep approval files, raw sessions and dumps on the originating host. The receiver verifies provenance through the existing route before staging the result. Leave the slot absent when the source or route is unavailable.

The Pi `/dump` format has a separate structural check and stays outside the nightly feed. `readApprovedDump` runs only in the owner environment. Pass the permit from the owner's approval record and the expected scope from the owner-side caller. Supply the owner approval store's atomic consume operation. It returns success only for the exact unspent approved record and denies revoked or consumed permits. The permit binds an opaque permit ID, host, `pi-dump` source, canonical absolute file, `read` operation and expiry. The check returns the permit ID and day-limited counts or a denial code. Use a regular file in an owner-controlled directory with no concurrent writers. Keep the file, its path and its contents on the owner host. A permit for one file authorizes that structural read only. Any subsequent read, another source, excerpts or model submission needs its own approval.

## Native runner trust boundary

| Trusted | Untrusted |
| --- | --- |
| The owner account, reviewed runner and Usage #2 decoder, owner configuration, authorized feed producer, and installed Claude Code binary. Claude Code uses the owner's existing sign-in for the duration of its invocation. | Aggregate payload fields, the caller's inherited environment and working directory, and the model's response content. |

| Channel | Control and proof |
| --- | --- |
| Environment, sourced files and lookup paths | The child gets a fixed environment with explicit owner profile and working paths. The runner executes an absolute binary directly. The stub fixture plants provider, proxy, and shell overrides and checks the actual child environment. |
| Config and tool subprocesses | Start in a private empty directory with safe and restricted modes, strict empty MCP configuration, connectors off, and an empty built-in tool list. The stub checks the actual arguments. Managed policy still applies. The owner reviews effective settings and credential helpers under the job account before approving the run. |
| Shared files and shell evaluation | The approved collector, pinned reader and owner configuration are trusted. The local collector reads known object keys and approved source slots, with bounded regular-file reads. Raw session files are accepted only by the local export command using the owner's explicit manifest. Owner-controlled input and output directories stay outside the child workspace. The runner passes only the model's numeric evidence on stdin. The stub plants extra fields and instruction text. |
| Output | Check model identity in the CLI result envelope and allow only reviewed recommendations. Suppress raw CLI stdout and stderr in diagnostics. The stub proves rejection of missing, fallback, mixed, and forged metadata. |
| Process inspection, privilege and network | The runner trusts the owner login and executable. It does not isolate mutually untrusted same-user processes or restrict the CLI's network at OS level. Use the runner only in the verified owner job context. |

## Owner invocation

Run with Node 24 or later under the owner login using a clean launcher environment. Pass the ISO timestamp of the intended Paris slot. For a retry or a delayed wake, use the original slot, including its UTC offset. Use 03:00 local when the spring change skips 02:00. The runner takes its actual invocation time from the job clock and rejects future or off-schedule slots.

```sh
node extensions/commands/usage/optimizer/owner-cli.ts /absolute/path/owner.json 2026-10-25T02:00:00+02:00
```

For the recurring job, substitute absolute paths in `nightly.launchagent.plist` and use the owner’s login LaunchAgent. Its interval and load triggers call the same command with `--scheduled`. The runner calculates Paris time independently of the machine’s time zone. The polling interval sets scheduling precision. Before activation, the Mac owner runs `plutil -lint`, verifies the Node path and job login, then checks a disposable invocation after wake, UTC midnight and reload. Keep live print approval off during those checks.

Keep the configuration and report directory private to the owner account. Let the authorized feed producer write only to the handoff location. Choose one input layout.

| Key | Value |
| --- | --- |
| `stagedEvidence.snapshots`, `stagedEvidence.sessions` | Absolute canonical directories for exact Usage #2 objects and approved session aggregates. |
| `feedDirectory` | Alternative absolute path to the combined aggregate handoff. |
| `reportDirectory` | Absolute path to an existing owner-controlled report directory. |
| `usageContract.revision`, `usageContract.module` | The `USAGE_CONTRACT_REVISION` in `daily-usage.ts` and the absolute path to the corresponding reviewed module exporting `decodeSnapshot`. The owner installs and verifies the pinned module and its imports. |
| `hosts` | Objects with `hostId` and `approvedSources`, drawn from the owner's enrolled roster and approvals. |
| `nativeClaude.executable`, `nativeClaude.home`, `nativeClaude.configDirectory` | Absolute paths for the reviewed native Claude executable, owner home, and signed-in profile. |
| `nativeClaude.isPrintApproved` | Set to `true` after verifying the job account, settings, and paid usage policy. `false` refuses print mode. |

In staged mode the runner loads the sibling `pipeline/readDailyPublication.ts` from the pinned Usage #2 checkout. Its store reads the exact object keys from the snapshot directory, using the byte limit supplied by the pinned decoder. An authorized private R2 reader must stage the exact object bytes atomically under the same keys. The reviewed producer grants authorize PUT. Live deployment needs a separately authorized exact-key read connection and a verified delivery into the owner’s snapshot directory. The runner reports absent objects as missing and malformed objects as invalid. It requires no dashboard or R2 credential. Stage only source aggregates approved for the host in `owner.json`.

A combined handoff atomically publishes `<UTC day>.json` in `feedDirectory` with `{ "day": "YYYY-MM-DD", "hosts": [...] }`. Each host entry carries `hostId`, an optional Usage #2 `snapshot`, and `sessions` with its approved source aggregates.

A missing handoff produces a partial coverage report without invoking Claude. The first partial report stays on disk. Retry the original slot after the feed arrives or after resolving a failure in the checks that run before print. Use the same report directory for every invocation. A daily lock prevents overlap, and a complete report skips Claude, including on the second occurrence of the autumn fold.

### Recover an unresolved attempt

After the version and sign-in checks pass, the runner creates `<UTC day>.attempt.json` under the day lock and syncs the marker and its directory before launching print. The marker records the UTC day, original slot, recording time and launcher PID. The runner keeps it after print. A marker without a complete report blocks unattended retries, even if the marker is empty or unreadable. The marker records a possible launch and cannot establish whether Claude received or billed the request. The guard limits print subprocess launches by this runner. A single Claude Code process can make multiple provider attempts, including retries for structured output or fallback.

For an unresolved attempt, pause unattended invocations and verify that the prior runner and its Claude process have exited. Review the marker, any stale lock, the launcher diagnostics, the local report state and Anthropic usage or billing for that account and time window. Record the evidence and the owner's decision. If evidence is inconclusive, treat another launch as a possible duplicate charge. To authorize a new launch, archive that day's marker in an owner-controlled location outside the active report directory, clear any confirmed stale lock, and invoke the original slot. If a complete report exists, keep the marker and report. If recovering a stale lock from before the marker was created, confirm the processes have exited before clearing the lock and retrying.

## Native Claude activation

The runner checks the Claude version and the configured profile's `claude auth status`. It pins `claude-fable-5-2` and accepts a successful JSON result only when `modelUsage` has exactly one entry for that ID, with a matching `canonicalModel` and `firstParty` provider. It validates `structured_output` through the existing proposal renderer, which accepts reviewed choices and citations to facts from the same run. The request carries the day and approved numeric facts, including their fact identifiers. [CLI reference](https://code.claude.com/docs/en/cli-reference), [structured output](https://code.claude.com/docs/en/headless#get-structured-output), [fallback metadata](https://code.claude.com/docs/en/model-config#automatic-model-fallback), [model usage fields](https://code.claude.com/docs/en/agent-sdk/typescript#modelusage)

Safe mode preserves the saved login and restricted mode excludes user, project and local settings from the print run. Managed settings still apply, and `auth status` is a separate command. Review the selected profile and all effective managed settings for provider overrides, credential helpers, plugin or MCP policy, and fallback behavior before enabling print mode. Strict MCP mode causes startup to fail when an exclusive managed MCP configuration applies. [CLI modes](https://code.claude.com/docs/en/cli-reference#cli-flags), [settings precedence](https://code.claude.com/docs/en/settings#settings-precedence), [managed MCP](https://code.claude.com/docs/en/managed-mcp#exclusive-control-with-managed-mcp-json)

The Mac owner also verifies Keychain access, model eligibility, the plan or seat, allowance, paid credit settings, and approval to disclose the aggregate fields. Print mode can spend credits without prompting. The documented CLI contracts expose neither a preflight proof of the model that will serve the prompt nor a subscription-only guarantee that prevents paid print usage. `auth status` checks sign-in, and the response metadata checks which model actually served the run. A separate owner-authorized synthetic run can verify the effective flags, metadata, and billing in the job context. [Authentication](https://code.claude.com/docs/en/authentication), [print mode](https://code.claude.com/docs/en/headless)

## Offline proof

The scheduler fixture drives the executable at summer midnight, after a missed wake, at the spring gap and across both autumn occurrences. The staged fixture runs a local session export, verifies missing and invalid host coverage, and retries the original evidence day with the stub Claude CLI. Point `NIGHTLY_USAGE_PINNED_PIPELINE` at the `pipeline` directory extracted from `USAGE_CONTRACT_REVISION` to run it with the actual `readDailyPublication` and its imports. The generated dump fixture exercises representative nested fields and a capture over 5 MB. A separate fixture tests the 16 MiB file bound. The owner’s structural observation establishes the reported Mac file’s shape and size. The real file’s parser result, entry timestamps, identity equality and token values are unverified.

Run `node --experimental-transform-types --test tests/nightly-usage-optimizer.test.ts 'tests/optimizer-*.test.ts'`. The tests use only synthetic JSONL, a disposable Pi dump, a disposable report directory and a fixture model. To exercise the original Usage #2 validator, extract `pipeline/dailySnapshot.ts` and its local imports from `USAGE_CONTRACT_REVISION` into a disposable directory, set `NIGHTLY_FIXTURE_VALIDATOR` to the absolute validator path and run `tests/optimizer-nightly-flow.test.ts` with the same Node options.

| Boundary | Check |
| --- | --- |
| Owner-approved file | Deny an expired or spent permit, a symlink or a different host, source, file or operation. Export the permit ID and numeric counts only. |
| Nightly input | Reject unapproved or mismatched structured evidence and skip the model on incomplete coverage. |
| Model and output | Reject an unverified selector, returned fallback, invented citation or injected prose. Write the report locally once per day and status. |
| Native process | The disposable CLI stub checks the child environment, private working directory, command flags, stdin shape, auth refusal, restart behavior, and served-model metadata. Actual CLI behavior under the Mac job login remains an owner prerequisite. |
