$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectDir
try {
  $backupDir = Join-Path $projectDir 'backups'
  New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
  $fileName = 'vidracred-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.sql'
  $backupPath = Join-Path $backupDir $fileName
  # Native output redirection preserves the UTF-8 bytes with PowerShell 7.4+.
  docker compose exec -T db pg_dump -U vidracred -d vidracred --no-owner --no-privileges --exclude-table-data=sessions --exclude-table-data=login_attempts --file=/tmp/vidracred-backup.sql
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo generar el respaldo.' }
  docker compose cp db:/tmp/vidracred-backup.sql $backupPath
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo copiar el respaldo.' }
  Write-Output "Respaldo guardado en $backupPath"
} finally { Pop-Location }
