---
name: herdr-shepherd
description: Use when a user references Herdr spaces, workspaces, tabs, panes, agents, paused work, handoffs, or duplicate effort; or when unexplained Git state suggests parallel work, such as an unexpected branch or HEAD, unfamiliar dirty files, files changing during inspection, a shared worktree, or another active tool or agent.
---

# Herdr Shepherd

## Overview

Treat Herdr as shared working context. Inspect relevant tabs before searching elsewhere or repeating work; coordinate proactively when an existing agent can prevent duplication or unblock a handoff.

## Suspected Parallel Work

Run a silent Herdr check when at least one concrete signal suggests another writer: an unexpected branch or `HEAD`, unfamiliar changes that may overlap the task, a file changing during inspection, or explicit evidence of another active tool, agent, or shared worktree. A dirty tree by itself, expected user edits, and unrelated generated files are not enough.

1. Snapshot Herdr and narrow candidates to panes whose cwd or worktree belongs to the same repository.
2. Read likely owners' actual plans before inferring overlap from tab labels or filenames.
3. If no same-repository ownership or task overlap appears, continue silently without messaging.
4. If target-file overlap is confirmed or ownership remains unclear, coordinate before editing or mutating Git state.

## Workflow

1. Run `herdr api snapshot` immediately.
2. Identify relevant workspace, tab, pane, and agent IDs from labels and status.
3. Read likely panes with `herdr pane read <pane-id> --source recent-unwrapped`. Read more than one when ownership is unclear.
4. Continue the work locally when no handoff is needed — but if the repo's working tree is shared, first confirm you may hold it (see Shared Git Working Trees).
5. Send a proactive message when an existing relevant agent owns paused work, has context worth preserving, or should avoid duplicating current work.

Read-only inspection is silent: it creates no audit entry and opens no viewer.

## Herdr Instance vs Subagent

Default to a subagent for helper work that is parent-owned and disposable: read code, inspect logs, compare options, review a diff, summarize docs, or investigate a failing test. Use another Herdr instance in the same space when the work needs a durable lane: it may edit files, run a dev server, hold browser or app state, use a separate worktree, continue after the parent moves on, receive user input directly, or preserve context from paused work.

Prefer an existing Herdr instance over a fresh subagent when it already owns relevant context, files, processes, or a plan. Do not split at all when the task is small, tightly coupled, or cheaper to finish inline than coordinate.

Runtime capability changes the default. An agent running Claude has first-class subagents and is encouraged to use them while coordinating completion of its tasks. Codex and other runtimes should refrain from launching sub-agents unless no other Herdr tab is open to coordinate with.

| Situation | Use |
|---|---|
| Quick read-only investigation | Subagent |
| Independent code review | Subagent |
| Summarize logs, docs, or issues | Subagent |
| Existing pane already owns the work | Same Herdr instance |
| Parallel file edits | Herdr instance with isolated worktree |
| Needs dev server, browser, or live app state | Herdr instance |
| Long-running or pausable work | Herdr instance |
| Cross-runtime coordination, e.g. Codex + Claude | Herdr instance |
| Small local change | Neither |

## Capability-Aware Helper Handoffs

When the current session lacks a capability such as Browser, Computer Use, or freshly installed software, do not stop at the local boundary. Snapshot Herdr, read likely helper panes, and ask an existing helper to confirm both capability and idle/disposable status before delegating.

Prefer an already-capable helper. If a helper needs install or restart, use only a pane the user explicitly authorizes as disposable, keep the coordinating pane alive, and run lifecycle operations through the audited wrapper with `origin: user-directed`. Never restart the coordinating pane or any pane with active, uncommitted, or irreplaceable work.

After restart, confirm the fresh helper exposes the capability before handing it the original task. Treat a sent prompt as queued work, not proof of execution: wait for pane status or returned evidence, then bring the result and ownership back to the coordinator.

## Shared Git Working Trees

Agents in the same repo usually share ONE git working tree. Git state is therefore a coordination surface, not private scratch space:

- `HEAD` can move mid-session — a branch you did not create can appear between two of your own tool calls.
- `git status` can show another agent's uncommitted edits.
- Any `checkout`, `checkout -b`, `merge`, or `stash` sweeps their in-flight work onto your branch.

