import { createHash, randomUUID } from 'node:crypto';
import { appendFile, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const READ_COMMANDS = new Set([
  'agent explain', 'agent get', 'agent list', 'agent read', 'agent wait',
  'api schema', 'api snapshot', 'integration status',
  'pane current', 'pane edges', 'pane get', 'pane layout', 'pane list',
  'pane neighbor', 'pane process-info', 'pane read',
  'plugin list', 'session list', 'tab get', 'tab list',
  'workspace get', 'workspace list',
]);
const SECRET_PATTERNS = [
  /\b(?:token|password|secret|api[_-]?key)\s*[:=]\s*[^\s"']+/giu,
  /\b(?:ghp|github_pat|sk|xox[baprs])_[A-Za-z0-9_-]{12,}\b/gu,
  /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}=*\b/giu,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu,
];

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function defaultStateDir() {
  return process.env.HERDR_COORDINATION_STATE_DIR
    || join(process.env.LOCALAPPDATA || process.env.HOME || '.', 'Herdr', 'coordination-audit');
}

export function classifyShellCommand(command = '') {
  if (/coordinate\.mjs\b[\s\S]*--stdin/i.test(command)) return { kind: 'wrapper' };
  const match = command.match(/(?:^|[\s;&|])(?:["'][^"']*[\\/])?herdr(?:\.exe)?["']?\s+([a-z-]+)(?:\s+([a-z-]+))?/i);
  if (!match) return { kind: 'other' };
  const operation = `${match[1].toLowerCase()} ${String(match[2] || '').toLowerCase()}`.trim();
  return { kind: READ_COMMANDS.has(operation) ? 'read' : 'raw-mutation', operation };
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
