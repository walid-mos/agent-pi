# Nightly usage proposals

This change adds the offline proposal core, an owner-side native JSONL summarizer, and a structural checker for a locally permitted synthetic `/dump` file. It does not yet wire R2 reads, schedule execution, report-file writing or a production Claude adapter. The eventual R2 reader must call the Usage #2 validator at `agent-usage/pipeline/readDailyPublication.ts` from reviewed revision `c28162911b5dfc539e20f26e22bb93359e31dbc1`; its schema checks are not copied here. The offline fixture uses synthetic inputs and does not claim to validate that publication schema.

## Owner-side evidence

Each participating host must run its own producer against its native Pi JSONL store at `~/.pi/agent/sessions` or native Claude Code JSONL store at `~/.claude/projects`. `parseNativeSessionFile` accepts lines supplied by that owner-side reader and summarizes one source file. The owner must verify the actual path, format, participating account and UTC-day coverage before enabling a source. Approval is per host and per source. The summary contains only host/source labels, UTC day, session/turn/compaction counts, token totals and model IDs. It excludes prompts, message bodies, tool arguments/results, filenames, paths, client names, account identifiers and credentials. The native summary parser does not yet walk either store or produce error/tool categories. Duplicate usage is counted once only when a stable request ID proves a match; otherwise evidence stays separate and marked unjoined. Subscription allowance is never inferred from API-equivalent estimates.

The `/dump` JSON is outside the supported optimizer input. `readApprovedDump` exists only for the authorized synthetic structural check or a future owner-run check with a literal file permit. A permit binds exact host, source, absolute file, `read` operation and expiry. The owner-side caller supplies the expected scope; result metadata carries the permit ID. The reader refuses scope mismatch and expiry before opening a file. It emits only date-bound counts, model IDs and token totals. It never emits dump content. The one-file permit grants no other file or source access and cannot authorize model submission.

## Run day and coverage

The scheduled wall time is 02:00 Europe/Paris. Select the latest fully closed UTC day at invocation, and use that UTC day as the idempotency key. At winter 02:00 the just-closed day is the previous UTC date; at summer 02:00 it is also the previous UTC date because the invocation coincides with UTC midnight. The spring 02:00 wall time does not exist, so the scheduler must run at the first valid time after the gap. Autumn 02:00 occurs twice; both runs resolve from their actual UTC instant and deduplicate by UTC day. Missing, invalid and late hosts stay explicitly missing or invalid, never zero. A partial report records roster coverage and missing hosts. A delayed or wake catch-up run recalculates the latest closed UTC day and records its actual invocation time.

## Model boundary and activation

The configured native selector defaults to the exact `claude-fable-5-2` ID. The production adapter must use Claude Code safe mode, preserve subscription authentication and disable tools, file changes, hooks and other side effects. It must not use bare mode. Remove API credential variables from the child environment and verify their absence before launch because print mode can bill credits and environment keys can take precedence. Do not launch unless exact model selection, safe mode, disabled tools, and structured response metadata are confirmed. Accept a result only when returned assistant model metadata exactly matches the configured ID. Reject fallback or absent/mismatched metadata.

Before owner activation, verify on each host the resolved CLI path and version, active sign-in type, plan/seat, Keychain availability in the job context, model-picker eligibility, allowance/reset, credit setting/cap, organization restrictions, effective model overrides and every API-key variable's presence/effect without disclosing values. Mac Studio version, login, entitlement and permitted paid credits remain unverified. Confirm the optimizer's R2 read access separately. Obtain explicit owner approval for each evidence source and for sending its exact aggregate fields to Anthropic. Any actual inference requires separate authorization because print mode can incur charges. This repository task makes no model call, Mac change, schedule or production read.

## Trust boundary and probes

| Trusted principal | Untrusted input |
| --- | --- |
| Owner-run local job with a single-use, expiring permit; permit contains no credential. Claude Code subscription auth remains in the owner's login context only for a separately activated run. | Session JSONL, `/dump` JSON, R2 objects, model text, repository files, and dependency lifecycle scripts. |

| Channel | Control | Disposable probe |
| --- | --- | --- |
| Inherited environment and credentials | No production model process is implemented. A future adapter must construct an allowlisted child environment and fail if API credential variables are present. | An API-key environment probe remains required before adding that adapter. |
| Files and path scope | The structural reader checks exact host/source/absolute-file/read scope and expiry before opening the file. | Tests deny a different host, source, file, operation and an expired permit. |
| Shell and process | The fixture has no process or shell boundary and registers no model tools. | Process and environment probes are required before a production adapter exists. |
| Untrusted content | Parsers ignore message/prompt content, reject unknown structural fields, and validate the returned model ID and proposal shape. | Tests inject instructions in session text and verify sentinels never enter approved output. |
| Output | Functions return only approved aggregates and proposal fields; callers own local persistence. | Synthetic tests check that prompt and transcript sentinels are absent. |
| Network and side effects | Tests use a fixture adapter and make no network request. No production adapter can be activated by this code. | The offline fixture produces the same report for the same synthetic evidence and response. |

## Proposal contract

A proposal must cite source fact IDs, state evidence limitations, describe one measured change and include a before/after measurement method. It must not emit exploit code, offensive automation, credentials, transcript excerpts or unattended patch application. Missing evidence produces a reviewable missing-input report rather than a fabricated recommendation. Identical validated input and fixture model response produce byte-stable proposal JSON.
