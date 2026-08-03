---
name: herdr-shepherd
description: Use when work may be running in parallel with other agent sessions — a shared git working tree, an unexpected branch or HEAD, files changing during inspection, fanning one effort across lanes, merging several lanes into one branch, handoffs, paused work, or suspected duplicate effort. Also use when coordinating peer sessions through a multiplexer such as Herdr, including its spaces, workspaces, tabs, panes, and agents.
---

# Shepherd

Coordination doctrine for several agents working the same repository at once. It is about who owns what, how work is split and rejoined, and which claims can be trusted — not about driving any particular tool. Where a specific multiplexer is in play, that tool's own skill owns its mechanics; see Working With a Session Multiplexer.

Three terms are used throughout, deliberately tool-neutral:

- **Peer session** — another agent working the same repository: a second terminal, a multiplexer pane, a cloud agent. Anything that holds its own context and can act on its own.
- **Session read** — a pull-based read of a peer's transcript or screen. It is the only channel that cannot be dropped, because you fetch it rather than waiting for it.
- **Send** — pushing a message into a peer's input. Always lossy to some degree, which is why substance never travels this way alone.

## Suspected Parallel Work

Check for a peer when at least one concrete signal suggests another writer: an unexpected branch or `HEAD`, unfamiliar changes that may overlap the task, a file changing during inspection, or explicit evidence of another active tool, agent, or shared worktree. A dirty tree by itself, expected user edits, and unrelated generated files are not enough.

1. Enumerate peer sessions and narrow to those whose working directory or worktree belongs to the same repository.
2. Rank the candidates by liveness before spending reads: a peer mid-turn is an active writer and is read first, a peer blocked on human input is surfaced to the user rather than messaged, and an idle peer is the handoff candidate. Liveness orders the queue; it never settles overlap.
3. Read likely owners' actual plans before inferring overlap from labels or filenames.
4. If no same-repository ownership or task overlap appears, continue silently without messaging.
5. If target-file overlap is confirmed or ownership remains unclear, coordinate before editing or mutating git state.

Read-only inspection is silent: it costs the peer nothing and needs no announcement.

## Peer Session vs Subagent

Default to a subagent for helper work that is parent-owned and disposable: read code, inspect logs, compare options, review a diff, summarize docs, or investigate a failing test. Use a peer session when the work needs a durable lane: it may edit files, run a dev server, hold browser or app state, use a separate worktree, continue after the parent moves on, receive user input directly, or preserve context from paused work.

Prefer an existing peer session over a fresh subagent when it already owns relevant context, files, processes, or a plan. Do not split at all when the task is small, tightly coupled, or cheaper to finish inline than to coordinate.

Runtime capability changes the default. An agent running Claude has first-class subagents and is encouraged to use them while coordinating completion of its tasks. Codex and other runtimes should refrain from launching sub-agents unless no peer session is open to coordinate with.

| Situation | Use |
|---|---|
| Quick read-only investigation | Subagent |
| Independent code review | Subagent |
| Summarize logs, docs, or issues | Subagent |
| A peer already owns the work | That peer session |
| Parallel file edits | Peer session with an isolated worktree |
| Needs dev server, browser, or live app state | Peer session |
| Long-running or pausable work | Peer session |
| Cross-runtime coordination, e.g. Codex + Claude | Peer session |
| Small local change | Neither |

## Capability-Aware Helper Handoffs

When the current session lacks a capability such as Browser, Computer Use, or freshly installed software, do not stop at the local boundary. Enumerate peers, read likely helpers, and ask one to confirm both the capability and its idle/disposable status before delegating.

Prefer an already-capable helper. If a helper needs install or restart, use only a session the user explicitly authorizes as disposable, keep the coordinating session alive, and run lifecycle operations through whatever audited path the multiplexer integration provides. Never restart the coordinating session or any session with active, uncommitted, or irreplaceable work.

After restart, confirm the fresh helper exposes the capability before handing it the original task. Treat a sent prompt as queued work, not proof of execution: wait for liveness or returned evidence, then bring the result and ownership back to the coordinator.

## Shared Git Working Trees

Agents in the same repo usually share ONE git working tree. Git state is therefore a coordination surface, not private scratch space:

- `HEAD` can move mid-session — a branch you did not create can appear between two of your own tool calls.
- `git status` can show another agent's uncommitted edits.
- Any `checkout`, `checkout -b`, `merge`, or `stash` sweeps their in-flight work onto your branch.

Before your first git mutation or file edit, check for peers, then read `git branch --show-current` and `git status --short`. If another agent holds the tree, either **take an isolated worktree** (`git worktree add <path outside the repo and outside any synced folder> -b <branch> main`) or **take a lane that never touches the tree** (review, docs, issue-tracker hygiene).

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

