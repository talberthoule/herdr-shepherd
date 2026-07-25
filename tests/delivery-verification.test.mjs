import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  deliveryVerdict,
  executeCoordinationRequest,
} from '../skills/coordinating-herdr-agents/scripts/coordinate.mjs';
import { handleHookPayload } from '../skills/coordinating-herdr-agents/scripts/hook-lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fakeHerdr = join(here, 'fake-herdr.mjs');
const skillPath = join(here, '..', 'skills', 'coordinating-herdr-agents', 'SKILL.md');

function request() {
  return {
    origin: 'proactive',
    action: 'herdr.exec',
    args: ['agent', 'send', 'w2:p1', 'Resume the installer build.'],
    target: { type: 'agent', id: 'w2:p1' },
    reason: 'Continue paused work',
    message: 'Resume the installer build.',
  };
}

async function send(statuses) {
  const dir = await mkdtemp(join(tmpdir(), 'fake-herdr-delivery-'));
  const log = join(dir, 'calls.jsonl');
  const result = await executeCoordinationRequest(request(), {
    command: process.execPath,
    prefixArgs: [fakeHerdr],
    env: { ...process.env, FAKE_HERDR_LOG: log, FAKE_HERDR_STATUSES: statuses, HERDR_PANE_ID: 'w1:pE' },
    inputDelayMs: 0,
    deliveryProbeDelayMs: 0,
  });
  return { result, log };
}

test('idle target that starts working is a confirmed delivery', async () => {
  const { result } = await send('idle,working');
  assert.match(result.stdout, /coordination-delivery: confirmed/);
});

test('idle target that stays idle is unconfirmed, not success', async () => {
  const { result } = await send('idle,idle');
  assert.match(result.stdout, /coordination-delivery: unconfirmed/);
  assert.equal(result.exitCode, 0, 'the send itself still succeeded; only delivery is in doubt');
});

test('target already working reports queued rather than guessing', async () => {
  const { result } = await send('working,working');
  assert.match(result.stdout, /coordination-delivery: queued/);
});

test('unreadable status reports unknown instead of assuming delivery', async () => {
  const { result } = await send('none,none');
  assert.match(result.stdout, /coordination-delivery: unknown/);
});

test('verdict never claims delivery without a before and after reading', () => {
  assert.equal(deliveryVerdict(null, 'working'), 'unknown');
  assert.equal(deliveryVerdict('idle', null), 'unknown');
  assert.equal(deliveryVerdict('done', 'working'), 'confirmed');
  assert.equal(deliveryVerdict('done', 'done'), 'unconfirmed');
});

test('a failed Enter skips the probe and reports the failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fake-herdr-delivery-'));
  const log = join(dir, 'calls.jsonl');
  const result = await executeCoordinationRequest(request(), {
    command: process.execPath,
    prefixArgs: [fakeHerdr],
    env: {
      ...process.env,
      FAKE_HERDR_LOG: log,
      FAKE_HERDR_STATUSES: 'idle,working',
      FAKE_HERDR_KEYS_FAILURE: '1',
      HERDR_PANE_ID: 'w1:pE',
    },
    inputDelayMs: 0,
    deliveryProbeDelayMs: 0,
  });
  assert.equal(result.exitCode, 1);
  assert.doesNotMatch(result.stdout, /coordination-delivery/);
  const calls = (await readFile(log, 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(calls.filter((c) => c[0] === 'agent' && c[1] === 'get').length, 1);
});

test('the audit event records the delivery verdict', async () => {
  const stateDir = await mkdtemp(join(tmpdir(), 'herdr-audit-delivery-'));
  const command = `node coordinate.mjs --stdin <<'JSON'\n${JSON.stringify(request())}\nJSON`;
  await handleHookPayload({
    hook_event_name: 'PostToolUse',
    tool_use_id: 'evt-1',
    tool_input: { command },
    tool_response: 'ok\ncoordination-delivery: unconfirmed\n',
  }, { runtime: 'claude-code', stateDir, launchViewer: false });
  const events = (await readFile(join(stateDir, 'audit.jsonl'), 'utf8'))
    .trim().split(/\r?\n/).map(JSON.parse);
  const recorded = events.find((e) => e.phase === 'succeeded');
  assert.ok(recorded, 'expected a succeeded event');
  assert.equal(recorded.delivery, 'unconfirmed');
});

test('viewer renders the delivery verdict with its own explanation', async () => {
  const viewer = await readFile(
    join(here, '..', 'skills', 'coordinating-herdr-agents', 'scripts', 'audit-server.mjs'),
    'utf8',
  );
  assert.match(viewer, /DELIVERY_TITLE=\{[^}]*unconfirmed:/);
  assert.match(viewer, /Suspect a stuck composer/);
  assert.match(viewer, /dl-'\+esc\(e\.delivery\)/);
});

test('skill documents the delivery verdicts', async () => {
  const skill = await readFile(skillPath, 'utf8');
  for (const verdict of ['confirmed', 'unconfirmed', 'queued', 'unknown']) {
    assert.match(skill, new RegExp(`\`${verdict}\``), `missing "${verdict}" verdict`);
  }
  assert.match(skill, /probes the target's agent status before and shortly after/);
});
