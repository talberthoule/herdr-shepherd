# Audited Herdr Command Policy

## Request contract

Pipe one literal JSON object in a single-quoted PowerShell here-string directly to `scripts/coordinate.mjs --stdin`.

| Field | Required | Value |
|---|---:|---|
| `origin` | yes | `proactive` or `user-directed` |
| `action` | yes | `herdr.exec` |
| `args` | yes | Herdr CLI arguments as a string array |
| `target` | yes | `{ "type": "agent|pane|tab|workspace", "id": "..." }` |
| `reason` | yes | Concise coordination reason |
| `message` | yes | Outbound text, or an empty string for actions without text |

For `proactive`, `args` must be exactly `['agent', 'send', targetId, message]`; `target` and `message` must match those arguments. The wrapper verifies the agent exists, prefixes the source tab/pane for the recipient, types the message, and sends Enter after a short delay. A successful audit outcome means submission to the pane, not proof that the agent started a new turn.

For `user-directed`, broader Herdr arguments are permitted because the user supplied the authority. Never relabel an agent-initiated action as user-directed.

## Audit behavior

The profile hook records both attempted and succeeded/failed phases with sequence, timestamp, runtime, session/tool identifiers when available, origin, action, source pane, target, reason, redacted message, message SHA-256, and outcome summary. The source is the Herdr pane issuing the command; the target is the receiving pane or resource. Codex and Claude Code share the same JSONL log and localhost viewer.

Read-only commands such as `api snapshot`, `pane read`, and `agent list` are not logged. A raw mutating Herdr command is denied; repeat it through the wrapper. Obvious tokens, passwords, API keys, bearer credentials, and private keys are blocked before execution and are not retained verbatim.

The viewer binds only to `127.0.0.1`, uses a random per-run token and strict CSP, loads no remote assets, opens one browser tab per viewer process, and defaults to succeeded events. **Viewed & close** acknowledges the highest displayed sequence and stops the viewer. Browser-tab close alone does not acknowledge it. **Clear viewed history** deletes only acknowledged entries after confirmation.
