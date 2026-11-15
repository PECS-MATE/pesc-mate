# Resume public child-voice generation with existing containers; never builds images.
[CmdletBinding()]
param(
    [ValidateRange(5, 360)][int]$MaxMinutes = 180,
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repositoryPath = Split-Path -Parent $PSScriptRoot
$qwenContainer = 'pesc-mate-qwen-tts-1'
$meloContainer = 'pesc-mate-melotts-1'
$mutex = [Threading.Mutex]::new($false, 'Local\pecsmate-card-speech')
$ownsMutex = $false
$startedQwen = $false
$stoppedMelo = $false
$deadlineAt = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + ($MaxMinutes * 60)

function Invoke-DockerCommand {
    param([string[]]$DockerArguments)
    & docker @DockerArguments
    if ($LASTEXITCODE -ne 0) { throw "Docker command failed: $($DockerArguments[0])" }
}

Push-Location -LiteralPath $repositoryPath
try {
    try { $ownsMutex = $mutex.WaitOne(0) }
    catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
    if (-not $ownsMutex) { throw 'Card speech generation is already running in another terminal.' }
    Get-Command python, docker -ErrorAction Stop | Out-Null
    $qwenRunning = & docker inspect --format '{{.State.Running}}' $qwenContainer
    if ($LASTEXITCODE -ne 0) { throw 'The existing Qwen container is required. This command does not build or download a model.' }
    $meloRunning = & docker inspect --format '{{.State.Running}}' $meloContainer
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect the existing Melo container.' }
    & python scripts/generate-card-speech.py --status
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect prepared speech files.' }
    if ($CheckOnly) { Write-Host 'Prerequisites OK. No containers were changed and no speech was generated.'; return }

    if ($meloRunning -eq 'true') {
        Invoke-DockerCommand -DockerArguments @('stop', $meloContainer)
        $stoppedMelo = $true
    }
    if ($qwenRunning -ne 'true') {
        Invoke-DockerCommand -DockerArguments @('start', $qwenContainer)
        $startedQwen = $true
    }
    & python scripts/generate-card-speech.py --deadline-seconds ($MaxMinutes * 60) --deadline-at $deadlineAt
    if ($LASTEXITCODE -ne 0) { throw 'Generation did not finish. Saved clips are preserved; run this command again to resume.' }
    Write-Host 'Complete: 120 cards in girl and boy voices. Refresh the service page to use them.'
}
finally {
    # Restore only services changed by this invocation, including after Ctrl+C/failure.
    try {
        if ($startedQwen) { Invoke-DockerCommand -DockerArguments @('stop', $qwenContainer) }
    }
    finally {
        try {
            if ($stoppedMelo) { Invoke-DockerCommand -DockerArguments @('start', $meloContainer) }
        }
        finally {
            if ($ownsMutex) { $mutex.ReleaseMutex() }
            $mutex.Dispose()
            Pop-Location
        }
    }
}
