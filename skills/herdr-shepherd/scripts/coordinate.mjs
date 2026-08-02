import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultStateDir, listAuditEvents, redactOutboundText, validateCoordinationRequest } from './core.mjs';

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

// A target that is mid-turn is already "working", so a send to it cannot be
// distinguished from one that stuck in the composer. Only an idle target that
// starts working proves the Enter submitted.
const ACTIVE_STATUS = new Set(['working', 'busy', 'running']);

export const DELIVERY_MARKER = 'coordination-delivery';
export const COMPOSER_MARKER = 'coordination-composer';
export const WRAPPER_MARKER = 'coordination-wrapper';
// The hook writes its `attempted` event before the command runs, so a matching
// event must already exist by the time this process starts. Detection does not
// depend on this window at all - a hook that never ran writes nothing, ever - so
// the window is only a guard against an ancient attempt vouching for a new send.
// It is deliberately generous: the harness can wait on a user permission
// decision between the hook and the command, and a slow approval must not read
// as a missing audit. A stale vouch requires an identical origin, target, and
// message, which is close to harmless; a false refusal blocks coordination.
export const AUDIT_MATCH_WINDOW_MS = 900_000;

// Silence must mean exactly one thing: the wrapper never ran. Every run
// therefore names which wrapper ran and from where, so a stale path or a
// superseded plugin copy is visible in the tool result instead of reading as a
// quiet delivery.
export async function wrapperIdentity(scriptPath = fileURLToPath(import.meta.url)) {
  const root = dirname(dirname(dirname(dirname(scriptPath))));
  for (const manifest of ['.claude-plugin', '.codex-plugin']) {
    try {
      const { name, version } = JSON.parse(await readFile(join(root, manifest, 'plugin.json'), 'utf8'));
      if (name && version) return `${name} ${version} (${scriptPath})`;
    } catch { /* absent in a bare skill install; fall through to the unversioned form */ }
  }
  return `herdr-shepherd unknown-version (${scriptPath})`;
}

export function findAuditedAttempt(events, request, now = Date.now(), windowMs = AUDIT_MATCH_WINDOW_MS) {
  const { sha256 } = redactOutboundText(request.message || '');
  return events.find((event) => event.phase === 'attempted'
    && event.origin === request.origin
    && event.target?.id === request.target?.id
    && event.message_sha256 === sha256
    && Math.abs(now - Date.parse(event.occurred_at)) <= windowMs);
}

// An audit requirement that degrades to best-effort is indistinguishable from no
// audit at all, which is exactly how ten sends from one pane went unrecorded. If
// the hook did not run, refuse rather than send without a record.
export async function assertAudited(request, options = {}) {
  const environment = options.env || process.env;
  if (environment.HERDR_SHEPHERD_ALLOW_UNAUDITED === '1') return { audited: false, bypassed: true };
  const stateDir = options.stateDir || defaultStateDir(environment);
  const events = await listAuditEvents(stateDir);
  const match = findAuditedAttempt(events, request, options.now ?? Date.now(), options.auditWindowMs);
  if (match) return { audited: true, bypassed: false, sequence: match.sequence };
  throw new Error(
    `refusing to send unaudited: no "attempted" audit event for this request exists in ${stateDir}. `
    + 'The PreToolUse hook did not run, so this send would leave no record of who sent what. '
    + 'Confirm the herdr-shepherd plugin hooks are active in this session; a session whose hook '
    + 'loading failed audits nothing and gives no other warning. '
    + 'Set HERDR_SHEPHERD_ALLOW_UNAUDITED=1 to send anyway and accept an unaudited mutation.',
  );
}

function agentStatus(stdout) {
  try {
    return JSON.parse(stdout).result?.agent?.agent_status ?? null;
  } catch {
    return null;
  }
}

export function deliveryVerdict(before, after) {
  if (before === null || after === null) return 'unknown';
  if (ACTIVE_STATUS.has(before)) return 'queued';
  return ACTIVE_STATUS.has(after) ? 'confirmed' : 'unconfirmed';
}

// The control socket drops a probe intermittently, surfacing as a BrokenPipe
// exit rather than a CLI-level error. Reporting that as a missing target sends
// the caller hunting for a pane that is in fact live, so the two are separated:
// only the CLI's own agent_not_found is a settled answer about the target.
function probeFailureKind({ stderr }) {
  try {
    const code = JSON.parse(stderr).error?.code;
    if (code) return /_not_found$/.test(code) ? 'missing' : 'transport';
  } catch { /* not the structured CLI error; fall through to text matching */ }
  return /\bnot found\b/i.test(stderr) ? 'missing' : 'transport';
}

function probeDetail({ exitCode, stderr }) {
  const first = stderr.trim().split(/\r?\n/)[0];
  return first ? first.slice(0, 200) : `exit code ${exitCode} with no diagnostics`;
}

