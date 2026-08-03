import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const skillRoot = 'skills/herdr-shepherd';

test('public repository contains both plugin manifests and one canonical skill runtime', async () => {
  for (const path of [
    '.codex-plugin/plugin.json',
    '.claude-plugin/plugin.json',
    '.agents/plugins/marketplace.json',
    '.claude-plugin/marketplace.json',
    'hooks/hooks.json',
    'hooks/claude.json',
    `${skillRoot}/SKILL.md`,
    `${skillRoot}/agents/openai.yaml`,
    `${skillRoot}/references/command-policy.md`,
    `${skillRoot}/references/herdr-integration.md`,
    `${skillRoot}/scripts/hook.mjs`,
    `${skillRoot}/scripts/coordinate.mjs`,
    'install.ps1',
    'install.sh',
    'uninstall.ps1',
    'uninstall.sh',
    'README.md',
    'LICENSE',
  ]) {
    await assert.doesNotReject(readFile(join(root, path)));
  }
  await assert.rejects(readFile(join(root, 'scripts', 'hook.mjs')), /ENOENT/);
});

test('marketplace manifests expose the herdr-shepherd plugin id', async () => {
  const codexPlugin = JSON.parse(await readFile(join(root, '.codex-plugin/plugin.json'), 'utf8'));
  const claudePlugin = JSON.parse(await readFile(join(root, '.claude-plugin/plugin.json'), 'utf8'));
  const codexMarket = JSON.parse(await readFile(join(root, '.agents/plugins/marketplace.json'), 'utf8'));
  const claudeMarket = JSON.parse(await readFile(join(root, '.claude-plugin/marketplace.json'), 'utf8'));
  assert.equal(codexPlugin.name, 'herdr-shepherd');
  assert.equal(claudePlugin.name, 'herdr-shepherd');
  assert.equal(codexMarket.name, 'shepherd');
  assert.equal(claudeMarket.name, 'shepherd');
  assert.equal(codexMarket.plugins[0].name, 'herdr-shepherd');
  assert.equal(claudeMarket.plugins[0].name, 'herdr-shepherd');
});

test('root Windows installers resolve the canonical skill runtime', async () => {
  const install = await readFile(join(root, 'install.ps1'), 'utf8');
  const uninstall = await readFile(join(root, 'uninstall.ps1'), 'utf8');
  assert.match(install, /skills\\herdr-shepherd/);
  assert.match(uninstall, /skills\\herdr-shepherd/);
  assert.match(install, /scripts\\configure-hooks\.mjs/);
  assert.match(uninstall, /scripts\\configure-hooks\.mjs/);
});

test('README leads with plugin setup and common coordination workflows', async () => {
  const readme = await readFile(join(root, 'README.md'), 'utf8');
  const required = [
    'codex plugin marketplace add talberthoule/herdr-shepherd',
    'codex plugin add herdr-shepherd@shepherd',
    'claude plugin marketplace add talberthoule/herdr-shepherd',
    'claude plugin install herdr-shepherd@shepherd',
    './install.ps1',
    './install.sh',
    'discover active and paused work',
    'source-attributed handoffs',
    'shared-worktree conflicts',
    'Delete all history',
    'ACK <event_id>',
  ];
  for (const text of required) assert.ok(readme.includes(text), `README is missing ${text}`);
  assert.ok(readme.indexOf('## Install') < readme.indexOf('## Manual Install'), 'plugin install should appear before manual install');
});

test('README documents the Shepherd audit state identity', async () => {
  const readme = await readFile(join(root, 'README.md'), 'utf8');
  for (const value of [
    '%LOCALAPPDATA%\\Herdr\\shepherd-audit',
    '${XDG_STATE_HOME:-$HOME/.local/state}/Herdr/shepherd-audit',
    'HERDR_SHEPHERD_STATE_DIR',
  ]) {
    assert.ok(readme.includes(value), `README is missing ${value}`);
  }
});

