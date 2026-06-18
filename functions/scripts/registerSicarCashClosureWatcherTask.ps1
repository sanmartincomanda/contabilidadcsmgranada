param(
    [string]$TaskName = 'SICAR Cash Closure Watcher',
    [int]$IntervalMs = 15000,
    [int]$StartupBackfillDays = 3,
    [int]$PollBackfillDays = 2,
    [string]$NodePath = '',
    [string]$StartNow = 'true'
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
$safePollBackfillDays = [Math]::Max(1, [Math]::Min($PollBackfillDays, 31))
$shouldStartNow = ([string]$StartNow).Trim().ToLowerInvariant() -notin @('false', '0', 'no', 'n')
$nodePathArgument = if ($NodePath) { " -NodePath `"$NodePath`"" } else { "" }
$watcherArguments = "`"$hiddenRunnerPath`" `"runSicarCashClosureWatcher.ps1`" -IntervalMs $safeInterval -StartupBackfillDays $safeBackfillDays -PollBackfillDays $safePollBackfillDays$nodePathArgument"

function Install-StartupFallback {
    $startupDir = [Environment]::GetFolderPath('Startup')
    $linkPath = Join-Path $startupDir "$TaskName.lnk"
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($linkPath)
    $shortcut.TargetPath = 'wscript.exe'
    $shortcut.Arguments = $watcherArguments
    $shortcut.WorkingDirectory = [string]$PSScriptRoot
    $shortcut.WindowStyle = 7
    $shortcut.Description = "Escucha cierres de caja SICAR cada $safeInterval ms y escribe en Firebase solo si hay cambios."
    $shortcut.Save()

    Write-Host "No se pudo usar Task Scheduler. Se instalo fallback en Inicio: $linkPath"
    if ($shouldStartNow) {
        Start-Process -FilePath 'wscript.exe' -WindowStyle Hidden -ArgumentList $watcherArguments
        Start-Sleep -Seconds 2
        Write-Host "Watcher iniciado en segundo plano con fallback Startup."
    }
}

$taskAction = New-ScheduledTaskAction `
    -Execute 'wscript.exe' `
    -Argument $watcherArguments

$taskTrigger = New-ScheduledTaskTrigger -AtLogOn

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
        -Description "Escucha cierres de caja SICAR en MySQL cada $safeInterval ms, recupera $safeBackfillDays dia/s al iniciar, revalida $safePollBackfillDays dia/s en cada ciclo y escribe en Firebase solo si hay cierres nuevos o cambios." `
        -Force | Out-Null

    Write-Host "Tarea '$TaskName' creada correctamente. Intervalo interno: $safeInterval ms. Backfill al iniciar: $safeBackfillDays dia/s. Backfill vivo: $safePollBackfillDays dia/s."
    Write-Host "Inicia automaticamente al iniciar sesion. Para iniciar ahora: Start-ScheduledTask -TaskName '$TaskName'"
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
