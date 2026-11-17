# Pots human dialogs

Pi opts into the installed [agent-sandbox broker](https://github.com/walid-mos/agent-sandbox/blob/main/docs/human-dialogs.md) through explicit worker flags. Read that protocol before changing wire validation or browser IPC. Its source owns the wire contract. `config.ts` owns Pi's opt-in, `receipt.ts` validates results, and `completion.ts` closes the waiting terminal dialog when either surface wins.

Start an opted-in worker with a persisted session:

```sh
pi --human-dialog-worker WORKER_NAME --human-dialog-broker /opt/agent-sandbox/session/human.mjs
```

The broker path flag is optional. Both question and secret extensions must be loaded. The source binds the exact worker name, absolute Pi session file and tool-call ID. The launcher must check the installed Pi supports these flags before passing them. Installing this source does not update an already running Pi process. Without the worker flag, both tools use their existing local dialogs. Invalid opted-in configuration or an unavailable broker fails the tool and never bypasses arbitration.

## Questions

The terminal stays interactive while the broker delivers Discord controls. Every terminal submission goes through the broker, including Escape and Discuss. The broker's first settlement wins. Pi closes the terminal dialog with that winner, maps option labels to the original option values, and retains the receipt's scope and click evidence in result details and context checkpoints.

Receipts must match the canonical dialog ID, normalized question digest, declared scope, exact answer IDs and selection counts. Discord answers also require the registered delivery ID and question-bound click evidence. Duplicate display labels are rejected because they cannot identify an option unambiguously. Ordinary questions need no operator identity. Only `policy: "push"` selects push approval and requires an explicit immutable `scope`. Pi never infers approval from labels.

Discuss pauses the broker dialog and saves the local draft in the session result. A subsequent call resumes that draft under a new source. Restarting the same answered call returns its durable receipt. Cancellation and expiry grant no consent.

A work-center question before worker startup uses the broker's bot route independently. Initial startup push approval does not depend on these Pi flags or on browser secret support.

## Secret destinations

| Destination | Local Pi | Opted-in pot |
| --- | --- | --- |
| Browser | Masked terminal input, real in-process handle | Masked terminal or private broker page, real in-process handle after matching receipt |
| Infisical | Existing vault writer | Broker writer, metadata receipt only after success |
| Pots env file | Not exposed by `ask_user_secret` | Not exposed by `ask_user_secret` |

The pot owns page creation, one-time link delivery, private staging and destination writes. Pi sends entered terminal values through subprocess stdin only. It suppresses subprocess stderr, bounds stdout and reports fixed transport errors. Values never become tool results, Discord messages or command arguments.

For browser input, Pi creates a random private runtime directory and one Unix socket with modes 0700 and 0600. The broker target contains the exact origin, socket and random per-call capability. These are trusted local metadata and never enter tool-visible receipts. The private socket accepts one bounded newline-terminated JSON frame, checks source/dialog/origin/capability and pending state, and parks the value using the same global secret store consumed by `frontend_batch`.

Pi acknowledges only version, dialog, source, origin and a separate random handoff ID. The broker commits a stored result containing the browser destination, origin and that handoff ID. Pi returns its actual `sec:` handle only when both the matching live parked entry and matching completion exist. A receipt alone cannot reconstruct a handle after restart. The handle remains origin-bound, single-use and subject to the existing handle lifetime.

The owner expires after five minutes, socket input after five seconds, and an unconfirmed parked handoff after ten seconds. Completion, failure, cancellation and expiry remove the socket and burn any unconfirmed handle. Normal process exit removes the socket directory. An uncatchable process kill closes the socket in the kernel and loses its in-memory value. Ambiguous writes require checking the destination and making a new tool call. They never retry with a second handle or fall back to a vault write.

The trusted Pi process, installed broker and operator may briefly hold a value. This protocol does not isolate hostile extensions or another malicious process running under the same Unix user.

## Verification and rollout

`tests/broker-questionnaire.test.ts`, `tests/broker-secret.test.ts`, `tests/browser-secret-owner.test.ts`, `tests/human-broker-transport.test.ts` and `tests/human-dialog-config.test.ts` exercise controller closure, competing submissions, cancellation, restart, malformed receipts, IPC binding and leakage boundaries with synthetic values. Run the repository's checks and full test suite before publishing.

Rollout requires compatible broker and Pi source, CI installation, a new Pi process and explicit launcher opt-in. Source readiness does not prove the private page, Discord controls or destination writes are deployed. Verify those with the owning pot after CI rollout. No operator identity, private page link or entered value belongs in this public repository.
