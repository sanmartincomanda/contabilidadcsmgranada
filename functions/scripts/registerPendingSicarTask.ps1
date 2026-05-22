param(
    [string]$TaskName = 'SICAR Pending Purchases Replay',
    [int]$Limit = 50
)

$scriptPath = Join-Path $PSScriptRoot 'runPendingSicarPurchases.ps1'

if (-not (Test-Path -LiteralPath $scriptPath)) {
    throw "No se encontro el script principal en $scriptPath"
}

$startBoundary = (Get-Date).AddMinutes(1).ToString('s')
$tempXmlPath = Join-Path $env:TEMP 'SICARPendingPurchasesReplay.xml'

$taskXml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Procesa compras SICAR pendientes desde Firestore privado cada minuto.</Description>
  </RegistrationInfo>
  <Triggers>
    <TimeTrigger>
      <Repetition>
        <Interval>PT1M</Interval>
        <Duration>P3650D</Duration>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <StartBoundary>$startBoundary</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>true</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>true</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT30M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>powershell.exe</Command>
      <Arguments>-NoProfile -ExecutionPolicy Bypass -File "$scriptPath" -Limit $Limit</Arguments>
    </Exec>
  </Actions>
</Task>
"@

Set-Content -Path $tempXmlPath -Value $taskXml -Encoding Unicode

try {
    schtasks /Create /TN $TaskName /XML $tempXmlPath /F | Out-Null
    Write-Host "Tarea '$TaskName' creada correctamente."
    schtasks /Query /TN $TaskName /V /FO LIST
}
finally {
    Remove-Item -LiteralPath $tempXmlPath -ErrorAction SilentlyContinue
}
