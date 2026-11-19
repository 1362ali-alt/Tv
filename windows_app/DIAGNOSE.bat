@echo off
rem Opens the live diagnosis page and the backend log side by side.
rem Take a photo of both windows and send it for analysis.
start "" "http://127.0.0.1:8787/api/diagnose"
if exist "%~dp0_userdata\backend.log" start "" notepad "%~dp0_userdata\backend.log"
if exist "%APPDATA%\PARDIK-SMART-IPTV\backend.log" start "" notepad "%APPDATA%\PARDIK-SMART-IPTV\backend.log"
echo.
echo If the diagnose page stayed empty, the app is not running: start it
echo first with PORTABLE.bat, wait for the window, then run DIAGNOSE.bat.
echo.
echo Multicast blocked by the firewall? Right-click install\allow_multicast.bat
echo and choose Run as administrator, once.
timeout /t 12 >nul
exit /b 0
