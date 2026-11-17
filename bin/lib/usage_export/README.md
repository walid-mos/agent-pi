# Per-host usage export

`bin/usage-export` reads a local Magpie ledger and publishes sanitized usage events and a coverage manifest. It does not run a server, read transcripts, contact providers, install a routine, or enroll a host. Python with `zoneinfo` and the system IANA timezone database is required. Run `bin/usage-export --help` for commands.

## CLI and authoritative contract

From an installed or pinned agent-pi checkout:

```sh
python3 -B bin/usage-export schema
python3 -B bin/usage-export export \
  --ledger /local/private/magpie/usage.jsonl \
  --state /local/private/usage-export-state \
  --output /local/published/usage-export \
  --from 2026-11-16 --through 2026-11-18 \
  --timezone Europe/Paris --now 2026-11-18T12:00:00Z
python3 -B bin/usage-export coverage --output /local/published/usage-export
```

The paths above are examples. Use separate directories for private state, exported files, and source files. No default path silently starts collection. The command scans the retained ledger, while `--from` and `--through` select the inclusive UTC dates listed in the manifest. The report timezone determines each event's `report_day`. Provide `--now` for deterministic fixtures. Normal invocations may use the real clock.

The authoritative definition is [schema.py](schema.py), exposed as JSON Schema by `schema`. Its `$id` identifies the contract version. Events and manifests also carry `schema_version`. Consumers in another repository must invoke `schema` from a pinned agent-pi checkout and register its returned document with their JSON Schema validator. Validate using the returned document's `#/$defs/event` or `#/$defs/manifest`. Do not copy its properties, enums, or version into a second schema. Fail on an unsupported contract rather than interpreting it as another version. The CLI validates its own emitted objects against the same definitions.

An aggregator takes a manifest snapshot, fetches only its relative `days/*.jsonl.gz` paths, verifies compressed-byte `sha256` and `bytes`, decompresses JSONL, validates each event, and upserts by `event_id`. Fetch changed hashes to receive late arrivals and newly available prices. Event files are cut on UTC dates. Rebucket by `ts_utc` in the aggregator's chosen timezone. A manifest lists only the requested range, even if local state retains other days.

`export` prints a JSON receipt containing the host identity, listed day count, cumulative source counters, and the completed bytes read on that invocation. `coverage` validates and prints the current manifest. Diagnostics contain fixed text, never the invalid value or its private path.

## Identity, privacy, and interpretation

The private state owns a random host identity, source identity, HMAC key, categorical mappings, deduplication index, scan checkpoint, and sanitized events. Keep it durable on that host. Reusing it preserves identity across ledger rotation and process restarts. Copying it to another host incorrectly gives both the same identity. Losing it creates a new identity. Paths, timezone, and reviewed catalog bind to this state, and rebinding is refused. The identities do not authorize enrollment or claim a Tailscale node identity.

A fingerprint includes the normalized nanosecond instant, partial request/response IDs, route ID, source usage fields, and local attribution references. It is namespaced by the local host and source. `req` supplies the requested model, never a request ID. `host` is ignored because it names an upstream endpoint. Neither `response_id`, `rid`, nor `route_id` alone is a global key. Different fingerprints sharing a request or response ID stay separate and increase `conflicting_id_events` on every affected day. Identical fixed metadata collapses as a duplicate. Two genuine calls with identical metadata and no distinguishing ID cannot be distinguished. Counters expose that limitation.

Identifying values become keyed opaque references. Raw sessions, request/response IDs, accounts, host endpoints, caller keys, client addresses, paths, worker names, branch names, prompts, replies, tool arguments, and arbitrary error strings never enter exported objects, filenames, or diagnostics. No worker records, client repositories, routing logs, bot databases, credentials, or transcript files are opened. `project_ref` and `worker_ref` are unavailable. `billing_mode` is unknown.

Categorical names default to unavailable, with stable opaque references for grouping. To expose public model/provider/client-program names, supply a locally reviewed JSON catalog using `--catalog`:

```json
{"req":["group/router"],"served":["gpt-6.1-sol"],"provider":["codex"],"agent":["pi"]}
```

These lists authorize exact labels only. Include public model names and provider names, never client labels, titles, paths, email addresses, or credentials. Other values remain opaque even when another value in that field is allowed. The catalog stays local. Its configuration is bound to private state so repeated exports cannot silently relabel history.

`kind=workload` represents upstream workload requests. `routing-overhead` records classifier tokens, durations and estimates separately. `model_list` and unknown row kinds are excluded and counted in `ignored_rows`. No routing-to-workload relationship is inferred. Application calls outside this ledger are not collected. Direct Pi/Claude Code usage is explicitly `not-collected` in coverage.

Tokens are nonnegative counts with `null` for missing or invalid values. `cache_write_1h` is part of the source's cache-write accounting and must not be added again to `cache_write`. Reasoning tokens can overlap output tokens and must not be added blindly. Durations are milliseconds per request. `request_ms_sum` adds overlapping requests and is never elapsed working time or human active time. No event-time start/end interpretation is claimed beyond the source timestamp.

