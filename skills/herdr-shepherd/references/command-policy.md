# Audited Herdr Command Policy

## Request contract

Pipe one literal JSON object directly to `scripts/coordinate.mjs --stdin`, through a quoted POSIX heredoc or a single-quoted PowerShell here-string. Under Claude Code the heredoc via the Bash tool is required: the PowerShell tool's string-to-native pipe prepends a UTF-8 BOM that breaks `--stdin` JSON parsing. Keep the JSON on one line, and do not append a pipe or redirect to the heredoc — the hook rejects both. Resolve the wrapper's own path per session rather than reusing a pinned one; see the Example in SKILL.md.

| Field | Required | Value |
|---|---:|---|
| `origin` | yes | `proactive` or `user-directed` |
| `action` | yes | `herdr.exec` |
| `args` | yes | Herdr CLI arguments as a string array |
| `target` | yes | `{ "type": "agent|pane|tab|workspace", "id": "..." }` |
| `reason` | yes | Concise coordination reason |
| `message` | yes | Outbound text, or an empty string for actions without text |

For `proactive`, `args` must be exactly `['agent', 'send', targetId, message]`; `target` and `message` must match those arguments. The wrapper verifies the agent exists, refuses a `blocked` target (the submit would answer its pending prompt and discard the message), prefixes the source tab/pane for the recipient, submits the message atomically via `pane run`, and records an event-driven delivery verdict. A successful audit outcome means the message was submitted, and only a `confirmed` verdict proves the agent started a new turn.

## Probe failures

The existence check runs only for `proactive`; `user-directed` is authorized by the user and is not gated on it. Two distinct failures must not be conflated, because only the first says anything about the target:

| Error | Meaning | Response |
|---|---|---|
| `target agent does not exist: <id>` | The CLI resolved the pane as absent. | Re-snapshot; the id is wrong or gone. |
| `could not reach Herdr to verify <id>: <diagnostic>` | The control socket dropped the probe, and a retry also failed. | The pane is probably live. Confirm with `herdr agent get <id>` and send again. |

The wrapper retries a transport fault once before reporting it and preserves the CLI's own diagnostic in the message. A transport fault is not evidence that coordination is down: `user-directed` sends bypass this gate entirely and may be delivering normally at the same time.

For `user-directed`, broader Herdr arguments are permitted because the user supplied the authority. Never relabel an agent-initiated action as user-directed.

## Audit behavior

The profile hook records both attempted and succeeded/failed phases with sequence, timestamp, runtime, session/tool identifiers when available, origin, action, source pane, target, reason, redacted message, message SHA-256, and outcome summary. The source is the Herdr pane issuing the command; the target is the receiving pane or resource. Codex and Claude Code share the same JSONL log and localhost viewer.

Read-only commands such as `api snapshot`, `pane read`, and `agent list` are not logged. A raw mutating Herdr command is denied; repeat it through the wrapper. Obvious tokens, passwords, API keys, bearer credentials, and private keys are blocked before execution and are not retained verbatim.

Quoted arguments are treated as data, so prose that merely names the product does not read as an invocation. Unquoted text and heredoc bodies are still scanned, and a string passed to an interpreter such as `bash -c` is classified by what it would execute.

### Scope of the classifier

The classifier is a guardrail against running a raw mutation by accident, not a sandbox against a determined bypass. It reads one command's text, so it cannot follow a mutation that reaches the shell indirectly — assigned to a variable and expanded later, built by string concatenation, or handed to a tool that executes it out of band. Those forms pass as inert.

This is a deliberate trade for a defect that caused real harm in the other direction: matching the product name followed by any word anywhere in the command text denied ordinary read-only investigation, including a `grep` for the hook's own denial message. Do not treat a classification of inert as permission; the obligation to route mutations through the audited wrapper is on the agent, and the audit-enforcement check below is what actually catches an unrecorded send.

## Audit enforcement

The hook records the `attempted` phase before the command runs, so the wrapper can verify its own coverage. If no matching `attempted` event exists when the wrapper starts, the hook did not run and the wrapper refuses the send with `refusing to send unaudited`. The check matches on origin, target id, and the message SHA-256 within a recent window; a request repeated verbatim inside that window can be vouched for by the earlier attempt.

`HERDR_SHEPHERD_ALLOW_UNAUDITED=1` skips the check and appends `audit=bypassed` to the wrapper's output. It exists for direct invocation outside a hooked session and for tests, not as a way past a refusal.

Every run prints `coordination-wrapper: <name> <version> (<path>)` before any other output, and the outcome event stores that value as `wrapper`. This makes the absence of output unambiguous: it means the wrapper never executed, which is a path or environment fault rather than a delivery result. Do not infer a verdict from silence.

The viewer binds only to `127.0.0.1`, uses a random per-run token and strict CSP, loads no remote assets, opens one browser tab per viewer process, and defaults to succeeded events. **Viewed & close** acknowledges the highest displayed sequence and stops the viewer. Browser-tab close alone does not acknowledge it. **Clear viewed history** deletes only acknowledged entries after confirmation.
