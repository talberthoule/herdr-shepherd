import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { executeCoordinationRequest } from '../skills/herdr-shepherd/scripts/coordinate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fakeHerdr = join(here, 'fake-herdr.mjs');
const skillPath = join(here, '..', 'skills', 'herdr-shepherd', 'SKILL.md');

function request(overrides) {
  const value = {
    origin: 'proactive',
    action: 'herdr.exec',
    args: ['agent', 'send', 'w2:p6', 'Confirm browser-control capability and idle/disposable status.'],
    target: { type: 'agent', id: 'w2:p6' },
    reason: 'Check helper capability before handoff',
    message: 'Confirm browser-control capability and idle/disposable status.',
    ...overrides,
  };
  if (value.origin === 'proactive') value.args = ['agent', 'send', value.target.id, value.message];
  return value;
}

test('skill documents capability-aware helper restart handoffs', async () => {
  const skill = await readFile(skillPath, 'utf8');
  assert.match(skill, /Capability-Aware Helper Handoffs/);
  assert.match(skill, /already-capable helper/);
  assert.match(skill, /Never restart the coordinating pane/);
  assert.match(skill, /confirm the fresh helper exposes the capability/i);
});

test('controlled fake-Herdr simulation keeps lifecycle mutations user-directed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fake-herdr-capability-'));
  const log = join(dir, 'calls.jsonl');
  const env = {
    ...process.env,
    FAKE_HERDR_LOG: log,
    FAKE_HERDR_TAB_LABEL: 'coordinator',
    HERDR_PANE_ID: 'w4:p1',
    HERDR_TAB_ID: 'w4:t1',
  };

  for (const value of [
    request({ message: 'Confirm browser-control capability and idle/disposable status.' }),
    request({
      origin: 'user-directed',
      args: ['pane', 'close', 'w2:p6'],
      target: { type: 'pane', id: 'w2:p6' },
      reason: 'Restart disposable helper after explicit user approval',
      message: '',
    }),
    request({
      origin: 'user-directed',
      args: ['agent', 'send', 'w2:p6', 'Confirm fresh session exposes browser-control before taking task.'],
      reason: 'Confirm restarted helper capability',
      message: 'Confirm fresh session exposes browser-control before taking task.',
    }),
    request({ reason: 'Delegate original task to confirmed helper', message: 'Run the delegated browser-control task and return evidence.' }),
  ]) {
    const result = await executeCoordinationRequest(value, {
      command: process.execPath,
      prefixArgs: [fakeHerdr],
      env,
      inputDelayMs: 0,
    });
    assert.equal(result.exitCode, 0);
  }

  const calls = (await readFile(log, 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(calls.filter((call) => call[0] === 'pane' && call[1] === 'close'), [['pane', 'close', 'w2:p6']]);
  assert.equal(calls.some((call) => call.includes('w4:p1') && call[1] === 'close'), false);
  // Every send to the helper is bracketed by a status probe: existence/status
  // before it, delivery verdict after it.
  const sends = calls.filter((call) => call[0] === 'pane' && call[1] === 'send-text' && call[2] === 'w2:p6').length;
  const probes = calls.filter((call) => call[0] === 'agent' && call[1] === 'get' && call[2] === 'w2:p6').length;
  assert.equal(sends, 3);
  assert.equal(probes, sends * 2, 'each send should probe the target before and after');
});
