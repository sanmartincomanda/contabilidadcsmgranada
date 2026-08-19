[CmdletBinding()]
param(
    [string]$TaskName = "SICAR Branch Transfers",
    [string]$RunScriptPath = "C:\Users\Microsoft Windows 11\Downloads\contabilidad-nueva-sucursal-base-2026-05-22\contabilidad-nueva-sucursal-base-2026-05-22\functions\scripts\runSicarBranchTransferWatcher.ps1",
    [string]$ServiceKeyPath = "C:\SICAR\keys\firebase-adminsdk.json",
    [int]$IntervalMs = 30000
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$script:SchTasksPath = Join-Path $env:WINDIR "System32\schtasks.exe"

function Format-DateValue {
    param([AllowNull()]$Value)

    if ($null -eq $Value) {
        return $null
    }

    try {
        return ([datetime]$Value).ToString("o")
    }
    catch {
        return [string]$Value
    }
}

function Test-ScheduledTaskCmdletsAvailable {
    try {
        $required = @(
            "Get-ScheduledTask",
            "Get-ScheduledTaskInfo",
            "New-ScheduledTaskAction",
            "New-ScheduledTaskTrigger",
            "New-ScheduledTaskSettingsSet",
            "New-ScheduledTaskPrincipal",
            "New-ScheduledTask"
        )

        foreach ($commandName in $required) {
            if (-not (Get-Command $commandName -ErrorAction Stop)) {
                return $false
            }
        }

        Get-ScheduledTask -TaskName "__codex_probe__" -ErrorAction SilentlyContinue | Out-Null
        return $true
    }
    catch {
        return $false
    }
}

function Invoke-Schtasks {
    param([string[]]$Arguments)

    $output = & $script:SchTasksPath @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw ("schtasks.exe fallo ({0}): {1}" -f ($Arguments -join " "), (($output | Out-String).Trim()))
    }

    return @($output)
}

if (-not (Test-Path -LiteralPath $RunScriptPath)) {
    throw "No existe el lanzador del watcher: $RunScriptPath"
}

$powerShellPath = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
$taskDescription = "Watcher local para traspasos SICAR entre Granada y Nindiri con costo real y autoentrada."
$taskArgument = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$RunScriptPath`" -ServiceKeyPath `"$ServiceKeyPath`" -IntervalMs $IntervalMs"

if (Test-ScheduledTaskCmdletsAvailable) {
    $action = New-ScheduledTaskAction -Execute $powerShellPath -Argument $taskArgument
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -RestartCount 999 `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -MultipleInstances IgnoreNew
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    $task = New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description $taskDescription

    Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
    Start-ScheduledTask -TaskName $TaskName

    $info = Get-ScheduledTaskInfo -TaskName $TaskName
    [ordered]@{
        taskName = $TaskName
        taskState = [string](Get-ScheduledTask -TaskName $TaskName).State
        registrationMode = "scheduledtasks"
        lastRunTime = Format-DateValue -Value $info.LastRunTime
        lastTaskResult = $info.LastTaskResult
        nextRunTime = Format-DateValue -Value $info.NextRunTime
    } | ConvertTo-Json -Depth 5
    return
}

$taskCommand = ('"{0}" {1}' -f $powerShellPath, $taskArgument)
Invoke-Schtasks -Arguments @(
    "/Create",
    "/TN", $TaskName,
    "/SC", "ONSTART",
    "/RU", "SYSTEM",
    "/RL", "HIGHEST",
    "/TR", $taskCommand,
    "/F"
) | Out-Null

try {
    Invoke-Schtasks -Arguments @("/Run", "/TN", $TaskName) | Out-Null
}
catch {
}

[ordered]@{
    taskName = $TaskName
    taskState = "Registered"
    registrationMode = "schtasks"
    lastRunTime = $null
    lastTaskResult = $null
    nextRunTime = $null
} | ConvertTo-Json -Depth 5
