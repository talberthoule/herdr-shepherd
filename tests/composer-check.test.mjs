import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  COMPOSER_MARKER,
  composerDraft,
  composerState,
  executeCoordinationRequest,
} from '../skills/herdr-shepherd/scripts/coordinate.mjs';

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

async function execute(envExtra = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'fake-herdr-composer-'));
  const log = join(dir, 'calls.jsonl');
  const result = await executeCoordinationRequest(request(), {
    command: process.execPath,
    prefixArgs: [fakeHerdr],
    env: {
      ...process.env,
      FAKE_HERDR_LOG: log,
      FAKE_HERDR_STATUSES: 'idle',
      HERDR_PANE_ID: 'w1:pE',
      HERDR_TAB_ID: '',
      HERDR_SHEPHERD_TRANSPORT: '',
      HERDR_SHEPHERD_ALLOW_DIRTY_COMPOSER: '',
      ...envExtra,
    },
  });
  const calls = (await readFile(log, 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  return { result, calls };
}

// The live shape: the prompt box is reported among evaluated_rules even when a
// higher-priority rule wins, so the draft is readable from a working pane too.
function explainJson(preview, { winner = 'live_prompt_box' } = {}) {
  return JSON.stringify({
    state: winner === 'live_prompt_box' ? 'idle' : 'working',
    evaluated_rules: [
      { id: 'osc_title_working', matched: winner !== 'live_prompt_box', region: 'osc_title', evidence: { region_preview: '⠂ a task title' } },
      { id: 'live_prompt_box', matched: true, region: 'prompt_box_body', evidence: { region_preview: preview } },
    ],
  });
}

test('an empty composer reads as no draft', () => {
  assert.equal(composerDraft(explainJson('❯\n')), null);
  assert.equal(composerDraft(explainJson('❯')), null);
});

test('a draft is extracted regardless of which rule won detection', () => {
  // The live evidence separates the glyph from the text with U+00A0.
  assert.equal(composerDraft(explainJson('❯ split the transport section\n')), 'split the transport section');
  assert.equal(
    composerDraft(explainJson('❯ go ahead and implement ALP-172\n', { winner: 'osc_title_working' })),
    'go ahead and implement ALP-172',
  );
});

test('an unreadable explain leaves the composer unknown rather than drafted', () => {
  assert.equal(composerDraft('not json'), null);
  assert.equal(composerDraft(JSON.stringify({ evaluated_rules: [] })), null);
  assert.equal(composerDraft(JSON.stringify({ evaluated_rules: [{ region: 'osc_title', evidence: { region_preview: 'x' } }] })), null);
});

test('a composer that could not be read is reported unchecked, never clean', () => {
  // Verified live: Codex's manifest has no prompt_box_body region, so a
  // region-only check would score an unread composer identical to an empty one.
  const codex = JSON.stringify({
    agent: 'codex',
    evaluated_rules: [{ region: 'bottom_non_empty_lines(3)', evidence: { region_preview: 'nothing pending\n' } }],
  });
  assert.deepEqual(composerState(codex), { checked: false, draft: null });
  assert.deepEqual(composerState(explainJson('❯\n')), { checked: true, draft: null });
});

test('the queue hint detects an unsubmitted composer on agents with no prompt box', () => {
  const codex = JSON.stringify({
    agent: 'codex',
    evaluated_rules: [{
      region: 'bottom_non_empty_lines(3)',
      evidence: { region_preview: '[Herdr from w1:pE] earlier message\n\n  tab to queue message\n' },
    }],
  });
  const state = composerState(codex);
  assert.equal(state.checked, true);
  assert.match(state.draft, /unsubmitted message/);
});

test('a clean composer is checked once and the send proceeds', async () => {
  const { result, calls } = await execute();
  assert.equal(result.exitCode, 0);
  assert.deepEqual(calls.map((call) => `${call[0]} ${call[1]}`), [
    'agent get', 'agent explain', 'pane run', 'agent wait',
  ]);
});

test('a drafted composer refuses the send before anything is submitted', async () => {
  await assert.rejects(
    () => execute({ FAKE_HERDR_COMPOSER: 'split the transport section into its own skill' }),
    (error) => {
      assert.match(error.message, /unsubmitted composer draft/);
      assert.match(error.message, /split the transport section/, 'the excerpt must show what would be force-submitted');
      assert.match(error.message, /HERDR_SHEPHERD_ALLOW_DIRTY_COMPOSER=1/);
      return true;
    },
  );
});

test('a long draft is excerpted rather than echoed whole', async () => {
  await assert.rejects(
    () => execute({ FAKE_HERDR_COMPOSER: 'x'.repeat(400) }),
    (error) => {
      assert.match(error.message, /…/);
      assert.ok(error.message.length < 500, 'the refusal must stay readable');
      return true;
    },
  );
});

test('the override sends anyway and skips the check entirely', async () => {
  const { result, calls } = await execute({
    FAKE_HERDR_COMPOSER: 'a draft the user accepted merging',
    HERDR_SHEPHERD_ALLOW_DIRTY_COMPOSER: '1',
  });
  assert.equal(result.exitCode, 0);
  assert.ok(!calls.some((call) => call[1] === 'explain'), 'the override spends no round trip on the check');
});

test('a failed explain does not block a send it cannot judge', async () => {
  const { result, calls } = await execute({ FAKE_HERDR_EXPLAIN_FAILURE: '1' });
  assert.equal(result.exitCode, 0, 'an unknown composer is not a positive draft reading');
  assert.ok(calls.some((call) => call[1] === 'run'), 'the send still goes out');
});

test('the check runs on user-directed sends too', async () => {
  const value = { ...request(), origin: 'user-directed' };
  const dir = await mkdtemp(join(tmpdir(), 'fake-herdr-composer-'));
  await assert.rejects(() => executeCoordinationRequest(value, {
    command: process.execPath,
    prefixArgs: [fakeHerdr],
    env: {
      ...process.env,
      FAKE_HERDR_LOG: join(dir, 'calls.jsonl'),
      FAKE_HERDR_STATUSES: 'idle',
      FAKE_HERDR_COMPOSER: 'half a thought',
      HERDR_PANE_ID: 'w1:pE',
      HERDR_TAB_ID: '',
      HERDR_SHEPHERD_ALLOW_DIRTY_COMPOSER: '',
    },
  }), /unsubmitted composer draft/, 'user authorization does not make force-submitting their draft safe');
});
