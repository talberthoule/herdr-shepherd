# Herdr Shepherd Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Launch the existing coordination plugin as Herdr Shepherd in a new public repository and fresh local installation, then make the former repository private and read-only.

**Architecture:** Preserve the complete source history by cloning the existing repository into an adjacent checkout and pushing that baseline to a new GitHub repository. Apply one clean-break identity migration in the new checkout, leaving upstream Herdr CLI/protocol names intact, then cut local installations over only after local and hosted verification passes. Retire the old repository last so it remains the rollback path throughout.

**Tech Stack:** Git, GitHub CLI, Codex plugin CLI, Claude Code plugin CLI, Node.js ESM standard library, `node:test`, PowerShell, POSIX `/bin/sh`.

## Global Constraints

- Product display name: `Herdr Shepherd`.
- New repository and local project ID: `herdr-shepherd`.
- Plugin ID and skill ID: `herdr-shepherd`.
- Marketplace namespace: `shepherd`.
- Skill invocation: `$herdr-shepherd`.
- Windows audit state: `%LOCALAPPDATA%\Herdr\shepherd-audit`.
- Linux audit state: `${XDG_STATE_HOME:-$HOME/.local/state}/Herdr/shepherd-audit`.
- Environment override: `HERDR_SHEPHERD_STATE_DIR`.
- Keep the external `herdr` executable, `herdr.exec`, CLI commands, and protocol-owned Herdr names unchanged.
- Do not ship an alias, shim, redirecting skill, or transitional package for the retired plugin ID.
- Preserve the old `audit.jsonl` and `state.json` byte-for-byte; `viewer.json` is an ephemeral process lease and may be removed by uninstall.
- Keep the old local checkout as the rollback copy; do not delete it.
- Keep `talberthoule/coordinating-herdr-agents` public and writable until the new repository, CI, and fresh installation are verified.
- Add no dependencies and make no runtime behavior change beyond product identity and state-path resolution.

---

### Task 1: Create the New Repository and Independent Checkout

**Files:**
- Existing source checkpoint: `docs/superpowers/specs/2026-07-25-herdr-shepherd-migration-design.md`
- Existing plan: `docs/superpowers/plans/2026-07-25-herdr-shepherd-migration.md`
- Create checkout: `%OneDriveCommercial%\Code\herdr-shepherd`

**Interfaces:**
- Consumes: clean source checkout on `main`, authenticated `gh`, and the user-approved repository names.
- Produces: public `talberthoule/herdr-shepherd`, independent local clone with `origin` pointing only to the new repository, and branch `agent/herdr-shepherd-rebrand`.

- [ ] **Step 1: Recheck source ownership and repository state**

Run from the source checkout:

```powershell
herdr api snapshot
git branch --show-current
git status -sb
git log -3 --oneline
gh auth status
```

Expected: the current pane is the only active writer for this repository, branch is `main`, the worktree is clean, and GitHub authentication is active.

- [ ] **Step 2: Publish the approved spec and plan to the source repository**

```powershell
git push origin main
git status -sb
```

Expected: push succeeds and status is exactly `## main...origin/main`.

- [ ] **Step 3: Confirm the destination is still unused**

```powershell
$destination = Join-Path $env:OneDriveCommercial 'Code\herdr-shepherd'
if (Test-Path -LiteralPath $destination) { throw "Destination already exists: $destination" }
gh api repos/talberthoule/herdr-shepherd
```

Expected: the local path does not exist and the API returns `404 Not Found`. Any other result stops the task for inspection.

- [ ] **Step 4: Create the empty public repository**

```powershell
gh repo create talberthoule/herdr-shepherd --public --description 'Audited coordination and safe handoffs for Codex and Claude Code sessions running through Herdr.'
gh repo view talberthoule/herdr-shepherd --json nameWithOwner,url,visibility,isArchived,defaultBranchRef
```

Expected: `nameWithOwner` is `talberthoule/herdr-shepherd`, visibility is `PUBLIC`, and `isArchived` is `false`. An empty repository may report no default branch until the first push.

