import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { executeCoordinationRequest } from '../skills/coordinating-herdr-agents/scripts/coordinate.mjs';

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

test('proactive send identifies its source and submits with a delayed Enter', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fake-herdr-'));
  const log = join(dir, 'calls.jsonl');
  const result = await executeCoordinationRequest(request(), {
    command: process.execPath,
    prefixArgs: [fakeHerdr],
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
    ['pane', 'send-text', 'w2:p1', '[Herdr from "codex-complete-MRs-2" (w1:pE)] Resume the official installer build.'],
    ['pane', 'send-keys', 'w2:p1', 'enter'],
    // Post-send status probe: the send reports success, this decides delivery.
    ['agent', 'get', 'w2:p1'],
  ]);
});

test('failed Enter submissions are reported', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fake-herdr-'));
  const log = join(dir, 'calls.jsonl');
  const result = await executeCoordinationRequest(request(), {
    command: process.execPath,
    prefixArgs: [fakeHerdr],
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
