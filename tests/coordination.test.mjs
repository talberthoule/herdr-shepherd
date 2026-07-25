import assert from 'node:assert/strict';
import { mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  acknowledgeThrough,
  appendAuditEvent,
  classifyShellCommand,
  clearViewedHistory,
  defaultStateDir,
  deleteAllAuditHistory,
  deleteAuditAction,
  listAuditEvents,
  redactOutboundText,
  validateCoordinationRequest,
} from '../skills/herdr-shepherd/scripts/core.mjs';

test('default audit state uses the shepherd namespace on every platform', () => {
  assert.equal(
    defaultStateDir({ LOCALAPPDATA: 'C:\\state' }, 'win32'),
    'C:\\state\\Herdr\\shepherd-audit',
  );
  assert.equal(
    defaultStateDir({ HOME: '/home/test' }, 'linux'),
    '/home/test/.local/state/Herdr/shepherd-audit',
  );
  assert.equal(
    defaultStateDir({ HOME: '/home/test', XDG_STATE_HOME: '/state' }, 'linux'),
    '/state/Herdr/shepherd-audit',
  );
  assert.equal(
    defaultStateDir({ HERDR_SHEPHERD_STATE_DIR: '/custom' }, 'linux'),
    '/custom',
  );
});

async function stateDir() {
  return mkdtemp(join(tmpdir(), 'herdr-coordination-'));
}

test('read-only Herdr inspection is allowed without auditing', () => {
  assert.equal(classifyShellCommand('herdr api snapshot').kind, 'read');
  assert.equal(classifyShellCommand('herdr pane read w2:p1 --source recent-unwrapped').kind, 'read');
  assert.equal(classifyShellCommand('herdr agent list').kind, 'read');
  assert.equal(classifyShellCommand('herdr agent explain w2:p1 --json').kind, 'read');
  assert.equal(classifyShellCommand('herdr agent wait w2:p1 --status idle --timeout 1000').kind, 'read');
  assert.equal(classifyShellCommand('herdr pane process-info --pane w2:p1').kind, 'read');
});

test('raw Herdr mutations are denied while the audited wrapper is recognized', () => {
  assert.equal(classifyShellCommand('herdr agent send w2:p1 "continue"').kind, 'raw-mutation');
  assert.equal(classifyShellCommand('herdr pane close w2:p1').kind, 'raw-mutation');
  assert.equal(classifyShellCommand("@'\n{}\n'@ | node C:\\skill\\coordinate.mjs --stdin").kind, 'wrapper');
});

test('proactive requests may only send to an existing agent', () => {
  const valid = {
    origin: 'proactive',
    action: 'herdr.exec',
    args: ['agent', 'send', 'w2:p1', 'Please resume the installer build.'],
    target: { type: 'agent', id: 'w2:p1' },
    reason: 'Avoid duplicating paused work',
    message: 'Please resume the installer build.',
  };
  assert.deepEqual(validateCoordinationRequest(valid), valid);
  assert.throws(
    () => validateCoordinationRequest({ ...valid, args: ['pane', 'close', 'w2:p1'] }),
    /proactive coordination may only use agent send/i,
  );
});

test('obvious secrets are blocked and never retained in clear text', () => {
  const secret = 'token=ghp_1234567890abcdefghijklmnopqrstuvwxyz';
  const result = redactOutboundText(`Send this ${secret}`);
  assert.equal(result.blocked, true);
  assert.doesNotMatch(result.redacted, /ghp_1234567890/);
  assert.match(result.redacted, /\[REDACTED\]/);
  assert.equal(result.sha256.length, 64);
});

test('audit events receive monotonic sequence numbers and preserve phase order', async () => {
  const dir = await stateDir();
  const base = {
    schema_version: 1,
    event_id: 'tool-1',
    runtime: 'codex',
    session_id: 'session-1',
    turn_id: 'turn-1',
    tool_use_id: 'tool-1',
    origin: 'proactive',
    action: 'herdr.exec',
    target: { type: 'agent', id: 'w2:p1' },
    reason: 'Coordinate work',
    message_redacted: 'Continue',
    message_sha256: '0'.repeat(64),
  };
  await appendAuditEvent(dir, { ...base, phase: 'attempted' });
  await appendAuditEvent(dir, { ...base, phase: 'succeeded', outcome_summary: 'sent' });
  const events = await listAuditEvents(dir);
  assert.deepEqual(events.map((event) => event.sequence), [1, 2]);
  assert.deepEqual(events.map((event) => event.phase), ['attempted', 'succeeded']);
});

