import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const skillPath = join(root, 'skills', 'herdr-shepherd', 'SKILL.md');
const mirrorPaths = [join(root, 'AGENTS.md'), join(root, 'CLAUDE.md')];

const heading = '## Coordination Transport Reliability';

function extractSection(raw) {
  const markdown = raw.replaceAll('\r\n', '\n');
  const start = markdown.indexOf(heading);
  assert.notEqual(start, -1, `missing "${heading}" section`);
  const rest = markdown.slice(start + heading.length);
  const end = rest.indexOf('\n## ');
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

test('skill documents coordination transport reliability', async () => {
  const skill = await readFile(skillPath, 'utf8');
  const section = extractSection(skill);
  assert.match(section, /types the `message` field verbatim/);
  assert.match(section, /first 1024 characters/);
  assert.match(section, /part 1\/2/);
  assert.match(section, /sender's session log/);
  assert.match(section, /within about 20 seconds/);
  assert.match(section, /stuck composers/);
  assert.match(section, /ground truth/);
  assert.match(section, /branch-ready claim/);
  assert.match(section, /ACKs of ACKs/);
  assert.match(section, /unsolicited routine chatter/);
  assert.match(section, /ACK-requested still requires a compact ACK/);
  assert.match(section, /stuck composer is indistinguishable from understood/);
  assert.match(section, /sender owns delivery recovery/);
  assert.match(section, /never the fallback/);
  assert.match(section, /do-not-acknowledge/);
  assert.doesNotMatch(section, /treat silence as understood/);
});

test('AGENTS.md and CLAUDE.md mirror the transport reliability section verbatim', async () => {
  const canonical = extractSection(await readFile(skillPath, 'utf8'));
  for (const path of mirrorPaths) {
    const mirrored = extractSection(await readFile(path, 'utf8'));
    assert.equal(mirrored, canonical, `${path} transport reliability section drifted from SKILL.md`);
  }
});
