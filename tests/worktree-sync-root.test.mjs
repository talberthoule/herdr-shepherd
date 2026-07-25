import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const skillPath = join(root, 'skills', 'coordinating-herdr-agents', 'SKILL.md');

const heading = '## Shared Git Working Trees';

function extractSection(raw) {
  const markdown = raw.replaceAll('\r\n', '\n');
  const start = markdown.indexOf(heading);
  assert.notEqual(start, -1, `missing "${heading}" section`);
  const rest = markdown.slice(start + heading.length);
  const end = rest.indexOf('\n## ');
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

test('worktree guidance requires a path outside any sync root', async () => {
  const section = extractSection(await readFile(skillPath, 'utf8'));
  // "outside the repo" alone is insufficient and must not stand on its own.
  assert.match(section, /outside the repo and outside any synced folder/);
  assert.match(section, /Never put a worktree inside a cloud-synced folder/);
  assert.match(section, /Outside the repo is not enough; it must be outside the sync root/);
  assert.doesNotMatch(section, /worktree add <path outside the repo> /);
});

test('worktree guidance describes the silent-breakage failure mode', async () => {
  const section = extractSection(await readFile(skillPath, 'utf8'));
  assert.match(section, /destroys the `\.git` pointer file/);
  assert.match(section, /silent and looks healthy/);
  // Each operation that misleads must be named, since none of them errors loudly.
  assert.match(section, /not a working tree/);
  assert.match(section, /quietly drops the registration while leaving the directory behind/);
  assert.match(section, /unrecoverable/);
  assert.match(section, /Commit early on a worktree lane/);
});

test('guidance separates sync damage from a self-held working directory', async () => {
  const section = extractSection(await readFile(skillPath, 'utf8'));
  assert.match(section, /Two unrelated faults produce look-alike symptoms/);
  // The distinguishing signal: is .git actually gone, or is the directory merely locked?
  assert.match(section, /Device or resource busy/);
  assert.match(section, /Permission denied/);
  assert.match(section, /a shell still has the directory as its working directory/);
  assert.match(section, /leave the directory and retry; the worktree is fine/);
  assert.match(section, /the process holding the lock is usually your own/);
  assert.match(section, /Confirm the `\.git` file is actually missing before concluding/);
});

test('corollary count matches the number of corollary bullets', async () => {
  const section = extractSection(await readFile(skillPath, 'utf8'));
  const declared = section.match(/^(\w+) corollaries that are easy to get wrong:$/m);
  assert.ok(declared, 'missing the corollaries lead-in line');
  const words = { Two: 2, Three: 3, Four: 4, Five: 5 };
  const expected = words[declared[1]];
  assert.ok(expected, `unrecognised corollary count word "${declared[1]}"`);
  const after = section.slice(section.indexOf(declared[0]) + declared[0].length);
  const bullets = after.split('\n').filter((line) => line.startsWith('- **')).length;
  assert.equal(bullets, expected, 'corollary count word disagrees with the bullet count');
});

test('common mistakes cover sync-root worktrees and false-clean status', async () => {
  const skill = (await readFile(skillPath, 'utf8')).replaceAll('\r\n', '\n');
  const mistakes = skill.slice(skill.indexOf('## Common Mistakes'));
  assert.match(mistakes, /Do not create a worktree inside a cloud-synced folder/);
  assert.match(mistakes, /Do not read an empty `git -C <dir> status` as a clean worktree/);
  assert.match(mistakes, /counting output lines scores it identical to clean/);
  assert.match(mistakes, /Do not blame the sync client for a locked worktree/);
});
