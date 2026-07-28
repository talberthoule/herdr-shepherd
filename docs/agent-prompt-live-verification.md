# agent-prompt transport: live verification checklist

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
