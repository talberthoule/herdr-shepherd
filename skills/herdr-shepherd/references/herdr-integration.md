# Herdr Integration

Herdr-specific material that the native Herdr skill does not cover: Shepherd's own audited mutation path, and the coordination hazards its code refuses on. Read this before the first coordinated mutation in a Herdr session.

For Herdr's own mechanics — enumerating sessions, lifecycle, splits, waits, reads — use the native Herdr skill. If it is not available in this session, say so and offer to install it rather than improvising CLI syntax. Everything below is Shepherd's, not Herdr's, and does not exist upstream.

Verified against Herdr `0.7.2-preview.2026-07-07`, protocol 16. Re-verify after a Herdr upgrade; several items here are version-specific bugs.

## Vocabulary mapping

The skill speaks tool-neutrally. In Herdr:

| Skill term | Herdr |
|---|---|
| Peer session | A pane running a detected agent, addressed as `w<workspace>:p<pane>` |
| Enumerate peers | `herdr api snapshot` |
| Session read | `herdr pane read <id> --source recent-unwrapped` |
| Liveness | `agent_status` from `herdr agent get <id>` or the snapshot |
| Send | An `agent send` request through the audited wrapper |

## Mutation boundary

Proactive coordination may only request `agent send` for an existing agent. The audited wrapper prefixes the source tab/pane, submits the message atomically, and records a delivery verdict; only a `confirmed` verdict or a later session read supports claiming the agent resumed. Do not proactively start agents, run other pane commands, focus UI, close panes, rename items, or alter layout.

A direct user request may authorize broader Herdr actions. Mark those `user-directed`; they remain audited but do not auto-open the viewer.

Every mutation must use the audited wrapper. Raw Herdr mutations are denied by the profile hook, and the wrapper refuses to send at all when it cannot confirm the hook audited the attempt. See [command-policy.md](command-policy.md) for the request contract.

## Liveness semantics

Herdr derives status by matching detection rules against the pane's rendered screen, not by asking the agent. `herdr agent explain <id> --json` names the rule that matched, the screen region behind it, and the manifest version used — it is the tool for questioning a status you do not believe.

| Status | Means | Use it for |
|---|---|---|
| `working` | Mid-turn | An active writer: read its plan before touching shared files, and expect a send to queue behind the running turn. |
| `idle` | Awaiting input with a live composer | The only state a delivery verdict can be confirmed from, and the safe handoff candidate. |
| `blocked` | Waiting on a human at a prompt or modal | Never send; surface it to the user. |
| `done` | Finished a turn and wants attention | A UI attention state, not a lifecycle state. |
| `unknown` | No agent detected, or detection failed | Ambiguous by construction; read the pane instead. |

Two Herdr-specific traps:

- `idle`, `working`, `blocked`, and `unknown` are waitable; `done` is not. `herdr agent wait <id> --status done` is refused with "done is a UI attention state; use idle for CLI agent completion waits". Herdr's `done` also has nothing to do with a tracker's Done column — an agent that finished one turn is not a lane that passed review.
- Detection runs against a versioned, remotely-updated manifest, so semantics can drift when the manifest or the agent's own UI changes. An agent that must be trusted rather than guessed at can self-report with `pane report-agent`.

`agent wait --timeout` is **ignored** on this build; the command blocks until the state arrives. The wrapper bounds its own delivery wait with a watchdog — bound yours the same way.

## Two hazards the wrapper refuses on

Both were found by running sends against live panes, and both cause a send to take an action the user never chose.

**A send into a `blocked` pane does not stick in the composer.** The submitted Enter answers the pane's pending prompt with its **default option**, and the message text is discarded. The send silently makes a decision on the user's behalf. The wrapper refuses when the pre-send status is `blocked`, on every transport. Resolve the prompt first; deliberate modal interaction is explicit `send-keys`, never a message send.

**A send merges with an unsubmitted composer draft** and force-submits both as one message. The wrapper checks before every send, on both origins, and refuses on a positive reading. `HERDR_SHEPHERD_ALLOW_DIRTY_COMPOSER=1` overrides it, and is only for a merge the user has accepted.

