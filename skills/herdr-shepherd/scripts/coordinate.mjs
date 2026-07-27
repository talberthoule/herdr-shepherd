import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateCoordinationRequest } from './core.mjs';

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

// A target that is mid-turn is already "working", so a send to it cannot be
// distinguished from one that stuck in the composer. Only an idle target that
// starts working proves the Enter submitted.
const ACTIVE_STATUS = new Set(['working', 'busy', 'running']);

export const DELIVERY_MARKER = 'coordination-delivery';

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

async function main() {
  if (!process.argv.includes('--stdin')) throw new Error('use --stdin with a JSON coordination request');
  const request = JSON.parse(await stdin());
  const result = await executeCoordinationRequest(request);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

if (process.argv[1] && basename(process.argv[1]) === basename(fileURLToPath(import.meta.url))) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
