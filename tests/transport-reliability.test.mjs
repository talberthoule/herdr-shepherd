import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const skillPath = join(root, 'skills', 'herdr-shepherd', 'SKILL.md');

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
  assert.match(section, /one atomic `pane run` call/);
  assert.match(section, /submits the `message` field verbatim/);
  assert.match(section, /probes the target's status before the send/);
  assert.match(section, /Only `confirmed` may be treated as delivered/);
  assert.match(section, /Never send to a `blocked` target/);
  assert.match(section, /answers the pane's pending prompt with its default option/);
  assert.match(section, /force-submits both as one message/);
  assert.match(section, /ground truth/);
  assert.match(section, /branch-ready claim/);
  assert.match(section, /ACKs of ACKs/);
  assert.match(section, /unsolicited routine chatter/);
  assert.match(section, /ACK-requested still requires a compact ACK/);
  assert.match(section, /sender owns delivery recovery/);
  assert.match(section, /never the fallback/);
  assert.match(section, /do-not-acknowledge/);
  assert.match(section, /`agent wait` and trust `--timeout`/);
  // Legacy keystroke-transport hazards stay documented while the fallback exists.
  assert.match(section, /first 1024 characters/);
  assert.match(section, /part 1\/2/);
  assert.match(section, /sender's session log/);
  assert.match(section, /within about 20 seconds/);
  assert.match(section, /stuck composers/);
  assert.match(section, /stuck composer is indistinguishable from understood/);
  assert.doesNotMatch(section, /treat silence as understood/);
});

