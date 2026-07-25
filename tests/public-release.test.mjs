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
      if (entry.isDirectory() && !entry.name.startsWith('.git')) pending.push(path);
      else if (/\.(?:json|md|mjs|ps1|sh|yaml|yml)$/.test(entry.name)) {
        const content = await readFile(path, 'utf8');
        for (const value of forbidden) assert.ok(!content.includes(value), `${path} contains ${value}`);
      }
    }
  }
});
