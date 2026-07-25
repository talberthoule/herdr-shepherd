[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$skillRoot = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'skills\herdr-shepherd'
$codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME '.codex' }
$claudeHome = Join-Path $HOME '.claude'
$codexHooks = Join-Path $codexHome 'hooks.json'
$claudeSettings = Join-Path $claudeHome 'settings.json'
$claudeSkills = Join-Path $claudeHome 'skills'
$claudeLink = Join-Path $claudeSkills 'herdr-shepherd'
$stateDir = Join-Path $env:LOCALAPPDATA 'Herdr\shepherd-audit'
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

New-Item -ItemType Directory -Force -Path $codexHome, $claudeHome, $claudeSkills, $stateDir | Out-Null
$codexArg = if ($codexInstalled) { $codexHooks } else { '-' }
$claudeArg = if ($claudeInstalled) { $claudeSettings } else { '-' }
& node (Join-Path $skillRoot 'scripts\configure-hooks.mjs') install $codexArg $claudeArg $skillRoot
if ($LASTEXITCODE -ne 0) { throw 'Failed to configure Codex and Claude Code hooks.' }

if ($claudeInstalled) {
    if (Test-Path -LiteralPath $claudeLink) {
        $item = Get-Item -LiteralPath $claudeLink -Force
        $targets = @($item.Target | ForEach-Object { [IO.Path]::GetFullPath($_) })
        if ($item.LinkType -ne 'Junction' -or $targets -notcontains [IO.Path]::GetFullPath($skillRoot)) {
            throw "Claude skill path already exists and is not the expected junction: $claudeLink"
        }
    } else {
        New-Item -ItemType Junction -Path $claudeLink -Target $skillRoot | Out-Null
    }
}

$codexConfig = Join-Path $codexHome 'config.toml'
if ($codexInstalled -and (-not (Test-Path -LiteralPath $codexConfig) -or -not (Select-String -LiteralPath $codexConfig -Pattern '^\s*hooks\s*=\s*true\s*$' -Quiet))) {
    Write-Warning 'Codex hooks are not enabled in config.toml. Add `hooks = true` under `[features]`.'
}

Write-Host 'Installed Herdr Shepherd.'
Write-Host "Shared audit state: $stateDir"
Write-Host 'Review and trust the new hooks in a fresh host session. This installer does not bypass trust review.'
