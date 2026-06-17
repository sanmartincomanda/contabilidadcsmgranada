param(
    [string]$TaskName = 'SICAR Daily Purchases Sync',
    [string]$StartTime = '20:10',
    [int]$LookbackDays = 31
)

$scriptPath = Join-Path $PSScriptRoot 'runDailySicarPurchases.ps1'
$hiddenRunnerPath = Join-Path $PSScriptRoot 'runSicarPowerShellHidden.vbs'

if (-not (Test-Path -LiteralPath $scriptPath)) {
    throw "No se encontro el script principal en $scriptPath"
}

if (-not (Test-Path -LiteralPath $hiddenRunnerPath)) {
    throw "No se encontro el lanzador oculto en $hiddenRunnerPath"
}

$taskAction = New-ScheduledTaskAction `
    -Execute 'wscript.exe' `
    -Argument "`"$hiddenRunnerPath`" `"runDailySicarPurchases.ps1`" -LookbackDays $LookbackDays"

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
    -Description "Sincroniza compras SICAR hacia Firebase y audita los ultimos $LookbackDays dias: credito a CxP+compras, efectivo a gastos+compras, otros a compras." `
    -Force | Out-Null

Write-Host "Tarea '$TaskName' creada correctamente para correr diario a las $StartTime con auditoria de $LookbackDays dia(s)."
Get-ScheduledTask -TaskName $TaskName | Format-List TaskName,State
