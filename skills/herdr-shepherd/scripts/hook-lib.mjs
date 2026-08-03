import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { appendAuditEvent, classifyShellCommand, defaultStateDir, redactOutboundText, requestDigest, validateCoordinationRequest } from './core.mjs';

const wrapperPatterns = [
  {
    pattern: /@'\s*\r?\n([\s\S]*?)\r?\n'@\s*\|\s*node\b[\s\S]*coordinate\.mjs\b[\s\S]*--stdin/i,
  },
  {
    pattern: /node\b[\s\S]*coordinate\.mjs\b[\s\S]*--stdin[\s\S]*<<'([A-Za-z_][A-Za-z0-9_-]*)'\s*\r?\n([\s\S]*?)\r?\n\1\b/i,
    group: 2,
  },
];

export function extractCoordinationRequest(command) {
  for (const candidate of wrapperPatterns) {
    const match = String(command || '').match(candidate.pattern);
    if (match) return JSON.parse(match[candidate.group || 1]);
  }
  throw new Error('audited wrapper requires literal JSON through a PowerShell here-string or POSIX heredoc');
}

function deny(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
    systemMessage: reason,
  };
}

function outcome(payload) {
  const value = payload.tool_response ?? payload.tool_result ?? payload.error ?? '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  // Markers are read from un-encoded output when the response is structured. On
  // the stringified form a Windows path separator is indistinguishable from the
  // backslash of a JSON escape, which truncates the value at the first segment.
  const streams = [value?.stdout, value?.stderr].filter((stream) => typeof stream === 'string');
  const markers = typeof value === 'string' ? value : (streams.join('\n') || text);
  const failed = payload.hook_event_name === 'PostToolUseFailure'
    || /"(?:exit_code|exitCode)"\s*:\s*[1-9]/.test(text)
    || /(?:^|\s)(?:error|failed):/i.test(text);
  const delivery = markers.match(/coordination-delivery:\s*(confirmed|unconfirmed|queued|unknown)/)?.[1];
  // Records which wrapper actually performed the send, so a stale path or a
  // superseded plugin copy is attributable after the fact.
  const wrapper = markers.match(/coordination-wrapper:\s*([^\r\n]+)/)?.[1]?.trim();
  // Stored as a first-class field like delivery and wrapper. It previously
  // survived only incidentally inside outcome_summary, which the viewer never
  // renders for a send - so an operator auditing which submits went out
  // unguarded found nothing and concluded every one had been checked.
  const composer = markers.match(/coordination-composer:\s*(unchecked|bypassed)/)?.[1];
  return {
    phase: failed ? 'failed' : 'succeeded',
    summary: redactOutboundText(text.slice(0, 1000)).redacted,
    delivery,
    wrapper,
    composer,
  };
}

function pageActive(viewer) {
  return viewer.last_seen_at && Date.now() - Date.parse(viewer.last_seen_at) <= 5000;
}

function defaultOpenUrl(url) {
  const command = process.platform === 'win32' ? 'cmd.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/d', '/c', 'start', '/min', '', url] : process.platform === 'darwin' ? ['-g', url] : [url];
  try {
    const browser = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    browser.once('error', () => process.stderr.write(`Herdr Shepherd audit: ${url}\n`));
    browser.unref();
  } catch {
    process.stderr.write(`Herdr Shepherd audit: ${url}\n`);
  }
}

async function markOpened(viewerPath, viewer) {
  const value = { ...viewer, opened_at: new Date().toISOString() };
  await writeFile(viewerPath, `${JSON.stringify(value)}\n`, 'utf8');
  return value;
}

