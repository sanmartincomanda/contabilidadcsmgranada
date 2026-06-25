param(
    [string]$Month = "",
    [string]$StartDate = "",
    [string]$EndDate = "",
    [switch]$Preview
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$functionsDir = Resolve-Path (Join-Path $scriptDir "..")
Set-Location $functionsDir

$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodePath) {
    throw "No se encontro Node.js para correr el sincronizador de folios SICAR."
}

$argsList = @(".\scripts\syncSicarStampedInvoiceFolios.js")

if ($Month) {
    $argsList += "--month=$Month"
}
if ($StartDate) {
    $argsList += "--startDate=$StartDate"
}
if ($EndDate) {
    $argsList += "--endDate=$EndDate"
}
if ($Preview) {
    $argsList += "--preview"
} else {
    $argsList += "--apply"
}

& $nodePath $argsList
