import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const skillPath = join(root, 'skills', 'herdr-shepherd', 'SKILL.md');
const herdrRefPath = join(root, 'skills', 'herdr-shepherd', 'references', 'herdr-integration.md');

const heading = '## Coordination Transport Reliability';

function extractSection(raw) {
  const markdown = raw.replaceAll('\r\n', '\n');
  const start = markdown.indexOf(heading);
  assert.notEqual(start, -1, `missing "${heading}" section`);
  const rest = markdown.slice(start + heading.length);
  const end = rest.indexOf('\n## ');
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

// What survives in the skill is the part that is true of any send channel.
test('skill documents transport reliability in tool-neutral terms', async () => {
  const section = extractSection(await readFile(skillPath, 'utf8'));
  assert.match(section, /Sends are lossy/);
  assert.match(section, /Establish a delivery verdict rather than assuming one/);
  assert.match(section, /Never send to a peer blocked on human input/);
  assert.match(section, /ground truth/);
  assert.match(section, /branch-ready claim/);
  assert.match(section, /ACKs of ACKs/);
  assert.match(section, /ACK-requested still requires a compact ACK/);
  assert.match(section, /sender owns delivery recovery/);
  assert.match(section, /never the fallback/);
  assert.match(section, /do-not-acknowledge/);
  assert.match(section, /Bound every wait with your own watchdog/);
  assert.doesNotMatch(section, /treat silence as understood/);
  assert.doesNotMatch(section, /pane run|herdr /i, 'transport doctrine must not name one multiplexer');
});

test('skill separates ACK from proof of submission', async () => {
  const section = extractSection(await readFile(skillPath, 'utf8'));
  assert.match(section, /An ACK proves the recipient holds the content, not that your send delivered it/);
  assert.match(section, /pull the content by session read before your message ever surfaces/);
  assert.match(section, /duplicate turn over work already done/);
});

// The concrete Herdr transport, its verdict names, and the legacy keystroke
// hazards belong with the integration notes, not with the doctrine.
test('herdr reference documents the concrete transport and verdicts', async () => {
  const reference = await readFile(herdrRefPath, 'utf8');
  assert.match(reference, /one atomic `pane run` call/);
  assert.match(reference, /Only `confirmed` may be treated as delivered/);
  for (const verdict of ['confirmed', 'queued', 'unconfirmed', 'unknown']) {
    assert.match(reference, new RegExp(`\`${verdict}\``), `missing the "${verdict}" verdict`);
  }
});

test('herdr reference keeps the legacy keystroke hazards while that transport exists', async () => {
  const reference = await readFile(herdrRefPath, 'utf8');
  assert.match(reference, /first 1024 characters/);
  assert.match(reference, /part 1\/2/);
  assert.match(reference, /sender's session log/);
  assert.match(reference, /within about 20 seconds/);
  assert.match(reference, /stuck composers/);
  assert.match(reference, /stuck composer is indistinguishable from understood/);
});