When one effort fans out into multiple lanes, stack git state, not processes. A lane is a branch plus a tracker issue, not a running session: at any moment only a session or two should be executing, while every other lane exists as a committed branch any agent can resume.

1. Commit every checkpoint on the lane's own branch. An uncommitted worktree can be resumed only by re-entering that exact worktree; a committed branch can be rebased, stacked on, reviewed, or deleted from anywhere.
2. Keep stacks shallow: review and merge the foundation branch early, then base new lanes on the default branch. Branch B off feature branch A only when B genuinely needs A's code before A can merge.
3. Independent work always branches from the default branch, never from a sibling feature branch, so an abandoned direction costs exactly one branch. When a base moves, restack dependents with `git rebase --update-refs`.
4. A lane gets a running process — dev server, compose stack, benchmark container — only while actively needed. Pause a lane by committing and stopping its processes; a dormant worktree costs nothing. Keep runtime/integration testing centralized in the one checkout the toolchain binds.
5. Record stack order and merge sequence in the shared tracker (for example Linear blocked-by relations), never only in a session's scrollback, so the merge plan survives context loss everywhere.
6. Decide direction with a cheap plan or spec artifact before fanning out implementation lanes; fanning out first and choosing direction second is the most expensive way to learn the direction was wrong.

## Merge Train Coordination

When multiple lanes converge on one default branch, run the merge as a train with a single integrator:

1. One integrator owns default-branch merges, the tracker status table, and branch-name assignment. Lanes never touch the default branch or remotes, nothing is marked Done before independent review plus merge plus gates, and the integrator corrects premature Done.
2. Run a standing read-only review lane with a strict queue in which reviews preempt the reviewer's own implementation lane. In the verdict loop, BLOCK sends fixes to the owning lane on the same frozen branch and the new sha is re-reviewed. A reviewer never reviews its own branch — the integrator covers that.
3. After every merge, re-run all gates and broadcast the moved default branch with its new sha to in-flight lanes so they rebase or branch from the current tip.
4. When the user delegates confirmations, ration them: approve autonomously anything in-lane — a design consistent with the tracked issue, read-only inspection, test runs, commits on the lane's own branch, tracker updates. Always escalate remote pushes, default-branch mutations, data deletion, credentials or secrets, visibility changes, and scope expansion.
5. Independent review is load-bearing, not ceremony: in one nine-lane train, 4 of 5 first-round reviews returned real blockers that lane-local green tests missed — zero-based test clocks versus production monotonic time, mocked lifecycles hiding races, best-effort rollback, and false-success reporting.

## Overlapping Loops

Long-running loops are the main source of duplicated effort, and **labels lie** — two differently-named loops can be near-identical in scope. Read the other agent's session for its *plan or todo list*, not just the files it has touched. If its plan already covers your task, do not race it: stand down to a non-conflicting lane and say so, recording the split in the shared tracker (Linear/Jira/etc.) so it survives context loss on both sides.

## Peer Liveness as a Coordination Signal

Most multiplexers report some liveness state per peer — working, idle, blocked, unknown. It is worth ranking reads by and worth refusing to send on, but four properties bound how far to trust it:

1. **Liveness says whether a peer is running a turn, never what it is running.** It orders your reads; it never establishes overlap. Read the plan.
2. **A peer blocked on human input is unreachable by message.** Escalate it to the user; do not try to coordinate around it. On some tools a send to a blocked peer does worse than fail — see the multiplexer's integration notes.
3. **"Unknown" is overloaded.** No agent present and detection failed usually report identically. Never read it as idle, and never send on the assumption that it is.
4. **Liveness is often inferred, not reported.** Where a tool derives it by inspecting a peer's screen, the semantics can drift when either the tool or the peer's UI changes. Prefer a self-reported state where the tool offers one.

### Sweep for blocked peers on every coordination wake

A blocked lane is stalled on a human and stays invisible until somebody looks. On each coordination wake, enumerate peers and surface every blocked one in the same repo or effort to the user, with its identifier and what it is asking. Escalation is the entire remedy — there is no coordination move that clears it.

### Check the input before sending

A send generally merges with whatever sits unsubmitted in the peer's input and submits both together, turning a half-typed human thought into a prompt nobody chose to send. Check before sending to any user-facing session, and suppress unsolicited routine chatter toward coordinator sessions a human is watching — lanes volunteer only substantive events: branch- or patch-ready with sha, verdicts, blockers, decision questions.

Where a tool can only detect a dirty input and never positively confirm a clean one, treat "could not tell" as *this send went out unguarded* — not as clean, and never as grounds for a blind resend, which is the move that appends a duplicate to an input already holding your last message.

## Coordination Transport Reliability

Sends are lossy. What is uncertain is rarely the typing; it is whether the peer received, surfaced, and acted on the message. Rules that hold regardless of transport:

