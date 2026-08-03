import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const skillRoot = join(root, 'skills', 'herdr-shepherd');
const skillPath = join(skillRoot, 'SKILL.md');
const herdrRefPath = join(skillRoot, 'references', 'herdr-integration.md');

const heading = '## Working With a Session Multiplexer';

function extractSection(raw) {
  const markdown = raw.replaceAll('\r\n', '\n');
  const start = markdown.indexOf(heading);
  assert.notEqual(start, -1, `missing "${heading}" section`);
  const rest = markdown.slice(start + heading.length);
  const end = rest.indexOf('\n## ');
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

test('skill defers multiplexer mechanics to that tool own skill', async () => {
  const section = extractSection(await readFile(skillPath, 'utf8'));
  assert.match(section, /belongs to that tool's own skill/);
  assert.match(section, /duplicating it here only creates a second copy to drift/);
});

test('skill checks for the native skill, asks for it, and degrades explicitly', async () => {
  const section = extractSection(await readFile(skillPath, 'utf8'));
  // The three-step contract the user asked for: detect, offer, degrade.
  assert.match(section, /Check whether the native Herdr skill is available/);
  assert.match(section, /If it is missing, say so and offer to install it/);
  assert.match(section, /If the user declines, continue with reduced capability/);
  // Degradation must name both sides of the line, not just wave at it.
  assert.match(section, /lane stacking, merge trains, worktree safety, durable records/);
  assert.match(section, /What degrades is anything needing Herdr's CLI surface/);
  assert.match(section, /Do not guess at CLI syntax from memory/);
});

test('skill points at its own Herdr enforcement rather than restating it', async () => {
  const section = extractSection(await readFile(skillPath, 'utf8'));
  assert.match(section, /references\/herdr-integration\.md/);
  assert.match(section, /references\/command-policy\.md/);
  assert.match(section, /the native skill does not cover/);
});

test('the doctrine itself stays free of Herdr CLI mechanics', async () => {
  const skill = (await readFile(skillPath, 'utf8')).replaceAll('\r\n', '\n');
  const doctrine = skill.slice(0, skill.indexOf(heading));
  for (const command of ['herdr api snapshot', 'herdr pane read', 'herdr agent get', 'coordinate.mjs']) {
    assert.ok(!doctrine.includes(command), `doctrine still carries the Herdr mechanic "${command}"`);
  }
});

test('the herdr reference states its own scope and pins the verified version', async () => {
  const reference = await readFile(herdrRefPath, 'utf8');
  assert.match(reference, /use the native Herdr skill/);
  assert.match(reference, /0\.7\.2-preview/, 'version-specific bugs need the version recorded');
  assert.match(reference, /Re-verify after a Herdr upgrade/);
  // The vocabulary bridge is what lets a tool-neutral skill be acted on in Herdr.
  assert.match(reference, /Peer session/);
  assert.match(reference, /Session read/);
});
