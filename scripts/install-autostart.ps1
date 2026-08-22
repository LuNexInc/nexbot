# Register a hidden Scheduled Task so NexBot comes back after logon,
# reboot, or a crash. No visible console. MultipleInstances = IgnoreNew.
param(
  [ValidateSet("on", "off", "status")]
  [string]$Mode = "on",
  [string]$Exe = ""
)

$ErrorActionPreference = "Stop"
$TaskName = "NexBot keepalive"

if (-not $Exe) {
  $Exe = Join-Path $env:LOCALAPPDATA "Programs\NexBot\NexBot.exe"
}

function Get-Status {
  $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $t) { return @{ installed = $false } }
  return @{
    installed = $true
    state     = [string]$t.State
    exe       = $t.Actions.Execute
  }
}

if ($Mode -eq "status") {
  Get-Status | ConvertTo-Json -Compress
  exit 0
}

if ($Mode -eq "off") {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  @{ installed = $false } | ConvertTo-Json -Compress
  exit 0
}

if (-not (Test-Path -LiteralPath $Exe)) {
  Write-Error "NexBot.exe not found: $Exe"
  exit 1
}

$action = New-ScheduledTaskAction -Execute $Exe -Argument "--hidden"
$logon = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 9999)
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit 0 `
  -MultipleInstances IgnoreNew
$settings.Hidden = $true
$settings.DisallowStartIfOnBatteries = $false

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($logon, $repeat) -Settings $settings -Description "Keep NexBot harness alive after reboot or crash (tray, --hidden)." | Out-Null

Get-Status | ConvertTo-Json -Compress
