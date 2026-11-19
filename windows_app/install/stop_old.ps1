# Stops every process of a running PARDIK IPTV installation so Setup.bat can
# replace the folder: the embedded python (by image path AND by command line),
# the Edge --app window (by title) and, as a last resort, whoever listens on
# the backend port. Kept in a .ps1 on purpose - batch quoting of this logic
# already broke the installer once.
$dst = Join-Path $env:LOCALAPPDATA "PARDIK-SMART-IPTV"
Get-Process | Where-Object {
    ($_.Path -and $_.Path.StartsWith($dst)) -or
    ($_.CommandLine -like "*iptv_backend.py*") -or
    ($_.CommandLine -like "*PARDIK-SMART-IPTV*launch.ps1*")
} | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process msedge -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowTitle -like "PARDIK IPTV*" } |
    Stop-Process -Force -ErrorAction SilentlyContinue
try {
    Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
} catch { }
Start-Sleep -Milliseconds 500