1. Send the message verbatim, and keep it compact. Substance goes to the durable record first; the send carries the pointer.
2. **Establish a delivery verdict rather than assuming one.** Only positive evidence that the peer began a new turn counts as delivered. A peer that was already busy leaves delivery and non-delivery indistinguishable — read its session later rather than resending blind. A failed probe is unknown, not delivered.
3. **Never send to a peer blocked on human input.** Resolve the block first; deliberate interaction with a prompt is an explicit keystroke, never a message send.
4. A message explicitly marked ACK-requested still requires a compact ACK: silence proves nothing, and an ambiguous verdict cannot distinguish delivered from still-pending. The sender owns delivery recovery — verdict, then session read, then resend — so a human pressing Enter is never the fallback. Broadcast protocol changes with an explicit do-not-acknowledge marker so the change itself does not trigger an ACK storm.
5. Session read is ground truth; ACKs arrive out of order and go stale. When correcting a mis-assignment, make the corrective message the last word in every affected queue, then verify convergence by session read, not ACK.
6. Verify claimed branches and commits in git before acting on any branch-ready claim.
7. Do not reply to ACKs of ACKs.
8. An ACK proves the recipient holds the content, not that your send delivered it: a capable recipient may pull the content by session read before your message ever surfaces. Once the recipient has acted on the content, do not resend on an inconclusive verdict — the second submit starts a duplicate turn over work already done. Read first.
9. Bound every wait with your own watchdog. A tool's own timeout flag may be advisory or ignored, and a wait that blocks forever looks exactly like a peer that never responded.

## Routing Substance and Pointers

Sends are lossy, so never make a send the only carrier of anything that matters. Write substance to a durable record first, then send a pointer to it. A dropped, truncated, or unsubmitted send then costs a delay instead of the content.

Route by how long the content needs to survive:

| Tier | Content | Channel |
|---|---|---|
| Durable | Findings, verdicts, decisions and their rationale, blockers, plans, declined alternatives, status | Durable record (tracker issue, or the fallback in Durable Record Setup) |
| Pointer | "ALP-135 updated, review comment added, needs your call on the drain deadline" | A send, referencing the record ID |
| Ephemeral | ACKs, liveness, lane claims, standing down | Session read or a send; never the durable record |

Do not route everything to the durable record. Trackers do not push to a terminal agent, so a tracker round trip is far too slow for a collision warning; an issue whose thread is forty ACKs destroys the signal the record exists to carry; and most coordination — capability checks, lane claims, "are you idle" — has no issue to attach to.

A pull-based session read is the only channel that cannot be dropped. It complements the pointer send; it does not replace it.

### Attribution in the durable record

Most trackers are reached through one shared credential, so every agent's issue and comment is authored by the human who owns the token. The tracker's own author field cannot tell two agents apart. Attribution must therefore be written into the body:

```text
Requested by: <runtime> (<session>) - <role>
Performed by: <runtime> (<session>) - <role>
Date: <ISO date>
Scope: <what this agent was and was not allowed to do>
```

Session identifiers are slots and get reused, so `w2:pJ` means nothing weeks later. The role is the durable half — "spec owner" and "independent reviewer" still parse after the sessions are gone. Record the identifier as a dated breadcrumb, not as identity.

## Durable Record Setup

When a repository has no durable record bound yet, establish one before relying on pointer sends. Do not silently invent a location, and do not fall back to session scrollback.

1. **Check what is already reachable** before proposing anything: a connected tracker MCP server or CLI, a GitHub remote with `gh` authenticated, or neither. Never offer a tracker whose capability you have not confirmed in this session.
2. **Offer the ranked options with a recommendation**, and let the user choose:
   - An issue tracker already connected in this session (Linear, Jira, GitHub Issues, Asana) — best, because it is searchable, threaded, and already authenticated.
   - GitHub Issues through `gh` on the repo's existing remote — no signup, works in any GitHub-backed repo.
   - Git-native: committed Markdown under a coordination directory on the default branch — always available, no external service, reviewable in the same diff as the code.
   - A shared file at a stable absolute path — last resort; durable only on one machine, so say so.
3. **Walk the signup and configuration** for the chosen option rather than handing over a link. Confirm the workspace or repository, create or identify the container (project, label, or directory), and confirm the naming convention for records.
4. **Prove it round-trips** before declaring it ready: write one probe record, read it back by ID, then delete or clearly mark the probe. An unverified binding is not a durable record.
5. **Record the binding where future agents will read it** — a committed `.herdr-shepherd.json` at the repo root, naming the system, the exact container, and the ID format:

   ```json
   {"record": {"system": "linear", "container": "project Herdr (team Alpha)", "id_format": "ALP-<number>", "url": "https://linear.app/…"}}
   ```

   Committed, so it travels with the repo and survives context loss, and runtime-neutral, so a Codex session and a Claude session resolve the same binding. Where a project already keeps agent instructions in `CLAUDE.md` or `AGENTS.md`, a mirrored line there is welcome — but never require those files or create them for this purpose, because most projects do not use them and the binding must not depend on a convention the project has not adopted. A binding held only in one session is not configured.
