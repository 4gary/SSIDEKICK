# Runs Gary in this window (opened by dumstream_start.ps1 in its own console, so closing other terminal tabs can't kill him).
$host.UI.RawUI.WindowTitle = 'Sidekick'
$env:PYTHONUNBUFFERED = '1'
$env:PYTHONUTF8 = '1'                 # UTF-8 for files and the console, so chat names and curly quotes don't break the log
$env:PYTHONIOENCODING = 'utf-8'
$env:HF_HUB_OFFLINE = '1'
Set-Location $PSScriptRoot
# Python writes the console and sidekick.log itself (see main() in sidekick.py), so no pipeline here
.\.venv\Scripts\python.exe sidekick.py
