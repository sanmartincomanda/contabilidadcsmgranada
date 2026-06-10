param(
    [string]$WatchFolder = 'C:\CSM\soportes-escaneados',
    [string]$ArchiveFolder = '',
    [string]$ErrorFolder = '',
    [int]$IntervalMs = 5000,
    [switch]$Once,
    [switch]$DryRun
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
    throw "No se encontro la llave de servicio en $serviceKeyPath. Configura GOOGLE_APPLICATION_CREDENTIALS o coloca la llave en C:\SICAR\keys\firebase-adminsdk.json"
}

$env:GOOGLE_APPLICATION_CREDENTIALS = $serviceKeyPath
New-Item -ItemType Directory -Force -Path $WatchFolder | Out-Null
if ($ArchiveFolder) { New-Item -ItemType Directory -Force -Path $ArchiveFolder | Out-Null }
if ($ErrorFolder) { New-Item -ItemType Directory -Force -Path $ErrorFolder | Out-Null }

$bundledNodePath = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$nodePath = if ($env:NODE_EXE_PATH) {
    $env:NODE_EXE_PATH
} elseif (Test-Path -LiteralPath $bundledNodePath) {
    $bundledNodePath
} else {
    (Get-Command node -ErrorAction Stop).Source
}

if (-not (Test-Path -LiteralPath $nodePath)) {
    throw "No se encontro Node.js en $nodePath. Configura NODE_EXE_PATH o instala Node.js."
}

$argsList = @(
    '.\scripts\watchScannedSupports.js',
    "--watchDir=$WatchFolder",
    "--intervalMs=$IntervalMs"
)

if ($ArchiveFolder) { $argsList += "--archiveDir=$ArchiveFolder" }
if ($ErrorFolder) { $argsList += "--errorDir=$ErrorFolder" }
if ($Once) { $argsList += '--once' }
if ($DryRun) { $argsList += '--dry-run' }

Push-Location $functionsRoot
try {
    & $nodePath @argsList
}
finally {
    Pop-Location
}
