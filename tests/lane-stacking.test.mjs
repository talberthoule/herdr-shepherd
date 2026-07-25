import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const skillPath = join(root, 'skills', 'herdr-shepherd', 'SKILL.md');
const mirrorPaths = [join(root, 'AGENTS.md'), join(root, 'CLAUDE.md')];

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

test('AGENTS.md and CLAUDE.md mirror the lane stacking section verbatim', async () => {
  const canonical = extractSection(await readFile(skillPath, 'utf8'));
  for (const path of mirrorPaths) {
    const mirrored = extractSection(await readFile(path, 'utf8'));
    assert.equal(mirrored, canonical, `${path} lane stacking section drifted from SKILL.md`);
  }
});
