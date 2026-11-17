$ErrorActionPreference = 'Stop'
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
  if (-not $env:TABLET_BIND_ADDRESS) { $env:TABLET_BIND_ADDRESS = '0.0.0.0' }
  docker compose --profile qwen up -d --build qwen-tts backend frontend
  if ($LASTEXITCODE -ne 0) { throw '로컬 Qwen 서비스 시작에 실패했습니다.' }
  Write-Output '서비스 시작 완료: http://localhost:5173 (음성 모델은 준비 시간이 필요할 수 있습니다.)'
} finally {
  Pop-Location
}
