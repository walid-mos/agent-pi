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

The paths above are examples. Use separate directories for private state, exported files, and source files. No default path silently starts collection. `bin/usage-export-host` is the explicit command with standard paths, described in [Host runner](#host-runner). It calls `magpie usage --csv all`, and nothing runs until a schedule calls it. The command scans the retained ledger, while `--from` and `--through` select the inclusive UTC dates listed in the manifest. The report timezone determines each event's `report_day`. Provide `--now` for deterministic fixtures. Normal invocations may use the real clock.

The authoritative definition is [schema.py](schema.py), exposed as JSON Schema by `schema`. Its `$id` identifies the contract version. Events and manifests also carry `schema_version`. Consumers in another repository must invoke `schema` from a pinned agent-pi checkout and register its returned document with their JSON Schema validator. Validate using the returned document's `#/$defs/event` or `#/$defs/manifest`. Do not copy its properties, enums, or version into a second schema. Fail on an unsupported contract rather than interpreting it as another version. The CLI validates its own emitted objects against the same definitions.

An aggregator takes a manifest snapshot, fetches only its relative `days/*.jsonl.gz` paths, verifies compressed-byte `sha256` and `bytes`, decompresses JSONL, validates each event, and upserts by `event_id`. Fetch changed hashes to receive late arrivals and newly available prices. Event files are cut on UTC dates. Rebucket by `ts_utc` in the aggregator's chosen timezone. A manifest lists only the requested range, even if local state retains other days.

`export` prints a JSON receipt containing the host identity, listed day count, cumulative source counters, the completed bytes read on that invocation, and `relabelled_events`, the number of stored events a grown catalog labelled. `coverage` validates and prints the current manifest. Diagnostics contain fixed text, never the invalid value or its private path.

## Identity, privacy, and interpretation

The private state owns a random host identity, source identity, HMAC key, categorical mappings, deduplication index, scan checkpoint, and sanitized events. Keep it durable on that host. Reusing it preserves identity across ledger rotation and process restarts. Copying it to another host incorrectly gives both the same identity. Losing it creates a new identity. Ledger path, output path and timezone bind to this state, and rebinding is refused. The reviewed catalog binds too, and can only grow. The identities do not authorize enrollment or claim a Tailscale node identity.

A fingerprint includes the normalized nanosecond instant, partial request/response IDs, route ID, source usage fields, and local attribution references. It is namespaced by the local host and source. `req` supplies the requested model, never a request ID. `host` is ignored because it names an upstream endpoint. Neither `response_id`, `rid`, nor `route_id` alone is a global key. Different fingerprints sharing a request or response ID stay separate and increase `conflicting_id_events` on every affected day. Identical fixed metadata collapses as a duplicate. Two genuine calls with identical metadata and no distinguishing ID cannot be distinguished. Counters expose that limitation.

Identifying values become keyed opaque references. Raw sessions, request/response IDs, accounts, host endpoints, caller keys, client addresses, paths, worker names, branch names, prompts, replies, tool arguments, and arbitrary error strings never enter exported objects, filenames, or diagnostics. No worker records, client repositories, routing logs, bot databases, credentials, or transcript files are opened. `project_ref` and `worker_ref` are unavailable. `billing_mode` is unknown.

Categorical names default to unavailable, with stable opaque references for grouping. To expose public model/provider/client-program names, supply a locally reviewed JSON catalog using `--catalog`:

```json
{"req":["group/router"],"served":["actual-model-id"],"provider":["codex"],"agent":["pi"]}
```

These lists authorize exact labels only. Include public model names and provider names, never client labels, titles, paths, email addresses, or credentials. Other values remain opaque even when another value in that field is allowed. The catalog stays local and is bound to private state. A later export accepts a catalog that keeps every bound label of each field and adds new ones, and rebinds the state in the same transaction. Stored events whose raw value is newly listed receive that label and keep their `event_id`. Their UTC day files are republished under new hashes, so an aggregator refetches them. A catalog that drops or changes a bound label is refused. A state first bound without a catalog accepts a first catalog. Relabelling reads the event table in bounded batches.

`kind=workload` represents upstream workload requests. `routing-overhead` records classifier tokens, durations and estimates separately. `model_list` and unknown row kinds are excluded and counted in `ignored_rows`. No routing-to-workload relationship is inferred. Application calls outside this ledger are not collected. Direct Pi/Claude Code usage is explicitly `not-collected` in coverage.

Tokens are nonnegative counts with `null` for missing or invalid values. `cache_write_1h` is part of the source's cache-write accounting and must not be added again to `cache_write`. Reasoning tokens can overlap output tokens and must not be added blindly. Durations are milliseconds per request. `request_ms_sum` adds overlapping requests and is never elapsed working time or human active time. No event-time start/end interpretation is claimed beyond the source timestamp.

## Estimates

The inventory's raw ledger contains no prices. Without a supplied CSV snapshot, estimates stay unavailable. The supported [Magpie usage interface](https://usemagpie.ai/docs/usage) offers `magpie usage --csv all`. An operator can capture that output privately and pass its file with `--estimates` and `--price-snapshot-at`. `usage-export` never invokes Magpie or changes `magpie sessions read`. `usage-export-host` takes the snapshot itself.

A snapshot joins only on matching UTC second, requested/served model, provider, token fields, duration, status, kind, and partial request/response IDs. It must match exactly one retained event and one CSV row. Ambiguity leaves a price unknown. A CSV time without an offset is UTC, and fractional seconds, a BOM and either separator are accepted. A row whose time cannot be parsed, or whose cost is not a finite number in the accepted range, is skipped, leaving its price unknown. Costs are the CSV's effective API-equivalent estimates, whose underlying catalogue precedence remains Magpie's. Provenance records `magpie-csv-snapshot`, snapshot read time, and SHA-256 of that private snapshot. No claim of a provider invoice or an identified catalogue revision is made.

A first accepted estimate is frozen per event. A later snapshot can fill unavailable values but cannot reprice accepted values. If a newly observed event, or a new snapshot, makes an earlier join ambiguous, that estimate is revoked to unknown on every affected day. A snapshot that no longer contains a row leaves an accepted price in place, because a shorter CSV window is indistinguishable from a withdrawn price. Billed cost is always `null`. Unknown estimates never become zero. Every total carries an unpriced count, plus missing-token and missing-duration counts. Known partial sums must be displayed with those counts. A total with no known amount is `null`, including an empty overhead total. A missing day has no totals object at all.

## Coverage and failure recovery

Coverage is deliberately conservative. A day with events is `partial`. A date without retained events is `missing`, with `file`, `workload`, and `overhead` all `null`. The exporter cannot prove that a quiet day had zero requests, that the original history is complete, or that all host usage went through Magpie. Source retention is unknown. It never asserts complete coverage, even for a closed date. No host-existence or retirement state is inferred.

`first_event_at` and `last_event_at` describe retained exported history. `last_scan_at` advances when completed input advances and remains unchanged for a no-op scan. `late_events` counts requests first observed after the end of the following UTC day, a conservative ingestion-delay indicator rather than proof of source completeness. Torn trailing lines are deferred. The ledger payload limit in [storage.py](storage.py) excludes the terminating newline. Malformed complete rows and oversized rows are counted without quoting them. A ledger snapshot is bounded at the initial file size, so appends during a scan wait until the next run.

SQLite holds the growing index on disk with a bounded cache. Input and gzip output stream with a bounded line buffer. A normal scan resumes at the completed byte offset and checks the file identity, size and checkpoint boundary. Rotation, truncation or a changed boundary triggers a full scan without deleting previously exported history. `--rescan` also reconciles in-place edits away from the checkpoint boundary, which incremental checks cannot detect. Export is additive. Source removals or corrections cannot retract an earlier event automatically.

A file lock excludes simultaneous writers for one state, and a second writer reports that the state is busy. Private directories use owner-only permissions and database files use owner read/write permissions. Day files have deterministic gzip headers, sorted events and content-addressed names. The manifest is atomically replaced only after its day files are durable. A day file deleted or altered inside the output directory is rebuilt from private state on the next run. Readers holding an older manifest can still fetch its immutable files. Old versions remain until a future retention policy safely removes them. Disk use therefore grows with retained events and changed day versions. The exporter does not impose the proposed live retention policy in this source-only PR.

A failed run rolls back its checkpoint and database changes. Completed immutable files can remain unreferenced and are safe to ignore. A repeated run recovers from the retained source. A hard kill can leave an unreferenced pending file. It never causes a manifest to point at partially written bytes. Source files are never written. The process shares its OS user's filesystem permissions and does not isolate private state from that user or root. Export only the designated output directory, never its state or source parent.

## Host runner

`bin/usage-export-host` runs `export` with the values defined in [host_layout.py](host_layout.py):

| Item | Value |
| --- | --- |
| Ledger | `~/.config/magpie/usage.jsonl` |
| Private state | `~/.local/state/agent-usage-export/` |
| Published output | `~/Public/deliverables/agent-usage-export/v1/` |
| Catalog, used when the file exists | `~/.config/agent-usage-export/catalog.json` |
| Listed window | The last 35 UTC days, today included |
| Timezone bound to the state | `Europe/Paris` |

The output folder sits in the tree the `tailnet-link` file server serves in place. That server runs as the same user, so the owner-only modes suit it, and it skips the hidden `.pending-*` files.

A run does four things:

1. When `magpie` is on `PATH` or at `~/.local/bin/magpie`, it writes `magpie usage --csv all` into a private temporary file, mode 0600, outside the state, output and ledger folders. It passes that file with `--estimates`, and its own clock with `--price-snapshot-at`. The file is removed on every exit, a termination signal included. Without `magpie`, when `magpie` fails, or when its output lacks the estimate columns, the export runs without estimates.
2. It runs the export.
3. It reconciles each closed UTC day of the window that the snapshot covers, as requests and tokens by type against the exported workload and routing-overhead events. The CSV side carries two figures: `csv` counts every row, and `csv_unique` counts rows that differ in at least one CSV column. The export side counts stored events, whose identity also covers fields the CSV leaves out, such as the session and the route. A day matches when the export counts equal either figure, so a ledger line written twice and two distinct events that look identical in the CSV both match. `model_list` rows, and rows whose kind the ledger rejects, are in neither count. A covered day comes after the first exported day and after the snapshot's first row, because either side can be truncated. It has also been closed for an hour, so a request logged after the snapshot near midnight cannot make it differ.
4. It prints one JSON receipt on one line:

```json
{"export": {"schema_version": 1, "host_uuid": "<64 hex>", "days": 35, "read_bytes": 0,
            "scan": {"ledger_bytes": 0, "invalid_rows": 0, "ignored_rows": 0, "duplicate_rows": 0,
                     "deferred_tail_bytes": 0}, "relabelled_events": 0},
 "snapshot": "taken", "estimates_applied": true,
 "reconcile": [{"day": "2026-11-17", "matches": true,
                "csv": {"requests": 2, "input": 200, "output": 40, "cache_read": 20, "cache_write": 8,
                        "cache_write_1h": 2, "reasoning": 10},
                "csv_unique": {"requests": 2, "input": 200, "output": 40, "cache_read": 20, "cache_write": 8,
                               "cache_write_1h": 2, "reasoning": 10},
                "export": {"requests": 2, "input": 200, "output": 40, "cache_read": 20, "cache_write": 8,
                           "cache_write_1h": 2, "reasoning": 10}}]}
```

`export` is `null` when the export failed. `snapshot` is `taken`, `magpie-missing` or `magpie-failed`. `estimates_applied` is true when the export ran with a snapshot file, whatever number of events that snapshot priced. The receipt holds counts, dates and the host identity, never a raw value, a path or a label. The command exits 0 when the export succeeded and every reconciled day matches. It exits 1 when the export failed, a reconciled day differs, or the reconcile itself failed, still printing the receipt, with fixed text on stderr. A termination signal exits with 128 plus the signal number.

### Enrollment

Nothing runs until a schedule calls the command. A pot's own bot enrolls it with one command:

```sh
pots routine add usage-export --every 1h --timeout 10m --run "$HOME/.pi/agent/bin/usage-export-host"
```

A failed run fails the routine once, which wakes that pot's bot. To leave, run `pots routine remove usage-export`, then delete the published folder `~/Public/deliverables/agent-usage-export/v1/`. The private state stays, so a host that joins again keeps its identity. A Mac's schedule is installed by the report repository `walid-mos/agent-usage`, which calls this command.

### Catalog review

```sh
python3 -B ~/.pi/agent/bin/usage-export-host candidates
```

`candidates` prints to the local terminal each raw value the private state holds for `req`, `served`, `provider` and `agent` that the catalog file does not label, with its event count. It opens the state read-only and writes nothing, the published folder included. Copy only public model, provider and client-program names into the matching list of the catalog file. The next run labels their stored events and republishes those days. The catalog can only grow: a later export refuses a catalog that removes or renames a label.

## Frontend adapter limits

This export is not `dataset.json`. It contains enough usage metadata for an adapter to create explicitly usage-only request or turn records: opaque event/session identity, source instant, requested/served model and provider references or reviewed names, tokens by kind, per-request duration, status, and optional estimated cost. Any such turn is a usage representation, not evidence of a transcript turn, and the timestamp is not proven to be its start time.

It cannot recover prompts, replies, tool names/arguments/results, tool errors, human activity, session titles, repository paths, parent/child relations, compactions, hooks, quota histories, exact routing links, or billed cost. Transcript turn boundaries, stop reasons and tool counts are unavailable. Rows with missing metrics remain unavailable rather than acquiring invented zero values. The original `src/model/dataset.ts` and `extract/` must decide whether Overview, Timeline and Tokens accept usage-only turns or derive their totals from transcript `turns[]`. Those totals are unsupported until that source check and an honest missing-data representation exist in the adapter. Routing overhead must never inflate workload turn/request totals.

## Isolated verification

`python3 -B -m unittest discover -s tests/usage_export -p 'test_*.py'` runs the actual production CLI against temporary synthetic ledgers, including privacy canaries, IDs reused across days, late rows, offsets, unknown metrics, CSV ambiguity, rotation, and failed atomic publication. The same suite runs through `pnpm test`. Fixtures have an ownership receipt and marker, and cleanup verifies both before deletion. Host runner tests point `HOME`, `PATH` and `TMPDIR` at the fixture and call a fake `magpie` executable. No live ledger, Magpie or provider is used.