- [ ] **Step 5: Clone the complete local history without shared object hardlinks**

```powershell
$source = Join-Path $env:OneDriveCommercial 'Code\coordinating-herdr-agents'
$destination = Join-Path $env:OneDriveCommercial 'Code\herdr-shepherd'
git clone --no-hardlinks -- $source $destination
git -C $destination remote set-url origin https://github.com/talberthoule/herdr-shepherd.git
git -C $destination remote -v
```

Expected: both fetch and push URLs name only `talberthoule/herdr-shepherd`.

- [ ] **Step 6: Push the preserved baseline and verify history identity**

```powershell
$source = Join-Path $env:OneDriveCommercial 'Code\coordinating-herdr-agents'
$destination = Join-Path $env:OneDriveCommercial 'Code\herdr-shepherd'
$sourceSha = git -C $source rev-parse main
$destinationSha = git -C $destination rev-parse main
if ($sourceSha -ne $destinationSha) { throw "Clone SHA mismatch: $sourceSha != $destinationSha" }
git -C $destination push -u origin main
$remoteSha = git -C $destination ls-remote --exit-code origin refs/heads/main
Write-Output "source=$sourceSha"
Write-Output "destination=$destinationSha"
Write-Output "remote=$remoteSha"
```

Expected: all three SHA values identify the same commit.

- [ ] **Step 7: Create the implementation branch**

```powershell
$destination = Join-Path $env:OneDriveCommercial 'Code\herdr-shepherd'
git -C $destination switch -c agent/herdr-shepherd-rebrand
git -C $destination status -sb
```

Expected: clean `agent/herdr-shepherd-rebrand` based on the pushed baseline.

---

### Task 2: Replace the Product and Package Identity

**Files:**
- Move: `skills/coordinating-herdr-agents/` → `skills/herdr-shepherd/`
- Modify: `.agents/plugins/marketplace.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `.claude-plugin/plugin.json`
- Modify: `.codex-plugin/plugin.json`
- Modify: `hooks/claude.json`
- Modify: `hooks/hooks.json`
- Modify: `install.ps1`
- Modify: `install.sh`
- Modify: `uninstall.ps1`
- Modify: `uninstall.sh`
- Modify: `README.md`
- Modify: `LICENSE`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-07-13-dual-plugin-linux-distribution-design.md`
- Modify: `docs/superpowers/plans/2026-07-13-dual-plugin-linux-distribution.md`
- Review only: `docs/superpowers/specs/2026-07-25-herdr-shepherd-migration-design.md`
- Review only: `docs/superpowers/plans/2026-07-25-herdr-shepherd-migration.md`
- Modify: `tests/capability-handoff.test.mjs`
- Modify: `tests/configure-hooks.test.mjs`
- Modify: `tests/coordinate.test.mjs`
- Modify: `tests/coordination.test.mjs`
- Modify: `tests/delivery-verification.test.mjs`
- Modify: `tests/durable-record-routing.test.mjs`
- Modify: `tests/hook.test.mjs`
- Modify: `tests/junction-cli.test.mjs`
- Modify: `tests/lane-stacking.test.mjs`
- Modify: `tests/merge-train.test.mjs`
- Modify: `tests/public-release.test.mjs`
- Modify: `tests/server.test.mjs`
- Modify: `tests/subagent-policy.test.mjs`
- Modify: `tests/transport-reliability.test.mjs`
- Modify: `tests/worktree-sync-root.test.mjs`

**Interfaces:**
- Consumes: preserved source files and existing manifest/test structure.
- Produces: canonical runtime at `skills/herdr-shepherd`, plugin ID `herdr-shepherd`, marketplace `shepherd`, invocation `$herdr-shepherd`, and current install URLs under the new repository.

- [ ] **Step 1: Change the release contract first**

Edit `tests/public-release.test.mjs` so the canonical paths and manifest assertions are:

