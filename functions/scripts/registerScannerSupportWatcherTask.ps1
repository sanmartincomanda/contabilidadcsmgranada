param(
    [string]$TaskName = 'CSM Scanner Support Watcher',
    [string]$WatchFolder = 'C:\CSM\soportes-escaneados',
    [int]$IntervalMs = 5000
)

$scriptPath = Join-Path $PSScriptRoot 'runScannerSupportWatcher.ps1'
$hiddenRunnerPath = Join-Path $PSScriptRoot 'runSicarPowerShellHidden.vbs'

if (-not (Test-Path -LiteralPath $scriptPath)) {
    throw "No se encontro el script principal en $scriptPath"
}

if (-not (Test-Path -LiteralPath $hiddenRunnerPath)) {
    throw "No se encontro el lanzador oculto en $hiddenRunnerPath"
}

New-Item -ItemType Directory -Force -Path $WatchFolder | Out-Null

$taskAction = New-ScheduledTaskAction `
    -Execute 'wscript.exe' `
    -Argument "`"$hiddenRunnerPath`" `"runScannerSupportWatcher.ps1`" `"-WatchFolder`" `"$WatchFolder`" `"-IntervalMs`" `"$IntervalMs`""

$taskTrigger = New-ScheduledTaskTrigger -AtLogOn
$taskSettings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -StartWhenAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $taskAction `
    -Trigger $taskTrigger `
    -Settings $taskSettings `
    -Description 'Vigila la carpeta de escaneos CSM y sube soportes fiscales a Firebase Storage.' `
    -Force | Out-Null

Write-Host "Tarea '$TaskName' creada correctamente. Carpeta vigilada: $WatchFolder"
Get-ScheduledTask -TaskName $TaskName | Format-List TaskName,State
