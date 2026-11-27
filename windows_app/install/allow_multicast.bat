@echo off
rem ============================================================
rem  PARDIK IPTV - let the player components RECEIVE udp multicast
rem  Right-click - Run as administrator.  The building live channels
rem  arrive as UDP multicast; Windows Firewall drops the inbound
rem  packets for ffmpeg.exe / vlc.exe / python.exe by default, and
rem  then every channel dies with no picture.
rem
rem  The firewall matches rules by the EXACT path string, so every
rem  path is normalized to its absolute form first - a rule saved
rem  as ...\install\..\tools\ffmpeg.exe never matches the real file.
rem ============================================================
setlocal
rem Without elevation EVERY netsh command below fails; that failure must be
rem seen, not swallowed - a silently unregistered rule is why multicast can
rem stay blocked even though "rules added" was printed.
net session >nul 2>&1
if errorlevel 1 goto NOADMIN
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "TOOLS=%ROOT%\tools"
set "RTPY=%ROOT%\runtime\python\python.exe"
echo App folder: %ROOT%
rem drop stale rules from older builds, then add clean normalized ones
netsh advfirewall firewall delete rule name="PARDIK IPTV ffmpeg multicast" >nul 2>&1
netsh advfirewall firewall delete rule name="PARDIK IPTV vlc multicast" >nul 2>&1
netsh advfirewall firewall delete rule name="PARDIK IPTV python multicast" >nul 2>&1
netsh advfirewall firewall add rule name="PARDIK IPTV ffmpeg multicast" dir=in action=allow program="%TOOLS%\ffmpeg.exe" enable=yes profile=any >nul 2>&1
if exist "%TOOLS%\vlc\vlc.exe" netsh advfirewall firewall add rule name="PARDIK IPTV vlc multicast" dir=in action=allow program="%TOOLS%\vlc\vlc.exe" enable=yes profile=any >nul 2>&1
for /d %%d in ("%TOOLS%\vlc\*") do if exist "%%~d\vlc.exe" netsh advfirewall firewall add rule name="PARDIK IPTV vlc multicast" dir=in action=allow program="%%~d\vlc.exe" enable=yes profile=any >nul 2>&1
if exist "%LOCALAPPDATA%\Programs\VideoLAN\VLC\vlc.exe" netsh advfirewall firewall add rule name="PARDIK IPTV vlc multicast" dir=in action=allow program="%LOCALAPPDATA%\Programs\VideoLAN\VLC\vlc.exe" enable=yes profile=any >nul 2>&1
if exist "%ProgramFiles%\VideoLAN\VLC\vlc.exe" netsh advfirewall firewall add rule name="PARDIK IPTV vlc multicast" dir=in action=allow program="%ProgramFiles%\VideoLAN\VLC\vlc.exe" enable=yes profile=any >nul 2>&1
rem the multicast probe runs INSIDE python - without its own rule the probe
rem can read 0 bytes while playback through ffmpeg is fine, or vice versa
if exist "%RTPY%" netsh advfirewall firewall add rule name="PARDIK IPTV python multicast" dir=in action=allow program="%RTPY%" enable=yes profile=any >nul 2>&1
netsh advfirewall firewall delete rule name="PARDIK IPTV udp multicast 10000-10200" >nul 2>&1
netsh advfirewall firewall add rule name="PARDIK IPTV udp multicast 10000-10999" dir=in action=allow protocol=udp localport=10000-10999 enable=yes profile=any >nul 2>&1
echo.
echo Rules registered for:
netsh advfirewall firewall show rule name="PARDIK IPTV ffmpeg multicast" | findstr /i "Program"
netsh advfirewall firewall show rule name="PARDIK IPTV vlc multicast" | findstr /i "Program"
netsh advfirewall firewall show rule name="PARDIK IPTV python multicast" | findstr /i "Program"
echo.
echo Multicast firewall rules added with normalized paths.
echo If any line above says "requested operation requires elevation",
echo close this window and re-run the file with Run as administrator.
> "%~dp0fw_rules.ok" echo ok
rem "auto" = the launcher itself asked (UAC): no pause, window closes alone
if /i not "%~1"=="auto" pause
exit /b 0
:NOADMIN
echo ============================================================
echo  ADMINISTRATOR RIGHTS REQUIRED - nothing was changed.
echo  Close this window, right-click allow_multicast.bat and
echo  choose "Run as administrator", then check the printed
echo  Program= lines to confirm the rules registered.
echo ============================================================
pause
exit /b 1