test('only acknowledged audit history can be cleared', async () => {
  const dir = await stateDir();
  for (let index = 1; index <= 3; index += 1) {
    await appendAuditEvent(dir, {
      schema_version: 1,
      event_id: `event-${index}`,
      phase: 'attempted',
      runtime: 'codex',
      origin: 'proactive',
      action: 'herdr.exec',
      target: { type: 'agent', id: 'w2:p1' },
      reason: 'test',
      message_redacted: `message-${index}`,
      message_sha256: `${index}`.repeat(64),
    });
  }
  await acknowledgeThrough(dir, 2);
  await clearViewedHistory(dir);
  const remaining = await listAuditEvents(dir);
  assert.deepEqual(remaining.map((event) => event.sequence), [3]);

  const state = JSON.parse(await readFile(join(dir, 'state.json'), 'utf8'));
  assert.equal(state.acknowledged_sequence, 2);
});

test('deleting one audit action removes all phases with the same event id', async () => {
  const dir = await stateDir();
  const base = {
    schema_version: 1,
    event_id: 'action-1',
    runtime: 'codex',
    origin: 'proactive',
    action: 'herdr.exec',
    target: { type: 'agent', id: 'w2:p1' },
    reason: 'test',
    message_redacted: 'message',
    message_sha256: '0'.repeat(64),
  };
  await appendAuditEvent(dir, { ...base, phase: 'attempted' });
  await appendAuditEvent(dir, { ...base, phase: 'succeeded', outcome_summary: 'sent' });
  await appendAuditEvent(dir, { ...base, event_id: 'action-2', phase: 'attempted' });

  assert.equal(await deleteAuditAction(dir, 'action-1'), 2);
  const remaining = await listAuditEvents(dir);
  assert.deepEqual(remaining.map((event) => event.event_id), ['action-2']);
  assert.deepEqual(remaining.map((event) => event.sequence), [3]);
});

test('deleting all audit history empties the log without renumbering future events', async () => {
  const dir = await stateDir();
  await appendAuditEvent(dir, { event_id: 'action-1', phase: 'attempted', runtime: 'codex', origin: 'proactive', action: 'herdr.exec' });
  await appendAuditEvent(dir, { event_id: 'action-2', phase: 'attempted', runtime: 'codex', origin: 'proactive', action: 'herdr.exec' });

  assert.equal(await deleteAllAuditHistory(dir), 2);
  assert.deepEqual(await listAuditEvents(dir), []);

  await appendAuditEvent(dir, { event_id: 'action-3', phase: 'attempted', runtime: 'codex', origin: 'proactive', action: 'herdr.exec' });
  const remaining = await listAuditEvents(dir);
  assert.deepEqual(remaining.map((event) => event.sequence), [3]);
});

test('malformed JSONL tail from an interrupted writer is ignored', async () => {
  const dir = await stateDir();
  await writeFile(join(dir, 'audit.jsonl'), '{"sequence":1}\n{"sequence":', 'utf8');
  assert.deepEqual(await listAuditEvents(dir), [{ sequence: 1 }]);
});

test('a stale lock from a crashed writer is recovered', async () => {
  const dir = await stateDir();
  const lock = join(dir, '.lock');
  await writeFile(lock, 'crashed', 'utf8');
  const old = new Date(Date.now() - 60_000);
  await utimes(lock, old, old);
  const started = Date.now();
  await appendAuditEvent(dir, { phase: 'attempted', runtime: 'codex', origin: 'proactive', action: 'herdr.exec' });
  assert.ok(Date.now() - started < 1000);
});

test('concurrent writers produce unique ordered sequences', async () => {
  const dir = await stateDir();
  await Promise.all(Array.from({ length: 20 }, (_, index) => appendAuditEvent(dir, {
    event_id: `concurrent-${index}`, phase: 'attempted', runtime: 'codex',
    origin: 'proactive', action: 'herdr.exec',
  })));
  const events = await listAuditEvents(dir);
  assert.deepEqual(events.map((event) => event.sequence), Array.from({ length: 20 }, (_, index) => index + 1));
});
