# Dual-Plugin and Linux Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Herdr Shepherd as a native Codex and Claude Code plugin marketplace with Windows and Linux manual installers, a single reusable runtime, and an activity viewer that reuses one page, shows newest events first, and supports deletion.

**Architecture:** Move the existing skill and Node runtime into `skills/herdr-shepherd/` and point both plugin manifests, hook manifests, tests, and manual installers at that one copy. Keep the activity viewer in the existing `audit-server.mjs`, `hook-lib.mjs`, and `core.mjs` modules; add only the smallest persistence and API functions needed for page-presence tracking and audit deletion.

**Tech Stack:** Node.js ESM standard library, `node:test`, PowerShell, POSIX `/bin/sh`, Codex plugin manifest, Claude Code plugin manifest, Herdr CLI.

## Global Constraints

- Marketplace name is `shepherd`.
- Codex install commands are `codex plugin marketplace add talberthoule/herdr-shepherd` and `codex plugin add herdr-shepherd@shepherd`.
- Claude Code install commands are `claude plugin marketplace add talberthoule/herdr-shepherd` and `claude plugin install herdr-shepherd@shepherd`.
- Both plugins contain the skill and hooks; users still review and trust hooks through the host's normal security flow.
- Windows manual fallback is clone plus `./install.ps1`.
- Linux manual fallback is clone plus `./install.sh`.
- No package registry, daemon, dependency framework, or duplicated Codex/Claude runtime is introduced.
- Existing skill/runtime files move into `skills/herdr-shepherd/`; do not leave a second implementation under root `scripts/`.
- Node and Herdr are required.
- Manual installers configure whichever supported hosts are present and fail only when neither Codex nor Claude Code is installed.
- PowerShell here-strings and literal POSIX heredocs are both accepted by the audited wrapper parser.
- The activity viewer remains token-protected loopback-only, uses no UI framework, and keeps keyboard focus stable while delete controls are focused.
- Claims stay bounded: this is a coordination and guardrail layer over Herdr, not an autonomous orchestration framework.

---

## File Structure

- Move `SKILL.md` to `skills/herdr-shepherd/SKILL.md`: canonical skill instructions.
- Move `agents/openai.yaml` to `skills/herdr-shepherd/agents/openai.yaml`: default agent metadata.
- Move `references/command-policy.md` to `skills/herdr-shepherd/references/command-policy.md`: audited command policy reference.
- Move `scripts/*.mjs` to `skills/herdr-shepherd/scripts/*.mjs`: the single Node runtime.
- Move `scripts/install.ps1` to `install.ps1`: Windows manual installer.
- Move `scripts/uninstall.ps1` to `uninstall.ps1`: Windows manual uninstaller.
- Create `install.sh`: POSIX manual installer.
- Create `uninstall.sh`: POSIX manual uninstaller.
- Create `.codex-plugin/plugin.json`: Codex plugin manifest.
- Create `.claude-plugin/plugin.json`: Claude Code plugin manifest.
- Create `.agents/plugins/marketplace.json`: Codex marketplace manifest.
- Create `.claude-plugin/marketplace.json`: Claude Code marketplace manifest.
- Create `hooks/hooks.json`: Codex hook manifest with `PreToolUse` and `PostToolUse`.
- Create `hooks/claude.json`: Claude hook manifest with `PreToolUse`, `PostToolUse`, and `PostToolUseFailure`.
- Create `.github/workflows/test.yml`: Windows and Ubuntu Node test workflow.
- Modify `tests/*.test.mjs`: imports and focused coverage for packaging, Linux parsing, runtime detection, viewer reuse, newest-first ordering, deletion, and delete-all.
- Modify `README.md`: value-first install and use-case documentation.

## Task 1: Canonical Plugin Layout and Marketplace Metadata

**Files:**
- Move: `SKILL.md` -> `skills/herdr-shepherd/SKILL.md`
- Move: `agents/openai.yaml` -> `skills/herdr-shepherd/agents/openai.yaml`
- Move: `references/command-policy.md` -> `skills/herdr-shepherd/references/command-policy.md`
- Move: `scripts/core.mjs` -> `skills/herdr-shepherd/scripts/core.mjs`
- Move: `scripts/coordinate.mjs` -> `skills/herdr-shepherd/scripts/coordinate.mjs`
- Move: `scripts/configure-hooks.mjs` -> `skills/herdr-shepherd/scripts/configure-hooks.mjs`
- Move: `scripts/audit-server.mjs` -> `skills/herdr-shepherd/scripts/audit-server.mjs`
- Move: `scripts/hook-lib.mjs` -> `skills/herdr-shepherd/scripts/hook-lib.mjs`
- Move: `scripts/hook.mjs` -> `skills/herdr-shepherd/scripts/hook.mjs`
- Move: `scripts/install.ps1` -> `install.ps1`
- Move: `scripts/uninstall.ps1` -> `uninstall.ps1`
- Create: `.codex-plugin/plugin.json`
- Create: `.claude-plugin/plugin.json`
- Create: `.agents/plugins/marketplace.json`
- Create: `.claude-plugin/marketplace.json`
- Create: `hooks/hooks.json`
- Create: `hooks/claude.json`
- Modify: `tests/public-release.test.mjs`
- Modify: `tests/*.test.mjs`

**Interfaces:**
- Produces: canonical skill root `skills/herdr-shepherd`.
- Produces: canonical runtime path `skills/herdr-shepherd/scripts/hook.mjs`.
- Produces: hook command `node "${CLAUDE_PLUGIN_ROOT}/skills/herdr-shepherd/scripts/hook.mjs"`.
- Produces: installable marketplace id `herdr-shepherd@shepherd`.

- [ ] **Step 1: Write the failing public layout test**

Replace the first test in `tests/public-release.test.mjs` with:

```js
test('public repository contains both plugin manifests and one canonical skill runtime', async () => {
  for (const path of [
    '.codex-plugin/plugin.json',
    '.claude-plugin/plugin.json',
    '.agents/plugins/marketplace.json',
    '.claude-plugin/marketplace.json',
    'hooks/hooks.json',
    'hooks/claude.json',
    'skills/herdr-shepherd/SKILL.md',
    'skills/herdr-shepherd/agents/openai.yaml',
    'skills/herdr-shepherd/references/command-policy.md',
    'skills/herdr-shepherd/scripts/hook.mjs',
    'skills/herdr-shepherd/scripts/coordinate.mjs',
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
```

