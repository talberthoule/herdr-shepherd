import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const skillPath = join(root, 'skills', 'herdr-shepherd', 'SKILL.md');

const heading = '## Agent Status as a Coordination Signal';

function extractSection(raw) {
  const markdown = raw.replaceAll('\r\n', '\n');
  const start = markdown.indexOf(heading);
  assert.notEqual(start, -1, `missing "${heading}" section`);
  const rest = markdown.slice(start + heading.length);
  const end = rest.indexOf('\n## ');
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

test('skill documents the status vocabulary and its limits', async () => {
  const section = extractSection(await readFile(skillPath, 'utf8'));
  for (const status of ['working', 'idle', 'blocked', 'done', 'unknown']) {
    assert.match(section, new RegExp(`\`${status}\``), `missing the "${status}" status`);
  }
  assert.match(section, /derived by matching detection rules against the pane's rendered screen/);
  assert.match(section, /done is a UI attention state; use idle for CLI agent completion waits/);
  assert.match(section, /nothing to do with a tracker's Done column/);
  assert.match(section, /`unknown` is overloaded/);
  assert.match(section, /never \*what\* it is running/);
  assert.match(section, /pane report-agent/);
});

test('skill requires a blocked sweep and names escalation as the remedy', async () => {
  const section = extractSection(await readFile(skillPath, 'utf8'));
  assert.match(section, /Sweep for blocked panes on every coordination wake/);
  assert.match(section, /stalled on a human and stays invisible until somebody looks/);
  assert.match(section, /Escalation is the entire remedy/);
});

test('skill documents the composer check the wrapper enforces', async () => {
  const section = extractSection(await readFile(skillPath, 'utf8'));
  assert.match(section, /`prompt_box_body` region preview/);
  assert.match(section, /reads from a working pane too/);
  assert.match(section, /before every send, on both origins/);
  assert.match(section, /HERDR_SHEPHERD_ALLOW_DIRTY_COMPOSER=1/);
  // The one-sided fallback is the part an operator must not misread.
  assert.match(section, /tab to queue message/);
  assert.match(section, /proves a dirty composer but can never prove a clean one/);
  assert.match(section, /coordination-composer: unchecked/);
  assert.match(section, /this send went out unguarded/);
});

test('suspected parallel work ranks candidates by status before reading them', async () => {
  const skill = (await readFile(skillPath, 'utf8')).replaceAll('\r\n', '\n');
  const section = skill.slice(
    skill.indexOf('## Suspected Parallel Work'),
    skill.indexOf('## Workflow'),
  );
  assert.match(section, /Rank those candidates by status before spending reads/);
  assert.match(section, /Status orders the queue; it never settles overlap/);
});


