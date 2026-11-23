@echo off
setlocal
rem PARDIK IPTV - stop the hidden backend and free port 8787.
rem Same identity discipline as the launcher: only a python whose command
rem line carries iptv_backend.py may be killed - never a stranger on 8787.
echo PARDIK IPTV - stopping the backend ...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { $p = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $_); if ($p -and $p.CommandLine -like '*iptv_backend*') { Stop-Process -Id $_ -Force; Write-Host ('stopped PID ' + $_) } else { Write-Host ('PID ' + $_ + ' is NOT our backend - left running') } }"
netstat -ano | findstr ":8787" | findstr "LISTENING" >nul 2>&1 && (echo port 8787 is STILL busy) || (echo port 8787 is free now)
pause
