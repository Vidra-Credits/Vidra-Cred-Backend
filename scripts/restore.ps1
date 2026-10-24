param([Parameter(Mandatory=$true)][string]$BackupPath)
$ErrorActionPreference = 'Stop'
$resolvedBackup = (Resolve-Path -LiteralPath $BackupPath).Path
if ([IO.Path]::GetExtension($resolvedBackup) -ne '.sql') { throw 'Seleccione un respaldo .sql.' }
$databaseName = 'vidracred_restore_' + (Get-Date -Format 'yyyyMMddHHmmss')
Push-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
try {
  docker compose cp $resolvedBackup db:/tmp/vidracred-restore.sql
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo copiar el respaldo.' }
  docker compose exec -T db createdb -U vidracred $databaseName
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear la base de recuperación.' }
  docker compose exec -T db psql -X -v ON_ERROR_STOP=1 -U vidracred -d $databaseName -f /tmp/vidracred-restore.sql
  if ($LASTEXITCODE -ne 0) { throw "No se pudo completar la recuperación en $databaseName." }
  Write-Output "Respaldo restaurado en una base nueva: $databaseName"
  Write-Output 'La base original no se ha modificado. Para consultar la copia, configure DATABASE_URL con el nuevo nombre.'
} finally { Pop-Location }