test('retired product state identity appears only in migration history', async () => {
  const allowed = new Set([
    join(root, 'docs', 'superpowers', 'specs', '2026-07-25-herdr-shepherd-migration-design.md'),
    join(root, 'docs', 'superpowers', 'plans', '2026-07-25-herdr-shepherd-migration.md'),
  ]);
  const forbidden = [
    'coordination-' + 'audit',
    'HERDR_' + 'COORDINATION_STATE_DIR',
    'Herdr coordination ' + 'audit',
    'Herdr coordination ' + 'hook failed',
    'Auditing Herdr ' + 'coordination...',
    'Recording Herdr ' + 'coordination...',
    'Recording failed Herdr ' + 'coordination...',
    'Removed Herdr ' + 'coordination hooks.',
    '.herdr-coordination' + '.bak',
  ];
  const pending = [root];
  while (pending.length) {
    const dir = pending.pop();
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== '.git') pending.push(path);
      else if (!allowed.has(path) && /\.(?:json|md|mjs|ps1|sh|yaml|yml)$/.test(entry.name)) {
        const content = await readFile(path, 'utf8');
        for (const value of forbidden) assert.ok(!content.includes(value), `${path} contains ${value}`);
      }
    }
  }
});

test('CLAUDE.md and AGENTS.md point at the skill instead of copying it', async () => {
  // The doctrine has exactly one home. These files carry a link and this
  // repository's own facts; a second copy is what the three-file sync tax was.
  const headings = [
    '## Stacking Work Across Lanes',
    '## Merge Train Coordination',
    '## Agent Status as a Coordination Signal',
    '## Coordination Transport Reliability',
    '## Routing Substance and Pointers',
    '## Durable Record Setup',
  ];
  for (const path of ['CLAUDE.md', 'AGENTS.md']) {
    const content = await readFile(join(root, path), 'utf8');
    for (const heading of headings) {
      assert.ok(!content.includes(heading), `${path} has re-grown the mirrored section "${heading}"`);
    }
    assert.ok(
      content.includes('skills/herdr-shepherd/SKILL.md'),
      `${path} must link the skill it defers to`,
    );
    assert.ok(
      content.includes('.herdr-shepherd.json'),
      `${path} must point at the durable-record binding rather than restating it`,
    );
  }
});

test('the skill package stands alone without CLAUDE.md or AGENTS.md', async () => {
  // Those files are this repository's own convention. The installers and both
  // plugin manifests must never reference them, or the skill would depend on a
  // convention the projects it installs into do not have.
  for (const path of ['install.ps1', 'install.sh', '.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) {
    const content = await readFile(join(root, path), 'utf8');
    for (const file of ['CLAUDE.md', 'AGENTS.md']) {
      assert.ok(!content.includes(file), `${path} makes the skill depend on ${file}`);
    }
  }
  const skill = await readFile(join(root, `${skillRoot}/SKILL.md`), 'utf8');
  assert.match(skill, /never require those files or create them for this purpose/);
});

test('CI runs the Node suite on Windows and Ubuntu', async () => {
  const workflow = await readFile(join(root, '.github/workflows/test.yml'), 'utf8');
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /ubuntu-latest/);
  assert.match(workflow, /node --test --test-concurrency=1 tests\/\*\.test\.mjs/);
  assert.match(workflow, /sh -n install\.sh/);
});

test('public repository excludes private local identifiers', async () => {
  const forbidden = ['Pres' + 'idio', 'Anlysis' + '-Inference-Engine', 'C:' + '\\Users\\'];
  const pending = [root];
  while (pending.length) {
    const dir = pending.pop();
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== '.git') pending.push(path);
      else if (/\.(?:json|md|mjs|ps1|sh|yaml|yml)$/.test(entry.name)) {
        const content = await readFile(path, 'utf8');
        for (const value of forbidden) assert.ok(!content.includes(value), `${path} contains ${value}`);
      }
    }
  }
});
