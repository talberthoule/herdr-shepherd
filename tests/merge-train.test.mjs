import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const skillPath = join(root, 'skills', 'herdr-shepherd', 'SKILL.md');

const heading = '## Merge Train Coordination';

function extractSection(raw) {
  const markdown = raw.replaceAll('\r\n', '\n');
  const start = markdown.indexOf(heading);
  assert.notEqual(start, -1, `missing "${heading}" section`);
  const rest = markdown.slice(start + heading.length);
  const end = rest.indexOf('\n## ');
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

test('skill documents merge train coordination', async () => {
  const skill = await readFile(skillPath, 'utf8');
  const section = extractSection(skill);
  assert.match(section, /single integrator/);
  assert.match(section, /never touch the default branch or remotes/);
  assert.match(section, /reviews preempt the reviewer's own implementation lane/);
  assert.match(section, /same frozen branch/);
  assert.match(section, /never reviews its own branch/);
  assert.match(section, /re-run all gates/);
  assert.match(section, /Always escalate remote pushes/);
  assert.match(section, /load-bearing, not ceremony/);
});

