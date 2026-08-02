import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const skillPath = join(root, 'skills', 'herdr-shepherd', 'SKILL.md');

const heading = '## Stacking Work Across Lanes';

function extractSection(raw) {
  const markdown = raw.replaceAll('\r\n', '\n');
  const start = markdown.indexOf(heading);
  assert.notEqual(start, -1, `missing "${heading}" section`);
  const rest = markdown.slice(start + heading.length);
  const end = rest.indexOf('\n## ');
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

test('skill documents stacking work across lanes', async () => {
  const skill = await readFile(skillPath, 'utf8');
  const section = extractSection(skill);
  assert.match(section, /stack git state, not processes/);
  assert.match(section, /Commit every checkpoint/);
  assert.match(section, /Keep stacks shallow/);
  assert.match(section, /git rebase --update-refs/);
  assert.match(section, /only while actively needed/);
  assert.match(section, /blocked-by relations/);
  assert.match(section, /before fanning out implementation lanes/);
});