Before your first git mutation or file edit, snapshot, then read `git branch --show-current` and `git status --short`. If another agent holds the tree, either **take an isolated worktree** (`git worktree add <path outside the repo and outside any synced folder> -b <branch> main`) or **take a lane that never touches the tree** (review, docs, issue-tracker hygiene).

Three corollaries that are easy to get wrong:

- **Never park on `main` in a worktree.** Git forbids the same branch in two worktrees, so holding `main` silently blocks the tree-holder's `git checkout main; git merge --ff-only <branch>` at merge time. You break the merge step for everyone else without touching a file.
- **Review needs no checkout.** `git diff main...<branch>`, `git show <rev>:<path>`, and `git log` fully review a pushed branch read-only — which is exactly what makes a reviewer lane safe to run alongside a coding agent.
- **Never put a worktree inside a cloud-synced folder.** OneDrive, Dropbox, and iCloud rewrite metadata and dehydrate files underneath git, which destroys the `.git` pointer file linking a worktree to its parent repo. Outside the repo is not enough; it must be outside the sync root. Use a local path such as `C:/work/<repo>/<lane>`.

A worktree broken this way is silent and looks healthy. The directory is still there, `git worktree list` may still list it, and only the operations fail: `git -C <path> status` errors, `git worktree remove` refuses with "not a working tree", and `git worktree prune` quietly drops the registration while leaving the directory behind. Anything uncommitted in it is unrecoverable, because git no longer has a handle on it. One repository lost every worktree it had this way, twice within an hour, and survived only because each lane had already been merged. Commit early on a worktree lane; an uncommitted checkout there is not durable storage.

Two unrelated faults produce look-alike symptoms, and treating the second as the first destroys a healthy worktree:

| Symptom | Cause | Fix |
|---|---|---|
| `.git` file missing; `git -C <path> status` errors; remove says "not a working tree" | sync client destroyed the pointer file | prune the registration, recreate the lane outside the sync root |
| `.git` intact; move, remove, or delete fails with "Permission denied" or "Device or resource busy" | a shell still has the directory as its working directory | leave the directory and retry; the worktree is fine |

The second is self-inflicted and common, because inspecting a worktree means entering it and agent shells persist their working directory between calls — so the process holding the lock is usually your own. Confirm the `.git` file is actually missing before concluding the sync client is at fault.

Also check whether the project's containers/toolchain bind the *main* checkout; if they do, a worktree cannot run the stack, and it suits docs/review/analysis rather than code that needs integration testing.

## Stacking Work Across Lanes

When one effort fans out into multiple lanes, stack git state, not processes. A lane is a branch plus a tracker issue, not a running pane: at any moment only a pane or two should be executing, while every other lane exists as a committed branch any agent can resume.

1. Commit every checkpoint on the lane's own branch. An uncommitted worktree can be resumed only by re-entering that exact worktree; a committed branch can be rebased, stacked on, reviewed, or deleted from anywhere.
2. Keep stacks shallow: review and merge the foundation branch early, then base new lanes on the default branch. Branch B off feature branch A only when B genuinely needs A's code before A can merge.
3. Independent work always branches from the default branch, never from a sibling feature branch, so an abandoned direction costs exactly one branch. When a base moves, restack dependents with `git rebase --update-refs`.
4. A lane gets a running process — dev server, compose stack, benchmark container — only while actively needed. Pause a lane by committing and stopping its processes; a dormant worktree costs nothing. Keep runtime/integration testing centralized in the one checkout the toolchain binds.
5. Record stack order and merge sequence in the shared tracker (for example Linear blocked-by relations), never only in pane scrollback, so the merge plan survives context loss on every pane.
6. Decide direction with a cheap plan or spec artifact before fanning out implementation lanes; fanning out first and choosing direction second is the most expensive way to learn the direction was wrong.

## Merge Train Coordination

When multiple lanes converge on one default branch, run the merge as a train with a single integrator:

