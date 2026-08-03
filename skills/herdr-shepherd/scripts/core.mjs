import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, posix, win32 } from 'node:path';

const READ_COMMANDS = new Set([
  'agent explain', 'agent get', 'agent list', 'agent read', 'agent wait',
  'api schema', 'api snapshot', 'integration status',
  'pane current', 'pane edges', 'pane get', 'pane layout', 'pane list',
  'pane neighbor', 'pane process-info', 'pane read',
  'plugin list', 'session list', 'tab get', 'tab list',
  'workspace get', 'workspace list',
]);
const SECRET_PATTERNS = [
  // A leading [A-Za-z0-9_]* is required: `\b` cannot match after an underscore,
  // so without it every AWS_SECRET_ACCESS_KEY= / DB_PASSWORD= style assignment
  // escaped - and .env fragments are exactly what agents paste to each other.
  // The surrounding [A-Za-z0-9_]* runs are both required: `\b` cannot match
  // after an underscore, so DB_PASSWORD= escaped on the left, and the keyword
  // is rarely the last word - AWS_SECRET_ACCESS_KEY= escaped on the right.
  /[A-Za-z0-9_]*(?:token|password|passwd|secret|api[_-]?key|credential)[A-Za-z0-9_]*\s*[:=]\s*[^\s"']+/giu,
  // Real Anthropic/OpenAI/Slack keys separate with `-`, not only `_`.
  /\b(?:ghp|gho|ghu|ghs|github_pat|sk|pk|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/gu,
  /\bAKIA[0-9A-Z]{16}\b/gu,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu,
  // Credentials embedded in a URL: scheme://user:secret@host
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s:/@]+@/giu,
  /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}=*\b/giu,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu,
];

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function defaultStateDir(environment = process.env, platform = process.platform) {
  if (environment.HERDR_SHEPHERD_STATE_DIR) return environment.HERDR_SHEPHERD_STATE_DIR;
  const path = platform === 'win32' ? win32 : posix;
  const base = platform === 'win32'
    ? (environment.LOCALAPPDATA || environment.HOME || '.')
    : (environment.XDG_STATE_HOME || path.join(environment.HOME || '.', '.local', 'state'));
  return path.join(base, 'Herdr', 'shepherd-audit');
}