// pane-run is the live-verified default on Herdr 0.7.2-preview: one `pane run`
// call submits text plus Enter atomically (verified: no composer race,
// multi-line >1500-char payloads intact, busy targets queue cleanly - see
// docs/agent-prompt-live-verification.md). keystrokes is the legacy typed
// text + delayed Enter path, kept as an opt-in fallback. agent-prompt targets
// the newer CLI documented upstream that folds submit and delivery-wait into
// one request; it does not exist in 0.7.2-preview.
const TRANSPORTS = new Set(['keystrokes', 'pane-run', 'agent-prompt']);

function resolveTransport(options, env) {
  const transport = options.transport || env.HERDR_SHEPHERD_TRANSPORT || 'pane-run';
  if (!TRANSPORTS.has(transport)) {
    throw new Error(`unknown coordination transport: ${transport} (expected keystrokes or agent-prompt)`);
  }
  return transport;
}

// Verified live: `agent explain --json` reports the target's composer as the
// `prompt_box_body` region preview, and reports it whatever state won the
// detection race - so the draft is readable from a working pane too, not only
// an idle one. An empty composer previews as the bare prompt glyph.
const PROMPT_BOX_REGION = 'prompt_box_body';
const PROMPT_GLYPH = /^[\s ]*[❯>][\s ]*/u;

// Verified live: only Claude's manifest exposes a prompt_box_body region.
// Codex evaluates osc_title, after_last_prompt_marker, whole_recent, and
// bottom_non_empty_lines(3) instead, so a region-only check silently skips
// every non-Claude pane - which is worse than no check, because it reports a
// composer it never read as clean. The queue hint is the agent-agnostic
// fallback: a TUI renders it only while text sits unsubmitted in the composer.
const QUEUE_HINT = /\btab to queue message\b/i;

// Reports whether the composer could be read at all, separately from what it
// held. An unreadable composer must never be reported as a clean one.
export function composerState(stdout) {
  let parsed;
  try { parsed = JSON.parse(stdout); } catch { return { checked: false, draft: null }; }
  const rules = Array.isArray(parsed.evaluated_rules) ? parsed.evaluated_rules : [];
  const box = rules.find((rule) => rule?.region === PROMPT_BOX_REGION)?.evidence?.region_preview;
  if (typeof box === 'string') return { checked: true, draft: box.replace(PROMPT_GLYPH, '').trim() || null };
  const previews = rules.map((rule) => rule?.evidence?.region_preview).filter((preview) => typeof preview === 'string');
  if (previews.some((preview) => QUEUE_HINT.test(preview))) {
    return { checked: true, draft: 'an unsubmitted message (queue hint visible)' };
  }
  return { checked: false, draft: null };
}

export function composerDraft(stdout) {
  return composerState(stdout).draft;
}

// Assumption pending live verification: a `--wait` that expires exits nonzero
// with a timeout diagnostic while the prompt itself has already submitted.
// Both the structured code and the text fallback are asserted only against
// fake-herdr; the live checklist records what the real CLI prints.
function isWaitTimeout({ stderr }) {
  try {
    const code = JSON.parse(stderr).error?.code;
    if (code) return /timeout|timed_out/.test(code);
  } catch { /* not the structured CLI error; fall through to text matching */ }
  return /\btimed?[ _-]?out\b/i.test(stderr);
}

// A transport fault is worth one more try; a missing target never is.
async function probeAgent(probe, options = {}) {
  const attempts = Math.max(1, options.probeAttempts ?? 2);
  let result;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    result = await probe();
    if (result.exitCode === 0) return { result, failure: null };
    if (probeFailureKind(result) === 'missing') return { result, failure: 'missing' };
    if (attempt < attempts) await wait(options.probeRetryDelayMs ?? 150);
  }
  return { result, failure: 'transport' };
}

// timeoutMs is a wrapper-side watchdog: `agent wait --timeout` is not honored
// in Herdr 0.7.2-preview (verified live - the CLI blocks until the state
// arrives, hours past its flag), so a bounded wait must be enforced here.
function run(command, args, env, timeoutMs) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { env, windowsHide: true, ...(timeoutMs ? { timeout: timeoutMs } : {}) });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (exitCode, signal) => resolvePromise({
      exitCode: exitCode ?? 1,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
      timedOut: Boolean(signal && timeoutMs),
    }));
  });
}

