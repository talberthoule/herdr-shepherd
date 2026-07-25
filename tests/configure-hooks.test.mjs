import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { installHooks, uninstallHooks } from '../skills/herdr-shepherd/scripts/configure-hooks.mjs';

test('installation preserves existing hooks and is idempotent for both runtimes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'herdr-hooks-'));
  const codex = join(dir, 'hooks.json');
  const claude = join(dir, 'settings.json');
  const existing = { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'existing session hook', timeout: 10 }] }] } };
  await writeFile(codex, JSON.stringify(existing), 'utf8');
  await writeFile(claude, JSON.stringify(existing), 'utf8');

  await installHooks({ codexPath: codex, claudePath: claude, skillRoot: 'C:\\skill' });
  await installHooks({ codexPath: codex, claudePath: claude, skillRoot: 'C:\\skill' });

  const codexValue = JSON.parse(await readFile(codex, 'utf8'));
  const claudeValue = JSON.parse(await readFile(claude, 'utf8'));
  assert.equal(codexValue.hooks.SessionStart[0].hooks[0].command, 'existing session hook');
  assert.deepEqual(Object.keys(codexValue.hooks).sort(), ['PostToolUse', 'PreToolUse', 'SessionStart']);
  assert.deepEqual(Object.keys(claudeValue.hooks).sort(), ['PostToolUse', 'PostToolUseFailure', 'PreToolUse', 'SessionStart']);
  assert.equal(codexValue.hooks.PreToolUse.length, 1);
  assert.equal(claudeValue.hooks.PreToolUse.length, 1);
});

test('uninstall removes only coordination hook entries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'herdr-hooks-'));
  const codex = join(dir, 'hooks.json');
  const claude = join(dir, 'settings.json');
  await installHooks({ codexPath: codex, claudePath: claude, skillRoot: 'C:\\skill' });
  const value = JSON.parse(await readFile(codex, 'utf8'));
  value.hooks.PreToolUse.push({ matcher: 'Bash', hooks: [{ type: 'command', command: 'someone else', timeout: 10 }] });
  await writeFile(codex, JSON.stringify(value), 'utf8');

  await uninstallHooks({ codexPath: codex, claudePath: claude, skillRoot: 'C:\\skill' });
  const after = JSON.parse(await readFile(codex, 'utf8'));
  assert.equal(after.hooks.PreToolUse.length, 1);
  assert.equal(after.hooks.PreToolUse[0].hooks[0].command, 'someone else');
});

test('installation can configure only the host that is present', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'herdr-hooks-'));
  const codex = join(dir, 'hooks.json');
  await installHooks({ codexPath: codex, skillRoot: '/skill' });
  const codexValue = JSON.parse(await readFile(codex, 'utf8'));
  assert.deepEqual(Object.keys(codexValue.hooks).sort(), ['PostToolUse', 'PreToolUse']);

  const claude = join(dir, 'settings.json');
  await installHooks({ claudePath: claude, skillRoot: '/skill' });
  const claudeValue = JSON.parse(await readFile(claude, 'utf8'));
  assert.deepEqual(Object.keys(claudeValue.hooks).sort(), ['PostToolUse', 'PostToolUseFailure', 'PreToolUse']);
});