1. One integrator pane owns default-branch merges, the tracker status table, and branch-name assignment. Lanes never touch the default branch or remotes, nothing is marked Done before independent review plus merge plus gates, and the integrator corrects premature Done.
2. Run a standing read-only review lane with a strict queue in which reviews preempt the reviewer's own implementation lane. In the verdict loop, BLOCK sends fixes to the owning lane on the same frozen branch and the new sha is re-reviewed. A reviewer never reviews its own branch — the integrator covers that.
3. After every merge, re-run all gates and broadcast the moved default branch with its new sha to in-flight lanes so they rebase or branch from the current tip.
4. When the user delegates pane confirmations, ration them: approve autonomously anything in-lane — a design consistent with the tracked issue, read-only inspection, test runs, commits on the lane's own branch, tracker updates. Always escalate remote pushes, default-branch mutations, data deletion, credentials or secrets, visibility changes, and scope expansion.
5. Independent review is load-bearing, not ceremony: in one nine-lane train, 4 of 5 first-round reviews returned real blockers that lane-local green tests missed — zero-based test clocks versus production monotonic time, mocked lifecycles hiding races, best-effort rollback, and false-success reporting.

## Overlapping Loops

Long-running loops are the main source of duplicated effort, and **labels lie** — two differently-named loops can be near-identical in scope. Read the other agent's pane for its *plan or todo list*, not just the files it has touched. If its plan already covers your task, do not race it: stand down to a non-conflicting lane and say so, recording the split in the shared tracker (Linear/Jira/etc.) so it survives context loss on both sides.

## Mutation Boundary

Proactive coordination may only request `herdr agent send` for an existing agent. The audited wrapper prefixes the source tab/pane, types the message, and sends Enter after a short delay, so report it as sent; a later status read is still required before claiming the agent resumed. Do not proactively start agents, run other pane commands, focus UI, close panes, rename items, or alter layout.

A direct user request may authorize broader Herdr actions. Mark those `user-directed`; they remain audited but do not auto-open the viewer.

Every mutation must use the audited wrapper. Read [references/command-policy.md](references/command-policy.md) before the first mutation in a turn. Raw Herdr mutations are denied by the profile hook.

## Coordination Transport Reliability

A send is keystrokes typed into the target composer plus a delayed Enter, so delivery races the target pane's input state. The race is lost most often when the target is busy — mid-turn, clearing its conversation, or sitting in an unfocused workspace. Field-tested rules:

1. The wrapper types the `message` field verbatim. Never put a placeholder there; `args` must mirror `message` exactly.
2. Keep sends compact — well under 1000 characters including the source prefix. A long send that loses the composer race arrives with its first 1024 characters dropped, cut mid-word with the source prefix gone, and a short send that loses the same race can vanish outright. Put details in the shared tracker and reference issue or comment IDs instead of inlining them.
3. Number multi-point sends (part 1/2, part 2/2) so truncation is detectable. On receiving a truncated part, recover the full text from the sender's session log before acting, and say so in the ACK.
4. The typed Enter can be swallowed by the target pane's TUI state (a modal or paused prompt), leaving the message stuck in the composer. After every send, verify within about 20 seconds that the target flips to working or shows the text processing; if not, re-send — the fresh Enter submits the stuck composer. Sweep panes for stuck composers on each coordination wake.
5. Pane read is ground truth; ACKs arrive out of order and go stale. When correcting a mis-assignment, make the corrective message the last word in every affected queue, then verify convergence by pane read, not ACK.
6. Verify claimed branches and commits in git before acting on any branch-ready claim.
7. Do not reply to ACKs of ACKs.
8. Inbound sends stomp any in-progress typing in the target composer, including the user's, so suppress unsolicited routine chatter toward user-facing coordinator panes — lanes volunteer only substantive events (branch- or patch-ready with sha, verdicts, blockers, decision questions). A message explicitly marked ACK-requested still requires a compact ACK: silence cannot prove delivery, because a stuck composer is indistinguishable from understood. The sender owns delivery recovery — wait about 20 seconds, then pane read, then resend — so a human pressing Enter is never the fallback. Broadcast protocol changes with an explicit do-not-acknowledge marker so the change itself does not trigger an ACK storm.
9. The wrapper probes the target's agent status before and shortly after each send and records the verdict in the audit trail, so delivery is assessed even when nobody checks. `confirmed` means an idle target started working, which is the only state that proves the Enter submitted. `unconfirmed` means an idle target stayed idle — suspect a stuck composer, pane read and resend. `queued` means the target was already working, so a real delivery and a stuck composer are indistinguishable; pane read later rather than resending blind. `unknown` means the probe itself failed. Only `confirmed` may be treated as delivered.
10. An ACK proves the recipient holds the content, not that your send delivered it. A capable recipient may pull the content by pane read while your message sits unsubmitted in its composer, so an ACK can arrive from a send that never landed. Confirm submission by pane read: text still visible in the composer, or a queue hint such as `tab to queue message`, means unsubmitted. Once the recipient has already acted on the content, do not resend to flush its stuck composer — the fresh Enter submits a duplicate of work already done. Have the user clear it instead.

