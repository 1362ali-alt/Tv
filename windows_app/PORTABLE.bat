@echo off
rem ============================================================
rem  PARDIK IPTV - PORTABLE launcher: no install, no registry,
rem  no shortcuts, no copies into the user profile. Runs from
rem  this folder, even from a USB stick. The first run prepares
rem  runtime\python inside this folder -one time, needs internet-;
rem  after that everything stays here, settings and logs included.
rem ============================================================
if exist "%~dp0runtime\python\python.exe" goto RUN
echo First run: preparing the portable python runtime inside this folder...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install\bootstrap_runtime.ps1"
if not exist "%~dp0runtime\python\python.exe" goto NORUNTIME
:RUN
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0install\launch.ps1"
exit /b 0
:NORUNTIME
echo The portable python runtime could not be prepared.
echo Connect to the internet once and run PORTABLE.bat again.
pause
exit /b 1
