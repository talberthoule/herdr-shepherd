import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { listAuditEvents } from '../skills/herdr-shepherd/scripts/core.mjs';
import { handleHookPayload } from '../skills/herdr-shepherd/scripts/hook-lib.mjs';
import { runtimeFromEnvironment } from '../skills/herdr-shepherd/scripts/hook.mjs';

const request = {
  origin: 'proactive',
  action: 'herdr.exec',
  args: ['agent', 'send', 'w2:p1', 'Please resume the installer build.'],
  target: { type: 'agent', id: 'w2:p1' },
  reason: 'Avoid duplicated work',
  message: 'Please resume the installer build.',
};

const commandFor = (value) => `@'\n${JSON.stringify(value)}\n'@ | node "C:\\skill\\coordinate.mjs" --stdin`;
const posixCommandFor = (value) => `node "$HOME/.codex/plugins/herdr-shepherd/skills/herdr-shepherd/scripts/coordinate.mjs" --stdin <<'JSON'\n${JSON.stringify(value)}\nJSON`;

async function stateDir() {
  return mkdtemp(join(tmpdir(), 'herdr-hook-'));
}

test('read-only inspection is ignored by the audit hook', async () => {
  const dir = await stateDir();
  const result = await handleHookPayload({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'herdr api snapshot' },
  }, { runtime: 'codex', stateDir: dir, launchViewer: false });
  assert.equal(result.output, undefined);
  assert.deepEqual(await listAuditEvents(dir), []);
});

test('raw mutation is denied before execution', async () => {
  const result = await handleHookPayload({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'herdr agent send w2:p1 continue' },
  }, { runtime: 'claude-code', stateDir: await stateDir(), launchViewer: false });
  assert.equal(result.output.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(result.output.hookSpecificOutput.permissionDecisionReason, /audited wrapper/i);
});

test('proactive wrapper request is logged and viewer is activated', async () => {
  const dir = await stateDir();
  let activations = 0;
  const result = await handleHookPayload({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_use_id: 'tool-123',
    session_id: 'session-1',
    turn_id: 'turn-1',
    tool_input: { command: commandFor(request) },
  }, { runtime: 'codex', sourceId: 'w1:pH', stateDir: dir, launchViewer: true, ensureViewer: async () => { activations += 1; } });
  assert.equal(result.output, undefined);
  assert.equal(activations, 1);
  const [event] = await listAuditEvents(dir);
  assert.equal(event.phase, 'attempted');
  assert.equal(event.event_id, 'tool-123');
  assert.deepEqual(event.source, { type: 'agent', id: 'w1:pH' });
  assert.deepEqual(event.target, { type: 'agent', id: 'w2:p1' });
  assert.equal(event.message_redacted, request.message);
});

test('POSIX literal heredoc wrapper request is accepted', async () => {
  const dir = await stateDir();
  const result = await handleHookPayload({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_use_id: 'tool-posix',
    tool_input: { command: posixCommandFor(request) },
  }, { runtime: 'codex', sourceId: 'w1:pH', stateDir: dir, launchViewer: false });
  assert.equal(result.output, undefined);
  const [event] = await listAuditEvents(dir);
  assert.equal(event.event_id, 'tool-posix');
  assert.equal(event.message_redacted, request.message);
});

test('hook runtime is detected from plugin environment when no installer argument is present', () => {
  assert.equal(runtimeFromEnvironment({ PLUGIN_ROOT: '/tmp/plugin', CLAUDE_PLUGIN_ROOT: '/tmp/plugin' }), 'codex');
  assert.equal(runtimeFromEnvironment({ CLAUDE_PLUGIN_ROOT: '/tmp/plugin' }), 'claude-code');
  assert.equal(runtimeFromEnvironment({}), 'unknown');
});