## Routing Substance and Pointers

Sends are lossy, so never make a send the only carrier of anything that matters. Write substance to a durable record first, then send a pointer to it. A dropped, truncated, or unsubmitted send then costs a delay instead of the content.

Route by how long the content needs to survive:

| Tier | Content | Channel |
|---|---|---|
| Durable | Findings, verdicts, decisions and their rationale, blockers, plans, declined alternatives, status | Durable record (tracker issue, or the fallback in Durable Record Setup) |
| Pointer | "ALP-135 updated, review comment added, needs your call on the drain deadline" | `agent send`, referencing the record ID |
| Ephemeral | ACKs, liveness, lane claims, standing down | Pane read or `agent send`; never the durable record |

Do not route everything to the durable record. Trackers do not push to a terminal agent, so a tracker round trip is far too slow for a collision warning; an issue whose thread is forty ACKs destroys the signal the record exists to carry; and most coordination — capability checks, lane claims, "are you idle" — has no issue to attach to.

Pane read is the only channel that cannot be dropped, because it is a pull. It complements the pointer send; it does not replace it.

### Attribution in the durable record

Most trackers are reached through one shared credential, so every agent's issue and comment is authored by the human who owns the token. The tracker's own author field cannot tell two agents apart. Attribution must therefore be written into the body:

```text
Requested by: <runtime> (<pane>) - <role>
Performed by: <runtime> (<pane>) - <role>
Date: <ISO date>
Scope: <what this agent was and was not allowed to do>
```

Pane IDs are slot identifiers and get reused, so `w2:pJ` means nothing weeks later. The role is the durable half — "spec owner" and "independent reviewer" still parse after the panes are gone. Record the pane as a dated breadcrumb, not as identity.

## Durable Record Setup

When a repository has no durable record bound yet, establish one before relying on pointer sends. Do not silently invent a location, and do not fall back to pane scrollback.

1. **Check what is already reachable** before proposing anything: a connected tracker MCP server or CLI, a GitHub remote with `gh` authenticated, or neither. Never offer a tracker whose capability you have not confirmed in this session.
2. **Offer the ranked options with a recommendation**, and let the user choose:
   - An issue tracker already connected in this session (Linear, Jira, GitHub Issues, Asana) — best, because it is searchable, threaded, and already authenticated.
   - GitHub Issues through `gh` on the repo's existing remote — no signup, works in any GitHub-backed repo.
   - Git-native: committed Markdown under a coordination directory on the default branch — always available, no external service, reviewable in the same diff as the code.
   - A shared file at a stable absolute path — last resort; durable only on one machine, so say so.
3. **Walk the signup and configuration** for the chosen option rather than handing over a link. Confirm the workspace or repository, create or identify the container (project, label, or directory), and confirm the naming convention for records.
4. **Prove it round-trips** before declaring it ready: write one probe record, read it back by ID, then delete or clearly mark the probe. An unverified binding is not a durable record.
5. **Record the binding where future agents will read it** — the repo's `CLAUDE.md` or `AGENTS.md`, naming the system, the exact container, and the ID format. This is what makes the choice survive context loss; a binding held only in one session is not configured.
6. **Report what was created**, including anything the user now owns externally (a new account, project, or label), so nothing external appears without their knowledge.

Treat missing credentials as a stop, not a workaround: ask the user to authenticate rather than downgrading to a less durable tier on their behalf.

## Receiving Coordination Messages

When a Herdr coordination message lands in your session, reply before doing substantial work so the sender knows it was actually seen. Keep it compact:

```text
ACK <event_id or source> - received; status: accepted|declined|needs-info
```

This acknowledgement is a coordination convention, not proof of transport delivery. If the message does not include an event id, acknowledge the visible source prefix and summarize what you accepted or need clarified.

## Example

After snapshot and pane-read show that `w2:p1` owns a paused installer build, run a single PowerShell command containing literal JSON:

```powershell
@'
{"origin":"proactive","action":"herdr.exec","args":["agent","send","w2:p1","Resume the official installer build and report blockers here."],"target":{"type":"agent","id":"w2:p1"},"reason":"Continue paused work without duplicating it","message":"Resume the official installer build and report blockers here."}
'@ | node "$HOME\.codex\skills\herdr-shepherd\scripts\coordinate.mjs" --stdin
```