// A quoted string is an argument, not a command, so prose that merely mentions
// Herdr must not read as an invocation - otherwise `grep "Herdr mutations"` and
// `echo "... herdr candidates ..."` are denied as raw mutations. Two things must
// still survive masking: a quoted path to the binary, and a string handed to an
// interpreter to execute, which really does run what it contains.
const SHELL_INTERPRETER = /(?:^|[\s;&|(])(?:eval|exec|bash|sh|zsh|dash|ksh|pwsh|powershell(?:\.exe)?|cmd(?:\.exe)?|Invoke-Expression|iex)\b(?:\s+-{1,2}[A-Za-z-]+)*\s*$/i;

// An unbalanced apostrophe earlier in the command - `don't`, `agent's` - can pair
// with a later quote and swallow everything between them, mutation included. A
// span holding a command separator is therefore treated as spurious pairing and
// left unmasked, so the classifier still sees whatever it contains.
const SPANS_COMMANDS = /(?:&&|\|\||[;|])/;

export function maskQuotedArguments(command = '') {
  const text = String(command);
  return text.replace(/(["'])((?:\\.|(?!\1)[^\\])*)\1/g, (match, quote, inner, offset) => {
    if (SHELL_INTERPRETER.test(text.slice(0, offset))) return ` ${inner} `;
    if (SPANS_COMMANDS.test(inner)) return match;
    const executable = inner.match(/(?:^|[\\/])(herdr(?:\.exe)?)$/i);
    return executable ? ` ${executable[1]} ` : ' ';
  });
}

// Every invocation in the command is classified, not just the first. A single
// `.match()` meant `herdr agent list && herdr pane kill w1:p3` scored as the
// leading read and passed the gate unaudited - and list-then-act is the most
// natural compound in a multiplexer, so that was an accidental bypass rather
// than a determined one. An unquoted path to the binary is also recognised:
// masking only ever handled quoted paths, so `./herdr`, `/usr/bin/herdr`, and
// `OUT=$(herdr ...)` all read as unrelated commands.
const INVOCATION = /(?:^|[\s;&|(=`])(?:[^\s;&|"'`]*[\\/])?herdr(?:\.exe)?["']?((?:\s+-{1,2}[A-Za-z][\w-]*(?:=\S+)?)*)\s+([a-z-]+)(?:\s+([a-z-]+))?/gi;

export function classifyShellCommand(command = '') {
  if (/coordinate\.mjs\b[\s\S]*--stdin/i.test(command)) return { kind: 'wrapper' };
  const masked = maskQuotedArguments(command);
  let sawRead = false;
  let firstRead;
  for (const match of masked.matchAll(INVOCATION)) {
    // Leading flags are skipped so `herdr --json pane read` classifies on the
    // real verb instead of denying a read as the operation "--json pane".
    const operation = `${match[2].toLowerCase()} ${String(match[3] || '').toLowerCase()}`.trim();
    if (!READ_COMMANDS.has(operation)) return { kind: 'raw-mutation', operation };
    sawRead = true;
    firstRead = firstRead ?? operation;
  }
  return sawRead ? { kind: 'read', operation: firstRead } : { kind: 'other' };
}

export function redactOutboundText(value = '') {
  const original = String(value);
  let redacted = original;
  let blocked = false;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, () => {
      blocked = true;
      return '[REDACTED]';
    });
  }
  return {
    blocked,
    redacted,
    sha256: createHash('sha256').update(original).digest('hex'),
  };
}

// The audit match used to key on the message hash alone. Every action without
// text hashes the empty string, so one audited `pane read` vouched for any
// other command to the same target inside the window - including a mutation
// the event never named, since the stored event carried no args at all. The
// digest binds the whole executed shape, so an attempt authorizes exactly the
// command it recorded.
export function requestDigest(request = {}) {
  const canonical = JSON.stringify({
    origin: request.origin ?? null,
    action: request.action ?? null,
    args: Array.isArray(request.args) ? request.args : [],
    target: { type: request.target?.type ?? null, id: request.target?.id ?? null },
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export function validateCoordinationRequest(request) {
  if (!request || typeof request !== 'object') throw new Error('coordination request must be an object');
  if (!['proactive', 'user-directed'].includes(request.origin)) throw new Error('origin must be proactive or user-directed');
  if (request.action !== 'herdr.exec' || !Array.isArray(request.args) || request.args.length < 2) {
    throw new Error('action must be herdr.exec with an args array');
  }
  if (!request.target?.type || !request.target?.id || !request.reason) throw new Error('target and reason are required');
  if (request.origin === 'proactive') {
    const [resource, verb, target, message, ...extra] = request.args;
    if (resource !== 'agent' || verb !== 'send' || !target || !message || extra.length) {
      throw new Error('proactive coordination may only use agent send');
    }
    if (request.target.type !== 'agent' || request.target.id !== target || request.message !== message) {
      throw new Error('proactive target and message must match agent send arguments');
    }
  }
  const secret = redactOutboundText(request.message || request.args.join(' '));
  if (secret.blocked) throw new Error('outbound coordination contains an obvious secret');
  return request;
}

async function withLock(stateDir, operation) {
  await mkdir(stateDir, { recursive: true });
  const lockPath = join(stateDir, '.lock');
  const deadline = Date.now() + 5000;
  let handle;
  while (!handle) {
    try {
      handle = await open(lockPath, 'wx');
    } catch (error) {
      if (error.code !== 'EEXIST' || Date.now() >= deadline) throw error;
      try {
        const lock = await stat(lockPath);
        if (Date.now() - lock.mtimeMs > 30_000) {
          await rm(lockPath, { force: true });
          continue;
        }
      } catch (lockError) {
        if (lockError.code !== 'ENOENT') throw lockError;
      }
      await wait(20);
    }
  }
  try {
    return await operation();
  } finally {
    await handle.close();
    await rm(lockPath, { force: true });
  }
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return fallback;
    throw error;
  }
}

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

export async function listAuditEvents(stateDir = defaultStateDir()) {
  try {
    const text = await readFile(join(stateDir, 'audit.jsonl'), 'utf8');
    return text.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function readAuditState(stateDir = defaultStateDir()) {
  return readJson(join(stateDir, 'state.json'), { acknowledged_sequence: 0, next_sequence: 1 });
}

export async function appendAuditEvent(stateDir = defaultStateDir(), event) {
  return withLock(stateDir, async () => {
    const statePath = join(stateDir, 'state.json');
    const state = await readJson(statePath, { acknowledged_sequence: 0, next_sequence: 1 });
    const saved = {
      ...event,
      schema_version: event.schema_version || 1,
      sequence: state.next_sequence,
      event_id: event.event_id || randomUUID(),
      occurred_at: event.occurred_at || new Date().toISOString(),
    };
    await appendFile(join(stateDir, 'audit.jsonl'), `${JSON.stringify(saved)}\n`, 'utf8');
    state.next_sequence += 1;
    await writeJsonAtomic(statePath, state);
    return saved;
  });
}

export async function acknowledgeThrough(stateDir = defaultStateDir(), sequence) {
  return withLock(stateDir, async () => {
    const path = join(stateDir, 'state.json');
    const state = await readJson(path, { acknowledged_sequence: 0, next_sequence: 1 });
    state.acknowledged_sequence = Math.max(state.acknowledged_sequence, Number(sequence) || 0);
    await writeJsonAtomic(path, state);
    return state;
  });
}

async function rewriteAuditEvents(stateDir, keep) {
  const events = await listAuditEvents(stateDir);
  const remaining = events.filter(keep);
  const path = join(stateDir, 'audit.jsonl');
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, remaining.map((event) => JSON.stringify(event)).join('\n') + (remaining.length ? '\n' : ''), 'utf8');
  await rename(temporary, path);
  return events.length - remaining.length;
}

export async function clearViewedHistory(stateDir = defaultStateDir()) {
  return withLock(stateDir, async () => {
    const state = await readJson(join(stateDir, 'state.json'), { acknowledged_sequence: 0, next_sequence: 1 });
    return rewriteAuditEvents(stateDir, (event) => event.sequence > state.acknowledged_sequence);
  });
}

export async function deleteAuditAction(stateDir = defaultStateDir(), eventId) {
  if (!eventId) throw new Error('event_id is required');
  return withLock(stateDir, () => rewriteAuditEvents(stateDir, (event) => event.event_id !== eventId));
}

export async function deleteAllAuditHistory(stateDir = defaultStateDir()) {
  return withLock(stateDir, () => rewriteAuditEvents(stateDir, () => false));
}
