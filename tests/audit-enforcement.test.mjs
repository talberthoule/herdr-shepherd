import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  AUDIT_MATCH_WINDOW_MS,
  DELIVERY_MARKER,
  WRAPPER_MARKER,
  assertAudited,
  findAuditedAttempt,
  runCli,
  wrapperIdentity,
} from '../skills/herdr-shepherd/scripts/coordinate.mjs';
import { appendAuditEvent, redactOutboundText } from '../skills/herdr-shepherd/scripts/core.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fakeHerdr = join(here, 'fake-herdr.mjs');
const wrapperPath = join(here, '..', 'skills', 'herdr-shepherd', 'scripts', 'coordinate.mjs');

const MESSAGE = 'Resume the official installer build.';

function request(origin = 'proactive') {
  return {
    origin,
    action: 'herdr.exec',
    args: ['agent', 'send', 'w2:p1', MESSAGE],
    target: { type: 'agent', id: 'w2:p1' },
    reason: 'Continue paused work',
    message: MESSAGE,
  };
}

const stateDir = () => mkdtemp(join(tmpdir(), 'herdr-audit-enforcement-'));

// Mirrors what the PreToolUse hook writes before the command runs.
async function seedAttempt(dir, overrides = {}) {
  return appendAuditEvent(dir, {
    phase: 'attempted',
    runtime: 'claude-code',
    origin: 'proactive',
    action: 'herdr.exec',
    target: { type: 'agent', id: 'w2:p1' },
    message_sha256: redactOutboundText(MESSAGE).sha256,
    ...overrides,
  });
}

test('a matching attempted event proves the hook ran', async () => {
  const dir = await stateDir();
  await seedAttempt(dir);
  const result = await assertAudited(request(), { stateDir: dir, env: {} });
  assert.deepEqual({ audited: result.audited, bypassed: result.bypassed }, { audited: true, bypassed: false });
});

test('an unaudited send is refused with an actionable reason', async () => {
  const dir = await stateDir();
  await assert.rejects(() => assertAudited(request(), { stateDir: dir, env: {} }), (error) => {
    assert.match(error.message, /refusing to send unaudited/i);
    assert.match(error.message, /PreToolUse hook did not run/i);
    assert.match(error.message, /HERDR_SHEPHERD_ALLOW_UNAUDITED=1/);
    assert.ok(error.message.includes(dir), 'names the state directory it searched');
    return true;
  });
});

test('the audit requirement can be bypassed only deliberately', async () => {
  const dir = await stateDir();
  const result = await assertAudited(request(), {
    stateDir: dir,
    env: { HERDR_SHEPHERD_ALLOW_UNAUDITED: '1' },
  });
  assert.deepEqual({ audited: result.audited, bypassed: result.bypassed }, { audited: false, bypassed: true });
});

test('an attempt for different content does not vouch for this send', async () => {
  const dir = await stateDir();
  await seedAttempt(dir, { message_sha256: redactOutboundText('a different message').sha256 });
  await assert.rejects(() => assertAudited(request(), { stateDir: dir, env: {} }), /refusing to send unaudited/i);
});

test('an attempt for a different target does not vouch for this send', async () => {
  const dir = await stateDir();
  await seedAttempt(dir, { target: { type: 'agent', id: 'w2:pZ' } });
  await assert.rejects(() => assertAudited(request(), { stateDir: dir, env: {} }), /refusing to send unaudited/i);
});

test('a stale attempt outside the window does not vouch for this send', async () => {
  const dir = await stateDir();
  const event = await seedAttempt(dir);
  const stale = Date.parse(event.occurred_at) + AUDIT_MATCH_WINDOW_MS + 1000;
  await assert.rejects(
    () => assertAudited(request(), { stateDir: dir, env: {}, now: stale }),
    /refusing to send unaudited/i,
  );
});

test('findAuditedAttempt ignores outcome phases', async () => {
  const dir = await stateDir();
  await seedAttempt(dir, { phase: 'succeeded' });
  const events = JSON.parse(`[${(await readFile(join(dir, 'audit.jsonl'), 'utf8')).trim().split(/\r?\n/).join(',')}]`);
  assert.equal(findAuditedAttempt(events, request()), undefined);
});

test('the wrapper names itself and where it ran from', async () => {
  const identity = await wrapperIdentity(wrapperPath);
  assert.match(identity, /^herdr-shepherd \d+\.\d+\.\d+ \(/, 'carries name and manifest version');
  assert.ok(identity.includes(wrapperPath), 'carries the resolved script path');
});

test('an unversioned install still identifies itself', async () => {
  const identity = await wrapperIdentity(join(tmpdir(), 'nowhere', 's', 'h', 'coordinate.mjs'));
  assert.match(identity, /^herdr-shepherd unknown-version \(/);
});

test('a successful run is identifiable from stdout alone', async () => {
  const dir = await stateDir();
  const log = join(dir, 'calls.jsonl');
  await seedAttempt(dir);
  const result = await runCli({
    argv: ['node', 'coordinate.mjs', '--stdin'],
    input: JSON.stringify(request()),
    stateDir: dir,
    command: process.execPath,
    prefixArgs: [fakeHerdr],
    env: { ...process.env, FAKE_HERDR_LOG: log, HERDR_TAB_ID: '', HERDR_PANE_ID: 'w1:pE' },
    inputDelayMs: 0,
    deliveryProbeDelayMs: 0,
  });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, new RegExp(`^${WRAPPER_MARKER}: herdr-shepherd `), 'identity leads the output');
  assert.match(result.stdout, new RegExp(`${DELIVERY_MARKER}: (confirmed|unconfirmed|queued|unknown)`));
  assert.doesNotMatch(result.stdout, /audit=bypassed/);
});

test('a bypassed audit is disclosed in the output', async () => {
  const dir = await stateDir();
  const log = join(dir, 'calls.jsonl');
  const result = await runCli({
    argv: ['node', 'coordinate.mjs', '--stdin'],
    input: JSON.stringify(request()),
    stateDir: dir,
    command: process.execPath,
    prefixArgs: [fakeHerdr],
    env: {
      ...process.env,
      FAKE_HERDR_LOG: log,
      HERDR_TAB_ID: '',
      HERDR_SHEPHERD_ALLOW_UNAUDITED: '1',
    },
    inputDelayMs: 0,
    deliveryProbeDelayMs: 0,
  });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /audit=bypassed/);
});

test('a malformed request reports its own defect, not an audit failure', async () => {
  const dir = await stateDir();
  await assert.rejects(() => runCli({
    argv: ['node', 'coordinate.mjs', '--stdin'],
    input: JSON.stringify({ ...request(), reason: undefined }),
    stateDir: dir,
    env: {},
  }), /target and reason are required/i);
});

test('the wrapper CLI refuses an unaudited send without contacting Herdr', async () => {
  const dir = await stateDir();
  const child = spawn(process.execPath, [wrapperPath, '--stdin'], {
    windowsHide: true,
    env: {
      ...process.env,
      HERDR_SHEPHERD_STATE_DIR: dir,
      // Even if the guard failed open, this cannot reach a real pane.
      HERDR_BIN: join(dir, 'no-such-herdr-binary'),
      HERDR_SHEPHERD_ALLOW_UNAUDITED: '',
    },
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  child.stdin.end(JSON.stringify(request()));
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  assert.equal(exitCode, 1);
  assert.match(Buffer.concat(stderr).toString(), /refusing to send unaudited/i);
  assert.equal(Buffer.concat(stdout).toString(), '', 'no delivery verdict is implied');
});