test('user-directed wrapper request is logged without opening viewer', async () => {
  const dir = await stateDir();
  let activations = 0;
  await handleHookPayload({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_use_id: 'tool-user',
    tool_input: { command: commandFor({ ...request, origin: 'user-directed' }) },
  }, { runtime: 'claude-code', stateDir: dir, launchViewer: true, ensureViewer: async () => { activations += 1; } });
  assert.equal(activations, 0);
  assert.equal((await listAuditEvents(dir))[0].origin, 'user-directed');
});

test('post success and failure append outcome phases', async () => {
  const dir = await stateDir();
  for (const [eventName, toolUseId, response, phase] of [
    ['PostToolUse', 'tool-ok', { exit_code: 0, output: 'sent' }, 'succeeded'],
    ['PostToolUseFailure', 'tool-bad', { exit_code: 1, error: 'offline' }, 'failed'],
  ]) {
    await handleHookPayload({
      hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: toolUseId,
      tool_input: { command: commandFor(request) },
    }, { runtime: 'claude-code', stateDir: dir, launchViewer: false });
    await handleHookPayload({
      hook_event_name: eventName, tool_name: 'Bash', tool_use_id: toolUseId,
      tool_input: { command: commandFor(request) }, tool_response: response,
    }, { runtime: 'claude-code', stateDir: dir, launchViewer: false });
    const events = await listAuditEvents(dir);
    assert.equal(events.at(-1).phase, phase);
  }
});

test('the outcome event records which wrapper performed the send', async () => {
  const dir = await stateDir();
  // A Windows path is the case that matters: its separators must not be read as
  // JSON escapes and truncate the recorded value.
  const identity = 'herdr-shepherd 0.1.0 (C:\\plugins\\shepherd\\node\\scripts\\coordinate.mjs)';
  await handleHookPayload({
    hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'wrapper-identity',
    tool_input: { command: posixCommandFor(request) },
    tool_response: { stdout: `coordination-wrapper: ${identity}\ncoordination-delivery: confirmed\n`, exitCode: 0 },
  }, { runtime: 'claude-code', stateDir: dir, launchViewer: false });
  const event = (await listAuditEvents(dir)).at(-1);
  assert.equal(event.phase, 'succeeded');
  assert.equal(event.delivery, 'confirmed');
  assert.equal(event.wrapper, identity);
});

test('wrapper identity is also recovered from a plain-string tool response', async () => {
  const dir = await stateDir();
  await handleHookPayload({
    hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'wrapper-identity-string',
    tool_input: { command: posixCommandFor(request) },
    tool_response: 'coordination-wrapper: herdr-shepherd 0.1.0 (/opt/h/scripts/coordinate.mjs)\ncoordination-delivery: queued\n',
  }, { runtime: 'claude-code', stateDir: dir, launchViewer: false });
  const event = (await listAuditEvents(dir)).at(-1);
  assert.equal(event.wrapper, 'herdr-shepherd 0.1.0 (/opt/h/scripts/coordinate.mjs)');
  assert.equal(event.delivery, 'queued');
});

test('an outcome without a wrapper marker omits the field rather than guessing', async () => {
  const dir = await stateDir();
  await handleHookPayload({
    hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'silent-wrapper',
    tool_input: { command: posixCommandFor(request) },
    tool_response: JSON.stringify({ stdout: '', exitCode: 0 }),
  }, { runtime: 'claude-code', stateDir: dir, launchViewer: false });
  assert.equal('wrapper' in (await listAuditEvents(dir)).at(-1), false);
});

test('secret-bearing wrapper request is denied without storing the secret', async () => {
  const dir = await stateDir();
  const secret = 'token=ghp_1234567890abcdefghijklmnopqrstuvwxyz';
  const result = await handleHookPayload({
    hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'secret-tool',
    tool_input: { command: commandFor({ ...request, args: ['agent', 'send', 'w2:p1', secret], message: secret }) },
  }, { runtime: 'codex', stateDir: dir, launchViewer: false });
  assert.equal(result.output.hookSpecificOutput.permissionDecision, 'deny');
  assert.doesNotMatch(JSON.stringify(await listAuditEvents(dir)), /ghp_1234567890/);
});
