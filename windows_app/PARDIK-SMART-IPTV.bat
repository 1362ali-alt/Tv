@echo off
rem PARDIK SMART IPTV - launcher (double-click me)
rem The backend + UI run in their own hidden windows; this console closes
rem at once so no black DOS box is left sitting on the TV.
start "" powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0install\launch.ps1"
exit /b 0