Add this second test in the same file:

```js
test('marketplace manifests expose the herdr plugin id', async () => {
  const codexPlugin = JSON.parse(await readFile(join(root, '.codex-plugin/plugin.json'), 'utf8'));
  const claudePlugin = JSON.parse(await readFile(join(root, '.claude-plugin/plugin.json'), 'utf8'));
  const codexMarket = JSON.parse(await readFile(join(root, '.agents/plugins/marketplace.json'), 'utf8'));
  const claudeMarket = JSON.parse(await readFile(join(root, '.claude-plugin/marketplace.json'), 'utf8'));
  assert.equal(codexPlugin.name, 'herdr-shepherd');
  assert.equal(claudePlugin.name, 'herdr-shepherd');
  assert.equal(codexMarket.name, 'herdr');
  assert.equal(claudeMarket.name, 'herdr');
  assert.equal(codexMarket.plugins[0].name, 'herdr-shepherd');
  assert.equal(claudeMarket.plugins[0].name, 'herdr-shepherd');
});
```

Update the private identifier test in the same file to allow the public GitHub owner while still blocking local/company identifiers:

```js
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
```

- [ ] **Step 2: Run the layout test to verify it fails**

Run:

```powershell
node --test --test-concurrency=1 tests/public-release.test.mjs
```

Expected: FAIL because `.codex-plugin/plugin.json`, `.claude-plugin/plugin.json`, `skills/herdr-shepherd/SKILL.md`, and `install.sh` do not exist yet.

- [ ] **Step 3: Move the existing files into the canonical layout**

Run:

```powershell
New-Item -ItemType Directory -Force -Path 'skills\herdr-shepherd' | Out-Null
git mv SKILL.md skills/herdr-shepherd/SKILL.md
git mv agents skills/herdr-shepherd/agents
git mv references skills/herdr-shepherd/references
git mv scripts skills/herdr-shepherd/scripts
git mv skills/herdr-shepherd/scripts/install.ps1 install.ps1
git mv skills/herdr-shepherd/scripts/uninstall.ps1 uninstall.ps1
```

Update imports in tests from:

```js
import { appendAuditEvent } from '../scripts/core.mjs';
```

to the matching canonical path:

```js
import { appendAuditEvent } from '../skills/herdr-shepherd/scripts/core.mjs';
```

Apply that import-prefix change to every test importing from `../scripts/`.

In `tests/junction-cli.test.mjs`, replace the current `skillRoot` line with:

```js
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const skillRoot = join(root, 'skills', 'herdr-shepherd');
```

- [ ] **Step 4: Add plugin and marketplace manifests**

Create `.codex-plugin/plugin.json`:

```json
{
  "name": "herdr-shepherd",
  "version": "0.1.0",
  "description": "Herdr Shepherd coordinates Codex and Claude Code sessions through Herdr with audited handoffs and a local activity trail.",
  "author": {
    "name": "Talbert Houle",
    "url": "https://github.com/talberthoule"
  },
  "homepage": "https://github.com/talberthoule/herdr-shepherd",
  "repository": "https://github.com/talberthoule/herdr-shepherd",
  "license": "MIT",
  "keywords": ["herdr", "codex", "claude-code", "coordination", "agents"],
  "skills": "./skills/",
  "hooks": "./hooks/hooks.json",
  "interface": {
    "displayName": "Herdr Shepherd",
    "shortDescription": "Audited Herdr Shepherd coordination for parallel agent work",
    "longDescription": "Herdr Shepherd discovers active work, avoids duplicate sessions, sends source-attributed handoffs, and inspects local coordination events while keeping Herdr as the coordination layer.",
    "developerName": "Talbert Houle",
    "category": "Developer Tools",
    "capabilities": ["Instructions", "Lifecycle hooks"],
    "websiteURL": "https://github.com/talberthoule/herdr-shepherd",
    "defaultPrompt": [
      "Use Herdr Shepherd before editing in this shared worktree.",
      "Use $herdr-shepherd to inspect active Herdr agents and coordinate overlapping work.",
      "Send an audited Herdr Shepherd handoff to the agent that owns this work."
    ],
    "brandColor": "#111827"
  }
}
```

Create `.claude-plugin/plugin.json`:

```json
{
  "name": "herdr-shepherd",
  "version": "0.1.0",
  "description": "Herdr Shepherd coordinates Codex and Claude Code sessions through Herdr with audited handoffs and a local activity trail.",
  "author": {
    "name": "Talbert Houle",
    "url": "https://github.com/talberthoule"
  },
  "hooks": "./hooks/claude.json"
}
```

Create `.agents/plugins/marketplace.json`:

```json
{
  "name": "shepherd",
  "interface": {
    "displayName": "Shepherd"
  },
  "plugins": [
    {
      "name": "herdr-shepherd",
      "source": {
        "source": "url",
        "url": "https://github.com/talberthoule/herdr-shepherd.git",
        "ref": "main"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Developer Tools"
    }
  ]
}
```

Create `.claude-plugin/marketplace.json`:

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "shepherd",
  "description": "Herdr Shepherd coordination plugins for Codex and Claude Code agents.",
  "owner": {
    "name": "Talbert Houle",
    "url": "https://github.com/talberthoule"
  },
  "plugins": [
    {
      "name": "herdr-shepherd",
      "description": "Herdr Shepherd coordinates parallel Codex and Claude Code sessions.",
      "source": "./",
      "category": "productivity"
    }
  ]
}
```

- [ ] **Step 5: Add plugin hook manifests**

Create `hooks/hooks.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/skills/herdr-shepherd/scripts/hook.mjs\"",
            "commandWindows": "if (Get-Command node -ErrorAction SilentlyContinue) { node \"$env:CLAUDE_PLUGIN_ROOT\\skills\\herdr-shepherd\\scripts\\hook.mjs\" }",
            "timeout": 15,
            "statusMessage": "Auditing Herdr coordination..."
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/skills/herdr-shepherd/scripts/hook.mjs\"",
            "commandWindows": "if (Get-Command node -ErrorAction SilentlyContinue) { node \"$env:CLAUDE_PLUGIN_ROOT\\skills\\herdr-shepherd\\scripts\\hook.mjs\" }",
            "timeout": 15,
            "statusMessage": "Recording Herdr coordination..."
          }
        ]
      }
    ]
  }
}
```

Create `hooks/claude.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/skills/herdr-shepherd/scripts/hook.mjs\"",
            "commandWindows": "if (Get-Command node -ErrorAction SilentlyContinue) { node \"$env:CLAUDE_PLUGIN_ROOT\\skills\\herdr-shepherd\\scripts\\hook.mjs\" }",
            "timeout": 15,
            "statusMessage": "Auditing Herdr coordination..."
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/skills/herdr-shepherd/scripts/hook.mjs\"",
            "commandWindows": "if (Get-Command node -ErrorAction SilentlyContinue) { node \"$env:CLAUDE_PLUGIN_ROOT\\skills\\herdr-shepherd\\scripts\\hook.mjs\" }",
            "timeout": 15,
            "statusMessage": "Recording Herdr coordination..."
          }
        ]
      }
    ],
    "PostToolUseFailure": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/skills/herdr-shepherd/scripts/hook.mjs\"",
            "commandWindows": "if (Get-Command node -ErrorAction SilentlyContinue) { node \"$env:CLAUDE_PLUGIN_ROOT\\skills\\herdr-shepherd\\scripts\\hook.mjs\" }",
            "timeout": 15,
            "statusMessage": "Recording failed Herdr coordination..."
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 6: Run layout and moved-import tests**

