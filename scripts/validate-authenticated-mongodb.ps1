[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$composeFile = Join-Path $repository 'compose.secure-db.yaml'
$identity = [Guid]::NewGuid().ToString('N')
$project = "pesc-auth-test-$identity"
$baseDirectory = Join-Path $repository '.local-security-tests'
$secretDirectory = Join-Path $baseDirectory "auth-$identity"
$ownedVolume = "${project}_mongodb_secure_data"
$variables = @('PESC_SECURE_SECRETS_DIR', 'SECURE_MONGODB_DATABASE', 'SECURE_BACKEND_PORT', 'SECURE_BACKEND_IMAGE')
$previous = @{}
foreach ($name in $variables) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
$started = $false
$failed = $false
$cleaned = $false

function Invoke-Compose([string[]]$DockerArguments) {
    & docker compose -f $composeFile -p $project @DockerArguments
    if ($LASTEXITCODE -ne 0) { throw "Authenticated validation command failed (exit $LASTEXITCODE)." }
}

function New-TestPassword {
    $bytes = [byte[]]::new(48)
    [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    return [Convert]::ToBase64String($bytes)
}

try {
    if ($project -notmatch '^pesc-auth-test-[a-f0-9]{32}$') { throw 'Invalid isolated project identity.' }
    if (-not (Test-Path -LiteralPath $baseDirectory)) { New-Item -ItemType Directory -Path $baseDirectory | Out-Null }
    if ((Get-Item -LiteralPath $baseDirectory).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Secret test base must not be a link.' }
    New-Item -ItemType Directory -Path $secretDirectory | Out-Null
    if ($IsWindows) {
        $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        & icacls $secretDirectory /inheritance:r /grant:r "*${sid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Cannot restrict temporary secret directory permissions.' }
    } else {
        & chmod 700 -- $secretDirectory
        if ($LASTEXITCODE -ne 0) { throw 'Cannot restrict temporary secret directory permissions.' }
    }
    $files = @{ mongodb_root_username = "pesc_root_$($identity.Substring(0, 16))";
        mongodb_root_password = (New-TestPassword); mongodb_app_username = "pesc_app_$($identity.Substring(0, 16))";
        mongodb_app_password = (New-TestPassword) }
    foreach ($name in $files.Keys) {
        $path = Join-Path $secretDirectory $name
        [IO.File]::WriteAllText($path, $files[$name], [Text.UTF8Encoding]::new($false))
        if (-not $IsWindows) { & chmod 600 -- $path; if ($LASTEXITCODE -ne 0) { throw 'Cannot restrict test secret file permissions.' } }
    }
    $files.Clear()
    $env:PESC_SECURE_SECRETS_DIR = $secretDirectory
    $env:SECURE_MONGODB_DATABASE = "pesc_mate_auth_test_$identity"
    $env:SECURE_BACKEND_PORT = '0'
    $env:SECURE_BACKEND_IMAGE = "${project}-backend:validation"
    Write-Host 'Validating a new isolated authenticated stack; credentials are not printed.'
    $started = $true
    Invoke-Compose -DockerArguments @('up', '-d', '--build', '--wait', '--wait-timeout', '180')
    $tests = Join-Path $repository 'backend/security_tests'
    Invoke-Compose -DockerArguments @('run', '--rm', '--no-deps', '--volume', "${tests}:/app/security_tests:ro", 'backend',
        'python', '-m', 'unittest', 'discover', '-s', 'security_tests', '-p', 'test_*.py', '-v')
} catch {
    Write-Host 'Authenticated MongoDB validation failed. No production stack was selected.'
    $failed = $true
} finally {
    try {
        if ($started) {
            $labels = & docker volume inspect $ownedVolume --format '{{json .Labels}}' 2>$null
            if ($LASTEXITCODE -eq 0) {
                $metadata = $labels | ConvertFrom-Json
                if ($metadata.'com.docker.compose.project' -ne $project -or
                    $metadata.'com.docker.compose.volume' -ne 'mongodb_secure_data') { throw 'Refusing cleanup of an unowned volume.' }
            }
            Invoke-Compose -DockerArguments @('down', '--volumes', '--timeout', '15')
        }
        $resolved = (Resolve-Path -LiteralPath $secretDirectory).Path
        if ([IO.Path]::GetDirectoryName($resolved) -ne [IO.Path]::GetFullPath($baseDirectory) -or
            ((Get-Item -LiteralPath $baseDirectory).Attributes -band [IO.FileAttributes]::ReparsePoint) -or
            [IO.Path]::GetFileName($resolved) -notmatch '^auth-[a-f0-9]{32}$' -or
            ((Get-Item -LiteralPath $resolved).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'Refusing cleanup outside the exact temporary secret directory.'
        }
        Remove-Item -LiteralPath $resolved -Recurse -Force
        $cleaned = $true
    } catch {
        Write-Host "Cleanup needs review for isolated project $project. Credentials were retained in $secretDirectory."
        $failed = $true
    }
    foreach ($name in $variables) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
}
if ($cleaned) { Write-Host 'Only the isolated test containers, database volume and temporary credentials were removed. Build cache remains.' }
if ($failed) { exit 1 }
Write-Host 'Authenticated MongoDB boundary validation passed.'
