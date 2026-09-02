param(
    [string]$TaskName = 'SICAR Ticket Sales Watcher',
    [int]$IntervalMs = 10000,
    [int]$StartupBackfillDays = 2,
    [int]$RecentBackfillIntervalMs = 60000,
    [string]$NodePath = '',
    [string]$StartNow = 'true'
)

$ErrorActionPreference = 'Stop'

$scriptPath = Join-Path $PSScriptRoot 'runSicarTicketSalesWatcher.ps1'
$hiddenRunnerPath = Join-Path $PSScriptRoot 'runSicarPowerShellHidden.vbs'

if (-not (Test-Path -LiteralPath $scriptPath)) { throw "No se encontro $scriptPath" }
if (-not (Test-Path -LiteralPath $hiddenRunnerPath)) { throw "No se encontro $hiddenRunnerPath" }

$safeInterval = [Math]::Max(5000, [Math]::Min($IntervalMs, 300000))
$safeBackfillDays = [Math]::Max(1, [Math]::Min($StartupBackfillDays, 31))
$safeRecentBackfill = [Math]::Max($safeInterval, [Math]::Min($RecentBackfillIntervalMs, 600000))
$shouldStartNow = ([string]$StartNow).Trim().ToLowerInvariant() -notin @('false', '0', 'no', 'n')
$nodePathArgument = if ($NodePath) { " -NodePath `"$NodePath`"" } else { '' }
$watcherArguments = "`"$hiddenRunnerPath`" `"runSicarTicketSalesWatcher.ps1`" -IntervalMs $safeInterval -StartupBackfillDays $safeBackfillDays -RecentBackfillIntervalMs $safeRecentBackfill$nodePathArgument"

function Install-StartupFallback {
    $startupDir = [Environment]::GetFolderPath('Startup')
    $linkPath = Join-Path $startupDir "$TaskName.lnk"
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($linkPath)
    $shortcut.TargetPath = 'wscript.exe'
    $shortcut.Arguments = $watcherArguments
    $shortcut.WorkingDirectory = [string]$PSScriptRoot
    $shortcut.WindowStyle = 7
    $shortcut.Description = 'Sincroniza ventas y articulos SICAR en segundo plano.'
    $shortcut.Save()

    Write-Host "Task Scheduler no permitio registrar la tarea. Inicio automatico alternativo creado en: $linkPath"
    if ($shouldStartNow) {
        $runningWatcher = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
            $_.CommandLine -match 'watchSicarTicketSales\.js'
        } | Select-Object -First 1
        if ($runningWatcher) {
            Write-Host "El watcher ya esta ejecutandose en el proceso $($runningWatcher.ProcessId); no se inicio un duplicado."
        } else {
            Start-Process -FilePath 'wscript.exe' -WindowStyle Hidden -ArgumentList $watcherArguments
            Start-Sleep -Seconds 3
            Write-Host 'Watcher de ventas por ticket iniciado en segundo plano.'
        }
    }
}

$legacyTask = Get-ScheduledTask -TaskName 'SICAR Daily Sales Sync' -ErrorAction SilentlyContinue
if ($legacyTask) {
    Disable-ScheduledTask -TaskName 'SICAR Daily Sales Sync' -ErrorAction Stop | Out-Null
    Write-Host "Tarea antigua 'SICAR Daily Sales Sync' desactivada para evitar duplicados."
}

$taskAction = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument $watcherArguments
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
        -Description "Sincroniza cada venta SICAR con sus articulos cada $safeInterval ms y escribe Firebase solo cuando detecta cambios." `
        -Force `
        -ErrorAction Stop | Out-Null

    if ($shouldStartNow) {
        Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop
        Start-Sleep -Seconds 3
    }

    Write-Host "Tarea '$TaskName' instalada. Intervalo: $safeInterval ms. Backfill: $safeBackfillDays dia/s."
    Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop | Format-List TaskName,State
} catch {
    if ($_.Exception.Message -match 'Acceso denegado|Access is denied|0x80070005') {
        Install-StartupFallback
    } else {
        throw
    }
}
