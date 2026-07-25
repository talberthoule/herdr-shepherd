# Herdr Shepherd

Multiple agents can move faster than one agent, but only when they can see who owns each lane. Without that shared context, parallel work turns into duplicate edits, stale plans, hidden terminal state, and risky Git moves.

Herdr Shepherd is a Codex and Claude Code plugin for using Herdr as shared working context. It gives each session a local protocol for discovering active work, avoiding duplicate edits, choosing between inline work, helper subagents, and visible Herdr lanes, sending source-attributed handoffs, and reviewing a token-protected activity trail.

It is deliberately small: Herdr remains the coordination layer, and this project adds skill instructions plus audited hooks around the Herdr CLI.

## What, So What, Now What

| Question | Answer |
|---|---|
| What? | A coordination skill plus audited hooks for Codex and Claude Code sessions working inside Herdr. |
| So what? | Teams can add agent processing power without losing ownership, context, handoff traceability, or shared-worktree safety. |
| Now what? | Install the plugin, ask new sessions to use it before shared-repo work, and let the skill decide when to stay inline, use a subagent, or branch into another visible Herdr lane. |

## Install

The normal setup is two commands in the host CLI you already use.

Codex:

```sh
codex plugin marketplace add talberthoule/herdr-shepherd
codex plugin add herdr-shepherd@shepherd
```

Claude Code:

```sh
claude plugin marketplace add talberthoule/herdr-shepherd
claude plugin install herdr-shepherd@shepherd
```

Review and trust the installed hooks through the normal host prompt. The hooks are what block raw Herdr mutations and record audited coordination actions.

## First Use

Start a new agent session and ask it to use Herdr Shepherd before editing a shared repository. The skill will inspect Herdr first, read relevant panes, and only send an audited message when another session owns overlapping work or has context worth preserving.

It also helps decide when to keep work inline, when a short-lived subagent is enough, and when to branch into another visible Herdr lane for durable parallel work. That lets teams add processing power without losing ownership, context, or merge safety.

The local activity viewer opens one browser tab per viewer process for proactive handoffs. It defaults to successful submissions, shows the newest events first, can delete one complete coordination action, and has a `Delete all history` control for clearing local audit history.

## Use Cases

- discover active and paused work before starting a duplicate task;
- resume the correct session instead of opening a competing lane;
- choose when to stay inline, use a helper subagent, or expand into another coordinated lane;
- send source-attributed handoffs that include the originating tab and pane;
- divide feature, review, and investigation lanes across Codex and Claude Code;
- catch shared-worktree conflicts before checkout, merge, or stash moves another agent's work;
- inspect attempted, succeeded, and failed coordination actions in a local audit trail.

## Acknowledgements

For handoffs that require the receiving session to act, ask for a compact acknowledgement in the message:

```text
ACK <event_id> - received from <source>; status: accepted|declined|needs-info
```

This ACK is a human/agent convention, not a transport guarantee. The audit log still records whether the sender-side wrapper attempted and completed the Herdr send; the ACK confirms the target session actually saw and understood the handoff.

## Safety Boundary

Read-only Herdr inspection is allowed directly. Proactive mutations must use the audited wrapper and are limited to `herdr agent send` for an existing agent. User-directed mutations can be broader, but they are still audited.

The hook rejects raw Herdr mutations, blocks obvious secrets in outbound messages, prefixes sent messages with source attribution, and records attempted plus outcome events locally.

Audit state stays on your machine:

- Windows: `%LOCALAPPDATA%\Herdr\shepherd-audit`
- Linux: `${XDG_STATE_HOME:-$HOME/.local/state}/Herdr/shepherd-audit`
- Runtime override: `HERDR_SHEPHERD_STATE_DIR`

## Manual Install

Manual install is useful when plugin marketplaces are unavailable or when testing a local checkout.

Windows:

```powershell
git clone https://github.com/talberthoule/herdr-shepherd.git
cd herdr-shepherd
./install.ps1
```

Linux:

```sh
git clone https://github.com/talberthoule/herdr-shepherd.git
cd herdr-shepherd
./install.sh
```

The installers require Node.js and Herdr. They configure whichever supported hosts are present: Codex, Claude Code, or both.

## Requirements

- Node.js
- Herdr CLI
- Codex CLI or Claude Code
- PowerShell for `install.ps1`
- POSIX `/bin/sh` for `install.sh`

## Test

```sh
node --test --test-concurrency=1 tests/*.test.mjs
```

On Linux, also check the shell installers:

```sh
sh -n install.sh
sh -n uninstall.sh
```

## Troubleshooting

- If Codex hooks do not run, enable `hooks = true` under `[features]` in `~/.codex/config.toml`, then review hooks in a fresh Codex session.
- If Claude Code does not load the skill after manual install, restart Claude Code or reload plugins.
- Use `Viewed & close` when you want to stop the activity viewer. Closing the browser tab alone leaves the viewer process running, so later events update that viewer instead of opening another tab.
- If a hook blocks a command, rerun the action through the audited wrapper shown in the skill.
- If an unrelated shell command is blocked because inline prose contains `Herdr <word>`, reword that inline text or pass it another way; the hook scans complete shell command text.

## Uninstall

Windows:

```powershell
./uninstall.ps1
```

Linux:

```sh
./uninstall.sh
```

Use `-PurgeAuditHistory` on Windows or `--purge-audit-history` on Linux only when you also want to delete the local audit log.

## License

MIT
