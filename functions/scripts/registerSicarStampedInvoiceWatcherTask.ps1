param(
    [string]$TaskName = 'SICAR Stamped Invoice Watcher',
    [int]$IntervalMs = 15000,
    [int]$StartupBackfillDays = 3,
    [string]$NodePath = '',
    [string]$StartNow = 'true'
)

$ErrorActionPreference = 'Stop'

$scriptPath = Join-Path $PSScriptRoot 'runSicarStampedInvoiceWatcher.ps1'
$hiddenRunnerPath = Join-Path $PSScriptRoot 'runSicarPowerShellHidden.vbs'

if (-not (Test-Path -LiteralPath $scriptPath)) {
    throw "No se encontro el script principal en $scriptPath"
}

if (-not (Test-Path -LiteralPath $hiddenRunnerPath)) {
    throw "No se encontro el lanzador oculto en $hiddenRunnerPath"
}

$safeInterval = [Math]::Max(15000, [Math]::Min($IntervalMs, 60000))
$safeBackfillDays = [Math]::Max(1, [Math]::Min($StartupBackfillDays, 31))
$shouldStartNow = ([string]$StartNow).Trim().ToLowerInvariant() -notin @('false', '0', 'no', 'n')
$nodePathArgument = if ($NodePath) { " -NodePath `"$NodePath`"" } else { "" }
$watcherArguments = "`"$hiddenRunnerPath`" `"runSicarStampedInvoiceWatcher.ps1`" -IntervalMs $safeInterval -StartupBackfillDays $safeBackfillDays$nodePathArgument"

function Install-StartupFallback {
    $startupDir = [Environment]::GetFolderPath('Startup')
    $linkPath = Join-Path $startupDir "$TaskName.lnk"
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($linkPath)
    $shortcut.TargetPath = 'wscript.exe'
    $shortcut.Arguments = $watcherArguments
    $shortcut.WorkingDirectory = [string]$PSScriptRoot
    $shortcut.WindowStyle = 7
    $shortcut.Description = "Escucha facturas SICAR y se reconecta automaticamente ante fallos de red."
    $shortcut.Save()

    Write-Host "No se pudo usar Task Scheduler. Se instalo el inicio automatico en: $linkPath"
    if ($shouldStartNow) {
        Start-Process -FilePath 'wscript.exe' -WindowStyle Hidden -ArgumentList $watcherArguments
        Start-Sleep -Seconds 2
        Write-Host 'Watcher de facturas iniciado en segundo plano.'
    }
}

$taskAction = New-ScheduledTaskAction `
    -Execute 'wscript.exe' `
    -Argument $watcherArguments

$taskTrigger = @(
    (New-ScheduledTaskTrigger -AtLogOn),
    (New-ScheduledTaskTrigger `
        -Once `
        -At (Get-Date).AddMinutes(1) `
        -RepetitionInterval (New-TimeSpan -Minutes 5) `
        -RepetitionDuration (New-TimeSpan -Days 3650))
)

$taskSettings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -StartWhenAvailable `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Days 3650)

try {
    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $taskAction `
        -Trigger $taskTrigger `
        -Settings $taskSettings `
        -Description "Escucha facturas membretadas SICAR en MySQL cada $safeInterval ms, recupera $safeBackfillDays dia/s recientes al iniciar y sube a Firebase solo cuando hay fac_id nuevo." `
        -Force | Out-Null

    Write-Host "Tarea '$TaskName' creada correctamente. Intervalo interno: $safeInterval ms. Backfill al iniciar: $safeBackfillDays dia/s."
    Write-Host "Inicia al iniciar sesion y se verifica cada 5 minutos si dejo de ejecutarse."
    if ($shouldStartNow) {
        Start-ScheduledTask -TaskName $TaskName
        Start-Sleep -Seconds 2
    }
    Get-ScheduledTask -TaskName $TaskName | Format-List TaskName,State
} catch {
    if ($_.Exception.Message -match 'Acceso denegado|Access is denied|0x80070005') {
        Install-StartupFallback
    } else {
        throw
    }
}
