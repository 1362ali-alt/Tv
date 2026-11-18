@echo off
rem ============================================================
rem  PARDIK SMART IPTV - one-click installer (Windows 10 x64)
rem  Copies the app, creates shortcuts, registers uninstaller,
rem  then launches it.  Run as the normal user (no admin needed).
rem ============================================================
setlocal
set "SRC=%~dp0.."
set "DST=%LOCALAPPDATA%\PARDIK-SMART-IPTV"
echo Installing to %DST% ...
if exist "%DST%" rmdir /s /q "%DST%"
mkdir "%DST%"
xcopy "%SRC%\app"     "%DST%\app\"     /e /i /q /y >nul
xcopy "%SRC%\tools"   "%DST%\tools\"   /e /i /q /y >nul
xcopy "%SRC%\install" "%DST%\install\" /e /i /q /y >nul
if exist "%SRC%\runtime" xcopy "%SRC%\runtime" "%DST%\runtime\" /e /i /q /y >nul
copy /y "%SRC%\PARDIK-SMART-IPTV.bat" "%DST%\" >nul
copy /y "%SRC%\PARDIK-SMART-IPTV-silent.vbs" "%DST%\" >nul

rem --- ensure python + ffmpeg ---
powershell -NoProfile -ExecutionPolicy Bypass -File "%DST%\install\bootstrap_runtime.ps1"

rem --- shortcuts (Desktop + Start Menu) ---
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws=New-Object -ComObject WScript.Shell;" ^
  "$d='%USERPROFILE%\Desktop\PARDIK SMART IPTV.lnk';" ^
  "$s=$ws.CreateShortcut($d); $s.TargetPath='%DST%\PARDIK-SMART-IPTV-silent.vbs';" ^
  "$s.IconLocation='%DST%\app\web\favicon.ico,0'; $s.WorkingDirectory='%DST%'; $s.Save();" ^
  "$m='%APPDATA%\Microsoft\Windows\Start Menu\Programs';" ^
  "$s2=$ws.CreateShortcut(\"$m\PARDIK SMART IPTV.lnk\"); $s2.TargetPath='%DST%\PARDIK-SMART-IPTV-silent.vbs';" ^
  "$s2.IconLocation='%DST%\app\web\favicon.ico,0'; $s2.WorkingDirectory='%DST%'; $s2.Save();"

rem --- uninstall entry ---
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\PARDIK-SMART-IPTV" /v DisplayName /t REG_SZ /d "PARDIK SMART IPTV" /f >nul
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\PARDIK-SMART-IPTV" /v DisplayVersion /t REG_SZ /d "2.7.2.06" /f >nul
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\PARDIK-SMART-IPTV" /v UninstallString /t REG_SZ /d "\"%DST%\install\Uninstall.bat\"" /f >nul
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\PARDIK-SMART-IPTV" /v InstallLocation /t REG_SZ /d "%DST%" /f >nul

echo.
echo Installation complete. Launching...
start "" "%DST%\PARDIK-SMART-IPTV.bat"
endlocal