```js
const skillRoot = 'skills/herdr-shepherd';

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

assert.equal(codexPlugin.name, 'herdr-shepherd');
assert.equal(claudePlugin.name, 'herdr-shepherd');
assert.equal(codexMarket.name, 'shepherd');
assert.equal(claudeMarket.name, 'shepherd');
assert.equal(codexMarket.plugins[0].name, 'herdr-shepherd');
assert.equal(claudeMarket.plugins[0].name, 'herdr-shepherd');
```

Change the README contract to require:

```js
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
```

- [ ] **Step 2: Run the contract test and verify it fails**

```powershell
node --test tests/public-release.test.mjs
```

Expected: FAIL because `skills/herdr-shepherd` and the new manifest values do not exist yet.

- [ ] **Step 3: Move the canonical skill directory**

```powershell
git mv skills/coordinating-herdr-agents skills/herdr-shepherd
```

Expected: Git records one directory rename rather than a delete/recreate pair.

- [ ] **Step 4: Replace the retired slug in functional references**

Use a bulk mechanical replacement for the retired slug, excluding the approved migration spec's explicit source-project references:

```powershell
$platform = 'he' + 'rdr'
$oldSlug = "coordinating-$platform-agents"
$newSlug = 'herdr-shepherd'
$migrationDocs = @(
    'docs/superpowers/specs/2026-07-25-herdr-shepherd-migration-design.md',
    'docs/superpowers/plans/2026-07-25-herdr-shepherd-migration.md'
)
$files = @(git grep -Il $oldSlug -- .)
foreach ($file in $files) {
    if ($file -in $migrationDocs) { continue }
    $content = Get-Content -Raw -LiteralPath $file
    $updated = $content.Replace($oldSlug, $newSlug)
    if ($updated -ne $content) { Set-Content -NoNewline -LiteralPath $file -Value $updated }
}
```

Review both migration documents after the replacement. Their destination paths and current invocation examples already use the new identity; preserve their explicit source repository, retired-ID, cleanup-path, and rollback statements.

- [ ] **Step 5: Update display names, marketplaces, URLs, and metadata**

Apply these exact live identity values:

```json
{
  "pluginName": "herdr-shepherd",
  "marketplaceName": "shepherd",
  "displayName": "Herdr Shepherd",
  "repository": "https://github.com/talberthoule/herdr-shepherd",
  "skillInvocation": "$herdr-shepherd"
}
```

Specific required changes:

- `.agents/plugins/marketplace.json`: top-level `name` becomes `shepherd`, `interface.displayName` becomes `Shepherd`, plugin name becomes `herdr-shepherd`, and URL becomes `https://github.com/talberthoule/herdr-shepherd.git`.
- `.claude-plugin/marketplace.json`: marketplace `name` becomes `shepherd`, description names Herdr Shepherd, and plugin name becomes `herdr-shepherd`.
- `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json`: `name` becomes `herdr-shepherd`; descriptions use the new display name.
- `.codex-plugin/plugin.json`: homepage, repository, interface display name, website URL, and default prompts use the new identity.
- `skills/herdr-shepherd/SKILL.md`: frontmatter name becomes `herdr-shepherd`; heading becomes `Herdr Shepherd`; wrapper paths use the new directory.
- `skills/herdr-shepherd/agents/openai.yaml`: display name and default prompt use `Herdr Shepherd` and `$herdr-shepherd`.
- `README.md`: title, prose, install commands, clone URLs, `cd` commands, and manual-install paths use the new identity.
- `LICENSE`: contributor name becomes `Herdr Shepherd contributors`.
- `AGENTS.md` and `CLAUDE.md`: canonical skill links point to `skills/herdr-shepherd/SKILL.md`.
- Historical plan/spec command examples use the new live install commands; retain historical reasoning.

Keep generic phrases such as “Herdr CLI,” “Herdr workspace,” and `herdr.exec` unchanged.

- [ ] **Step 6: Update all test imports and path assertions**

Every import or file lookup beginning with:

```text
../skills/coordinating-herdr-agents/
skills/coordinating-herdr-agents/
```

must begin with:

```text
../skills/herdr-shepherd/
skills/herdr-shepherd/
```