Run:

```powershell
node --test --test-concurrency=1 tests/public-release.test.mjs tests/junction-cli.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```powershell
git add .
git commit -m "Add plugin marketplace layout"
```

## Task 2: Cross-Platform Hooks, Installers, and Wrapper Parsing

**Files:**
- Modify: `skills/herdr-shepherd/scripts/hook.mjs`
- Modify: `skills/herdr-shepherd/scripts/hook-lib.mjs`
- Modify: `skills/herdr-shepherd/scripts/configure-hooks.mjs`
- Modify: `install.ps1`
- Modify: `uninstall.ps1`
- Create: `install.sh`
- Create: `uninstall.sh`
- Modify: `skills/herdr-shepherd/SKILL.md`
- Modify: `tests/hook.test.mjs`
- Modify: `tests/configure-hooks.test.mjs`
- Modify: `tests/public-release.test.mjs`

**Interfaces:**
- Consumes: canonical runtime path `skills/herdr-shepherd/scripts/hook.mjs`.
- Produces: `runtimeFromEnvironment(env: object): 'codex' | 'claude-code' | 'unknown'`.
- Produces: `extractCoordinationRequest(command: string): object` accepting PowerShell here-strings and POSIX literal heredocs.
- Produces: `installHooks({ codexPath?: string, claudePath?: string, skillRoot: string }): Promise<void>`.
- Produces: `uninstallHooks({ codexPath?: string, claudePath?: string, skillRoot: string }): Promise<void>`.

- [ ] **Step 1: Write failing tests for POSIX heredoc parsing and runtime detection**

Add this helper beside `commandFor` in `tests/hook.test.mjs`:

```js
const posixCommandFor = (value) => `node "$HOME/.codex/plugins/herdr-shepherd/skills/herdr-shepherd/scripts/coordinate.mjs" --stdin <<'JSON'\n${JSON.stringify(value)}\nJSON`;
```

Add this test in `tests/hook.test.mjs`:

```js
test('POSIX literal heredoc wrapper request is accepted', async () => {
  const dir = await stateDir();
  const result = await handleHookPayload({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_use_id: 'tool-posix',
    tool_input: { command: posixCommandFor(request) },
  }, { runtime: 'codex', sourceId: 'w1:pH', stateDir: dir, launchViewer: false });
  assert.equal(result.output, undefined);
  const [event] = await listAuditEvents(dir);
  assert.equal(event.event_id, 'tool-posix');
  assert.equal(event.message_redacted, request.message);
});
```

Modify the import from `hook.mjs` in `tests/hook.test.mjs` after Task 1 paths are updated:

```js
import { runtimeFromEnvironment } from '../skills/herdr-shepherd/scripts/hook.mjs';
```

Add this test:

```js
test('hook runtime is detected from plugin environment when no installer argument is present', () => {
  assert.equal(runtimeFromEnvironment({ PLUGIN_ROOT: '/tmp/plugin', CLAUDE_PLUGIN_ROOT: '/tmp/plugin' }), 'codex');
  assert.equal(runtimeFromEnvironment({ CLAUDE_PLUGIN_ROOT: '/tmp/plugin' }), 'claude-code');
  assert.equal(runtimeFromEnvironment({}), 'unknown');
});
```

- [ ] **Step 2: Run the hook tests to verify they fail**

Run:

```powershell
node --test --test-concurrency=1 tests/hook.test.mjs
```

Expected: FAIL because POSIX heredoc parsing is not implemented and `runtimeFromEnvironment` is not exported.

- [ ] **Step 3: Implement runtime detection in `hook.mjs`**

Replace the runtime line in `skills/herdr-shepherd/scripts/hook.mjs` with this exported function and use it in `main()`:

```js
export function runtimeFromEnvironment(env = process.env) {
  if (env.PLUGIN_ROOT) return 'codex';
  if (env.CLAUDE_PLUGIN_ROOT) return 'claude-code';
  return 'unknown';
}

async function main() {
  const runtime = process.argv[2] || runtimeFromEnvironment();
  const payload = JSON.parse(await stdin());
  const result = await handleHookPayload(payload, { runtime });
  if (result.output) process.stdout.write(JSON.stringify(result.output));
}
```

- [ ] **Step 4: Implement POSIX heredoc parsing in `hook-lib.mjs`**

Replace the current `hereStringPattern` and `extractCoordinationRequest` with:

```js
const wrapperPatterns = [
  {
    pattern: /@'\s*\r?\n([\s\S]*?)\r?\n'@\s*\|\s*node\b[\s\S]*coordinate\.mjs\b[\s\S]*--stdin/i,
    error: 'audited wrapper requires a single-quoted PowerShell here-string containing JSON',
  },
  {
    pattern: /node\b[\s\S]*coordinate\.mjs\b[\s\S]*--stdin[\s\S]*<<'([A-Za-z_][A-Za-z0-9_-]*)'\s*\r?\n([\s\S]*?)\r?\n\1\b/i,
    error: 'audited wrapper requires a single-quoted POSIX heredoc containing JSON',
    group: 2,
  },
];