On Linux, use the same literal JSON through a quoted heredoc:

```sh
node "$HOME/.codex/skills/herdr-shepherd/scripts/coordinate.mjs" --stdin <<'JSON'
{"origin":"proactive","action":"herdr.exec","args":["agent","send","w2:p1","Resume the official installer build and report blockers here."],"target":{"type":"agent","id":"w2:p1"},"reason":"Continue paused work without duplicating it","message":"Resume the official installer build and report blockers here."}
JSON
```

The hook records attempted and outcome events, redacts obvious secrets, and opens one loopback audit viewer tab per viewer process for proactive sends. The viewer defaults to the `succeeded` phase, which it displays as **sent**: the wrapper typed the message and pressed Enter, which is not proof the target submitted or read it. Treat the viewer as a record of what was attempted, and confirm delivery by pane read. Use **Viewed & close** to acknowledge; closing the tab alone leaves entries unseen and keeps the viewer process available for later updates.

## Quick Reference

| Need | Action |
|---|---|
| Discover other work | `herdr api snapshot` |
| Suspect parallel code changes | Match same-repo panes, read likely owners, message only for overlap |
| Recover pane context | `herdr pane read <id> --source recent-unwrapped` |
| Coordinate ownership | Audited `agent send` wrapper |
| Share findings, verdicts, or decisions | Write to the durable record, then send its ID |
| No durable record bound yet | Run Durable Record Setup before relying on pointer sends |
| Perform user-requested mutation | Audited wrapper with `origin: user-directed` |
| Inspect audit | Viewer opens one tab per viewer process after proactive sends, defaults to the `succeeded` phase shown as **sent** (typed, not confirmed delivered), shows newest events first, and supports deleting one action or all history |

## Common Mistakes

- Do not say another Herdr tab is inaccessible. Snapshot and read it.
- Do not search the repository, GitHub, or the web for paused Herdr work before inspecting Herdr.
- Do not repeat work merely because another agent is idle; read its pane and stage a handoff when relevant.
- Do not claim a submitted prompt started an agent turn until a later status read shows the agent working.
- Do not place credentials in coordination messages. The wrapper blocks obvious secrets.
- Do not put literal `Herdr <word>` prose inside unrelated shell command bodies; the hook scans complete command text and may classify it as a raw Herdr mutation. Reword or pass the text another way.
- Do not `checkout`, `checkout -b`, `merge`, or `stash` in a shared working tree before confirming who holds it — you will sweep another agent's uncommitted work onto your branch.
- Do not park on `main` in a worktree. It blocks the tree-holder's merge, and nothing tells you that you did it.
- Do not create a worktree inside a cloud-synced folder. The sync client breaks its `.git` pointer file, and uncommitted work in it becomes unrecoverable.
- Do not blame the sync client for a locked worktree. "Permission denied" or "Device or resource busy" almost always means a shell still has it as its working directory — usually your own, from an earlier inspection. Check whether `.git` is actually missing first.
- Do not read an empty `git -C <dir> status` as a clean worktree. On a broken worktree the command fails and prints nothing, so counting output lines scores it identical to clean. Check the command succeeded before trusting the result.
- Do not rely on a submitted `agent send` to stop an imminent collision. It is a queued message, not an interrupt. Escalate time-critical conflicts to the user.
- Do not inline long payloads in a send. A send that races a busy composer arrives head-truncated; keep sends compact, number multi-part sends, and verify delivery by pane read.
- Do not judge overlap by tab label. Read the other agent's plan; near-identical work often hides behind different names.
- Do not treat a dirty worktree alone as proof of parallel work.
- Do not treat an ACK as proof your send was submitted. The recipient may have pulled the content by pane read while your message sat unsubmitted.
- Do not resend to flush a stuck composer once the recipient has acted on the content; that submits a duplicate. Have the user clear it.
- Do not make a send the only carrier of a finding, verdict, or decision. Write it to the durable record first and send the ID.
- Do not route ACKs, liveness, or lane claims into the durable record; that noise destroys the signal the record exists to carry.
- Do not rely on a tracker's author field to identify an agent. One shared credential means every agent writes as the human; put attribution in the body.
- Do not invent a durable location when none is bound. Run Durable Record Setup and let the user choose.