How well that check sees depends on the target's detection manifest:

- **Claude panes are fully readable.** `agent explain <id> --json` exposes the composer as the `prompt_box_body` region preview whatever state won detection, so it reads from a working pane too. An empty composer previews as the bare prompt glyph; anything else is a draft.
- **Other agents are readable in one direction only.** Codex's manifest has no prompt box — it evaluates `osc_title`, `after_last_prompt_marker`, `whole_recent`, and `bottom_non_empty_lines(3)` — so the fallback is the `tab to queue message` hint, which a TUI renders only while text waits unsubmitted. That proves a dirty composer but can never prove a clean one: an empty composer and an unreadable one look identical.

A send the check could not read carries `coordination-composer: unchecked` in its output, and the hook stores it as a `composer` field on the audit event. Read it as *this send went out unguarded*, not as a clean composer. `HERDR_SHEPHERD_ALLOW_DIRTY_COMPOSER=1` records `coordination-composer: bypassed` the same way, so an intentional override is never mistaken for a guarded send.

The guards run for every request shape that pushes text into a pane — `agent send`, `pane run`, `pane send-text`, `agent prompt` — not only `agent send`, and on both origins. If the target's status cannot be read at all, the submit is refused rather than attempted, because a blocked pane cannot be ruled out from an unreadable status.

## Transport and delivery verdicts

A send submits the message in one atomic `pane run` call — text plus Enter together, honoring the pane's bracketed-paste mode — and the wrapper derives a verdict from the target's status stream. Multi-line and long payloads arrive intact.

- `confirmed` — the target began a turn. Either it is `working` after the submit, or it went `idle` → `done`, which on this build only happens by running one.
- `queued` — the target was already working; the message queued behind the running turn. Session read later to confirm it surfaced.
- `unconfirmed` — the target did not start within the wait window. Session read before resending.
- `unknown` — a status probe failed, before or after the submit. A dropped control socket says nothing about the target, so it is never reported as `unconfirmed`.

Only `confirmed` may be treated as delivered.

The legacy keystroke transport (`HERDR_SHEPHERD_TRANSPORT=keystrokes`, typed text plus a delayed Enter) races the target composer. A long send that loses the race arrives with its first 1024 characters dropped, so number multi-point sends (part 1/2, part 2/2) and recover truncated text from the sender's session log; the typed Enter can be swallowed by TUI state, leaving the message stuck in the composer — verify within about 20 seconds and resend, and sweep panes for stuck composers on each coordination wake. On that transport a stuck composer is indistinguishable from understood.

## Locate the wrapper first

`coordinate.mjs` ships with the skill, so its path depends on the runtime and install. **Resolve it at first use in a session instead of trusting a remembered path** — a plugin update or reorganization moves it, and the stale path fails mid-session with `Cannot find module`, which looks nothing like a coordination problem:

| Install | Wrapper path |
|---|---|
| Claude Code plugin | `~/.claude/plugins/cache/<marketplace>/herdr-shepherd/<version>/skills/herdr-shepherd/scripts/coordinate.mjs` |
| Codex plugin | `~/.codex/plugins/herdr-shepherd/skills/herdr-shepherd/scripts/coordinate.mjs` |
| Manual skill install | `<skill root>/scripts/coordinate.mjs` |

The version segment changes on update, so glob for `**/coordinate.mjs` under the runtime's config directory rather than pinning one. Do not use a junction or symlink path such as `~/.claude/skills/...`; those intermittently fail to resolve for the Windows node process, and because the hook only audits and never delivers, a node that fails to start means nothing was sent.

## Send

Pipe one literal JSON object to the wrapper. Under Claude Code use the Bash tool with a quoted heredoc — the PowerShell tool's string-to-native pipe prepends a UTF-8 BOM that breaks `--stdin` JSON parsing:

