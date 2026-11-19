@echo off
title PARDIK IPTV - portable
rem ============================================================
rem  PARDIK IPTV - PORTABLE launcher: no install, no registry,
rem  no shortcuts, no copies into the user profile. Python,
rem  FFmpeg and VLC are ALL bundled inside - nothing downloads,
rem  nothing installs, no internet is needed at any point.
rem  This console shows what happens and closes itself when the
rem  app window is up; on failure it STAYS with the reason.
rem ============================================================
echo ==================================================
echo  PARDIK IPTV - portable, no install needed
if exist "%~dp0build_info.json" type "%~dp0build_info.json"
echo ==================================================
if exist "%~dp0runtime\python\python.exe" goto RUN
echo Preparing the bundled python runtime...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install\bootstrap_runtime.ps1"
if not exist "%~dp0runtime\python\python.exe" goto NORUNTIME
:RUN
echo Starting - the app window opens by itself. This console closes on success.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install\launch.ps1"
if errorlevel 1 goto FAIL
echo.
echo Started. The title bar must show the build code printed above.
echo Closing this console in 5 seconds...
timeout /t 5 >nul
exit /b 0
:FAIL
echo.
echo ================= START FAILED =================
if exist "%~dp0launch.log" powershell -NoProfile -Command "Get-Content -Tail 15 -LiteralPath '%~dp0launch.log'"
echo Send a PHOTO of this whole window for analysis.
pause
exit /b 1
:NORUNTIME
echo The bundled python runtime is missing from this folder.
echo Extract the FULL zip again, then run this file once more.
pause
exit /b 1