Change product-facing assertions from `Herdr Agent Coordination` to `Herdr Shepherd`. Do not change test inputs that intentionally exercise the upstream `herdr` CLI or `herdr.exec` action.

- [ ] **Step 7: Run identity-focused tests**

```powershell
node --test tests/public-release.test.mjs tests/junction-cli.test.mjs tests/configure-hooks.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Inspect the identity diff and commit**

```powershell
git diff --check
git status --short
git diff --stat
git add -- .agents .claude-plugin .codex-plugin hooks skills tests README.md LICENSE AGENTS.md CLAUDE.md install.ps1 install.sh uninstall.ps1 uninstall.sh docs
git commit -m "Adopt the new project identity"
```

Expected: one commit containing only identity, path, documentation, and matching test changes.

---

### Task 3: Move Audit State to the Clean Shepherd Namespace

**Files:**
- Modify: `skills/herdr-shepherd/scripts/core.mjs`
- Modify: `skills/herdr-shepherd/scripts/configure-hooks.mjs`
- Modify: `skills/herdr-shepherd/scripts/audit-server.mjs`
- Modify: `skills/herdr-shepherd/scripts/hook-lib.mjs`
- Modify: `skills/herdr-shepherd/scripts/hook.mjs`
- Modify: `install.ps1`
- Modify: `install.sh`
- Modify: `uninstall.ps1`
- Modify: `uninstall.sh`
- Modify: `hooks/claude.json`
- Modify: `hooks/hooks.json`
- Test: `tests/coordination.test.mjs`
- Test: `tests/server.test.mjs`
- Test: `tests/hook.test.mjs`
- Test: `tests/configure-hooks.test.mjs`

**Interfaces:**
- Consumes: `defaultStateDir()` callers in the existing runtime.
- Produces: `defaultStateDir(environment = process.env, platform = process.platform): string`, using `HERDR_SHEPHERD_STATE_DIR` or the platform-specific `Herdr/shepherd-audit` location.

- [ ] **Step 1: Add cross-platform state-path tests**

Import `defaultStateDir` in `tests/coordination.test.mjs` and add:

```js
test('default audit state uses the shepherd namespace on every platform', () => {
  assert.equal(
    defaultStateDir({ LOCALAPPDATA: 'C:\\state' }, 'win32'),
    'C:\\state\\Herdr\\shepherd-audit',
  );
  assert.equal(
    defaultStateDir({ HOME: '/home/test' }, 'linux'),
    '/home/test/.local/state/Herdr/shepherd-audit',
  );
  assert.equal(
    defaultStateDir({ HOME: '/home/test', XDG_STATE_HOME: '/state' }, 'linux'),
    '/state/Herdr/shepherd-audit',
  );
  assert.equal(
    defaultStateDir({ HERDR_SHEPHERD_STATE_DIR: '/custom' }, 'linux'),
    '/custom',
  );
});
```

- [ ] **Step 2: Run the new state-path test and verify it fails**

```powershell
node --test --test-name-pattern="default audit state" tests/coordination.test.mjs
```

Expected: FAIL because `defaultStateDir` does not accept injected environment/platform values and still returns `coordination-audit`.

- [ ] **Step 3: Implement the platform-correct state resolver**

In `skills/herdr-shepherd/scripts/core.mjs`, import `posix` and `win32` from `node:path` and replace `defaultStateDir` with:

```js
export function defaultStateDir(environment = process.env, platform = process.platform) {
  if (environment.HERDR_SHEPHERD_STATE_DIR) return environment.HERDR_SHEPHERD_STATE_DIR;
  const path = platform === 'win32' ? win32 : posix;
  const base = platform === 'win32'
    ? (environment.LOCALAPPDATA || environment.HOME || '.')
    : (environment.XDG_STATE_HOME || path.join(environment.HOME || '.', '.local', 'state'));
  return path.join(base, 'Herdr', 'shepherd-audit');
}
```

Do not retain `HERDR_COORDINATION_STATE_DIR`; the approved migration is a clean break.

- [ ] **Step 4: Update installers and uninstallers**

Use these exact state paths:

```powershell
$stateDir = Join-Path $env:LOCALAPPDATA 'Herdr\shepherd-audit'
```

```sh
state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/Herdr/shepherd-audit"
```

Update purge safety checks to compare against those same exact paths. Change installer output to `Installed Herdr Shepherd.` and keep uninstall output clear that it removes Shepherd hooks while preserving history unless purge is explicitly requested.

- [ ] **Step 5: Update product-owned runtime labels**

Apply these labels:

- audit viewer title: `Herdr Shepherd audit`;
- hook error prefix: `Herdr Shepherd hook failed`;
- audit URL prefix: `Herdr Shepherd audit`;
- hook status messages: `Auditing Herdr Shepherd coordination...`, `Recording Herdr Shepherd coordination...`, and `Recording failed Herdr Shepherd coordination...`;
- hook backup suffix: `.herdr-shepherd.bak`.

Do not change the source-attribution prefix `[Herdr from ...]`; it describes the upstream transport.

- [ ] **Step 6: Run state and runtime tests**

```powershell
node --test tests/coordination.test.mjs tests/server.test.mjs tests/hook.test.mjs tests/configure-hooks.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Confirm the retired state namespace is absent from active runtime files**