export async function executeCoordinationRequest(request, options = {}) {
  validateCoordinationRequest(request);
  const command = options.command || process.env.HERDR_BIN || (process.platform === 'win32' ? 'herdr.exe' : 'herdr');
  const prefixArgs = options.prefixArgs || [];
  const env = options.env || process.env;
  const transport = resolveTransport(options, env);
  let statusBefore = null;
  // Tracked separately from statusBefore: an unparseable probe is still a probe,
  // and must not trigger a second round trip.
  let probedBefore = false;
  if (request.origin === 'proactive') {
    const probe = () => run(command, [...prefixArgs, 'agent', 'get', request.target.id], env);
    const { result: check, failure } = await probeAgent(probe, options);
    if (failure === 'missing') throw new Error(`target agent does not exist: ${request.target.id}`);
    if (failure) {
      throw new Error(
        `could not reach Herdr to verify ${request.target.id}: ${probeDetail(check)}. `
        + 'This is a transport fault, not a missing target — the pane may well be live. '
        + `Confirm with \`herdr agent get ${request.target.id}\` and retry the send.`,
      );
    }
    statusBefore = agentStatus(check.stdout);
    probedBefore = true;
  }
  if (request.args[0] === 'agent' && request.args[1] === 'send') {
    const sourcePane = env.HERDR_PANE_ID;
    let sourceLabel;
    if (env.HERDR_TAB_ID) {
      const source = await run(command, [...prefixArgs, 'tab', 'get', env.HERDR_TAB_ID], env);
      try { sourceLabel = JSON.parse(source.stdout).result?.tab?.label; } catch { /* use pane id */ }
    }
    const source = sourceLabel ? `"${String(sourceLabel).replace(/\s+/g, ' ').trim()}" (${sourcePane})` : sourcePane || 'another session';
    const text = `[Herdr from ${source}] ${request.message}`;
    // Retried for the same reason as the proactive gate, but never fatal here:
    // an unresolved status degrades the verdict to unknown rather than blocking
    // a send the caller is already authorized to make.
    if (!probedBefore) {
      const before = await probeAgent(() => run(command, [...prefixArgs, 'agent', 'get', request.target.id], env), options);
      statusBefore = agentStatus(before.result.stdout);
    }
    // Verified live: a send into a blocked pane does not sit in the composer.
    // The typed Enter answers the pending prompt with its default option and
    // the message text is discarded - the send silently takes a decision on
    // the user's behalf. Refuse on every transport; deliberate modal
    // interaction must use explicit send-keys, never a message send.
    if (statusBefore === 'blocked') {
      throw new Error(
        `refusing to send: ${request.target.id} is blocked on user input. `
        + 'A send would answer its pending prompt with the default option and discard the message. '
        + 'Resolve the prompt (or have the user answer it), then resend.',
      );
    }
    // A send merges with an unsubmitted draft and force-submits both as one
    // message, so a half-typed human thought becomes a prompt nobody chose to
    // send. Only a positive reading refuses: an explain that fails or cannot be
    // parsed leaves the composer unknown, and a false refusal blocks
    // coordination for a hazard that may not be there.
    let composerNotice = '';
    if (env.HERDR_SHEPHERD_ALLOW_DIRTY_COMPOSER !== '1') {
      const explained = await run(command, [...prefixArgs, 'agent', 'explain', request.target.id, '--json'], env);
      const { checked, draft } = explained.exitCode === 0
        ? composerState(explained.stdout)
        : { checked: false, draft: null };
      // Silence would claim a clean composer the check never read. Say so
      // instead, so the operator knows this send went out unguarded.
      if (!checked) composerNotice = `${COMPOSER_MARKER}: unchecked (no readable composer region for ${request.target.id})\n`;
      if (draft) {
        const excerpt = draft.length > 80 ? `${draft.slice(0, 80)}…` : draft;
        throw new Error(
          `refusing to send: ${request.target.id} holds an unsubmitted composer draft (${excerpt}). `
          + 'A send would merge with it and force-submit both as one message. '
          + 'Have the draft submitted or cleared, or set HERDR_SHEPHERD_ALLOW_DIRTY_COMPOSER=1 '
          + 'once the user has accepted the merge.',
        );
      }
    }
    // Wrapped so the composer notice is attached once, at the single exit,
    // rather than at each transport's several returns.
    const submitViaTransport = async () => {
    if (transport === 'pane-run') {
      // One `pane run` call submits text plus Enter atomically, so there is no
      // composer race and no separate typed Enter. The delivery verdict is
      // event-driven: `agent wait --status working` resolves the moment the
      // target starts (or immediately if it already started), bounded by a
      // wrapper-side watchdog because the CLI flag is broken on this build.
      const submitted = await run(command, [...prefixArgs, 'pane', 'run', request.target.id, text], env);
      if (submitted.exitCode !== 0) return submitted;
      if (statusBefore === null || ACTIVE_STATUS.has(statusBefore)) {
        const verdict = statusBefore === null ? 'unknown' : 'queued';
        return { ...submitted, stdout: `${submitted.stdout}\n${DELIVERY_MARKER}: ${verdict}\n` };
      }
      const waited = await run(
        command, [...prefixArgs, 'agent', 'wait', request.target.id, '--status', 'working'],
        env, options.deliveryWaitTimeoutMs ?? 5000,
      );
      if (waited.exitCode === 0) {
        return { ...submitted, stdout: `${submitted.stdout}\n${DELIVERY_MARKER}: confirmed\n` };
      }
      // A short turn can start and finish inside the watchdog window, leaving
      // the wait hanging on a `working` that already passed. One status read
      // disambiguates the fresh-pane case: idle only reaches done by running
      // a turn. done-before to done-after stays honestly unconfirmed.
      const after = await probeAgent(() => run(command, [...prefixArgs, 'agent', 'get', request.target.id], env), options);
      const statusAfter = agentStatus(after.result.stdout);
      const verdict = ACTIVE_STATUS.has(statusAfter) || (statusBefore === 'idle' && statusAfter === 'done')
        ? 'confirmed' : 'unconfirmed';
      return { ...submitted, stdout: `${submitted.stdout}\n${DELIVERY_MARKER}: ${verdict}\n` };
    }
    if (transport === 'agent-prompt') {
      // One call submits text plus encoded Enter, so there is no composer race
      // and no typed-Enter follow-up. When the target started idle, `--wait
      // --until working` folds the delivery probe into the same request: the
      // server reports the idle->working transition itself, which also catches
      // a turn that starts and finishes faster than a fixed post-send probe.
      // A target already mid-turn gets no wait - it is already `working`, so
      // the wait would trivially pass without proving this prompt submitted;
      // that stays `queued`, same as the keystroke taxonomy.
      const idle = statusBefore !== null && !ACTIVE_STATUS.has(statusBefore);
      const waitArgs = idle
        ? ['--wait', '--until', 'working', '--timeout', String(options.promptWaitTimeoutMs ?? 5000)]
        : [];
      const submitted = await run(command, [...prefixArgs, 'agent', 'prompt', request.target.id, text, ...waitArgs], env);
      if (submitted.exitCode !== 0) {
        // An expired wait is a delivery question, not a failed send: the prompt
        // submitted and the target did not start within the window. Anything
        // else is returned as the failure it is.
        if (!idle || !isWaitTimeout(submitted)) return submitted;
        return { ...submitted, exitCode: 0, stdout: `${submitted.stdout}\n${DELIVERY_MARKER}: unconfirmed\n` };
      }
      const verdict = statusBefore === null ? 'unknown' : (idle ? 'confirmed' : 'queued');
      return { ...submitted, stdout: `${submitted.stdout}\n${DELIVERY_MARKER}: ${verdict}\n` };
    }
    const typed = await run(command, [...prefixArgs, 'pane', 'send-text', request.target.id, text], env);
    if (typed.exitCode !== 0) return typed;
    // ponytail: fixed gap avoids Herdr/Codex's paste/Enter race; the agent-prompt
    // transport above is the replacement, opt-in until live-verified.
    await wait(options.inputDelayMs ?? 100);
    const submitted = await run(command, [...prefixArgs, 'pane', 'send-keys', request.target.id, 'enter'], env);
    if (submitted.exitCode !== 0) return submitted;
    // A send reports success once the keystrokes are delivered, which is not the
    // same as the target submitting them. Probe the status so the audit trail
    // records a delivery verdict instead of implying one.
    await wait(options.deliveryProbeDelayMs ?? 1500);
    const after = await probeAgent(() => run(command, [...prefixArgs, 'agent', 'get', request.target.id], env), options);
    const verdict = deliveryVerdict(statusBefore, agentStatus(after.result.stdout));
    return { ...submitted, stdout: `${submitted.stdout}\n${DELIVERY_MARKER}: ${verdict}\n` };
    };
    const sent = await submitViaTransport();
    return composerNotice ? { ...sent, stdout: `${composerNotice}${sent.stdout}` } : sent;
  }
  return run(command, [...prefixArgs, ...request.args], env);
}

async function stdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export async function runCli(options = {}) {
  const argv = options.argv || process.argv;
  if (!argv.includes('--stdin')) throw new Error('use --stdin with a JSON coordination request');
  // Validation first, so a malformed request reports the field it is missing
  // rather than an audit failure it cannot act on.
  const request = validateCoordinationRequest(JSON.parse(options.input ?? (await stdin())));
  const audit = await assertAudited(request, options);
  const result = await executeCoordinationRequest(request, options);
  const identity = `${WRAPPER_MARKER}: ${await wrapperIdentity()}${audit.bypassed ? ' audit=bypassed' : ''}`;
  return { ...result, stdout: `${identity}\n${result.stdout}` };
}

async function main() {
  const result = await runCli();
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

if (process.argv[1] && basename(process.argv[1]) === basename(fileURLToPath(import.meta.url))) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
