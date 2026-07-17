param(
    [int]$IntervalMs = 10000,
    [string]$StatePath = 'C:\SICAR\state\sicar-stamped-invoice-watch.json',
    [int]$StartupBackfillDays = 3,
    [string]$NodePath = '',
    [string]$ServiceKeyPath = $env:GOOGLE_APPLICATION_CREDENTIALS
)

$ErrorActionPreference = 'Stop'

$functionsDir = Resolve-Path (Join-Path $PSScriptRoot '..')
$defaultKeyPath = 'C:\SICAR\keys\firebase-adminsdk.json'

function Resolve-NodePath {
    if ($NodePath -and (Test-Path -LiteralPath $NodePath)) {
        return $NodePath
    }

    $candidates = @(
        (Join-Path $functionsDir 'node_modules\.bin\node.cmd'),
        (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe'),
        "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
    )

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            return $candidate
        }
    }

    $command = Get-Command node -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    throw "No se encontro Node.js para correr el watcher SICAR. Instala Node.js o agrega node.exe al PATH."
}

$nodePath = Resolve-NodePath

if (-not $ServiceKeyPath) {
    $ServiceKeyPath = $defaultKeyPath
}

if (-not (Test-Path -LiteralPath $ServiceKeyPath)) {
    throw "No se encontro la llave de servicio en $ServiceKeyPath. Configura GOOGLE_APPLICATION_CREDENTIALS o coloca la llave en C:\SICAR\keys\firebase-adminsdk.json"
}

$env:GOOGLE_APPLICATION_CREDENTIALS = $ServiceKeyPath

Push-Location $functionsDir
try {
    & $nodePath '.\scripts\watchSicarStampedInvoices.js' "--intervalMs=$IntervalMs" "--statePath=$StatePath" "--startupBackfillDays=$StartupBackfillDays"
} finally {
    Pop-Location
}
