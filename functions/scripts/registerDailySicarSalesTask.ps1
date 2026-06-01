param(
    [string]$TaskName = 'SICAR Daily Sales Sync',
    [string]$StartTime = '20:00'
)

$scriptPath = Join-Path $PSScriptRoot 'runDailySicarSales.ps1'
$hiddenRunnerPath = Join-Path $PSScriptRoot 'runSicarPowerShellHidden.vbs'

if (-not (Test-Path -LiteralPath $scriptPath)) {
    throw "No se encontro el script principal en $scriptPath"
}

if (-not (Test-Path -LiteralPath $hiddenRunnerPath)) {
    throw "No se encontro el lanzador oculto en $hiddenRunnerPath"
}

$taskAction = New-ScheduledTaskAction `
    -Execute 'wscript.exe' `
    -Argument "`"$hiddenRunnerPath`" `"runDailySicarSales.ps1`""

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
    -Description 'Sincroniza ventas diarias SICAR con subtotal, IVA y total hacia Firebase.' `
    -Force | Out-Null

Write-Host "Tarea '$TaskName' creada correctamente para correr diario a las $StartTime."
Get-ScheduledTask -TaskName $TaskName | Format-List TaskName,State