```powershell
$retired = 'HERDR_' + 'COORDINATION_STATE_DIR'
$retiredMatches = @(rg -n -- $retired skills install.ps1 install.sh uninstall.ps1 uninstall.sh tests hooks)
if ($LASTEXITCODE -notin 0,1) { throw 'State environment scan failed.' }
if ($retiredMatches.Count) { $retiredMatches; throw 'Retired state environment variable remains.' }
$oldState = 'coordination-' + 'audit'
$oldStateMatches = @(rg -n -- $oldState skills install.ps1 install.sh uninstall.ps1 uninstall.sh tests hooks)
if ($LASTEXITCODE -notin 0,1) { throw 'State directory scan failed.' }
if ($oldStateMatches.Count) { $oldStateMatches; throw 'Retired state directory remains.' }
```

Expected: both searches return no matches. Matches in the approved migration spec are allowed and are outside these paths.

- [ ] **Step 8: Commit the state migration**

```powershell
git diff --check
git add -- skills/herdr-shepherd/scripts install.ps1 install.sh uninstall.ps1 uninstall.sh hooks tests
git commit -m "Move audit state to the shepherd namespace"
```

Expected: one commit containing the state-path resolver, product-owned labels, installers, and their tests.

---

### Task 4: Run the Release Gate, Publish the Branch, and Merge

**Files:**
- Verify: every tracked file in the new checkout.
- Modify only if a gate exposes a concrete defect.

**Interfaces:**
- Consumes: identity and state commits from Tasks 2 and 3.
- Produces: green pull request merged into `talberthoule/herdr-shepherd:main`.

- [ ] **Step 1: Scan for stale functional identity**

```powershell
$platform = 'he' + 'rdr'
$oldSlug = "coordinating-$platform-agents"
$capitalized = $platform.Substring(0,1).ToUpper() + $platform.Substring(1)
$oldDisplay = "$capitalized Agent Coordination"
$oldTitle = "Coordinating $capitalized Agents"
$allowed = @(
  'docs/superpowers/specs/2026-07-25-herdr-shepherd-migration-design.md',
  'docs/superpowers/plans/2026-07-25-herdr-shepherd-migration.md'
)
$matches = @(git grep -n -I -e $oldSlug -e $oldDisplay -e $oldTitle -- .)
$unexpected = @($matches | Where-Object {
  $line = $_
  -not ($allowed | Where-Object { $line.StartsWith("${_}:") })
})
if ($unexpected.Count) { $unexpected; throw 'Stale functional identity remains.' }
$matches
```

Expected: any output is limited to explicit source-project, retirement, or clean-break statements in the two approved migration documents.

- [ ] **Step 2: Validate JSON and plugin manifests**

```powershell
node -e "for (const p of ['.agents/plugins/marketplace.json','.claude-plugin/marketplace.json','.claude-plugin/plugin.json','.codex-plugin/plugin.json','hooks/claude.json','hooks/hooks.json']) JSON.parse(require('node:fs').readFileSync(p,'utf8')); console.log('JSON manifests valid')"
claude plugin validate .
```

