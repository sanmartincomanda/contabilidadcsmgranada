param(
    [int]$Limit = 50
)

$defaultKeyPath = 'C:\SICAR\keys\firebase-adminsdk.json'
$serviceKeyPath = if ($env:GOOGLE_APPLICATION_CREDENTIALS) { $env:GOOGLE_APPLICATION_CREDENTIALS } else { $defaultKeyPath }

if (-not (Test-Path -LiteralPath $serviceKeyPath)) {
    throw "No se encontro la llave de servicio en $serviceKeyPath. Configura GOOGLE_APPLICATION_CREDENTIALS o coloca la llave en C:\\SICAR\\keys\\firebase-adminsdk.json"
}

$env:GOOGLE_APPLICATION_CREDENTIALS = $serviceKeyPath
$nodePath = (Get-Command node -ErrorAction Stop).Source
$functionsRoot = Split-Path -Parent $PSScriptRoot

Push-Location $functionsRoot
try {
    & $nodePath '.\scripts\processPendingSicarPurchases.js' "--limit=$Limit"
}
finally {
    Pop-Location
}