```sh
node "<wrapper path>" --stdin <<'JSON'
{"origin":"proactive","action":"herdr.exec","args":["agent","send","w2:p1","Resume the official installer build and report blockers here."],"target":{"type":"agent","id":"w2:p1"},"reason":"Continue paused work without duplicating it","message":"Resume the official installer build and report blockers here."}
JSON
```

Keep the JSON on one line and do not append a pipe or redirect to the heredoc; the hook rejects both. Where PowerShell is the only shell available, use a single-quoted here-string:

```powershell
@'
{"origin":"proactive","action":"herdr.exec","args":["agent","send","w2:p1","Resume the official installer build and report blockers here."],"target":{"type":"agent","id":"w2:p1"},"reason":"Continue paused work without duplicating it","message":"Resume the official installer build and report blockers here."}
'@ | node "<wrapper path>" --stdin
```

## Read the failure, do not guess it

A successful send prints two lines: `coordination-wrapper: <name> <version> (<path>)` identifying which wrapper ran, then `coordination-delivery: <verdict>`. **No output at all means the wrapper never executed** — a path or environment problem, never a delivery verdict. Silence is not success.

Three failures are easy to confuse, and the wrapper names which one it hit:

- `target agent does not exist: <id>` — the CLI resolved the pane as absent. Re-enumerate; the pane id is wrong or gone.
- `could not reach Herdr to verify <id>: ...` — the control socket dropped the probe after a retry. **The target is probably live.** Confirm with `herdr agent get <id>` and send again. Do not conclude that coordination is down, and do not record that conclusion anywhere durable.
- `refusing to send unaudited: ...` — the PreToolUse hook did not run, so the send would leave no record. This is an auditing failure, not a transport one; the target is fine.

The existence gate runs only for `proactive`, so `user-directed` sends can be delivering normally at the same moment proactive sends fail. Test both before reporting an outage.

## When the audit hook is not running

The wrapper requires proof that it was audited: the hook writes an `attempted` event *before* the command runs, so a matching event must already exist by the time the wrapper starts. If it does not, the wrapper refuses the send rather than mutating without a record.

This is load-bearing, not defensive. One pane ran ten coordination sends with the hook silently not loaded; seven delivered with no audit entry anywhere, and nothing distinguished that pane from an audited one. An audit that fails open is indistinguishable from an audit that passes.

On the refusal: confirm the skill's hooks are actually active in this session rather than assuming they are, since a session whose hook loading failed audits nothing and gives no other warning. A fresh pane is the usual fix. `HERDR_SHEPHERD_ALLOW_UNAUDITED=1` sends anyway and marks the output `audit=bypassed`; use it only when the user has accepted an unaudited mutation, never to make an inconvenient refusal go away.

The hook records attempted and outcome events, redacts obvious secrets, and opens one loopback audit viewer tab per viewer process for proactive sends. The viewer defaults to the `succeeded` phase, which it displays as **sent**: the wrapper submitted the message, which is not proof the target read or acted on it. Use **Viewed & close** to acknowledge; closing the tab alone leaves entries unseen.

## Herdr-specific mistakes

- Do not say another Herdr tab is inaccessible. Enumerate and read it.
- Do not search the repository, GitHub, or the web for paused Herdr work before inspecting Herdr.
- Do not put literal `Herdr <word>` prose *unquoted* inside unrelated shell command bodies. Quoted arguments are treated as data, so `grep "herdr agent send" log` is fine, but the classifier still scans unquoted text and heredoc bodies and may read prose there as a raw Herdr mutation. Quote the text or pass it another way.
- Do not read wrapper silence as success. Every real run prints `coordination-wrapper:`; no output means the wrapper never started, so nothing was sent.
- Do not assume your session is being audited. Verify that a send produced an `attempted` event before trusting the trail, and never reach for `HERDR_SHEPHERD_ALLOW_UNAUDITED=1` to clear a refusal the user has not accepted.
- Do not report a failed status probe as a missing target. `could not reach Herdr to verify <id>` is a transport fault on the control socket; the pane is probably live.
- Do not trust a remembered wrapper path. Resolve `coordinate.mjs` per session.
- Do not wait on `done`, and do not trust `agent wait --timeout` on this build.
