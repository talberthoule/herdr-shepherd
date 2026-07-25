import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}

async function save(path, value) {
  await mkdir(dirname(path), { recursive: true });
  try { await copyFile(path, `${path}.herdr-coordination.bak`, constants.COPYFILE_EXCL); } catch (error) { if (!['ENOENT', 'EEXIST'].includes(error.code)) throw error; }
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

function commandFor(skillRoot, runtime) {
  return `node "${join(skillRoot, 'scripts', 'hook.mjs')}" ${runtime}`;
}

function add(value, eventName, command) {
  value.hooks ||= {};
  value.hooks[eventName] ||= [];
  const exists = value.hooks[eventName].some((group) => group.hooks?.some((hook) => hook.command === command));
  if (!exists) value.hooks[eventName].push({ matcher: 'Bash', hooks: [{ type: 'command', command, timeout: 15 }] });
}

function remove(value, eventName, command) {
  if (!Array.isArray(value.hooks?.[eventName])) return;
  value.hooks[eventName] = value.hooks[eventName].flatMap((group) => {
    const hooks = (group.hooks || []).filter((hook) => hook.command !== command);
    return hooks.length ? [{ ...group, hooks }] : [];
  });
  if (!value.hooks[eventName].length) delete value.hooks[eventName];
}

export async function installHooks({ codexPath, claudePath, skillRoot }) {
  if (codexPath) {
    const codex = await readJson(codexPath);
    const codexCommand = commandFor(skillRoot, 'codex');
    for (const event of ['PreToolUse', 'PostToolUse']) add(codex, event, codexCommand);
    await save(codexPath, codex);
  }

  if (claudePath) {
    const claude = await readJson(claudePath);
    const claudeCommand = commandFor(skillRoot, 'claude-code');
    for (const event of ['PreToolUse', 'PostToolUse', 'PostToolUseFailure']) add(claude, event, claudeCommand);
    await save(claudePath, claude);
  }
}

export async function uninstallHooks({ codexPath, claudePath, skillRoot }) {
  if (codexPath) {
    const codex = await readJson(codexPath);
    const codexCommand = commandFor(skillRoot, 'codex');
    for (const event of ['PreToolUse', 'PostToolUse']) remove(codex, event, codexCommand);
    await save(codexPath, codex);
  }

  if (claudePath) {
    const claude = await readJson(claudePath);
    const claudeCommand = commandFor(skillRoot, 'claude-code');
    for (const event of ['PreToolUse', 'PostToolUse', 'PostToolUseFailure']) remove(claude, event, claudeCommand);
    await save(claudePath, claude);
  }
}

async function main() {
  const [mode, codexPath, claudePath, skillRoot] = process.argv.slice(2);
  if (!['install', 'uninstall'].includes(mode) || !skillRoot || (!codexPath && !claudePath)) {
    throw new Error('usage: configure-hooks.mjs install|uninstall <codex-hooks-or-> <claude-settings-or-> <skill-root>');
  }
  await (mode === 'install' ? installHooks : uninstallHooks)({
    codexPath: codexPath === '-' ? undefined : codexPath,
    claudePath: claudePath === '-' ? undefined : claudePath,
    skillRoot,
  });
}

if (process.argv[1] && basename(process.argv[1]) === basename(fileURLToPath(import.meta.url))) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
