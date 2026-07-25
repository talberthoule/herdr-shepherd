import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const skillPath = join(here, '..', 'skills', 'herdr-shepherd', 'SKILL.md');

const heading = '## Herdr Instance vs Subagent';

function extractSection(raw) {
  const markdown = raw.replaceAll('\r\n', '\n');
  const start = markdown.indexOf(heading);
  assert.notEqual(start, -1, `missing "${heading}" section`);
  const rest = markdown.slice(start + heading.length);
  const end = rest.indexOf('\n## ');
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

test('skill scopes sub-agent launching by runtime', async () => {
  const skill = await readFile(skillPath, 'utf8');
  const section = extractSection(skill);
  assert.match(section, /Default to a subagent for helper work/);
  assert.match(section, /running Claude has first-class subagents/);
  assert.match(section, /Codex and other runtimes/);
  assert.match(section, /unless no other Herdr tab is open to coordinate with/);
});
