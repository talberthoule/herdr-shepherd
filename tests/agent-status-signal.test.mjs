import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const skillPath = join(root, 'skills', 'herdr-shepherd', 'SKILL.md');
const herdrRefPath = join(root, 'skills', 'herdr-shepherd', 'references', 'herdr-integration.md');

const heading = '## Peer Liveness as a Coordination Signal';

function extractSection(raw, from = heading) {
  const markdown = raw.replaceAll('\r\n', '\n');
  const start = markdown.indexOf(from);
  assert.notEqual(start, -1, `missing "${from}" section`);
  const rest = markdown.slice(start + from.length);
  const end = rest.indexOf('\n## ');
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

// The doctrine is tool-neutral and lives in SKILL.md; Herdr's concrete status
// vocabulary is a property of Herdr and lives with the integration notes.
test('skill states the liveness doctrine without binding it to one tool', async () => {
  const section = extractSection(await readFile(skillPath, 'utf8'));
  assert.match(section, /never what it is running/);
  assert.match(section, /blocked on human input is unreachable by message/);
  assert.match(section, /"[Uu]nknown" is overloaded/);
  assert.match(section, /inferred, not reported/);
  assert.doesNotMatch(section, /herdr /i, 'the doctrine section must not name one multiplexer');
});

test('herdr reference carries the concrete status vocabulary and its traps', async () => {
  const reference = await readFile(herdrRefPath, 'utf8');
  for (const status of ['working', 'idle', 'blocked', 'done', 'unknown']) {
    assert.match(reference, new RegExp(`\`${status}\``), `missing the "${status}" status`);
  }
  assert.match(reference, /derived by matching detection rules against the pane's rendered screen|matching detection rules against the pane's rendered screen/);
  assert.match(reference, /done is a UI attention state; use idle for CLI agent completion waits/);
  assert.match(reference, /nothing to do with a tracker's Done column/);
  assert.match(reference, /pane report-agent/);
  assert.match(reference, /`agent wait --timeout` is \*\*ignored\*\*/);
});

test('skill requires a blocked sweep and names escalation as the remedy', async () => {
  const section = extractSection(await readFile(skillPath, 'utf8'));
  assert.match(section, /Sweep for blocked peers on every coordination wake/);
  assert.match(section, /stalled on a human and stays invisible until somebody looks/);
  assert.match(section, /Escalation is the entire remedy/);
});

test('skill warns about the input merge without assuming a tool', async () => {
  const section = extractSection(await readFile(skillPath, 'utf8'));
  assert.match(section, /merges with whatever sits unsubmitted/);
  assert.match(section, /this send went out unguarded/);
  assert.match(section, /never as grounds for a blind resend/);
});

test('herdr reference documents the composer check the wrapper enforces', async () => {
  const reference = await readFile(herdrRefPath, 'utf8');
  assert.match(reference, /`prompt_box_body` region preview/);
  assert.match(reference, /reads from a working pane too/);
  assert.match(reference, /before every send, on both origins/);
  assert.match(reference, /HERDR_SHEPHERD_ALLOW_DIRTY_COMPOSER=1/);
  // The one-sided fallback is the part an operator must not misread.
  assert.match(reference, /tab to queue message/);
  assert.match(reference, /proves a dirty composer but can never prove a clean one/);
  assert.match(reference, /coordination-composer: unchecked/);
});

test('herdr reference records the blocked-pane hazard that motivates the refusal', async () => {
  const reference = await readFile(herdrRefPath, 'utf8');
  assert.match(reference, /answers the pane's pending prompt with its \*\*default option\*\*/);
  assert.match(reference, /message text is discarded/);
  assert.match(reference, /refuses when the pre-send status is `blocked`/);
});

test('suspected parallel work ranks candidates by liveness before reading them', async () => {
  const skill = (await readFile(skillPath, 'utf8')).replaceAll('\r\n', '\n');
  const section = skill.slice(
    skill.indexOf('## Suspected Parallel Work'),
    skill.indexOf('## Peer Session vs Subagent'),
  );
  assert.match(section, /Rank the candidates by liveness before spending reads/);
  assert.match(section, /Liveness orders the queue; it never settles overlap/);
});
