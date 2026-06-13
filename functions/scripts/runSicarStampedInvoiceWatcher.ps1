param(
    [int]$IntervalMs = 1000,
    [string]$StatePath = 'C:\SICAR\state\sicar-stamped-invoice-watch.json',
    [string]$ServiceKeyPath = $env:GOOGLE_APPLICATION_CREDENTIALS
)

$ErrorActionPreference = 'Stop'

$functionsDir = Resolve-Path (Join-Path $PSScriptRoot '..')
$nodePath = Join-Path $functionsDir 'node_modules\.bin\node.cmd'
$defaultKeyPath = 'C:\SICAR\keys\firebase-adminsdk.json'

if (-not (Test-Path -LiteralPath $nodePath)) {
    $nodePath = 'node'
}

if (-not $ServiceKeyPath) {
    $ServiceKeyPath = $defaultKeyPath
}

if (-not (Test-Path -LiteralPath $ServiceKeyPath)) {
    throw "No se encontro la llave de servicio en $ServiceKeyPath. Configura GOOGLE_APPLICATION_CREDENTIALS o coloca la llave en C:\SICAR\keys\firebase-adminsdk.json"
}

$env:GOOGLE_APPLICATION_CREDENTIALS = $ServiceKeyPath

Push-Location $functionsDir
try {
    & $nodePath '.\scripts\watchSicarStampedInvoices.js' "--intervalMs=$IntervalMs" "--statePath=$StatePath"
} finally {
    Pop-Location
}