Expected: JSON parse succeeds and Claude reports a valid plugin/marketplace.

- [ ] **Step 3: Run the complete local gate**

```powershell
node --test --test-concurrency=1 tests/*.test.mjs
$null = [scriptblock]::Create((Get-Content -Raw install.ps1))
$null = [scriptblock]::Create((Get-Content -Raw uninstall.ps1))
if (Get-Command sh -ErrorAction SilentlyContinue) {
    sh -n install.sh
    sh -n uninstall.sh
}
git diff --check
git status -sb
```

Expected: all Node tests pass, both PowerShell scripts parse, both shell scripts pass when `sh` is present, no whitespace errors exist, and the worktree is clean.

- [ ] **Step 4: Push the branch**

```powershell
git push -u origin agent/herdr-shepherd-rebrand
git ls-remote --exit-code origin refs/heads/agent/herdr-shepherd-rebrand
```

Expected: remote branch exists at the local branch SHA.

- [ ] **Step 5: Open the pull request**

```powershell
$title = ('Launch ' + ('He' + 'rdr Shepherd'))
$body = @"
## What changed
- renamed the plugin, skill, marketplace, paths, and documentation
- moved audit state to a clean shepherd namespace
- preserved upstream CLI and protocol identifiers

## Why
The former project identity is being retired in favor of a concise, product-ready name.

## Checks
- complete Node test suite
- PowerShell and POSIX installer syntax
- manifest validation
- stale-identity scan
"@
gh pr create --repo talberthoule/herdr-shepherd --base main --head agent/herdr-shepherd-rebrand --title $title --body $body
```

Expected: GitHub returns the new pull request URL.

- [ ] **Step 6: Wait for GitHub Actions and inspect the exact result**

```powershell
$pr = gh pr view --repo talberthoule/herdr-shepherd --json number --jq '.number'
gh pr checks $pr --repo talberthoule/herdr-shepherd --watch
```

Expected: Windows and Ubuntu checks both pass. A failure returns to the owning branch for one focused fix and a full local rerun.

- [ ] **Step 7: Merge and verify the new default branch**

```powershell
$pr = gh pr view --repo talberthoule/herdr-shepherd --json number --jq '.number'
gh pr merge $pr --repo talberthoule/herdr-shepherd --merge --delete-branch
git switch main
git pull --ff-only origin main
git status -sb
git rev-parse HEAD
gh repo view talberthoule/herdr-shepherd --json defaultBranchRef,visibility,isArchived,url
```

Expected: local `main` matches `origin/main`, the new repository is public and unarchived, and its default branch contains the merged identity.

---

### Task 5: Uninstall the Former Identity and Install Fresh Plugins

**Files and external state:**
- Preserve: `%LOCALAPPDATA%\Herdr\coordination-audit\audit.jsonl`
- Preserve: `%LOCALAPPDATA%\Herdr\coordination-audit\state.json`
- Remove if present and verified: `%USERPROFILE%\.codex\skills\coordinating-herdr-agents`
- Remove through old uninstaller if present: `%USERPROFILE%\.claude\skills\coordinating-herdr-agents`
- Install through plugin managers: `herdr-shepherd@shepherd`
- New runtime state: `%LOCALAPPDATA%\Herdr\shepherd-audit`

**Interfaces:**
- Consumes: merged public marketplace repository from Task 4 and preserved old checkout.
- Produces: Codex and Claude Code installations of `herdr-shepherd@shepherd`, no active old skill/hook paths, unchanged durable old audit files, and absent or empty new state.

- [ ] **Step 1: Record durable audit hashes**

