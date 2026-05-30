param(
    [string]$TaskName = 'SICAR Daily Purchases Sync',
    [string]$StartTime = '20:10'
)

$scriptPath = Join-Path $PSScriptRoot 'runDailySicarPurchases.ps1'

if (-not (Test-Path -LiteralPath $scriptPath)) {
    throw "No se encontro el script principal en $scriptPath"
}

$taskAction = New-ScheduledTaskAction `
    -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""

$taskTrigger = New-ScheduledTaskTrigger -Daily -At $StartTime
$taskSettings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $taskAction `
    -Trigger $taskTrigger `
    -Settings $taskSettings `
    -Description 'Sincroniza compras SICAR hacia Firebase: credito a CxP+compras, efectivo a gastos+compras, otros a compras.' `
    -Force | Out-Null

Write-Host "Tarea '$TaskName' creada correctamente para correr diario a las $StartTime."
Get-ScheduledTask -TaskName $TaskName | Format-List TaskName,State
