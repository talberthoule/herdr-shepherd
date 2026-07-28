# agent-prompt transport: live verification checklist

## Live results — 2026-07-28, Herdr 0.7.2-preview.2026-07-07, protocol 16

Run end to end from a live coordinator pane (w4:p4) against a same-workspace Claude pane and
a disposable scratch agent, every mutation through the audited wrapper as `user-directed`.

| Question | Result |
|---|---|
| `agent prompt` exists? | **No.** Not in this build's CLI. The upstream docs describe a newer CLI. The `agent` usage text points at the replacement: "agent send writes literal text; use pane run when you want command text plus Enter." |
| `pane run` submits atomically? | **Yes.** Idle Claude composer: full text landed as one submitted prompt, target replied, composer left empty. No paste/Enter race observed. |
| Busy target | **Queues cleanly.** A `pane run` mid-turn was held and submitted as its own turn immediately after the running turn finished. Nothing merged, interleaved, or lost. |
| Long / multi-line payloads | **Intact.** ~1700-character, 12-line message delivered and submitted as one message; head and tail markers both echoed back. The 1024-char head-truncation is a keystroke-race artifact, not a transport property. |
| `agent wait --status X` | **Event-driven and correct** — resolves exit 0 with `agent_info` the moment the state arrives, and immediately if the state is already true. |
| `agent wait --timeout` | **Broken.** Ignored entirely; the command blocks until the state arrives (observed 4+ minutes past an 8s flag). Bounded waits need a wrapper-side watchdog, which `run(..., timeoutMs)` now provides. |
| Send into a `blocked` pane | **Dangerous — worse than documented.** The typed Enter answered the pending AskUserQuestion modal with its default option and the message text was discarded. A send into a blocked pane silently takes a decision on the user's behalf. The wrapper now refuses when the pre-send status is `blocked`, on every transport. |
| Unsubmitted composer draft | **Stomped by merge-and-submit.** `pane run` against a composer holding a draft submitted draft+message concatenated as one message — it force-submits the user's incomplete thought. `pane read` shows the composer line, so a pre-send read can detect a dirty composer; suppressing chatter toward user-facing panes remains justified. |
| Send→wait race | **Real.** A 2-second turn started and finished before a separately-issued wait began, leaving the wait hanging on a `working` that had already passed. The pane-run transport falls back to one status read after the watchdog, and treats idle→done as confirmed. |
| Audit / hook flow | **Unchanged.** Every wrapper call produced paired attempted/succeeded events with source, target, reason, and message SHA-256. |

Consequence: the `pane-run` transport in `coordinate.mjs` is the verified replacement on this
build; `agent-prompt` below remains the intended upgrade once the newer CLI ships. The original
checklist follows for re-verification against future builds.

The wrapper's `agent-prompt` transport (opt-in via `HERDR_SHEPHERD_TRANSPORT=agent-prompt` or
`options.transport`) replaces the keystroke send path — `pane send-text`, fixed delay, `pane
send-keys enter` — with one `herdr agent prompt` call. Herdr documents the call as atomically
submitting text plus encoded Enter while honoring the pane's live bracketed-paste mode, and its
socket form accepts a `wait` object so submission and delivery-wait happen in one request.

The implementation encodes assumptions that only a live Herdr instance can confirm. Run these
checks by hand (the shepherd hook intentionally blocks agents from running raw `herdr` commands),
record the outcomes, and adjust the code where noted. Use a scratch pane as the target, not a
lane with real work.

## 1. Command surface

```
herdr --version
herdr agent prompt --help
```

Record: do `--wait`, `--until`, and `--timeout` exist as documented? Does the help name the
accepted `--until` states (`working` is the one the wrapper uses)? Is there a `--` terminator for
message text? Does the target argument accept pane ids (`w2:p1`) or only agent names? The wrapper
passes pane ids, matching `agent get`.

## 2. Idle target, happy path

With the target pane idle:

```
herdr agent prompt <pane-id> "[Herdr live-probe 1] Reply with exactly: ack-1" --wait --until working --timeout 8000
echo exit=$?
```

Expect: exit 0, the target starts a turn, the full bracketed text is in its transcript, nothing
is left sitting in its composer. This validates `confirmed` deriving from the exit code alone.

## 3. Busy target

While the target is mid-turn:

```
herdr agent prompt <pane-id> "[Herdr live-probe 2] Reply with exactly: ack-2"
echo exit=$?
```

Record: queued as the next turn, interleaved into the current one, rejected, or lost? Does it
stomp anything already typed in the composer? The wrapper labels this `queued`; if the real
behavior is rejection or loss, the verdict mapping in `executeCoordinationRequest` must change.

## 4. Blocked pane (modal / permission prompt)

With the target sitting at a permission prompt or modal, send probe 3 the same way. Record the
exit code and where the text lands. This is the stuck-composer failure mode of the keystroke
transport; the open question is whether `agent prompt` bypasses it, queues behind it, or fails
loudly.

## 5. Wait-timeout diagnostics

Against a target that will not start working within the window (e.g. blocked, or `--until done`
against a long turn with a 1s timeout), record the exit code, stdout, and stderr verbatim.
`isWaitTimeout()` in `coordinate.mjs` currently matches a structured `error.code` containing
`timeout`/`timed_out`, falling back to `timed out` text. Fix its patterns to what the CLI
actually prints — if a timeout is indistinguishable from a failed submit, the unconfirmed-vs-
failed split needs a different signal entirely.

## 6. Long and multi-line payloads

Send a multi-line message and a >1500-character message. Expect bracketed paste to deliver them
intact — the 1024-character head-truncation was a paste-race artifact of the keystroke path. If
truncation still occurs, the compact-sends rule in SKILL.md stays regardless of transport.

## 7. User draft preservation

Type text into the target composer without submitting, then send probe 4. Record whether the
draft survives. If it does, the composer-stomping rationale for suppressing chatter toward
user-facing panes (Transport Reliability rule 8) weakens to an attention concern only.

## 8. End-to-end through the audited wrapper

```
HERDR_SHEPHERD_TRANSPORT=agent-prompt
```

then run a normal audited send through `coordinate.mjs --stdin`. Expect the usual
`coordination-wrapper:` line, a `coordination-delivery: confirmed` verdict against an idle
target, and the audit viewer showing the event as before. The hook, validation, and audit flow
are transport-independent and should need no change.

## After verification

- Correct `isWaitTimeout()` and the default `promptWaitTimeoutMs` (5000) to observed behavior.
- Flip the default transport in `resolveTransport()` to `agent-prompt`.
- Prune the keystroke-era rules from SKILL.md, CLAUDE.md, and AGENTS.md in the same change
  (the three are required to stay in sync): head-truncation, multi-part numbering, the
  stuck-Enter 20-second resend rule, and the resend-duplicate hazard all exist downstream of
  the composer race. Delivery-verdict semantics, durable-record routing, and git verification
  survive — they are about coordination, not transport.
- Only then consider removing the keystroke path itself; keep it while any supported Herdr
  version lacks `agent prompt`.
