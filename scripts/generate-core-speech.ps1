# Rebuild the public, fixed-expression audio bundle with an installed Korean voice.
# Run on Windows: pwsh -File scripts/generate-core-speech.ps1
[CmdletBinding()]
param(
    [string]$VoiceName = 'Microsoft Heami Desktop'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repositoryPath = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $repositoryPath 'frontend/src/App.jsx'
$outputPath = Join-Path $repositoryPath 'frontend/public/audio/core/v1'
$source = Get-Content -LiteralPath $sourcePath -Raw -Encoding utf8
$expressions = [System.Collections.Generic.List[string]]::new()

# The shipped expression definitions are the single source of truth. Do not read
# account data or accept arbitrary user text for this public, committed bundle.
foreach ($constantName in @('DEFAULT_QUICK_EXPRESSIONS', 'RECOVERY_EXPRESSIONS')) {
    $arrayPattern = '(?s)const\s+' + [regex]::Escape($constantName) + '\s*=\s*\[(.*?)\];'
    $arrayMatch = [regex]::Match($source, $arrayPattern)
    if (-not $arrayMatch.Success) {
        throw "Cannot find the public expression array: $constantName"
    }
    $labelMatches = [regex]::Matches($arrayMatch.Groups[1].Value, "label:\s*'([^']+)'")
    if ($labelMatches.Count -eq 0) {
        throw "No public labels found in: $constantName"
    }
    foreach ($labelMatch in $labelMatches) {
        $label = $labelMatch.Groups[1].Value.Trim().Normalize([Text.NormalizationForm]::FormC)
        if (-not $expressions.Contains($label)) { $expressions.Add($label) }
    }
}

function Test-GeneratedWave {
    param([string]$Path)

    $stream = [IO.File]::OpenRead($Path)
    $reader = [IO.BinaryReader]::new($stream)
    try {
        if ([Text.Encoding]::ASCII.GetString($reader.ReadBytes(4)) -ne 'RIFF') {
            throw "Invalid RIFF header: $Path"
        }
        $declaredLength = $reader.ReadUInt32() + 8L
        if ($declaredLength -ne $stream.Length -or
            [Text.Encoding]::ASCII.GetString($reader.ReadBytes(4)) -ne 'WAVE') {
            throw "Invalid WAVE header or length: $Path"
        }
        $formatValid = $false
        $audioBytes = 0L
        $nonzeroSamples = 0L
        while ($stream.Position + 8 -le $stream.Length) {
            $chunkName = [Text.Encoding]::ASCII.GetString($reader.ReadBytes(4))
            $chunkSize = $reader.ReadUInt32()
            $chunkEnd = $stream.Position + $chunkSize
            if ($chunkEnd -gt $stream.Length) { throw "Truncated WAVE chunk: $Path" }
            if ($chunkName -eq 'fmt ') {
                if ($chunkSize -lt 16) { throw "Invalid WAVE format chunk: $Path" }
                $encoding = $reader.ReadUInt16()
                $channels = $reader.ReadUInt16()
                $sampleRate = $reader.ReadUInt32()
                $byteRate = $reader.ReadUInt32()
                $blockAlign = $reader.ReadUInt16()
                $bits = $reader.ReadUInt16()
                $formatValid = $encoding -eq 1 -and $channels -eq 1 -and
                    $sampleRate -eq 16000 -and $byteRate -eq 32000 -and
                    $blockAlign -eq 2 -and $bits -eq 16
            } elseif ($chunkName -eq 'data') {
                if ($chunkSize % 2 -ne 0) { throw "Unaligned PCM audio data: $Path" }
                $audioBytes += $chunkSize
                while ($stream.Position -lt $chunkEnd) {
                    if ($reader.ReadInt16() -ne 0) { $nonzeroSamples++ }
                }
            }
            $stream.Position = $chunkEnd + ($chunkSize % 2)
        }
        $duration = $audioBytes / 32000.0
        if (-not $formatValid -or $duration -lt 0.2 -or $duration -gt 15 -or $nonzeroSamples -eq 0) {
            throw "Invalid, empty, silent, or unexpected-duration PCM audio: $Path"
        }
        return [Math]::Round($duration, 3)
    } finally {
        $reader.Dispose()
        $stream.Dispose()
    }
}

Add-Type -AssemblyName System.Speech
$synthesizer = [System.Speech.Synthesis.SpeechSynthesizer]::new()
try {
    $installedVoice = $synthesizer.GetInstalledVoices() |
        Where-Object { $_.Enabled -and $_.VoiceInfo.Name -eq $VoiceName -and $_.VoiceInfo.Culture.Name -eq 'ko-KR' } |
        Select-Object -First 1
    if (-not $installedVoice) {
        throw "Install the Korean Windows speech voice '$VoiceName' before generating this bundle."
    }
    $synthesizer.SelectVoice($VoiceName)
    $synthesizer.Rate = -1
    $synthesizer.Volume = 100
    $format = [System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(
        16000,
        [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
        [System.Speech.AudioFormat.AudioChannel]::Mono
    )
    [IO.Directory]::CreateDirectory($outputPath) | Out-Null
    $entries = [System.Collections.Generic.List[object]]::new()
    $fileNames = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $totalBytes = 0L
    foreach ($expression in $expressions) {
        $fileName = ($expression -replace '\s+', '_') + '.wav'
        if ($fileName.IndexOfAny([IO.Path]::GetInvalidFileNameChars()) -ge 0 -or -not $fileNames.Add($fileName)) {
            throw "Invalid or duplicate public audio file name: $fileName"
        }
        $filePath = Join-Path $outputPath $fileName
        $synthesizer.SetOutputToWaveFile($filePath, $format)
        $synthesizer.Speak($expression)
        $synthesizer.SetOutputToNull()
        $duration = Test-GeneratedWave -Path $filePath
        $totalBytes += (Get-Item -LiteralPath $filePath).Length
        $entries.Add([ordered]@{ text = $expression; file = $fileName })
        Write-Host "$fileName : $duration seconds"
    }
    if ($totalBytes -gt 2MB) { throw "The core audio bundle exceeds 2 MiB: $totalBytes bytes" }
    $manifest = [ordered]@{
        version = 'v1'
        voice = [ordered]@{ name = $VoiceName; culture = 'ko-KR' }
        provenance = [ordered]@{
            engine = 'System.Speech'
            source = 'frontend/src/App.jsx'
            scope = 'public-fixed-expressions'
        }
        format = [ordered]@{ encoding = 'PCM'; sampleRate = 16000; bitsPerSample = 16; channels = 1 }
        entries = $entries.ToArray()
    }
    $manifestPath = Join-Path $outputPath 'manifest.json'
    [IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 5) + "`n", [Text.UTF8Encoding]::new($false))
    Write-Host "Generated $($entries.Count) public expressions ($totalBytes bytes) in $outputPath"
} finally {
    $synthesizer.Dispose()
}
