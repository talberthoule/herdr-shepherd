import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const skillPath = join(root, 'skills', 'herdr-shepherd', 'SKILL.md');

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
  assert.match(section, /identifiers are slots and get reused/);
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
  assert.match(section, /[Aa] binding held only in one session is not configured/);
  // The binding must not depend on files most projects never adopt: the skill
  // ships SKILL.md and its scripts, never CLAUDE.md or AGENTS.md.
  assert.match(section, /committed `\.herdr-shepherd\.json` at the repo root/);
  assert.match(section, /runtime-neutral/);
  assert.match(section, /never require those files or create them for this purpose/);
  assert.match(section, /Report what was created/);
  assert.match(section, /Treat missing credentials as a stop, not a workaround/);
});

test('transport reliability separates ACK from proof of submission', async () => {
  const section = extractSection(
    await readFile(skillPath, 'utf8'),
    '## Coordination Transport Reliability',
  );
  assert.match(section, /An ACK proves the recipient holds the content, not that your send delivered it/);
  assert.match(section, /pull the content by session read before your message ever surfaces/);
  assert.match(section, /duplicate turn over work already done/);
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
  // A standing legend states what "sent" does and does not prove. It must not
  // describe the retired keystroke path: the default transport submits
  // atomically and never "types" anything.
  assert.match(viewer, /does not confirm the target read or acted on it/);
  assert.match(viewer, /Check the delivery verdict/);
  assert.doesNotMatch(viewer, /typed the message and pressed Enter/);
  assert.match(viewer, /PHASE_TITLE=\{[^}]*Delivery is unconfirmed/);
});

test('herdr reference describes the viewer label honestly', async () => {
  // The viewer is Shepherd's own Herdr surface, so its honesty rule moved with
  // the rest of the integration notes rather than staying in the doctrine.
  const reference = await readFile(
    join(root, 'skills', 'herdr-shepherd', 'references', 'herdr-integration.md'),
    'utf8',
  );
  assert.match(reference, /displays as \*\*sent\*\*/);
  assert.match(reference, /not proof the target read or acted on it/);
  assert.doesNotMatch(reference, /The viewer defaults to succeeded events\./);
});


