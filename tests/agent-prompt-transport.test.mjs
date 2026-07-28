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
    transport: 'agent-prompt',
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

test('an idle target is prompted and awaited in one call with no post-send probe', async () => {
  const { result, calls } = await execute({ FAKE_HERDR_STATUSES: 'idle' });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, new RegExp(`${DELIVERY_MARKER}: confirmed`));
  assert.deepEqual(calls, [
    ['agent', 'get', 'w2:p1'],
    ['agent', 'prompt', 'w2:p1', TEXT, '--wait', '--until', 'working', '--timeout', '5000'],
  ], 'the wait folds into the prompt call, so nothing runs after it');
});

test('a working target is prompted without a wait and recorded as queued', async () => {
  const { result, calls } = await execute({ FAKE_HERDR_STATUSES: 'working' });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, new RegExp(`${DELIVERY_MARKER}: queued`));
  assert.deepEqual(calls[1], ['agent', 'prompt', 'w2:p1', TEXT],
    'waiting for working on an already-working target would trivially pass without proving submission');
});

test('an unresolved before-status still submits and reports unknown', async () => {
  const { result, calls } = await execute({ FAKE_HERDR_STATUSES: 'none' });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, new RegExp(`${DELIVERY_MARKER}: unknown`));
  assert.deepEqual(calls[1], ['agent', 'prompt', 'w2:p1', TEXT]);
});

test('an expired wait is an unconfirmed delivery, not a failed send', async () => {
  const { result } = await execute({ FAKE_HERDR_STATUSES: 'idle', FAKE_HERDR_PROMPT_WAIT_TIMEOUT: '1' });
  assert.equal(result.exitCode, 0, 'the prompt submitted; only the wait expired');
  assert.match(result.stdout, new RegExp(`${DELIVERY_MARKER}: unconfirmed`));
  assert.match(result.stderr, /wait_timeout/, 'the CLI diagnostic must survive for the audit trail');
});

test('a failed prompt submission is returned as the failure it is', async () => {
  const { result } = await execute({ FAKE_HERDR_STATUSES: 'idle', FAKE_HERDR_PROMPT_FAILURE: '1' });
  assert.equal(result.exitCode, 1);
  assert.doesNotMatch(result.stdout, new RegExp(DELIVERY_MARKER),
    'a send that never submitted must not carry a delivery verdict');
});

test('the environment can select the transport when no option is passed', async () => {
  const { calls } = await execute(
    { FAKE_HERDR_STATUSES: 'idle', HERDR_SHEPHERD_TRANSPORT: 'agent-prompt' },
    { transport: undefined },
  );
  assert.equal(calls[1][1], 'prompt');
});

test('an unknown transport is refused before any Herdr call', async () => {
  await assert.rejects(
    () => execute({}, { transport: 'telegraph' }),
    /unknown coordination transport: telegraph/,
  );
});

test('the default transport remains keystrokes until agent-prompt is live-verified', async () => {
  const { calls } = await execute(
    { FAKE_HERDR_STATUSES: 'idle,idle' },
    { transport: undefined, inputDelayMs: 0, deliveryProbeDelayMs: 0 },
  );
  assert.deepEqual(calls.map((call) => `${call[0]} ${call[1]}`), [
    'agent get', 'pane send-text', 'pane send-keys', 'agent get',
  ]);
});
