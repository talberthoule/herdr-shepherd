# Claude Guidance

This file mirrors the Stacking Work Across Lanes, Merge Train Coordination, Coordination Transport Reliability, Routing Substance and Pointers, and Durable Record Setup workflows from [skills/coordinating-herdr-agents/SKILL.md](skills/coordinating-herdr-agents/SKILL.md) so they are visible to any agent working in this repository. Keep AGENTS.md, CLAUDE.md, and SKILL.md in sync when editing them.

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
9. An ACK proves the recipient holds the content, not that your send delivered it. A capable recipient may pull the content by pane read while your message sits unsubmitted in its composer, so an ACK can arrive from a send that never landed. Confirm submission by pane read: text still visible in the composer, or a queue hint such as `tab to queue message`, means unsubmitted. Once the recipient has already acted on the content, do not resend to flush its stuck composer — the fresh Enter submits a duplicate of work already done. Have the user clear it instead.

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
