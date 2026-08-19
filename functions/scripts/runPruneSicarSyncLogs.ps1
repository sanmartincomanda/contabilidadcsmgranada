param(
    [int]$RetentionDays = 30,
    [int]$Limit = 500,
    [switch]$Preview
)

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

$functionsRoot = Split-Path -Parent $PSScriptRoot
$projectRoot = Split-Path -Parent $functionsRoot
Import-EnvFile (Join-Path $projectRoot '.env.local')
Import-EnvFile (Join-Path $functionsRoot '.env.local')

$defaultKeyPath = 'C:\SICAR\keys\firebase-adminsdk.json'
$serviceKeyPath = if ($env:GOOGLE_APPLICATION_CREDENTIALS) { $env:GOOGLE_APPLICATION_CREDENTIALS } else { $defaultKeyPath }

if (-not (Test-Path -LiteralPath $serviceKeyPath)) {
    throw "No se encontro la llave de servicio en $serviceKeyPath."
}

$env:GOOGLE_APPLICATION_CREDENTIALS = $serviceKeyPath
$nodePath = if ($env:NODE_EXE_PATH) { $env:NODE_EXE_PATH } else { (Get-Command node -ErrorAction Stop).Source }

$argsList = @(
    '.\scripts\pruneSicarSyncLogs.js',
    "--retentionDays=$RetentionDays",
    "--limit=$Limit"
)
if ($Preview) { $argsList += '--preview' }

Push-Location $functionsRoot
try {
    & $nodePath @argsList
}
finally {
    Pop-Location
}
