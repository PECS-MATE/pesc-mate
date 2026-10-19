[CmdletBinding()]
param(
    [ValidateSet('quick', 'frontend', 'backend', 'full')]
    [string]$Mode = 'quick',
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$runnerArguments = @((Join-Path $PSScriptRoot 'verify.mjs'), $Mode)
if ($DryRun) { $runnerArguments += '--dry-run' }
& node @runnerArguments
exit $LASTEXITCODE
