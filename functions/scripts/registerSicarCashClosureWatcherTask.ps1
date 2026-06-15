param(
    [string]$TaskName = 'SICAR Cash Closure Watcher',
    [int]$IntervalMs = 15000,
    [int]$StartupBackfillDays = 3,
    [string]$NodePath = ''
)

$ErrorActionPreference = 'Stop'

$scriptPath = Join-Path $PSScriptRoot 'runSicarCashClosureWatcher.ps1'
$hiddenRunnerPath = Join-Path $PSScriptRoot 'runSicarPowerShellHidden.vbs'

if (-not (Test-Path -LiteralPath $scriptPath)) {
    throw "No se encontro el script principal en $scriptPath"
}

if (-not (Test-Path -LiteralPath $hiddenRunnerPath)) {
    throw "No se encontro el lanzador oculto en $hiddenRunnerPath"
}

$safeInterval = [Math]::Max(15000, [Math]::Min($IntervalMs, 300000))
$safeBackfillDays = [Math]::Max(1, [Math]::Min($StartupBackfillDays, 31))
$nodePathArgument = if ($NodePath) { " -NodePath `"$NodePath`"" } else { "" }

$taskAction = New-ScheduledTaskAction `
    -Execute 'wscript.exe' `
    -Argument "`"$hiddenRunnerPath`" `"runSicarCashClosureWatcher.ps1`" -IntervalMs $safeInterval -StartupBackfillDays $safeBackfillDays$nodePathArgument"

$taskTrigger = New-ScheduledTaskTrigger -AtLogOn

$taskSettings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -StartWhenAvailable `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Days 3650)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $taskAction `
    -Trigger $taskTrigger `
    -Settings $taskSettings `
    -Description "Escucha cierres de caja SICAR en MySQL cada $safeInterval ms, recupera $safeBackfillDays dia/s recientes al iniciar y escribe en Firebase solo si hay cierres nuevos o cambios." `
    -Force | Out-Null

Write-Host "Tarea '$TaskName' creada correctamente. Intervalo interno: $safeInterval ms. Backfill al iniciar: $safeBackfillDays dia/s."
Write-Host "Inicia automaticamente al iniciar sesion. Para iniciar ahora: Start-ScheduledTask -TaskName '$TaskName'"
Get-ScheduledTask -TaskName $TaskName | Format-List TaskName,State
