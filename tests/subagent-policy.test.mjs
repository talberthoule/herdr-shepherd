import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const skillPath = join(here, '..', 'skills', 'herdr-shepherd', 'SKILL.md');

const heading = '## Peer Session vs Subagent';

function extractSection(raw) {
  const markdown = raw.replaceAll('\r\n', '\n');
  const start = markdown.indexOf(heading);
  assert.notEqual(start, -1, `missing "${heading}" section`);
  const rest = markdown.slice(start + heading.length);
  const end = rest.indexOf('\n## ');
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

test('skill scopes sub-agent launching by runtime', async () => {
  const section = extractSection(await readFile(skillPath, 'utf8'));
  assert.match(section, /Default to a subagent for helper work/);
  assert.match(section, /running Claude has first-class subagents/);
  assert.match(section, /Codex and other runtimes/);
  assert.match(section, /unless no peer session is open to coordinate with/);
});

test('the split rule is stated in peer terms, not one tool s terms', async () => {
  const section = extractSection(await readFile(skillPath, 'utf8'));
  assert.match(section, /durable lane/);
  assert.match(section, /Do not split at all when the task is small/);
  assert.doesNotMatch(section, /Herdr instance/, 'the doctrine must not assume a specific multiplexer');
});
