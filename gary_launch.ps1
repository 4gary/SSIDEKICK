# Runs Gary in this window (opened by dumstream_start.ps1 in its own console, so closing other terminal tabs can't kill him).
$host.UI.RawUI.WindowTitle = 'Sidekick'
$env:PYTHONUNBUFFERED = '1'
$env:HF_HUB_OFFLINE = '1'
Set-Location $PSScriptRoot
.\.venv\Scripts\python.exe sidekick.py 2>&1 | ForEach-Object { "$_" } | Tee-Object -FilePath sidekick.log
