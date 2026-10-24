$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectDir
try {
  if (-not (Test-Path -LiteralPath '.env')) { Copy-Item -LiteralPath '.env.example' -Destination '.env' }
  docker compose up -d --build
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo iniciar VidraCred. Revise que Docker Desktop esté ejecutándose.' }
  Write-Output 'VidraCred disponible en http://localhost:3000'
} finally { Pop-Location }
