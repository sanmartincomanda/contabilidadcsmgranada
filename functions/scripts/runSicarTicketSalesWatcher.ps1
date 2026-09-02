param(
    [int]$IntervalMs = 10000,
    [string]$StatePath = 'C:\SICAR\state\sicar-ticket-sales-watch.json',
    [int]$StartupBackfillDays = 2,
    [int]$RecentBackfillIntervalMs = 60000,
    [string]$NodePath = '',
    [string]$ServiceKeyPath = $env:GOOGLE_APPLICATION_CREDENTIALS
)

$ErrorActionPreference = 'Stop'

$functionsDir = Resolve-Path (Join-Path $PSScriptRoot '..')
$defaultKeyPath = 'C:\SICAR\keys\firebase-adminsdk.json'

function Import-EnvFile {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) { return }

    Get-Content -LiteralPath $Path | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith('#')) { return }
        $separator = $line.IndexOf('=')
        if ($separator -lt 1) { return }

        $key = $line.Substring(0, $separator).Trim()
        $value = $line.Substring($separator + 1).Trim().Trim('"').Trim("'")
        if ($key -and -not [Environment]::GetEnvironmentVariable($key, 'Process')) {
            [Environment]::SetEnvironmentVariable($key, $value, 'Process')
        }
    }
}

function Resolve-NodePath {
    if ($NodePath -and (Test-Path -LiteralPath $NodePath)) { return $NodePath }

    $candidates = @(
        (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe'),
        (Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'),
        "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
    )

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
    }

    $command = Get-Command node -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    throw 'No se encontro Node.js para correr el watcher de ventas SICAR.'
}

$projectRoot = Split-Path -Parent $functionsDir
Import-EnvFile (Join-Path $projectRoot '.env.local')
Import-EnvFile (Join-Path $functionsDir '.env.local')

if (-not $ServiceKeyPath) { $ServiceKeyPath = $defaultKeyPath }
if (-not (Test-Path -LiteralPath $ServiceKeyPath)) {
    throw "No se encontro la llave de Firebase en $ServiceKeyPath."
}

$env:GOOGLE_APPLICATION_CREDENTIALS = $ServiceKeyPath
$resolvedNodePath = Resolve-NodePath

Push-Location $functionsDir
try {
    & $resolvedNodePath '.\scripts\watchSicarTicketSales.js' `
        "--intervalMs=$IntervalMs" `
        "--statePath=$StatePath" `
        "--startupBackfillDays=$StartupBackfillDays" `
        "--recentBackfillIntervalMs=$RecentBackfillIntervalMs"
} finally {
    Pop-Location
}