export async function ensureAuditViewer(stateDir = defaultStateDir(), options = {}) {
  const { openBrowser = true, openUrl = defaultOpenUrl } = options;
  await mkdir(stateDir, { recursive: true });
  const viewerPath = join(stateDir, 'viewer.json');
  const healthyViewer = async () => {
    try {
      const value = JSON.parse(await readFile(viewerPath, 'utf8'));
      const health = await fetch(`${value.url}/health?token=${encodeURIComponent(value.token)}`, { signal: AbortSignal.timeout(750) });
      return health.ok ? value : undefined;
    } catch { return undefined; }
  };

  let existing = await healthyViewer();
  if (!existing) {
    const lockPath = join(stateDir, '.viewer-start.lock');
    let lock;
    const lockDeadline = Date.now() + 7000;
    while (!lock) {
      try { lock = await open(lockPath, 'wx'); }
      catch (error) {
        if (error.code !== 'EEXIST' || Date.now() >= lockDeadline) throw error;
        try {
          if (Date.now() - (await stat(lockPath)).mtimeMs > 30_000) await rm(lockPath, { force: true });
        } catch (lockError) { if (lockError.code !== 'ENOENT') throw lockError; }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    try {
      existing = await healthyViewer();
      if (!existing) {
        const token = randomBytes(24).toString('base64url');
        const serverPath = fileURLToPath(new URL('./audit-server.mjs', import.meta.url));
        const child = spawn(process.execPath, [serverPath], {
          detached: true, stdio: 'ignore', windowsHide: true,
          env: { ...process.env, HERDR_SHEPHERD_STATE_DIR: stateDir, HERDR_COORDINATION_VIEWER_TOKEN: token },
        });
        child.unref();
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline && !(existing = await healthyViewer())) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (!existing) throw new Error('audit viewer did not start');
      }
    } finally {
      await lock.close();
      await rm(lockPath, { force: true });
    }
  }

  const url = `${existing.url}/?token=${encodeURIComponent(existing.token)}`;
  if (openBrowser && !existing.opened_at && !pageActive(existing)) {
    existing = await markOpened(viewerPath, existing);
    try {
      await openUrl(url);
    } catch {
      process.stderr.write(`Herdr Shepherd audit: ${url}\n`);
    }
  }
  return url;
}

export async function handleHookPayload(payload, options = {}) {
  const runtime = options.runtime || 'unknown';
  const stateDir = options.stateDir || defaultStateDir();
  const eventName = payload.hook_event_name || payload.event || '';
  const command = payload.tool_input?.command || payload.input?.command || '';
  const classification = classifyShellCommand(command);
  if (classification.kind === 'other' || classification.kind === 'read') return {};
  if (eventName === 'PreToolUse' && classification.kind === 'raw-mutation') {
    return { output: deny('Raw Herdr mutations are blocked. Use the herdr-shepherd audited wrapper.') };
  }
  if (classification.kind !== 'wrapper') return {};

  let request;
  try {
    request = validateCoordinationRequest(extractCoordinationRequest(command));
  } catch (error) {
    return eventName === 'PreToolUse' ? { output: deny(error.message) } : {};
  }
  const redaction = redactOutboundText(request.message || '');
  const sourceId = options.sourceId || process.env.HERDR_PANE_ID;
  const fallbackEventId = [
    runtime,
    payload.session_id || '',
    payload.turn_id || '',
    request.origin,
    request.action,
    request.target?.type || '',
    request.target?.id || '',
    redaction.sha256,
  ].join(':');
  const eventId = payload.tool_use_id || payload.toolUseId || fallbackEventId;
  const base = {
    schema_version: 1,
    event_id: eventId,
    runtime,
    session_id: payload.session_id,
    turn_id: payload.turn_id,
    tool_use_id: payload.tool_use_id || payload.toolUseId,
    origin: request.origin,
    action: request.action,
    source: sourceId ? { type: 'agent', id: sourceId } : { type: 'runtime', id: runtime },
    target: request.target,
    reason: request.reason,
    message_redacted: redaction.redacted,
    message_sha256: redaction.sha256,
    // What actually ran. The event used to carry only the constant action
    // "herdr.exec", so a recorded coordination toward a pane said nothing about
    // the command performed, and the digest that authorizes it now binds the
    // same shape rather than the message alone.
    args_redacted: (Array.isArray(request.args) ? request.args : []).map((arg) => redactOutboundText(String(arg)).redacted),
    request_sha256: requestDigest(request),
  };
  if (eventName === 'PreToolUse') {
    await appendAuditEvent(stateDir, { ...base, phase: 'attempted' });
    if (request.origin === 'proactive' && options.launchViewer !== false) {
      await (options.ensureViewer || ensureAuditViewer)(stateDir);
    }
    return {};
  }
  if (eventName === 'PostToolUse' || eventName === 'PostToolUseFailure') {
    const result = outcome(payload);
    await appendAuditEvent(stateDir, {
      ...base,
      phase: result.phase,
      outcome_summary: result.summary,
      ...(result.delivery ? { delivery: result.delivery } : {}),
      ...(result.wrapper ? { wrapper: result.wrapper } : {}),
      ...(result.composer ? { composer: result.composer } : {}),
    });
  }
  return {};
}
