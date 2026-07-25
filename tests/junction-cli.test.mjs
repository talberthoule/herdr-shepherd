import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const skillRoot = join(root, 'skills', 'herdr-shepherd');

function run(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }));
    child.stdin.end(input);
  });
}

test('hook CLI executes when invoked through a Claude-style junction', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'herdr-junction-'));
  const skills = join(dir, 'skills');
  const link = join(skills, 'herdr-shepherd');
  await mkdir(skills);
  await symlink(skillRoot, link, 'junction');
  const payload = JSON.stringify({
    hook_event_name: 'PreToolUse', tool_name: 'Bash',
    tool_input: { command: 'herdr pane close w2:p1' },
  });
  const result = await run(process.execPath, [join(link, 'scripts', 'hook.mjs'), 'claude-code'], payload);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
});