export function extractCoordinationRequest(command) {
  for (const candidate of wrapperPatterns) {
    const match = String(command || '').match(candidate.pattern);
    if (match) return JSON.parse(match[candidate.group || 1]);
  }
  throw new Error('audited wrapper requires literal JSON through a PowerShell here-string or POSIX heredoc');
}
```

- [ ] **Step 5: Make hook configuration accept either host**

In `skills/herdr-shepherd/scripts/configure-hooks.mjs`, replace `commandFor` with:

```js
function commandFor(skillRoot, runtime) {
  return `node "${join(skillRoot, 'scripts', 'hook.mjs')}" ${runtime}`;
}
```

Keep that function unchanged for manual installs. Replace `installHooks` with:

```js
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
```

Replace `uninstallHooks` with the same optional-host shape:

```js
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
```

Replace the CLI argument check with:

```js
if (!['install', 'uninstall'].includes(mode) || !skillRoot || (!codexPath && !claudePath)) {
  throw new Error('usage: configure-hooks.mjs install|uninstall <codex-hooks-or-> <claude-settings-or-> <skill-root>');
}
await (mode === 'install' ? installHooks : uninstallHooks)({
  codexPath: codexPath === '-' ? undefined : codexPath,
  claudePath: claudePath === '-' ? undefined : claudePath,
  skillRoot,
});
```

- [ ] **Step 6: Add optional-host tests**

Add this test to `tests/configure-hooks.test.mjs`:

```js
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
```

- [ ] **Step 7: Update Windows installers for optional hosts and canonical paths**

In root `install.ps1`, set:

```powershell
$skillRoot = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'skills\herdr-shepherd'
$codexInstalled = [bool](Get-Command codex -ErrorAction SilentlyContinue)
$claudeInstalled = [bool](Get-Command claude -ErrorAction SilentlyContinue)
if (-not $codexInstalled -and -not $claudeInstalled) {
    throw 'Neither Codex nor Claude Code is available on PATH.'
}
foreach ($command in @('node', 'herdr')) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "Required command is not available on PATH: $command"
    }
}
$codexArg = if ($codexInstalled) { $codexHooks } else { '-' }
$claudeArg = if ($claudeInstalled) { $claudeSettings } else { '-' }
& node (Join-Path $skillRoot 'scripts\configure-hooks.mjs') install $codexArg $claudeArg $skillRoot
```

Only create the Claude skill junction when `$claudeInstalled` is true. Only warn about Codex `hooks = true` when `$codexInstalled` is true.

In root `uninstall.ps1`, set the same `$skillRoot`, `$codexInstalled`, `$claudeInstalled`, `$codexArg`, and `$claudeArg`, then call:

```powershell
& node (Join-Path $skillRoot 'scripts\configure-hooks.mjs') uninstall $codexArg $claudeArg $skillRoot
```

Only inspect and remove the Claude junction when `$claudeInstalled` is true.

- [ ] **Step 8: Add POSIX install and uninstall scripts**

Create `install.sh`:

```sh
#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
skill_root="$repo_root/skills/herdr-shepherd"
codex_home="${CODEX_HOME:-$HOME/.codex}"
claude_home="$HOME/.claude"
codex_hooks="$codex_home/hooks.json"
claude_settings="$claude_home/settings.json"
claude_link="$claude_home/skills/herdr-shepherd"
state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/Herdr/coordination-audit"

command -v node >/dev/null 2>&1 || { echo "Required command is not available on PATH: node" >&2; exit 1; }
command -v herdr >/dev/null 2>&1 || { echo "Required command is not available on PATH: herdr" >&2; exit 1; }

codex_installed=0
claude_installed=0
command -v codex >/dev/null 2>&1 && codex_installed=1
command -v claude >/dev/null 2>&1 && claude_installed=1
if [ "$codex_installed" -eq 0 ] && [ "$claude_installed" -eq 0 ]; then
  echo "Neither Codex nor Claude Code is available on PATH." >&2
  exit 1
fi

mkdir -p "$codex_home" "$claude_home/skills" "$state_dir"
codex_arg="-"
claude_arg="-"
[ "$codex_installed" -eq 1 ] && codex_arg="$codex_hooks"
[ "$claude_installed" -eq 1 ] && claude_arg="$claude_settings"

node "$skill_root/scripts/configure-hooks.mjs" install "$codex_arg" "$claude_arg" "$skill_root"

if [ "$claude_installed" -eq 1 ]; then
  if [ -L "$claude_link" ]; then
    target=$(readlink "$claude_link")
    [ "$target" = "$skill_root" ] || { echo "Claude skill path already exists and is not the expected symlink: $claude_link" >&2; exit 1; }
  elif [ -e "$claude_link" ]; then
    echo "Claude skill path already exists and is not the expected symlink: $claude_link" >&2
    exit 1
  else
    ln -s "$skill_root" "$claude_link"
  fi
fi

if [ "$codex_installed" -eq 1 ] && { [ ! -f "$codex_home/config.toml" ] || ! grep -Eq '^[[:space:]]*hooks[[:space:]]*=[[:space:]]*true[[:space:]]*$' "$codex_home/config.toml"; }; then
  echo "Warning: Codex hooks are not enabled in config.toml. Add hooks = true under [features]." >&2
fi

echo "Installed herdr-shepherd."
echo "Shared audit state: $state_dir"
echo "Review and trust the new hooks in a fresh host session."
```

Create `uninstall.sh`:

```sh
#!/bin/sh
set -eu

purge_audit_history=0
[ "${1:-}" = "--purge-audit-history" ] && purge_audit_history=1

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
skill_root="$repo_root/skills/herdr-shepherd"
codex_home="${CODEX_HOME:-$HOME/.codex}"
claude_home="$HOME/.claude"
codex_hooks="$codex_home/hooks.json"
claude_settings="$claude_home/settings.json"
claude_link="$claude_home/skills/herdr-shepherd"
state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/Herdr/coordination-audit"

codex_arg="-"
claude_arg="-"
command -v codex >/dev/null 2>&1 && codex_arg="$codex_hooks"
command -v claude >/dev/null 2>&1 && claude_arg="$claude_settings"

node "$skill_root/scripts/configure-hooks.mjs" uninstall "$codex_arg" "$claude_arg" "$skill_root"

if [ -L "$claude_link" ] && [ "$(readlink "$claude_link")" = "$skill_root" ]; then
  rm "$claude_link"
elif [ -e "$claude_link" ]; then
  echo "Preserved unexpected Claude skill path: $claude_link" >&2
fi