6. **Report what was created**, including anything the user now owns externally (a new account, project, or label), so nothing external appears without their knowledge.

Treat missing credentials as a stop, not a workaround: ask the user to authenticate rather than downgrading to a less durable tier on their behalf.

## Receiving Coordination Messages

When a coordination message lands in your session, reply before doing substantial work so the sender knows it was actually seen. Keep it compact:

```text
ACK <event_id or source> - received; status: accepted|declined|needs-info
```

This acknowledgement is a coordination convention, not proof of transport delivery. If the message does not include an event id, acknowledge the visible source prefix and summarize what you accepted or need clarified.

## Working With a Session Multiplexer

This skill owns coordination policy. Driving a specific multiplexer — enumerating sessions, reading them, lifecycle, waits — belongs to that tool's own skill, and duplicating it here only creates a second copy to drift.

**Herdr.** When the work involves Herdr spaces, workspaces, tabs, panes, or agents:

1. **Check whether the native Herdr skill is available in this session** before relying on its commands. Do not guess at CLI syntax from memory.
2. **If it is missing, say so and offer to install it** from the Herdr repository, rather than improvising. It is the source of truth for Herdr's own mechanics.
3. **If the user declines, continue with reduced capability** and be explicit about which side of the line you are on. Everything in this skill that is about policy still applies — lane stacking, merge trains, worktree safety, durable records, routing, ACK discipline. What degrades is anything needing Herdr's CLI surface: enumerating peers, reading their sessions, and coordinated sends.

Shepherd ships its own Herdr-specific enforcement that the native skill does not cover — an audited mutation wrapper, delivery verdicts, and hazards its code refuses on outright. Read [references/herdr-integration.md](references/herdr-integration.md) before the first coordinated mutation in a Herdr session, and [references/command-policy.md](references/command-policy.md) for the request contract.

## Common Mistakes

- Do not treat a dirty worktree alone as proof of parallel work.
- Do not judge overlap by label. Read the other agent's plan; near-identical work often hides behind different names.
- Do not repeat work merely because a peer is idle; read its session and stage a handoff when relevant.
- Do not claim a submitted prompt started a peer's turn until positive evidence shows it working.
- Do not rely on a submitted send to stop an imminent collision. It is a queued message, not an interrupt. Escalate time-critical conflicts to the user.
- Do not send to a peer blocked on human input, and do not leave a blocked peer for someone else to notice. Surface it to the user on the coordination wake that found it; no message you can send will clear it.
- Do not send to a peer whose input holds an unsubmitted draft; the send merges with it and submits both.
- Do not read "unknown" liveness as idle. It means no agent was detected or that detection failed — different problems, and neither is safe to send to.
- Do not treat liveness as evidence of what a peer is working on. It orders your reads; only the plan settles overlap.
- Do not trust a tool's wait timeout without verifying it. Bound waits with your own watchdog.
- Do not place credentials in coordination messages.
- Do not `checkout`, `checkout -b`, `merge`, or `stash` in a shared working tree before confirming who holds it — you will sweep another agent's uncommitted work onto your branch.
- Do not park on `main` in a worktree. It blocks the tree-holder's merge, and nothing tells you that you did it.
- Do not create a worktree inside a cloud-synced folder. The sync client breaks its `.git` pointer file, and uncommitted work in it becomes unrecoverable.
- Do not blame the sync client for a locked worktree. "Permission denied" or "Device or resource busy" almost always means a shell still has it as its working directory — usually your own, from an earlier inspection. Check whether `.git` is actually missing first.
- Do not read an empty `git -C <dir> status` as a clean worktree. On a broken worktree the command fails and prints nothing, so counting output lines scores it identical to clean. Check the command succeeded before trusting the result.
- Do not treat an ACK as proof your send was submitted. The recipient may have pulled the content by session read while your message sat unsubmitted.
- Do not resend to flush a stuck input once the recipient has acted on the content; that submits a duplicate. Have the user clear it.
- Do not make a send the only carrier of a finding, verdict, or decision. Write it to the durable record first and send the ID.
- Do not route ACKs, liveness, or lane claims into the durable record; that noise destroys the signal the record exists to carry.
- Do not rely on a tracker's author field to identify an agent. One shared credential means every agent writes as the human; put attribution in the body.
- Do not invent a durable location when none is bound. Run Durable Record Setup and let the user choose.
- Do not improvise a multiplexer's CLI from memory when its own skill is unavailable. Ask for the skill, or say plainly which capabilities are degraded without it.