```powershell
$oldAudit = Join-Path $env:LOCALAPPDATA 'Herdr\coordination-audit'
$hashFile = Join-Path $env:TEMP 'herdr-shepherd-old-audit-hashes.json'
$before = @('audit.jsonl','state.json') | ForEach-Object {
    $path = Join-Path $oldAudit $_
    if (Test-Path -LiteralPath $path) {
        $hash = Get-FileHash -Algorithm SHA256 -LiteralPath $path
        [pscustomobject]@{ Name = $_; Hash = $hash.Hash }
    }
}
$before | ConvertTo-Json | Set-Content -LiteralPath $hashFile
Get-Content -Raw -LiteralPath $hashFile
```

Expected: the manifest records hashes for the durable files that currently exist.

- [ ] **Step 2: Run the old uninstaller without purging history**

```powershell
$oldCheckout = Join-Path $env:OneDriveCommercial 'Code\coordinating-herdr-agents'
& (Join-Path $oldCheckout 'uninstall.ps1')
```

Expected: old hook entries and the expected Claude junction are removed; output says audit history was preserved.

- [ ] **Step 3: Remove any remaining old Codex skill copy safely**

```powershell
$oldSkill = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.codex\skills\coordinating-herdr-agents'))
$expected = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.codex\skills\coordinating-herdr-agents'))
if ($oldSkill -ne $expected) { throw "Refusing unexpected target: $oldSkill" }
if (Test-Path -LiteralPath $oldSkill) {
    Remove-Item -LiteralPath $oldSkill -Recurse -Force
}
```

Expected: only the exact retired skill directory is removed. It remains recoverable from the preserved old checkout.

- [ ] **Step 4: Remove old plugin-manager entries only if they exist**

```powershell
$platform = 'he' + 'rdr'
$oldSelector = "coordinating-$platform-agents@$platform"
if ((codex plugin list | Out-String).Contains($oldSelector)) {
    codex plugin remove $oldSelector
}
if ((claude plugin list | Out-String).Contains($oldSelector)) {
    claude plugin uninstall $oldSelector --keep-data -y
}
```

Expected: no old selector remains installed; absence is a valid no-op.

- [ ] **Step 5: Add the new marketplace and install for Codex**

```powershell
codex plugin marketplace add talberthoule/herdr-shepherd --ref main --json
codex plugin add herdr-shepherd@shepherd
codex plugin list | Select-String -SimpleMatch 'herdr-shepherd@shepherd'
```

Expected: Codex reports `herdr-shepherd@shepherd` installed and enabled.

- [ ] **Step 6: Add the new marketplace and install for Claude Code**

```powershell
claude plugin marketplace add talberthoule/herdr-shepherd
claude plugin install herdr-shepherd@shepherd
claude plugin list | Select-String -SimpleMatch 'herdr-shepherd@shepherd'
```

Expected: Claude Code reports `herdr-shepherd@shepherd` installed and enabled.

- [ ] **Step 7: Verify the old durable audit hashes are unchanged**

```powershell
$oldAudit = Join-Path $env:LOCALAPPDATA 'Herdr\coordination-audit'
$hashFile = Join-Path $env:TEMP 'herdr-shepherd-old-audit-hashes.json'
$before = @(Get-Content -Raw -LiteralPath $hashFile | ConvertFrom-Json)
$after = @('audit.jsonl','state.json') | ForEach-Object {
    $path = Join-Path $oldAudit $_
    if (Test-Path -LiteralPath $path) {
        $hash = Get-FileHash -Algorithm SHA256 -LiteralPath $path
        [pscustomobject]@{ Name = $_; Hash = $hash.Hash }
    }
}
$difference = Compare-Object ($before | ConvertTo-Json -Compress) ($after | ConvertTo-Json -Compress)
if ($difference) { $difference; throw 'Old durable audit files changed.' }
Remove-Item -LiteralPath $hashFile -Force
```

Expected: no difference.

- [ ] **Step 8: Verify clean-break local state**

