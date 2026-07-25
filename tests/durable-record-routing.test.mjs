import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const skillPath = join(root, 'skills', 'herdr-shepherd', 'SKILL.md');
const mirrorPaths = [join(root, 'AGENTS.md'), join(root, 'CLAUDE.md')];

const routingHeading = '## Routing Substance and Pointers';
const setupHeading = '## Durable Record Setup';

function extractSection(raw, heading) {
  const markdown = raw.replaceAll('\r\n', '\n');
  const start = markdown.indexOf(heading);
  assert.notEqual(start, -1, `missing "${heading}" section`);
  const rest = markdown.slice(start + heading.length);
  const end = rest.indexOf('\n## ');
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

test('skill routes substance to a durable record and sends only pointers', async () => {
  const section = extractSection(await readFile(skillPath, 'utf8'), routingHeading);
  assert.match(section, /never make a send the only carrier/);
  assert.match(section, /costs a delay instead of the content/);
  // The three tiers must all be named.
  assert.match(section, /\| Durable \|/);
  assert.match(section, /\| Pointer \|/);
  assert.match(section, /\| Ephemeral \|/);
  assert.match(section, /never the durable record/);
  // Routing everything to the tracker is explicitly wrong.
  assert.match(section, /Do not route everything to the durable record/);
  assert.match(section, /too slow for a collision warning/);
  assert.match(section, /destroys the signal/);
  assert.match(section, /only channel that cannot be dropped/);
  assert.match(section, /it does not replace it/);
});

test('skill requires in-body attribution because trackers share one credential', async () => {
  const section = extractSection(await readFile(skillPath, 'utf8'), routingHeading);
  assert.match(section, /authored by the human who owns the token/);
  assert.match(section, /cannot tell two agents apart/);
  assert.match(section, /Requested by:/);
  assert.match(section, /Performed by:/);
  assert.match(section, /Scope:/);
  // Pane IDs are breadcrumbs; the role is what survives.
  assert.match(section, /slot identifiers and get reused/);
  assert.match(section, /The role is the durable half/);
});

test('skill walks the user through binding a durable record when none exists', async () => {
  const section = extractSection(await readFile(skillPath, 'utf8'), setupHeading);
  assert.match(section, /Do not silently invent a location/);
  // Capability must be confirmed before an option is offered.
  assert.match(section, /Never offer a tracker whose capability you have not confirmed/);
  // All four ranked fallbacks, so a repo with no tracker still lands somewhere durable.
  assert.match(section, /already connected in this session/);
  assert.match(section, /GitHub Issues through `gh`/);
  assert.match(section, /Git-native/);
  assert.match(section, /stable absolute path/);
  assert.match(section, /last resort/);
  // Configure, verify, and persist the binding.
  assert.match(section, /Walk the signup and configuration/);
  assert.match(section, /Prove it round-trips/);
  assert.match(section, /An unverified binding is not a durable record/);
  assert.match(section, /Record the binding where future agents will read it/);
  assert.match(section, /a binding held only in one session is not configured/);
  assert.match(section, /Report what was created/);
  assert.match(section, /Treat missing credentials as a stop, not a workaround/);
});

test('transport reliability separates ACK from proof of submission', async () => {
  const section = extractSection(
    await readFile(skillPath, 'utf8'),
    '## Coordination Transport Reliability',
  );
  assert.match(section, /An ACK proves the recipient holds the content, not that your send delivered it/);
  assert.match(section, /pull the content by pane read while your message sits unsubmitted/);
  assert.match(section, /tab to queue message/);
  assert.match(section, /submits a duplicate of work already done/);
});

test('viewer labels the succeeded phase as sent without changing the stored value', async () => {
  const viewer = await readFile(
    join(root, 'skills', 'herdr-shepherd', 'scripts', 'audit-server.mjs'),
    'utf8',
  );
  // The wire/query value must remain the stored phase so the events API keeps working.
  assert.match(viewer, /<option value="succeeded" selected>sent<\/option>/);
  assert.match(viewer, /<option value="attempted">attempted<\/option>/);
  assert.match(viewer, /<option value="failed">failed<\/option>/);
  // The rendered label comes from the map, not from the raw phase.
  assert.match(viewer, /PHASE_LABEL=\{[^}]*succeeded:'sent'/);
  assert.match(viewer, /esc\(PHASE_LABEL\[e\.phase\]\|\|e\.phase\)/);
  assert.doesNotMatch(viewer, /<span class="'\+esc\(e\.phase\)\+'">'\+esc\(e\.phase\)/);
  // A standing legend states what "sent" does and does not prove.
  assert.match(viewer, /does not confirm the target submitted or read it/);
  assert.match(viewer, /Confirm delivery by pane read/);
  assert.match(viewer, /PHASE_TITLE=\{[^}]*Delivery is unconfirmed/);
});

test('skill describes the viewer label honestly', async () => {
  const skill = await readFile(skillPath, 'utf8');
  assert.match(skill, /displays as \*\*sent\*\*/);
  assert.match(skill, /not proof the target submitted or read it/);
  assert.doesNotMatch(skill, /The viewer defaults to succeeded events\./);
});

test('AGENTS.md and CLAUDE.md mirror the new sections verbatim', async () => {
  const skill = await readFile(skillPath, 'utf8');
  for (const heading of [routingHeading, setupHeading]) {
    const canonical = extractSection(skill, heading);
    for (const path of mirrorPaths) {
      const mirrored = extractSection(await readFile(path, 'utf8'), heading);
      assert.equal(mirrored, canonical, `${path} "${heading}" drifted from SKILL.md`);
    }
  }
});

test('mirror preambles name every mirrored section', async () => {
  for (const path of mirrorPaths) {
    const raw = (await readFile(path, 'utf8')).replaceAll('\r\n', '\n');
    const preamble = raw.slice(0, raw.indexOf('\n## '));
    for (const name of ['Routing Substance and Pointers', 'Durable Record Setup']) {
      assert.ok(preamble.includes(name), `${path} preamble omits "${name}"`);
    }
  }
});
