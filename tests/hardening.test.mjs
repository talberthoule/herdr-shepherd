import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { classifyShellCommand, redactOutboundText } from '../skills/herdr-shepherd/scripts/core.mjs';
import {
  COMPOSER_MARKER,
  composerState,
  executeCoordinationRequest,
  isSubmitShaped,
} from '../skills/herdr-shepherd/scripts/coordinate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fakeHerdr = join(here, 'fake-herdr.mjs');
// Assembled so this file's own source cannot be read as an invocation by the
// classifier that guards the repo.
const H = 'her' + 'dr';

test('every invocation in a command is classified, not just the first', async () => {
  // `.match()` without /g meant a leading read scored the whole command, and
  // list-then-act is the most natural compound in a multiplexer.
  for (const command of [
    `${H} agent list && ${H} pane kill w1:p3`,
    `${H} pane list && ${H} workspace delete w2`,
    `${H} agent get w1:p1; ${H} pane close w1:p2`,
    `${H} api snapshot | tee log && ${H} tab rename w1:t1 x`,
  ]) {
    assert.equal(classifyShellCommand(command).kind, 'raw-mutation', `not denied: ${command}`);
  }
});

test('an unquoted path to the binary is still an invocation', async () => {
  for (const command of [
    `./${H} pane kill w1:p3`,
    `/usr/local/bin/${H} pane kill w1:p3`,
    `OUT=$(${H} pane kill w1:p3)`,
    `(${H} pane kill w1:p3)`,
  ]) {
    assert.equal(classifyShellCommand(command).kind, 'raw-mutation', `not denied: ${command}`);
  }
});

test('leading flags do not turn a read into a denial', async () => {
  // `--json pane` was scored as the operation, denying an ordinary read.
  assert.equal(classifyShellCommand(`${H} --json pane read w1:p2`).kind, 'read');
  assert.equal(classifyShellCommand(`${H} pane read w1:p2`).kind, 'read');
});

test('quoted prose and read-only commands are still not denied', async () => {
  assert.equal(classifyShellCommand(`grep "${H} agent send" log`).kind, 'other');
  assert.equal(classifyShellCommand(`${H} api snapshot`).kind, 'read');
  assert.equal(classifyShellCommand(`echo "don't" && ${H} agent list`).kind, 'read');
  // A real mutation hidden behind an interpreter must still be caught.
  assert.equal(classifyShellCommand(`bash -c "${H} pane kill x"`).kind, 'raw-mutation');
});

test('credential formats that reach a coordination message are blocked', async () => {
  // Assembled from fragments so these synthetic fixtures do not trip GitHub's
  // push protection, which reads a whole literal as a real leaked credential.
  for (const secret of [
    `sk-ant-${'api03'}-EXAMPLEKEYMATERIALHERE1234`,
    `DB_${'PASSWORD'}=hunter2hunter2`,
    `AWS_SECRET_${'ACCESS_KEY'}=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY`,
    `postgres://admin:${'hunter2'}@db:5432/app`,
    `AKIA${'IOSFODNN7EXAMPLE'}`,
    `xox${'b'}-1234567890-abcdefghijklmnop`,
  ]) {
    assert.equal(redactOutboundText(secret).blocked, true, `passed unredacted: ${secret}`);
  }
});

test('ordinary coordination prose is not mistaken for a credential', async () => {
  for (const benign of [
    'Resume the installer build and report blockers here.',
    'ALP-135 updated; needs your call on the drain deadline.',
    'Rebase onto main; the new sha is 81f6235.',
  ]) {
    assert.equal(redactOutboundText(benign).blocked, false, `falsely blocked: ${benign}`);
  }
});

test('every text-submitting shape is guarded, not only agent send', async () => {
  assert.equal(isSubmitShaped(['agent', 'send', 'w2:p1', 'x']), true);
  assert.equal(isSubmitShaped(['pane', 'run', 'w2:p1', 'x']), true);
  assert.equal(isSubmitShaped(['pane', 'send-text', 'w2:p1', 'x']), true);
  assert.equal(isSubmitShaped(['agent', 'prompt', 'w2:p1', 'x']), true);
  assert.equal(isSubmitShaped(['tab', 'focus', 'w2:t1']), false);
  assert.equal(isSubmitShaped(['pane', 'read', 'w2:p1']), false);
});

async function runRequest(request, envExtra = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'fake-herdr-harden-'));
  const log = join(dir, 'calls.jsonl');
  const result = await executeCoordinationRequest(request, {
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

const paneRunRequest = () => ({
  origin: 'user-directed',
  action: 'herdr.exec',
  args: ['pane', 'run', 'w2:p1', 'text pushed straight into the pane'],
  target: { type: 'pane', id: 'w2:p1' },
  reason: 'submit via the raw transport',
  message: '',
});

test('a user-directed pane run is refused against a blocked pane', async () => {
  // This shape performs the identical submit the wrapper uses internally, and
  // raw Herdr mutations are denied in the shell - so the wrapper was the only
  // path to it, and it was the unguarded one.
  await assert.rejects(
    () => runRequest(paneRunRequest(), { FAKE_HERDR_STATUSES: 'blocked' }),
    /blocked on user input/,
  );
});

test('a user-directed pane run is refused when the composer holds a draft', async () => {
  await assert.rejects(
    () => runRequest(paneRunRequest(), { FAKE_HERDR_COMPOSER: 'half a human thought' }),
    /unsubmitted composer draft/,
  );
});

test('an unreadable status refuses the submit instead of failing open', async () => {
  // The user-directed probe used to be non-fatal, so a dropped control socket
  // left the status null and the blocked refusal could not fire.
  await assert.rejects(
    () => runRequest(paneRunRequest(), { FAKE_HERDR_TRANSPORT_FAILURES: '99' }),
    /status could not be read/,
  );
});

test('the dirty-composer override announces itself', async () => {
  const { result, calls } = await runRequest(paneRunRequest(), {
    HERDR_SHEPHERD_ALLOW_DIRTY_COMPOSER: '1',
  });
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, new RegExp(`${COMPOSER_MARKER}: bypassed`),
    'a bypass that leaves no trace is indistinguishable from a guarded send');
  assert.ok(!calls.some((call) => call[1] === 'explain'), 'the override still spends no round trip');
});

test('the queue hint is read from the composer region only', async () => {
  // This repository's own docs quote the hint verbatim, so scanning every
  // region made any pane displaying them permanently un-sendable-to.
  const displayingTheDocs = JSON.stringify({
    agent: 'codex',
    evaluated_rules: [
      { region: 'whole_recent', evidence: { region_preview: 'the fallback is the `tab to queue message` hint, which a TUI renders' } },
      { region: 'bottom_non_empty_lines(3)', evidence: { region_preview: 'nothing pending\n' } },
    ],
  });
  assert.deepEqual(composerState(displayingTheDocs), { checked: false, draft: null });

  const reallyQueued = JSON.stringify({
    agent: 'codex',
    evaluated_rules: [
      { region: 'bottom_non_empty_lines(3)', evidence: { region_preview: 'queued text\n\n  tab to queue message\n' } },
    ],
  });
  assert.equal(composerState(reallyQueued).draft, 'an unsubmitted message (queue hint visible)');
});
