import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { DELIVERY_MARKER, executeCoordinationRequest } from '../skills/herdr-shepherd/scripts/coordinate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fakeHerdr = join(here, 'fake-herdr.mjs');

function request() {
  return {
    origin: 'proactive',
    action: 'herdr.exec',
    args: ['agent', 'send', 'w2:p1', 'Resume the official installer build.'],
    target: { type: 'agent', id: 'w2:p1' },
    reason: 'Continue paused work',
    message: 'Resume the official installer build.',
  };
}

async function execute(envExtra = {}, optionsExtra = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'fake-herdr-'));
  const log = join(dir, 'calls.jsonl');
  const result = await executeCoordinationRequest(request(), {
    command: process.execPath,
    prefixArgs: [fakeHerdr],
    transport: 'pane-run',
    env: {
      ...process.env,
      FAKE_HERDR_LOG: log,
      HERDR_PANE_ID: 'w1:pE',
      HERDR_TAB_ID: '',
      HERDR_SHEPHERD_TRANSPORT: '',
      ...envExtra,
    },
    ...optionsExtra,
  });
  const calls = (await readFile(log, 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  return { result, calls };
}

const TEXT = '[Herdr from w1:pE] Resume the official installer build.';

test('an idle target submits atomically and the wait resolves the verdict', async () => {
  const { result, calls } = await execute({ FAKE_HERDR_STATUSES: 'idle' });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, new RegExp(`${DELIVERY_MARKER}: confirmed`));
  assert.deepEqual(calls, [
    ['agent', 'get', 'w2:p1'],
    ['agent', 'explain', 'w2:p1', '--json'],
    ['pane', 'run', 'w2:p1', TEXT],
    ['agent', 'wait', 'w2:p1', '--status', 'working'],
  ], 'submit is one call and the verdict is the wait resolving, not a sleep-and-probe');
});

test('a working target is recorded as queued without a wait', async () => {
  const { result, calls } = await execute({ FAKE_HERDR_STATUSES: 'working' });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, new RegExp(`${DELIVERY_MARKER}: queued`));
  assert.equal(calls.length, 3, 'waiting for working on a working target proves nothing');
  assert.ok(!calls.some((call) => call[1] === 'wait'));
});

test('an unresolved before-status still submits and reports unknown', async () => {
  const { result, calls } = await execute({ FAKE_HERDR_STATUSES: 'none' });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, new RegExp(`${DELIVERY_MARKER}: unknown`));
  assert.equal(calls.length, 3);
});

test('a blocked target is refused before anything is typed', async () => {
  // Verified live on 0.7.2-preview: a send into a blocked pane answers the
  // pending prompt with its default option and discards the message text.
  const dir = await mkdtemp(join(tmpdir(), 'fake-herdr-'));
  const log = join(dir, 'calls.jsonl');
  for (const transport of ['pane-run', 'keystrokes', 'agent-prompt']) {
    await assert.rejects(() => executeCoordinationRequest(request(), {
      command: process.execPath,
      prefixArgs: [fakeHerdr],
      transport,
      env: { ...process.env, FAKE_HERDR_LOG: log, FAKE_HERDR_STATUSES: 'blocked', HERDR_PANE_ID: 'w1:pE', HERDR_TAB_ID: '' },
    }), /blocked on user input/, `${transport} must refuse a blocked target`);
  }
  const calls = (await readFile(log, 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  assert.ok(calls.every((call) => call[1] === 'get'), 'nothing may be typed at a blocked pane');
});

test('a hung wait is killed by the watchdog and a fresh pane that reached done is confirmed', async () => {
  const { result, calls } = await execute(
    { FAKE_HERDR_STATUSES: 'idle,done', FAKE_HERDR_WAIT_HANG: '1' },
    { deliveryWaitTimeoutMs: 300, probeRetryDelayMs: 0 },
  );
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, new RegExp(`${DELIVERY_MARKER}: confirmed`),
    'idle only reaches done by running a turn, so the turn the wait missed still confirms');
  assert.deepEqual(calls[4], ['agent', 'get', 'w2:p1'], 'the watchdog falls back to one status read');
});

test('a hung wait with no status movement stays unconfirmed', async () => {
  const { result } = await execute(
    { FAKE_HERDR_STATUSES: 'done,done', FAKE_HERDR_WAIT_HANG: '1' },
    { deliveryWaitTimeoutMs: 300, probeRetryDelayMs: 0 },
  );
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, new RegExp(`${DELIVERY_MARKER}: unconfirmed`));
});

test('a failed pane run is returned as the failure it is', async () => {
  const { result, calls } = await execute({ FAKE_HERDR_STATUSES: 'idle', FAKE_HERDR_RUN_FAILURE: '1' });
  assert.equal(result.exitCode, 1);
  assert.doesNotMatch(result.stdout, new RegExp(DELIVERY_MARKER));
  assert.equal(calls.length, 3, 'no wait may follow a failed submit');
  assert.ok(!calls.some((call) => call[1] === 'wait'));
});
