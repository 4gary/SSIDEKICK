# DUMSTREAM START: makes sure Streamer.bot, LM Studio's server, Gary and OBS are all running (skips what already is).
# Started from the "DUMSTREAM START" shortcut on the desktop.
$host.UI.RawUI.WindowTitle = "DUMSTREAM START"
$Gary = $PSScriptRoot
$StreamerBot = "$env:USERPROFILE\Streamer.bot\Streamer.bot.exe"
$ObsDir = "C:\Program Files\obs-studio\bin\64bit"
$Lms = "$env:USERPROFILE\.lmstudio\bin\lms.exe"
$LmApp = "$env:LOCALAPPDATA\Programs\LM Studio\LM Studio.exe"
$status = [ordered]@{}

function Listening($port) { [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) }
function WaitFor($port, $seconds) {
    for ($i = 0; $i -lt $seconds; $i++) { if (Listening $port) { return $true }; Start-Sleep 1 }
    return $false
}

Write-Host "`n  DUMSTREAM START`n" -ForegroundColor Magenta

# 1. Streamer.bot
if (Get-Process "Streamer.bot" -ErrorAction SilentlyContinue) { $status["Streamer.bot"] = "already running" }
else {
    Write-Host "  Starting Streamer.bot..."
    Start-Process $StreamerBot -WorkingDirectory (Split-Path $StreamerBot)
    $status["Streamer.bot"] = "started"
}

# 2. LM Studio server (Gary's brain; Gary asks for his model himself)
if (Listening 1234) { $status["LM Studio"] = "already running" }
else {
    Write-Host "  Starting LM Studio's server..."
    if (Test-Path $Lms) { & $Lms server start | Out-Null }
    elseif (Test-Path $LmApp) { Start-Process $LmApp }
    $status["LM Studio"] = if (WaitFor 1234 30) { "started" } else { "FAILED: open LM Studio, Developer tab, Start Server" }
}

# 3. Gary, in his own console window
if (Listening 7777) { $status["Gary"] = "already running" }
else {
    Write-Host "  Starting Gary..."
    Start-Process conhost.exe -ArgumentList "powershell.exe -NoExit -ExecutionPolicy Bypass -File `"$Gary\gary_launch.ps1`"" -WorkingDirectory $Gary
    $status["Gary"] = if (WaitFor 7777 20) { "started (keep the 'Sidekick' window open)" } else { "FAILED: check the 'Sidekick' window" }
}

# 4. OBS last, so Gary is already there when his browser source loads (OBS must start from its own folder)
if (Get-Process "obs64" -ErrorAction SilentlyContinue) { $status["OBS"] = "already running" }
else {
    Write-Host "  Starting OBS..."
    Start-Process "$ObsDir\obs64.exe" -WorkingDirectory $ObsDir
    $status["OBS"] = "started"
}

Write-Host ""
foreach ($k in $status.Keys) {
    $ok = $status[$k] -notlike "FAILED*"
    Write-Host ("  [{0}] {1,-13} {2}" -f ($(if ($ok) { "OK" } else { "!!" }), $k, $status[$k])) -ForegroundColor $(if ($ok) { "Green" } else { "Red" })
}
Write-Host "`n  Gary's control page: http://localhost:7777/control"
Write-Host "  This window closes in 8 seconds."
Start-Sleep 8