rm -f "$state_dir/viewer.json"
if [ "$purge_audit_history" -eq 1 ] && [ -d "$state_dir" ]; then
  expected="${XDG_STATE_HOME:-$HOME/.local/state}/Herdr/coordination-audit"
  [ "$state_dir" = "$expected" ] || { echo "Refusing to purge unexpected path: $state_dir" >&2; exit 1; }
  rm -rf "$state_dir"
fi

echo "Removed Herdr coordination hooks."
[ "$purge_audit_history" -eq 0 ] && echo "Preserved audit history at $state_dir"
```

- [ ] **Step 9: Update the skill examples for Windows and Linux**

In `skills/herdr-shepherd/SKILL.md`, keep the PowerShell example and add this POSIX example immediately after it:

```sh
node "$HOME/.codex/skills/herdr-shepherd/scripts/coordinate.mjs" --stdin <<'JSON'
{"origin":"proactive","action":"herdr.exec","args":["agent","send","w2:p1","Resume the official installer build and report blockers here."],"target":{"type":"agent","id":"w2:p1"},"reason":"Continue paused work without duplicating it","message":"Resume the official installer build and report blockers here."}
JSON
```

- [ ] **Step 10: Run cross-platform hook and installer checks**

Run:

```powershell
node --test --test-concurrency=1 tests/hook.test.mjs tests/configure-hooks.test.mjs tests/junction-cli.test.mjs
```

Expected: PASS.

On Linux or any machine with `sh`, also run:

```sh
sh -n install.sh
sh -n uninstall.sh
```

Expected: no output and exit code 0.

- [ ] **Step 11: Commit**

Run:

```powershell
git add .
git commit -m "Add cross-platform hook installers"
```

## Task 3: Activity Viewer Reuse, Newest-First Events, and Deletion

**Files:**
- Modify: `skills/herdr-shepherd/scripts/core.mjs`
- Modify: `skills/herdr-shepherd/scripts/hook-lib.mjs`
- Modify: `skills/herdr-shepherd/scripts/audit-server.mjs`
- Modify: `tests/coordination.test.mjs`
- Modify: `tests/server.test.mjs`

**Interfaces:**
- Consumes: `appendAuditEvent(stateDir, event)` and `listAuditEvents(stateDir)`.
- Produces: `deleteAuditAction(stateDir: string, eventId: string): Promise<number>`.
- Produces: `deleteAllAuditHistory(stateDir: string): Promise<number>`.
- Produces: `ensureAuditViewer(stateDir, { openBrowser, openUrl }): Promise<string>`.
- Produces: `GET /api/events` returning newest-first events.
- Produces: `DELETE /api/events/:eventId`.
- Produces: `POST /api/clear` as delete-all with `{ "confirmed": true }`.

- [ ] **Step 1: Write failing audit deletion tests**

In `tests/coordination.test.mjs`, update the import list:

```js
  deleteAllAuditHistory,
  deleteAuditAction,
```

Add:

```js
test('deleting one audit action removes all phases with the same event id', async () => {
  const dir = await stateDir();
  for (const phase of ['attempted', 'succeeded']) {
    await appendAuditEvent(dir, {
      event_id: 'tool-1',
      phase,
      runtime: 'codex',
      origin: 'proactive',
      action: 'herdr.exec',
      target: { type: 'agent', id: 'w2:p1' },
      reason: 'test',
      message_redacted: 'message',
      message_sha256: '0'.repeat(64),
    });
  }
  await appendAuditEvent(dir, {
    event_id: 'tool-2',
    phase: 'attempted',
    runtime: 'codex',
    origin: 'proactive',
    action: 'herdr.exec',
    target: { type: 'agent', id: 'w3:p1' },
    reason: 'keep',
    message_redacted: 'keep',
    message_sha256: '1'.repeat(64),
  });
  assert.equal(await deleteAuditAction(dir, 'tool-1'), 2);
  assert.deepEqual((await listAuditEvents(dir)).map((event) => event.event_id), ['tool-2']);
});

test('deleting all audit history empties the log without renumbering future events', async () => {
  const dir = await stateDir();
  await appendAuditEvent(dir, { event_id: 'old', phase: 'attempted', runtime: 'codex', origin: 'proactive', action: 'herdr.exec' });
  assert.equal(await deleteAllAuditHistory(dir), 1);
  assert.deepEqual(await listAuditEvents(dir), []);
  const saved = await appendAuditEvent(dir, { event_id: 'new', phase: 'attempted', runtime: 'codex', origin: 'proactive', action: 'herdr.exec' });
  assert.equal(saved.sequence, 2);
});
```

- [ ] **Step 2: Write failing server/viewer tests**

In `tests/server.test.mjs`, add the newest-first and single-action delete tests below. Replace the existing test named `clear endpoint refuses unseen history and clears viewed history after confirmation` with the `delete all requires confirmation and empties audit history` test, because `Delete all history` no longer depends on acknowledgement.

```js
test('events API returns newest events first', async (t) => {
  const stateDir = await fixture();
  await appendAuditEvent(stateDir, {
    event_id: 'two', phase: 'attempted', runtime: 'codex', origin: 'proactive',
    action: 'herdr.exec', target: { type: 'agent', id: 'w3:p1' }, reason: 'newer',
    message_redacted: 'newer', message_sha256: '1'.repeat(64),
  });
  const viewer = await createAuditServer({ stateDir, token: 'test-token', port: 0, autoExit: false });
  t.after(() => viewer.close());
  const response = await fetch(`${viewer.url}/api/events?token=test-token`);
  assert.deepEqual((await response.json()).events.map((event) => event.sequence), [2, 1]);
});

test('delete endpoint removes one complete coordination action', async (t) => {
  const stateDir = await fixture();
  await appendAuditEvent(stateDir, {
    event_id: 'one', phase: 'succeeded', runtime: 'codex', origin: 'proactive',
    action: 'herdr.exec', target: { type: 'agent', id: 'w2:p1' }, reason: 'test',
    message_redacted: 'done', message_sha256: '0'.repeat(64),
  });
  const viewer = await createAuditServer({ stateDir, token: 'test-token', port: 0, autoExit: false });
  t.after(() => viewer.close());
  const response = await fetch(`${viewer.url}/api/events/one?token=test-token`, { method: 'DELETE' });
  assert.equal(response.status, 204);
  assert.deepEqual(await listAuditEvents(stateDir), []);
});