## Estimates

The inventory's raw ledger contains no prices. Without a supplied CSV snapshot, estimates stay unavailable. The supported [Magpie usage interface](https://usemagpie.ai/docs/usage) offers `magpie usage --csv all`. An operator can capture that output privately and pass its file with `--estimates` and `--price-snapshot-at`. The exporter never invokes Magpie or changes `magpie sessions read`.

A snapshot joins only on matching UTC second, requested/served model, provider, token fields, duration, status, kind, and partial request/response IDs. It must match exactly one retained event and one CSV row. Ambiguity leaves a price unknown. CSV time without an offset is interpreted as documented UTC. Costs are the CSV's effective API-equivalent estimates, whose underlying catalogue precedence remains Magpie's. Provenance records `magpie-csv-snapshot`, snapshot read time, and SHA-256 of that private snapshot. No claim of a provider invoice or an identified catalogue revision is made.

A first accepted estimate is frozen per event. A later snapshot can fill unavailable values but cannot reprice accepted values. If a newly observed event makes an earlier join ambiguous, that estimate is revoked to unknown on every affected day. Billed cost is always `null`. Unknown estimates never become zero. Every total carries an unpriced count, plus missing-token and missing-duration counts. Known partial sums must be displayed with those counts. A total with no known amount is `null`, including an empty overhead total. A missing day has no totals object at all.

## Coverage and failure recovery

Coverage is deliberately conservative. A day with events is `partial`. A date without retained events is `missing`, with `file`, `workload`, and `overhead` all `null`. The exporter cannot prove that a quiet day had zero requests, that the original history is complete, or that all host usage went through Magpie. Source retention is unknown. It never asserts complete coverage, even for a closed date. No host-existence or retirement state is inferred.

`first_event_at` and `last_event_at` describe retained exported history. `last_scan_at` advances when completed input advances and remains unchanged for a no-op scan. `late_events` counts requests first observed after the end of the following UTC day, a conservative ingestion-delay indicator rather than proof of source completeness. Torn trailing lines are deferred. Malformed complete rows and oversized rows are counted without quoting them. A ledger snapshot is bounded at the initial file size, so appends during a scan wait until the next run.

SQLite holds the growing index on disk with a bounded cache. Input and gzip output stream with a bounded line buffer. A normal scan resumes at the completed byte offset and checks the file identity, size and checkpoint boundary. Rotation, truncation or a changed boundary triggers a full scan without deleting previously exported history. `--rescan` also reconciles in-place edits away from the checkpoint boundary, which incremental checks cannot detect. Export is additive. Source removals or corrections cannot retract an earlier event automatically.

A file lock excludes simultaneous writers for one state. Private directories use owner-only permissions and database files use owner read/write permissions. Day files have deterministic gzip headers, sorted events and content-addressed names. The manifest is atomically replaced only after its day files are durable. Readers holding an older manifest can still fetch its immutable files. Old versions remain until a future retention policy safely removes them. Disk use therefore grows with retained events and changed day versions. The exporter does not impose the proposed live retention policy in this source-only PR.

A failed run rolls back its checkpoint and database changes. Completed immutable files can remain unreferenced and are safe to ignore. A repeated run recovers from the retained source. A hard kill can leave an unreferenced pending file. It never causes a manifest to point at partially written bytes. Source files are never written. The process shares its OS user's filesystem permissions and does not isolate private state from that user or root. Export only the designated output directory, never its state or source parent.

## Frontend adapter limits

This export is not `dataset.json`. It contains enough usage metadata for an adapter to create explicitly usage-only request or turn records: opaque event/session identity, source instant, requested/served model and provider references or reviewed names, tokens by kind, per-request duration, status, and optional estimated cost. Any such turn is a usage representation, not evidence of a transcript turn, and the timestamp is not proven to be its start time.

It cannot recover prompts, replies, tool names/arguments/results, tool errors, human activity, session titles, repository paths, parent/child relations, compactions, hooks, quota histories, exact routing links, or billed cost. Transcript turn boundaries, stop reasons and tool counts are unavailable. Rows with missing metrics remain unavailable rather than acquiring invented zero values. The original `src/model/dataset.ts` and `extract/` must decide whether Overview, Timeline and Tokens accept usage-only turns or derive their totals from transcript `turns[]`. Those totals are unsupported until that source check and an honest missing-data representation exist in the adapter. Routing overhead must never inflate workload turn/request totals.

## Isolated verification

`python3 -B -m unittest discover -s tests/usage_export -p 'test_*.py'` runs the actual production CLI against temporary synthetic ledgers, including privacy canaries, IDs reused across days, late rows, offsets, unknown metrics, CSV ambiguity, rotation, and failed atomic publication. The same suite runs through `pnpm test`. Fixtures have an ownership receipt and marker, and cleanup verifies both before deletion. No live ledger or provider is used.
