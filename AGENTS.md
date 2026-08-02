# Agent Guidance

This file mirrors the Stacking Work Across Lanes, Merge Train Coordination, Agent Status as a Coordination Signal, Coordination Transport Reliability, Routing Substance and Pointers, and Durable Record Setup workflows from [skills/herdr-shepherd/SKILL.md](skills/herdr-shepherd/SKILL.md) so they are visible to any agent working in this repository. Keep AGENTS.md, CLAUDE.md, and SKILL.md in sync when editing them.

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

## Agent Status as a Coordination Signal

Herdr reports a status per agent, visible in `herdr api snapshot` and `herdr agent get <id>`. It is derived by matching detection rules against the pane's rendered screen, not reported by the agent, so `herdr agent explain <id> --json` — which names the rule that matched, the screen region behind it, and the manifest version used — is the tool for questioning a status you do not believe.

| Status | Means | Use it for |
|---|---|---|
| `working` | Mid-turn | An active writer: read its plan before touching shared files, and expect a send to queue behind the running turn. |
| `idle` | Awaiting input with a live composer | The only state a delivery verdict can be confirmed from, and the safe handoff candidate. |
| `blocked` | Waiting on a human at a prompt or modal | Never send; surface it to the user. |
| `done` | Finished a turn and wants attention | A UI attention state, not a lifecycle state. |
| `unknown` | No agent detected, or detection failed | Ambiguous by construction; read the pane instead. |

Four properties decide how far to trust it:

1. `idle`, `working`, `blocked`, and `unknown` are waitable; `done` is not. `herdr agent wait <id> --status done` is refused with "done is a UI attention state; use idle for CLI agent completion waits". Herdr's `done` also has nothing to do with a tracker's Done column — an agent that finished one turn is not a lane that passed review, and the merge train's Done rule is unaffected by it.
2. Detection is screen-scraped against a versioned, remotely-updated manifest, so status semantics can drift when that manifest or the agent's own UI changes. An agent that must be trusted rather than guessed at can self-report with `pane report-agent`.
3. `unknown` is overloaded: a pane running no recognized agent and a pane whose detection failed report identically. Never read it as idle, and never send to it on the assumption it is.
4. Status says *whether* an agent is running a turn, never *what* it is running. It orders your reads; it never establishes overlap. Read the plan.

### Sweep for blocked panes on every coordination wake

A `blocked` lane is stalled on a human and stays invisible until somebody looks, and you cannot rescue it with a message: a send answers its pending prompt with the default option and discards your text. On each coordination wake, snapshot and surface every blocked pane in the same repo or effort to the user, with its pane ID and what it is asking. Escalation is the entire remedy — there is no coordination move that clears it.

### Check the composer before sending

A send merges with whatever sits unsubmitted in the target's composer and force-submits both as one message, turning a half-typed human thought into a prompt nobody chose to send. The audited wrapper checks for that before every send, on both origins, and refuses when it finds a draft; `HERDR_SHEPHERD_ALLOW_DIRTY_COMPOSER=1` overrides it, and is only for a merge the user has accepted.

How well the check sees depends on the target's detection manifest, and the difference matters:

- **Claude panes are fully readable.** `agent explain <id> --json` exposes the composer as the `prompt_box_body` region preview whatever state won detection, so it reads from a working pane too. An empty composer previews as the bare prompt glyph; anything else is a draft.
- **Other agents are readable in one direction only.** Codex's manifest has no prompt box — it evaluates `osc_title`, `after_last_prompt_marker`, `whole_recent`, and `bottom_non_empty_lines(3)` — so the fallback is the `tab to queue message` hint, which a TUI renders only while text waits unsubmitted. That proves a dirty composer but can never prove a clean one: an empty composer and an unreadable one look identical.

A send the check could not read carries `coordination-composer: unchecked` in its output and audit entry. Read that as *this send went out unguarded*, not as a clean composer — and never as grounds for a blind resend, which is the move that appends a duplicate to a composer already holding your last message.

## Coordination Transport Reliability

A send submits the message into the target agent's session in one atomic `pane run` call — text plus Enter together, honoring the pane's bracketed-paste mode — and the wrapper derives a delivery verdict from the target's status stream. Multi-line and long payloads arrive intact on this transport; what stays uncertain is the target's state, not the typing. Field-tested rules:

1. The wrapper submits the `message` field verbatim. Never put a placeholder there; `args` must mirror `message` exactly. Keep sends compact regardless of transport: write substance to the durable record first and send the pointer.
2. The wrapper probes the target's status before the send and resolves the verdict event-driven afterward, recording it in the audit trail so delivery is assessed even when nobody checks. `confirmed` means an idle target started working, which is the only state that proves the submit landed. `queued` means the target was already working; the message queued behind the running turn, so pane read later to confirm it surfaced. `unconfirmed` means the target did not start within the wait window — pane read before resending. `unknown` means the probe itself failed. Only `confirmed` may be treated as delivered.
3. Never send to a `blocked` target, and do not work around the wrapper's refusal: verified live, the submit's Enter answers the pane's pending prompt with its default option and the message text is discarded — the send silently takes a decision on the user's behalf. Resolve the prompt first; deliberate modal interaction is explicit `send-keys`, never a message send.
4. A send merges with an unsubmitted composer draft and force-submits both as one message. Pane read shows the composer line, so check it before sending to a user-facing pane, and suppress unsolicited routine chatter toward user-facing coordinator panes — lanes volunteer only substantive events (branch- or patch-ready with sha, verdicts, blockers, decision questions).
5. A message explicitly marked ACK-requested still requires a compact ACK: a `queued` verdict cannot distinguish delivered from still-pending, and silence proves nothing. The sender owns delivery recovery — verdict first, then pane read, then resend — so a human pressing Enter is never the fallback. Broadcast protocol changes with an explicit do-not-acknowledge marker so the change itself does not trigger an ACK storm.
6. Pane read is ground truth; ACKs arrive out of order and go stale. When correcting a mis-assignment, make the corrective message the last word in every affected queue, then verify convergence by pane read, not ACK.
7. Verify claimed branches and commits in git before acting on any branch-ready claim.
8. Do not reply to ACKs of ACKs.
9. An ACK proves the recipient holds the content, not that your send delivered it: a capable recipient may pull the content by pane read before your message surfaces. Once the recipient has already acted on the content, do not resend after an `unconfirmed` verdict — the second submit starts a duplicate turn over work already done. Pane read first.
10. Do not shell a bare `agent wait` and trust `--timeout`; the flag is ignored on 0.7.2-preview and the command blocks until the state arrives. The wrapper bounds its own delivery wait with a watchdog — bound yours the same way.
11. Legacy keystroke transport only (`HERDR_SHEPHERD_TRANSPORT=keystrokes`, typed text plus a delayed Enter): the send races the target composer. A long send that loses the race arrives with its first 1024 characters dropped, so number multi-point sends (part 1/2, part 2/2) and recover truncated text from the sender's session log; the typed Enter can be swallowed by TUI state, leaving the message stuck in the composer — verify within about 20 seconds and resend, and sweep panes for stuck composers on each coordination wake. On that transport a stuck composer is indistinguishable from understood.

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