test('delete all requires confirmation and empties audit history', async (t) => {
  const stateDir = await fixture();
  const viewer = await createAuditServer({ stateDir, token: 'test-token', port: 0, autoExit: false });
  t.after(() => viewer.close());
  let response = await fetch(`${viewer.url}/api/clear?token=test-token`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmed: false }),
  });
  assert.equal(response.status, 400);
  response = await fetch(`${viewer.url}/api/clear?token=test-token`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmed: true }),
  });
  assert.equal(response.status, 204);
  assert.deepEqual(await listAuditEvents(stateDir), []);
});

test('active page polling suppresses duplicate browser launches and stale presence permits one', async (t) => {
  const stateDir = await fixture();
  const viewer = await createAuditServer({ stateDir, token: 'test-token', port: 0, autoExit: false });
  t.after(() => viewer.close());
  await writeFile(join(stateDir, 'viewer.json'), `${JSON.stringify({ pid: process.pid, token: viewer.token, url: viewer.url })}\n`, 'utf8');
  await fetch(`${viewer.url}/api/events?token=${viewer.token}`);
  let opens = 0;
  await ensureAuditViewer(stateDir, { openUrl: async () => { opens += 1; } });
  assert.equal(opens, 0);
  const stale = { pid: process.pid, token: viewer.token, url: viewer.url, last_seen_at: new Date(Date.now() - 6000).toISOString() };
  await writeFile(join(stateDir, 'viewer.json'), `${JSON.stringify(stale)}\n`, 'utf8');
  await ensureAuditViewer(stateDir, { openUrl: async () => { opens += 1; } });
  assert.equal(opens, 1);
});
```

Update the imports at the top of `tests/server.test.mjs`:

```js
import { mkdtemp, writeFile } from 'node:fs/promises';
```

- [ ] **Step 3: Run viewer/deletion tests to verify they fail**

Run:

```powershell
node --test --test-concurrency=1 tests/coordination.test.mjs tests/server.test.mjs
```

Expected: FAIL because deletion functions, delete endpoint, newest-first sorting, page-presence tracking, and `openUrl` injection do not exist.

- [ ] **Step 4: Implement audit deletion in `core.mjs`**

Add this helper near `clearViewedHistory`:

```js
async function rewriteAuditEvents(stateDir, keep) {
  const events = await listAuditEvents(stateDir);
  const remaining = events.filter(keep);
  const path = join(stateDir, 'audit.jsonl');
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, remaining.map((event) => JSON.stringify(event)).join('\n') + (remaining.length ? '\n' : ''), 'utf8');
  await rename(temporary, path);
  return events.length - remaining.length;
}
```

Refactor `clearViewedHistory` to use it inside the existing lock:

```js
export async function clearViewedHistory(stateDir = defaultStateDir()) {
  return withLock(stateDir, async () => {
    const state = await readJson(join(stateDir, 'state.json'), { acknowledged_sequence: 0, next_sequence: 1 });
    return rewriteAuditEvents(stateDir, (event) => event.sequence > state.acknowledged_sequence);
  });
}
```

Add:

```js
export async function deleteAuditAction(stateDir = defaultStateDir(), eventId) {
  if (!eventId) throw new Error('event_id is required');
  return withLock(stateDir, () => rewriteAuditEvents(stateDir, (event) => event.event_id !== eventId));
}

export async function deleteAllAuditHistory(stateDir = defaultStateDir()) {
  return withLock(stateDir, () => rewriteAuditEvents(stateDir, () => false));
}
```

- [ ] **Step 5: Give hook events a stable fallback action id**

In `handleHookPayload` in `hook-lib.mjs`, compute the event id before `base`:

```js
const fallbackEventId = [
  runtime,
  payload.session_id || '',
  payload.turn_id || '',
  request.origin,
  request.action,
  request.target?.type || '',
  request.target?.id || '',
  redaction.sha256,
].join(':');
const eventId = payload.tool_use_id || payload.toolUseId || fallbackEventId;
```

Then set:

```js
event_id: eventId,
tool_use_id: payload.tool_use_id || payload.toolUseId,
```

- [ ] **Step 6: Implement page-presence-aware browser launching**

In `hook-lib.mjs`, add:

```js
function pageActive(viewer) {
  return viewer.last_seen_at && Date.now() - Date.parse(viewer.last_seen_at) <= 5000;
}

