import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test('Windows uninstaller removes its junction without deleting the target', { skip: process.platform !== 'win32' }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'herdr-uninstall-'));
  t.after(() => rm(dir, { force: true, recursive: true }));

  const installRoot = join(dir, 'install');
  const skillRoot = join(installRoot, 'skills', 'herdr-shepherd');
  const home = join(dir, 'home');
  const link = join(home, '.claude', 'skills', 'herdr-shepherd');
  const marker = join(skillRoot, 'target-marker.txt');
  const bin = join(dir, 'bin');
  await mkdir(join(home, '.claude', 'skills'), { recursive: true });
  await mkdir(bin);
  await cp(join(root, 'uninstall.ps1'), join(installRoot, 'uninstall.ps1'));
  await cp(join(root, 'skills', 'herdr-shepherd'), skillRoot, { recursive: true });
  await writeFile(marker, 'target survives', 'utf8');
  await symlink(skillRoot, link, 'junction');
  await writeFile(join(bin, 'claude.cmd'), '@exit /b 0\r\n', 'utf8');

  const wrapper = join(dir, 'run-uninstall.ps1');
  await writeFile(wrapper, [
    'Set-Variable -Name HOME -Value $env:HERDR_TEST_HOME -Force',
    "& (Join-Path $env:HERDR_TEST_INSTALL_ROOT 'uninstall.ps1')",
  ].join('\r\n'), 'utf8');
  const powershell = join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = spawnSync(powershell, [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', wrapper,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin};${dirname(process.execPath)}`,
      CODEX_HOME: join(dir, 'codex'),
      LOCALAPPDATA: join(dir, 'local'),
      HERDR_TEST_HOME: home,
      HERDR_TEST_INSTALL_ROOT: installRoot,
    },
    timeout: 15000,
    windowsHide: true,
  });

  assert.equal(result.status, 0, result.stderr);
  await assert.rejects(lstat(link), { code: 'ENOENT' });
  assert.equal(await readFile(marker, 'utf8'), 'target survives');
});