```powershell
$oldCodexSkill = Join-Path $env:USERPROFILE '.codex\skills\coordinating-herdr-agents'
$oldClaudeSkill = Join-Path $env:USERPROFILE '.claude\skills\coordinating-herdr-agents'
$newState = Join-Path $env:LOCALAPPDATA 'Herdr\shepherd-audit'
if (Test-Path -LiteralPath $oldCodexSkill) { throw "Old Codex skill remains: $oldCodexSkill" }
if (Test-Path -LiteralPath $oldClaudeSkill) { throw "Old Claude skill remains: $oldClaudeSkill" }
if (Test-Path -LiteralPath $newState) {
    $entries = @(Get-ChildItem -Force -LiteralPath $newState)
    if ($entries.Count) { throw "New state is not clean: $newState" }
}
codex plugin list | Select-String -SimpleMatch 'herdr-shepherd@shepherd'
claude plugin list | Select-String -SimpleMatch 'herdr-shepherd@shepherd'
```

Expected: old skill paths are absent, both new plugins are installed, and the new state directory is absent or empty. A fresh host session will load the new hooks; do not restart the active coordinating pane.

---

### Task 6: Retire, Privatize, and Archive the Former Repository

**Files:**
- Replace in old checkout: `README.md`
- Preserve: every other file and the complete old Git history.

**Interfaces:**
- Consumes: verified new repository and local plugin installations.
- Produces: retirement commit on `talberthoule/coordinating-herdr-agents`, then a private and archived repository; old local checkout remains available.

- [ ] **Step 1: Reconfirm the new project before crossing the retirement boundary**

```powershell
gh repo view talberthoule/herdr-shepherd --json nameWithOwner,visibility,isArchived,defaultBranchRef,url
codex plugin list | Select-String -SimpleMatch 'herdr-shepherd@shepherd'
claude plugin list | Select-String -SimpleMatch 'herdr-shepherd@shepherd'
gh run list --repo talberthoule/herdr-shepherd --branch main --limit 1 --json conclusion,status,url,headSha
```

Expected: new repository is public and unarchived, both plugins are installed, and the latest `main` workflow concluded `success`.

- [ ] **Step 2: Replace the old README with an explicit retirement pointer**

From the old checkout, replace `README.md` with:

```markdown
# Retired

This project has been replaced by [Herdr Shepherd](https://github.com/talberthoule/herdr-shepherd).

The former plugin identity is unsupported. Uninstall it and install `herdr-shepherd@shepherd` from the new repository. This repository is retained as a private, read-only archive.
```

- [ ] **Step 3: Commit and push the retirement marker**

```powershell
git status --short
git add -- README.md
git commit -m "Retire project in favor of its successor"
git push origin main
git status -sb
```

Expected: old `main` and `origin/main` match with only the retirement commit added.

- [ ] **Step 4: Update the old repository description**

```powershell
gh repo edit talberthoule/coordinating-herdr-agents --description 'Retired; superseded by talberthoule/herdr-shepherd.'
```

Expected: repository metadata points owners to the successor before archival.

- [ ] **Step 5: Make the old repository private**

```powershell
gh repo edit talberthoule/coordinating-herdr-agents --visibility private --accept-visibility-change-consequences
gh repo view talberthoule/coordinating-herdr-agents --json visibility,isArchived
```

Expected: visibility is `PRIVATE` and `isArchived` is still `false`.

- [ ] **Step 6: Archive the old repository**

```powershell
gh repo archive talberthoule/coordinating-herdr-agents --yes
gh repo view talberthoule/coordinating-herdr-agents --json nameWithOwner,url,visibility,isArchived,defaultBranchRef
```

Expected: `visibility` is `PRIVATE` and `isArchived` is `true`.

- [ ] **Step 7: Record final local and remote state**

```powershell
$oldCheckout = Join-Path $env:OneDriveCommercial 'Code\coordinating-herdr-agents'
$newCheckout = Join-Path $env:OneDriveCommercial 'Code\herdr-shepherd'
git -C $oldCheckout status -sb
git -C $oldCheckout remote -v
git -C $newCheckout status -sb
git -C $newCheckout remote -v
gh repo view talberthoule/coordinating-herdr-agents --json visibility,isArchived,url
gh repo view talberthoule/herdr-shepherd --json visibility,isArchived,url
```

Expected: both local checkouts are clean; the old checkout still targets the private archived repository; the new checkout targets the public active repository; no local folder is deleted.
