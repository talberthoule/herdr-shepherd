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
export const WRAPPER_MARKER = 'coordination-wrapper';
// The hook writes its `attempted` event before the command runs, so a matching
// event must already exist by the time this process starts. The window only has
// to cover hook execution, which includes a viewer launch on the proactive path.
export const AUDIT_MATCH_WINDOW_MS = 120_000;

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

function run(command, args, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { env, windowsHide: true });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (exitCode) => resolvePromise({
      exitCode: exitCode ?? 1,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
    }));
  });
}

export async function executeCoordinationRequest(request, options = {}) {
  validateCoordinationRequest(request);
  const command = options.command || process.env.HERDR_BIN || (process.platform === 'win32' ? 'herdr.exe' : 'herdr');
  const prefixArgs = options.prefixArgs || [];
  const env = options.env || process.env;
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
    const typed = await run(command, [...prefixArgs, 'pane', 'send-text', request.target.id, text], env);
    if (typed.exitCode !== 0) return typed;
    // ponytail: fixed gap avoids Herdr/Codex's paste/Enter race; remove when pane run submits reliably.
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