function defaultOpenUrl(url) {
  if (process.platform === 'win32') {
    const browser = spawn('cmd.exe', ['/d', '/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true });
    browser.unref();
    return;
  }
  process.stderr.write(`Herdr coordination audit: ${url}\n`);
}
```

Change the `ensureAuditViewer` signature from:

```diff
-export async function ensureAuditViewer(stateDir = defaultStateDir(), { openBrowser = true } = {}) {
+export async function ensureAuditViewer(stateDir = defaultStateDir(), options = {}) {
```

At the top of that function, add:

```js
const { openBrowser = true } = options;
```

After the `healthyViewer` helper, add the server-start marker:

```js
let started = false;
```

Set `started = true` immediately after spawning `audit-server.mjs`.

Replace the current browser-opening block with:

```js
const url = `${existing.url}/?token=${encodeURIComponent(existing.token)}`;
if (openBrowser && (started || !pageActive(existing))) {
  try {
    await (options.openUrl || defaultOpenUrl)(url);
  } catch {
    process.stderr.write(`Herdr coordination audit: ${url}\n`);
  }
}
return url;
```

- [ ] **Step 7: Implement newest-first events, delete endpoints, and page presence in `audit-server.mjs`**

Update imports:

```js
  deleteAllAuditHistory,
  deleteAuditAction,
```

Add:

```js
async function markPageSeen(stateDir) {
  const viewerPath = join(stateDir, 'viewer.json');
  try {
    const current = JSON.parse(await readFile(viewerPath, 'utf8'));
    await writeFile(viewerPath, `${JSON.stringify({ ...current, last_seen_at: new Date().toISOString() })}\n`, 'utf8');
  } catch { /* viewer.json is created only for the standalone server */ }
}
```

In `GET /api/events`, call `await markPageSeen(stateDir);` before reading events. Sort after filtering:

```js
.sort((a, b) => (b.sequence || 0) - (a.sequence || 0))
```

Add a delete endpoint before the 404:

```js
if (request.method === 'DELETE' && url.pathname.startsWith('/api/events/')) {
  const eventId = decodeURIComponent(url.pathname.slice('/api/events/'.length));
  await deleteAuditAction(stateDir, eventId);
  response.writeHead(204).end();
  return;
}
```

Replace the existing `/api/clear` body with delete-all behavior:

```js
if (request.method === 'POST' && url.pathname === '/api/clear') {
  const body = await bodyJson(request);
  if (!body.confirmed) return json(response, 400, { error: 'confirmation required' });
  await deleteAllAuditHistory(stateDir);
  response.writeHead(204).end();
  return;
}
```

- [ ] **Step 8: Update the inline viewer UI**

In `html(token)`, change the clear button text:

```html
<button id="clear">Delete all history</button>
```

Replace the script body from `async function load()` through the interval setup with:

```js
async function requestJson(url, options){
  const r=await fetch(url,options);
  if(!r.ok){let message=r.statusText;try{message=(await r.json()).error||message}catch{}throw new Error(message)}
  return r.status===204?null:r.json()
}
function deleteFocused(){return document.activeElement&&document.activeElement.matches('[data-delete-event]')}
async function load(options={}){if(deleteFocused()&&!options.force)return;const q=new URLSearchParams({token,origin:originFilter.value,runtime:runtimeFilter.value,status:statusFilter.value});const d=await requestJson('/api/events?'+q);highest=d.events.reduce((m,e)=>Math.max(m,e.sequence||0),0);meta.textContent=d.events.length+' events - acknowledged through '+d.state.acknowledged_sequence;events.innerHTML=d.events.map(e=>'<div class="event"><span class="seq">#'+esc(e.sequence)+'</span><time class="time" datetime="'+esc(e.occurred_at)+'">'+esc(localDateTime.format(new Date(e.occurred_at)))+'</time><span class="'+esc(e.phase)+'">'+esc(e.phase)+'</span><span>'+esc(e.runtime)+'</span><span><span class="route-label">Source:</span> '+esc(e.source_display||e.runtime)+' <span class="route-arrow">-&gt;</span> <span class="route-label">Target:</span> '+esc(e.target_display||e.target?.id||e.action)+'</span><span><strong>'+esc(e.reason)+'</strong><br>'+esc(e.message_redacted||e.outcome_summary||'')+'</span><button data-delete-event="'+esc(e.event_id)+'" aria-label="Delete coordination action #'+esc(e.sequence)+'">Delete</button></div>').join('')||'<p>No matching events.</p>'}
originFilter.onchange=runtimeFilter.onchange=statusFilter.onchange=()=>load({force:true});
events.onclick=async event=>{const button=event.target.closest('[data-delete-event]');if(!button)return;if(!confirm('Delete this coordination action?'))return;try{await requestJson('/api/events/'+encodeURIComponent(button.dataset.deleteEvent)+'?token='+token,{method:'DELETE'});await load({force:true})}catch(error){meta.textContent='Delete failed: '+error.message}};
clearButton.onclick=async()=>{if(!confirm('Delete all audit history?'))return;try{await requestJson('/api/clear?token='+token,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({confirmed:true})});await load({force:true})}catch(error){meta.textContent='Delete all failed: '+error.message}};
closeButton.onclick=async()=>{await requestJson('/api/viewed-close?token='+token,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sequence:highest})});window.close();document.body.innerHTML='<main><h1>Audit acknowledged. You may close this tab.</h1></main>'};load({force:true});setInterval(load,2000);
```

Adjust the CSS grid for the extra delete column:

```css
.event{display:grid;grid-template-columns:54px minmax(190px,auto) 96px 110px minmax(340px,1.4fr) 2fr auto;gap:10px;border-top:1px solid #2b3034;padding:10px 0}
```

- [ ] **Step 9: Run viewer and audit tests**

Run:

```powershell
node --test --test-concurrency=1 tests/coordination.test.mjs tests/server.test.mjs tests/hook.test.mjs
```

Expected: PASS.

- [ ] **Step 10: Commit**

Run:

```powershell
git add .
git commit -m "Improve coordination activity viewer"
```

## Task 4: README, Skill Copy, and Release Validation

**Files:**
- Modify: `README.md`
- Modify: `skills/herdr-shepherd/SKILL.md`
- Modify: `tests/public-release.test.mjs`

**Interfaces:**
- Consumes: marketplace id `herdr-shepherd@shepherd`.
- Produces: value-first README with plugin setup before manual install.

- [ ] **Step 1: Write README coverage tests**

Add this test to `tests/public-release.test.mjs`:

```js
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
  ];
  for (const text of required) assert.ok(readme.includes(text), `README is missing ${text}`);
  assert.ok(readme.indexOf('## Install') < readme.indexOf('## Manual Install'), 'plugin install should appear before manual install');
});
```

- [ ] **Step 2: Run README test to verify it fails**

Run:

```powershell
node --test --test-concurrency=1 tests/public-release.test.mjs
```

Expected: FAIL because the README is still Windows/manual-install-first.

- [ ] **Step 3: Replace README content**

Replace `README.md` with:

````markdown
# Herdr Shepherd

Herdr Shepherd lets Codex and Claude Code sessions share work without guessing who owns a task. It gives each session a local protocol for discovering active work, avoiding duplicate edits, sending source-attributed handoffs, and reviewing a token-protected activity trail.

It is deliberately small: Herdr remains the coordination layer, and this project adds skill instructions plus audited hooks around the Herdr CLI.

## Install

Codex:

```sh
codex plugin marketplace add talberthoule/herdr-shepherd
codex plugin add herdr-shepherd@shepherd
```

Claude Code:

```sh
claude plugin marketplace add talberthoule/herdr-shepherd
claude plugin install herdr-shepherd@shepherd
```

Review and trust the installed hooks through the normal host prompt. The hooks are what block raw Herdr mutations and record audited coordination actions.

## First Use

Start a new agent session and ask it to use Herdr Shepherd before editing a shared repository. The skill will inspect Herdr first, read relevant panes, and only send an audited message when another session owns overlapping work or has context worth preserving.

The local activity viewer opens for proactive handoffs. It shows the newest events first, can delete one complete coordination action, and has a `Delete all history` control for clearing local audit history.

## Use Cases

- discover active and paused work before starting a duplicate task;
- resume the correct session instead of opening a competing lane;
- send source-attributed handoffs that include the originating tab and pane;
- divide feature, review, and investigation lanes across Codex and Claude Code;
- catch shared-worktree conflicts before checkout, merge, or stash moves another agent's work;
- inspect attempted, succeeded, and failed coordination actions in a local audit trail.

## Safety Boundary

Read-only Herdr inspection is allowed directly. Proactive mutations must use the audited wrapper and are limited to `herdr agent send` for an existing agent. User-directed mutations can be broader, but they are still audited.

The hook rejects raw Herdr mutations, blocks obvious secrets in outbound messages, prefixes sent messages with source attribution, and records attempted plus outcome events locally.

Audit state stays on your machine:

- Windows: `%LOCALAPPDATA%\Herdr\coordination-audit`
- Linux: `${XDG_STATE_HOME:-$HOME/.local/state}/Herdr/coordination-audit`

## Manual Install

Manual install is useful when plugin marketplaces are unavailable or when testing a local checkout.

Windows:

```powershell
git clone https://github.com/talberthoule/herdr-shepherd.git
cd herdr-shepherd
./install.ps1
```

Linux:

```sh
git clone https://github.com/talberthoule/herdr-shepherd.git
cd herdr-shepherd
./install.sh
```

The installers require Node.js and Herdr. They configure whichever supported hosts are present: Codex, Claude Code, or both.

## Requirements

- Node.js
- Herdr CLI
- Codex CLI or Claude Code
- PowerShell for `install.ps1`
- POSIX `/bin/sh` for `install.sh`

## Test

```sh
node --test --test-concurrency=1 tests/*.test.mjs
```

On Linux, also check the shell installers:

```sh
sh -n install.sh
sh -n uninstall.sh
```

## Troubleshooting

- If Codex hooks do not run, enable `hooks = true` under `[features]` in `~/.codex/config.toml`, then review hooks in a fresh Codex session.
- If Claude Code does not load the skill after manual install, restart Claude Code or reload plugins.
- If the activity viewer page is closed manually, the next proactive event can reopen it.
- If a hook blocks a command, rerun the action through the audited wrapper shown in the skill.

## Uninstall

Windows:

```powershell
./uninstall.ps1
```

Linux:

```sh
./uninstall.sh
```

Use `-PurgeAuditHistory` on Windows or `--purge-audit-history` on Linux only when you also want to delete the local audit log.

## License

MIT
````

- [ ] **Step 4: Update skill quick reference for the new viewer behavior**

In `skills/herdr-shepherd/SKILL.md`, replace:

```markdown
| Inspect audit | Viewer opens automatically after proactive send |
```

with:

```markdown
| Inspect audit | Viewer opens automatically after proactive sends, reuses an active page, shows newest events first, and supports deleting one action or all history |
```

- [ ] **Step 5: Run docs/public tests**

Run:

```powershell
node --test --test-concurrency=1 tests/public-release.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
git add README.md skills/herdr-shepherd/SKILL.md tests/public-release.test.mjs
git commit -m "Rewrite README for plugin distribution"
```

## Task 5: CI and Final Release Checks

**Files:**
- Create: `.github/workflows/test.yml`
- Modify: `tests/public-release.test.mjs`

**Interfaces:**
- Consumes: all earlier tasks.
- Produces: Windows and Ubuntu CI test workflow.

- [ ] **Step 1: Add a CI workflow presence test**

Add this test to `tests/public-release.test.mjs`:

```js
test('CI runs the Node suite on Windows and Ubuntu', async () => {
  const workflow = await readFile(join(root, '.github/workflows/test.yml'), 'utf8');
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /ubuntu-latest/);
  assert.match(workflow, /node --test --test-concurrency=1 tests\/\*\.test\.mjs/);
  assert.match(workflow, /sh -n install\.sh/);
});
```

- [ ] **Step 2: Run CI test to verify it fails**

Run:

```powershell
node --test --test-concurrency=1 tests/public-release.test.mjs
```

Expected: FAIL because `.github/workflows/test.yml` does not exist yet.

- [ ] **Step 3: Add the workflow**

Create `.github/workflows/test.yml`:

```yaml
name: test

on:
  push:
  pull_request:

jobs:
  node:
    strategy:
      fail-fast: false
      matrix:
        os: [windows-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: node --test --test-concurrency=1 tests/*.test.mjs
      - if: runner.os == 'Linux'
        run: |
          sh -n install.sh
          sh -n uninstall.sh
      - if: runner.os == 'Windows'
        shell: pwsh
        run: |
          $null = [scriptblock]::Create((Get-Content -Raw install.ps1))
          $null = [scriptblock]::Create((Get-Content -Raw uninstall.ps1))
```

- [ ] **Step 4: Run full local tests**

Run:

```powershell
node --test --test-concurrency=1 tests/*.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Validate Claude plugin manifest**

Run:

```powershell
claude plugin validate --strict .
```

Expected: PASS with no strict validation errors.

- [ ] **Step 6: Smoke-test Codex marketplace from the local checkout**

Run this in PowerShell using a temporary Codex home:

```powershell
$oldCodexHome = $env:CODEX_HOME
$env:CODEX_HOME = Join-Path ([IO.Path]::GetTempPath()) ('codex-plugin-test-' + [guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $env:CODEX_HOME | Out-Null
codex plugin marketplace add . --json
codex plugin add herdr-shepherd@shepherd --json
$env:CODEX_HOME = $oldCodexHome
```

Expected: both Codex commands exit 0 and the add result names `herdr-shepherd`.

- [ ] **Step 7: Smoke-test Claude plugin marketplace from the local checkout**

Run:

```powershell
claude plugin marketplace add . --scope local
claude plugin install herdr-shepherd@shepherd
claude plugin uninstall herdr-shepherd
claude plugin marketplace remove shepherd
```

Expected: install succeeds, uninstall succeeds, and the local marketplace is removed.

- [ ] **Step 8: Run git checks**

Run:

```powershell
git diff --check
git status --short
```

Expected: `git diff --check` exits 0. `git status --short` shows only the intended implementation files before the final commit.

- [ ] **Step 9: Commit**

Run:

```powershell
git add .
git commit -m "Add release validation workflow"
```

## Final Verification

- [ ] Run `node --test --test-concurrency=1 tests/*.test.mjs` and confirm PASS.
- [ ] Run `claude plugin validate --strict .` and confirm PASS.
- [ ] Run the local Codex marketplace smoke test and confirm PASS.
- [ ] Run the local Claude marketplace smoke test and confirm PASS.
- [ ] Run `git log --oneline -5` and confirm the task commits are present.
- [ ] Run `git status --short` and confirm the tree is clean.
