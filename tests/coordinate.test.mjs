import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { executeCoordinationRequest } from '../skills/herdr-shepherd/scripts/coordinate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fakeHerdr = join(here, 'fake-herdr.mjs');

function request(origin = 'proactive') {
  return {
    origin,
    action: 'herdr.exec',
    args: ['agent', 'send', 'w2:p1', 'Resume the official installer build.'],
    target: { type: 'agent', id: 'w2:p1' },
    reason: 'Continue paused work',
    message: 'Resume the official installer build.',
  };
}

test('legacy keystrokes send identifies its source and submits with a delayed Enter', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fake-herdr-'));
  const log = join(dir, 'calls.jsonl');
  const result = await executeCoordinationRequest(request(), {
    command: process.execPath,
    prefixArgs: [fakeHerdr],
    transport: 'keystrokes',
    env: {
      ...process.env,
      FAKE_HERDR_LOG: log,
      FAKE_HERDR_TAB_LABEL: 'codex-complete-MRs-2',
      HERDR_PANE_ID: 'w1:pE',
      HERDR_TAB_ID: 'w1:tE',
    },
    inputDelayMs: 0,
    deliveryProbeDelayMs: 0,
  });
  assert.equal(result.exitCode, 0);
  const calls = (await readFile(log, 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(calls, [
    ['agent', 'get', 'w2:p1'],
    ['tab', 'get', 'w1:tE'],
    // Composer check: a draft here would be force-submitted with the message.
    ['agent', 'explain', 'w2:p1', '--json'],
    ['pane', 'send-text', 'w2:p1', '[Herdr from "codex-complete-MRs-2" (w1:pE)] Resume the official installer build.'],
    ['pane', 'send-keys', 'w2:p1', 'enter'],
    // Post-send status probe: the send reports success, this decides delivery.
    ['agent', 'get', 'w2:p1'],
  ]);
});

test('failed Enter submissions are reported on the legacy transport', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fake-herdr-'));
  const log = join(dir, 'calls.jsonl');
  const result = await executeCoordinationRequest(request(), {
    command: process.execPath,
    prefixArgs: [fakeHerdr],
    transport: 'keystrokes',
    env: {
      ...process.env,
      FAKE_HERDR_LOG: log,
      FAKE_HERDR_KEYS_FAILURE: '1',
      HERDR_PANE_ID: 'w1:pE',
      HERDR_TAB_ID: 'w1:tE',
    },
    inputDelayMs: 0,
  });
  assert.equal(result.exitCode, 1);
  const calls = (await readFile(log, 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(calls, [
    ['agent', 'get', 'w2:p1'],
    ['tab', 'get', 'w1:tE'],
    ['agent', 'explain', 'w2:p1', '--json'],
    ['pane', 'send-text', 'w2:p1', '[Herdr from w1:pE] Resume the official installer build.'],
    ['pane', 'send-keys', 'w2:p1', 'enter'],
  ]);
});

test('missing proactive target prevents the send', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fake-herdr-'));
  const log = join(dir, 'calls.jsonl');
  await assert.rejects(() => executeCoordinationRequest(request(), {
    command: process.execPath,
    prefixArgs: [fakeHerdr],
    env: { ...process.env, FAKE_HERDR_LOG: log, FAKE_HERDR_MISSING: '1' },
  }), /target agent does not exist/i);
  const calls = (await readFile(log, 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(calls, [['agent', 'get', 'w2:p1']]);
});

test('structured agent_not_found is settled and is not retried', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fake-herdr-'));
  const log = join(dir, 'calls.jsonl');
  await assert.rejects(() => executeCoordinationRequest(request(), {
    command: process.execPath,
    prefixArgs: [fakeHerdr],
    env: { ...process.env, FAKE_HERDR_LOG: log, FAKE_HERDR_MISSING_JSON: '1' },
    probeRetryDelayMs: 0,
  }), /target agent does not exist/i);
  const calls = (await readFile(log, 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(calls, [['agent', 'get', 'w2:p1']], 'a missing target must not be probed twice');
});

test('a transient transport fault is retried and the send proceeds', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fake-herdr-'));
  const log = join(dir, 'calls.jsonl');
  const result = await executeCoordinationRequest(request(), {
    command: process.execPath,
    prefixArgs: [fakeHerdr],
    transport: 'keystrokes',
    env: {
      ...process.env,
      FAKE_HERDR_LOG: log,
      FAKE_HERDR_TRANSPORT_FAILURES: '1',
      HERDR_PANE_ID: 'w1:pE',
      HERDR_TAB_ID: '',
    },
    inputDelayMs: 0,
    deliveryProbeDelayMs: 0,
    probeRetryDelayMs: 0,
  });
  assert.equal(result.exitCode, 0);
  const calls = (await readFile(log, 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(calls, [
    ['agent', 'get', 'w2:p1'],
    ['agent', 'get', 'w2:p1'],
    ['agent', 'explain', 'w2:p1', '--json'],
    ['pane', 'send-text', 'w2:p1', '[Herdr from w1:pE] Resume the official installer build.'],
    ['pane', 'send-keys', 'w2:p1', 'enter'],
    ['agent', 'get', 'w2:p1'],
  ]);
});

test('a persistent transport fault is not reported as a missing target', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fake-herdr-'));
  const log = join(dir, 'calls.jsonl');
  await assert.rejects(() => executeCoordinationRequest(request(), {
    command: process.execPath,
    prefixArgs: [fakeHerdr],
    env: { ...process.env, FAKE_HERDR_LOG: log, FAKE_HERDR_TRANSPORT_FAILURES: '99' },
    probeRetryDelayMs: 0,
  }), (error) => {
    assert.doesNotMatch(error.message, /does not exist/i, 'a transport fault must not accuse the target');
    assert.match(error.message, /transport fault, not a missing target/i);
    assert.match(error.message, /BrokenPipe/, 'the underlying CLI diagnostic must survive');
    return true;
  });
  const calls = (await readFile(log, 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(calls.length, 2, 'the probe is retried exactly once before giving up');
  assert.ok(calls.every((call) => call[1] === 'get'), 'no send may follow a failed gate');
});

test('user-directed requests can execute broader Herdr operations', async () => {
  const value = request('user-directed');
  value.args = ['tab', 'focus', 'w2:t1'];
  value.target = { type: 'tab', id: 'w2:t1' };
  value.message = '';
  const dir = await mkdtemp(join(tmpdir(), 'fake-herdr-'));
  const log = join(dir, 'calls.jsonl');
  const result = await executeCoordinationRequest(value, {
    command: process.execPath, prefixArgs: [fakeHerdr], env: { ...process.env, FAKE_HERDR_LOG: log },
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse((await readFile(log, 'utf8')).trim()), ['tab', 'focus', 'w2:t1']);
});
