param(
    [string]$TaskName = 'SICAR Purchases Sync Every Minute',
    [int]$IntervalMinutes = 1,
    [int]$LookbackDays = 1
)

$scriptPath = Join-Path $PSScriptRoot 'runDailySicarPurchases.ps1'

if (-not (Test-Path -LiteralPath $scriptPath)) {
    throw "No se encontro el script principal en $scriptPath"
}

$safeInterval = [Math]::Max(1, [Math]::Min($IntervalMinutes, 60))
$safeLookback = [Math]::Max(0, [Math]::Min($LookbackDays, 14))

$taskAction = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" -LookbackDays $safeLookback"

$taskTrigger = New-ScheduledTaskTrigger `
    -Once `
    -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes $safeInterval) `
    -RepetitionDuration (New-TimeSpan -Days 3650)

$taskSettings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $taskAction `
    -Trigger $taskTrigger `
    -Settings $taskSettings `
    -Description "Sincroniza compras SICAR cada $safeInterval minuto(s), con ventana movil de $safeLookback dia(s)." `
    -Force | Out-Null

Write-Host "Tarea '$TaskName' creada correctamente cada $safeInterval minuto(s)."
Get-ScheduledTask -TaskName $TaskName | Format-List TaskName,State
