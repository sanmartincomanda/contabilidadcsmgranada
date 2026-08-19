[CmdletBinding()]
param(
    [switch]$Once,
    [switch]$Preview,
    [switch]$SkipStartupBackfill,
    [int]$IntervalMs = 30000,
    [string]$ServiceKeyPath = $env:GOOGLE_APPLICATION_CREDENTIALS
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$defaultKeyPath = 'C:\SICAR\keys\firebase-adminsdk.json'
if ([string]::IsNullOrWhiteSpace($ServiceKeyPath)) {
    $ServiceKeyPath = $defaultKeyPath
}

if (-not (Test-Path -LiteralPath $ServiceKeyPath)) {
    throw "No se encontro la llave de servicio en $ServiceKeyPath. Configura GOOGLE_APPLICATION_CREDENTIALS o coloca la llave en C:\SICAR\keys\firebase-adminsdk.json"
}

$env:GOOGLE_APPLICATION_CREDENTIALS = $ServiceKeyPath

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$functionsDir = Split-Path -Parent $scriptDir
$watcherPath = Join-Path $scriptDir 'watchSicarBranchTransfers.js'

if (-not (Test-Path -LiteralPath $watcherPath)) {
    throw "No existe el watcher: $watcherPath"
}

$nodePath = (Get-Command node -ErrorAction Stop).Source
$arguments = @($watcherPath, "--intervalMs=$IntervalMs")

if ($Once) {
    $arguments += '--once'
}

if ($Preview) {
    $arguments += '--preview'
}

if ($SkipStartupBackfill) {
    $arguments += '--skipStartupBackfill'
}

Push-Location $functionsDir
try {
    & $nodePath @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "El watcher de traspasos SICAR termino con codigo $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}
