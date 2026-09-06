[CmdletBinding()]
param(
    [string]$WatcherScriptPath = '',
    [int]$IntervalMs = 10000,
    [int]$StartupBackfillDays = 4,
    [int]$RecentBackfillIntervalMs = 60000,
    [int]$CheckIntervalSeconds = 30
)

$ErrorActionPreference = 'Stop'

if (-not $WatcherScriptPath) {
    $WatcherScriptPath = Join-Path $PSScriptRoot 'runSicarTicketSalesWatcher.ps1'
}
if (-not (Test-Path -LiteralPath $WatcherScriptPath)) {
    throw "No se encontro el watcher en $WatcherScriptPath."
}

$safeCheckInterval = [Math]::Max(10, [Math]::Min($CheckIntervalSeconds, 300))
$safeInterval = [Math]::Max(5000, [Math]::Min($IntervalMs, 300000))
$safeBackfillDays = [Math]::Max(1, [Math]::Min($StartupBackfillDays, 31))
$safeRecentBackfill = [Math]::Max($safeInterval, [Math]::Min($RecentBackfillIntervalMs, 600000))
$logsDir = 'C:\SICAR\logs'
$supervisorLogPath = Join-Path $logsDir 'ticket-sales-supervisor.log'
$watcherOutPath = Join-Path $logsDir 'ticket-sales-watcher.out.log'
$watcherErrorPath = Join-Path $logsDir 'ticket-sales-watcher.err.log'

New-Item -ItemType Directory -Path $logsDir -Force | Out-Null

function Write-SupervisorLog {
    param(
        [string]$Message,
        [string]$Level = 'INFO'
    )

    $line = '[{0}] [{1}] {2}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $Level, $Message
    Add-Content -LiteralPath $supervisorLogPath -Value $line
}

function Get-TicketWatcherProcesses {
    return @(
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                $_.Name -eq 'node.exe' -and
                $_.CommandLine -match 'watchSicarTicketSales\.js'
            }
    )
}

function Start-TicketWatcher {
    $arguments = @(
        '-NoProfile',
        '-WindowStyle', 'Hidden',
        '-ExecutionPolicy', 'Bypass',
        '-File', ('"{0}"' -f $WatcherScriptPath),
        '-IntervalMs', $safeInterval,
        '-StartupBackfillDays', $safeBackfillDays,
        '-RecentBackfillIntervalMs', $safeRecentBackfill
    ) -join ' '

    Start-Process `
        -FilePath 'powershell.exe' `
        -ArgumentList $arguments `
        -WorkingDirectory (Split-Path -Parent $WatcherScriptPath) `
        -WindowStyle Hidden `
        -RedirectStandardOutput $watcherOutPath `
        -RedirectStandardError $watcherErrorPath | Out-Null
}

$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\SicarTicketSalesWatcherSupervisor', [ref]$createdNew)
if (-not $createdNew) {
    return
}

Write-SupervisorLog "Supervisor iniciado. Revision cada $safeCheckInterval segundos."

try {
    while ($true) {
        try {
            $running = @(Get-TicketWatcherProcesses)
            if ($running.Count -eq 0) {
                Write-SupervisorLog 'Watcher ausente; iniciando recuperacion.' 'WARN'
                Start-TicketWatcher
                Start-Sleep -Seconds 3
                $running = @(Get-TicketWatcherProcesses)
                if ($running.Count -eq 0) {
                    Write-SupervisorLog 'El watcher no inicio. Se reintentara automaticamente.' 'ERROR'
                } else {
                    Write-SupervisorLog "Watcher recuperado en PID $($running[0].ProcessId)."
                }
            } elseif ($running.Count -gt 1) {
                Write-SupervisorLog "Se detectaron $($running.Count) watchers. Se conserva el mas antiguo y se cierran duplicados." 'WARN'
                $running |
                    Sort-Object CreationDate |
                    Select-Object -Skip 1 |
                    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
            }
        } catch {
            Write-SupervisorLog $_.Exception.Message 'ERROR'
        }

        Start-Sleep -Seconds $safeCheckInterval
    }
} finally {
    if ($mutex) {
        $mutex.ReleaseMutex() | Out-Null
        $mutex.Dispose()
    }
}
