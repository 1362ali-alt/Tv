@echo off
rem ============================================================
rem  PARDIK IPTV - PORTABLE launcher: no install, no registry,
rem  no shortcuts, no copies into the user profile. Runs from
rem  this folder, even from a USB stick. Python, FFmpeg and VLC are
rem  ALL bundled inside - nothing is downloaded, nothing is installed,
rem  no internet is needed at any point. Settings and logs stay here.
rem ============================================================
if exist "%~dp0runtime\python\python.exe" goto RUN
echo Preparing the bundled portable python runtime...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install\bootstrap_runtime.ps1"
if not exist "%~dp0runtime\python\python.exe" goto NORUNTIME
:RUN
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0install\launch.ps1"
exit /b 0
:NORUNTIME
echo The bundled python runtime is missing from this folder.
echo Re-extract the full zip and run PORTABLE.bat again.
pause
exit /b 1
