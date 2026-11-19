@echo off
setlocal
set "DST=%LOCALAPPDATA%\PARDIK-SMART-IPTV"
taskkill /f /im python.exe /fi "WINDOWTITLE eq *iptv*" >nul 2>&1
rem both shortcut names: the residential build and the older hotel one
del "%USERPROFILE%\Desktop\PARDIK SMART IPTV.lnk" >nul 2>&1
del "%USERPROFILE%\Desktop\PARDIK IPTV - Ronika Palace.lnk" >nul 2>&1
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\PARDIK SMART IPTV.lnk" >nul 2>&1
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\PARDIK IPTV - Ronika Palace.lnk" >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\PARDIK-SMART-IPTV" /f >nul 2>&1
if exist "%DST%" rmdir /s /q "%DST%"
echo PARDIK IPTV uninstalled.
endlocal
