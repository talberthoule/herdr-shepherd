[CmdletBinding()]
param([switch]$PurgeAuditHistory)

$ErrorActionPreference = 'Stop'
$skillRoot = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'skills\herdr-shepherd'
$codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME '.codex' }
$claudeHome = Join-Path $HOME '.claude'
$codexHooks = Join-Path $codexHome 'hooks.json'
$claudeSettings = Join-Path $claudeHome 'settings.json'
$claudeLink = Join-Path $claudeHome 'skills\herdr-shepherd'
$stateDir = Join-Path $env:LOCALAPPDATA 'Herdr\shepherd-audit'
$codexInstalled = [bool](Get-Command codex -ErrorAction SilentlyContinue)
$claudeInstalled = [bool](Get-Command claude -ErrorAction SilentlyContinue)

$codexArg = if ($codexInstalled) { $codexHooks } else { '-' }
$claudeArg = if ($claudeInstalled) { $claudeSettings } else { '-' }
& node (Join-Path $skillRoot 'scripts\configure-hooks.mjs') uninstall $codexArg $claudeArg $skillRoot
if ($LASTEXITCODE -ne 0) { throw 'Failed to remove coordination hooks.' }

$viewerState = Join-Path $stateDir 'viewer.json'
if (Test-Path -LiteralPath $viewerState) {
    try {
        $viewer = Get-Content -Raw -LiteralPath $viewerState | ConvertFrom-Json
        Stop-Process -Id $viewer.pid -Force -ErrorAction SilentlyContinue
    } finally {
        Remove-Item -LiteralPath $viewerState -Force -ErrorAction SilentlyContinue
    }
}

if ($claudeInstalled -and (Test-Path -LiteralPath $claudeLink)) {
    $item = Get-Item -LiteralPath $claudeLink -Force
    $targets = @($item.Target | ForEach-Object { [IO.Path]::GetFullPath($_) })
    if ($item.LinkType -eq 'Junction' -and $targets -contains [IO.Path]::GetFullPath($skillRoot)) {
        [IO.Directory]::Delete($claudeLink, $false)
    } else {
        Write-Warning "Preserved unexpected Claude skill path: $claudeLink"
    }
}

if ($PurgeAuditHistory -and (Test-Path -LiteralPath $stateDir)) {
    $resolved = [IO.Path]::GetFullPath($stateDir)
    $expected = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Herdr\shepherd-audit'))
    if ($resolved -ne $expected) { throw "Refusing to purge unexpected path: $resolved" }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}

Write-Host 'Removed Herdr Shepherd hooks.'
if (-not $PurgeAuditHistory) { Write-Host "Preserved audit history at $stateDir" }
