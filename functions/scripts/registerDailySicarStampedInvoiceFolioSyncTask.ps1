param(
    [string]$TaskName = "CSM Granada - Sincronizar Folios Facturas Membretadas",
    [string]$Time = "19:00"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$runner = Join-Path $scriptDir "runSicarStampedInvoiceFolioSync.ps1"
if (-not (Test-Path $runner)) {
    throw "No se encontro $runner"
}

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runner`""

$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Iguala diariamente a las 7 PM los folios de factura SICAR con los numeros de facturas membretadas del sistema contable." `
    -Force | Out-Null

Write-Host "Tarea registrada: $TaskName todos los dias a las $Time"
