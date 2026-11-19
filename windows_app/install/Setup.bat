@echo off
rem ============================================================
rem  PARDIK IPTV - one-click installer (Windows 10 x64)
rem  Residential flavour: Ronika Palace, Kahak (mode.txt decides the UI)
rem  Copies the app, creates shortcuts, registers uninstaller,
rem  then launches it.  Run as the normal user (no admin needed).
rem ============================================================
setlocal
set "SRC=%~dp0.."
set "DST=%LOCALAPPDATA%\PARDIK-SMART-IPTV"
echo Installing to %DST% ...
rem a RUNNING install locks its own files: rmdir would silently leave
rem the old code behind and the next launch keeps the old build - the
rem exact symptom of "nothing changed". Stop everything first, retry,
rem and VERIFY afterwards so a half-install can never pass unnoticed.
set "KILLPS=powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process | Where-Object { $_.Path -like ($env:LOCALAPPDATA + '\PARDIK-SMART-IPTV\*') -or $_.CommandLine -like '*iptv_backend.py*' } | Stop-Process -Force -ErrorAction SilentlyContinue; Get-Process msedge -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like 'PARDIK IPTV*' } | Stop-Process -Force -ErrorAction SilentlyContinue""
set TRY=0
:KILLLOOP
set /a TRY+=1
taskkill /f /fi "WINDOWTITLE eq PARDIK IPTV*" >nul 2>&1
%KILLPS% >nul 2>&1
timeout /t 2 /nobreak >nul
if exist "%DST%" rmdir /s /q "%DST%"
if exist "%DST%" if %TRY% LSS 3 goto KILLLOOP
if exist "%DST%" (
  echo.
  echo ==== INSTALL ABORTED ==================================================
  echo The old installation is still locked by a running process.
  echo Close every PARDIK IPTV window \(and Task Manager ^> python.exe /
  echo msedge.exe with that window title^), or simply RESTART WINDOWS,
  echo then run Setup.bat again. Nothing was changed.
  echo =======================================================================
  pause
  exit /b 1
)
mkdir "%DST%"
xcopy "%SRC%\app"     "%DST%\app\"     /e /i /q /y >nul
rem app_assets holds every icon/background the UI serves from /assets/img/
rem (iptv_backend._app_image looks in <install>\app_assets\img) - without this
rem copy the installed app renders with no artwork at all.
xcopy "%SRC%\app_assets" "%DST%\app_assets\" /e /i /q /y >nul
xcopy "%SRC%\tools"   "%DST%\tools\"   /e /i /q /y >nul
xcopy "%SRC%\install" "%DST%\install\" /e /i /q /y >nul
if exist "%SRC%\runtime" xcopy "%SRC%\runtime" "%DST%\runtime\" /e /i /q /y >nul
copy /y "%SRC%\PARDIK-SMART-IPTV.bat" "%DST%\" >nul
copy /y "%SRC%\PARDIK-SMART-IPTV-silent.vbs" "%DST%\" >nul
rem best effort: multicast needs admin, so a plain-user install just skips it
call "%~dp0allow_multicast.bat" <nul >nul 2>&1
rem verify the copy really landed: a half-install kept the old backend
findstr /c:"BUILD_STAMP" "%DST%\app\iptv_backend.py" >nul 2>&1
if errorlevel 1 (
  echo.
  echo ==== INSTALL ABORTED: old files still locked ==========================
  echo RESTART WINDOWS and run Setup.bat again before launching the app.
  echo =======================================================================
  pause
  exit /b 1
)
type "%DST%\build_info.json"
echo Install OK.
rem deployment flavour (residential | hotel); launch.ps1 exports it as IPTV_MODE
set "MODE=residential"
if exist "%SRC%\mode.txt" set /p MODE=<"%SRC%\mode.txt"
echo %MODE%>"%DST%\mode.txt"
rem shortcut name stays ASCII: cmd.exe parses this file in the OEM codepage,
rem so a Persian .lnk name would come out as mojibake. The app itself is Persian.
set "LNK=PARDIK IPTV - Ronika Palace"
if /i "%MODE%"=="hotel" set "LNK=PARDIK SMART IPTV"

rem --- ensure python + ffmpeg ---
powershell -NoProfile -ExecutionPolicy Bypass -File "%DST%\install\bootstrap_runtime.ps1"

rem --- shortcuts (Desktop + Start Menu) ---
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws=New-Object -ComObject WScript.Shell;" ^
  "$d='%USERPROFILE%\Desktop\%LNK%.lnk';" ^
  "$s=$ws.CreateShortcut($d); $s.TargetPath='%DST%\PARDIK-SMART-IPTV-silent.vbs';" ^
  "$s.IconLocation='%DST%\app\web\favicon.ico,0'; $s.WorkingDirectory='%DST%'; $s.Save();" ^
  "$m='%APPDATA%\Microsoft\Windows\Start Menu\Programs';" ^
  "$s2=$ws.CreateShortcut(\"$m\%LNK%.lnk\"); $s2.TargetPath='%DST%\PARDIK-SMART-IPTV-silent.vbs';" ^
  "$s2.IconLocation='%DST%\app\web\favicon.ico,0'; $s2.WorkingDirectory='%DST%'; $s2.Save();"

rem --- uninstall entry ---
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\PARDIK-SMART-IPTV" /v DisplayName /t REG_SZ /d "%LNK%" /f >nul
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\PARDIK-SMART-IPTV" /v DisplayVersion /t REG_SZ /d "2.7.2.06" /f >nul
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\PARDIK-SMART-IPTV" /v UninstallString /t REG_SZ /d "\"%DST%\install\Uninstall.bat\"" /f >nul
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\PARDIK-SMART-IPTV" /v InstallLocation /t REG_SZ /d "%DST%" /f >nul

echo.
echo Installation complete. Launching...
start "" "%DST%\PARDIK-SMART-IPTV.bat"
endlocal
