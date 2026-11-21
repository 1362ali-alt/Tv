@echo off
rem ============================================================
rem  PARDIK IPTV - let the player components RECEIVE udp multicast
rem  Right-click - Run as administrator.  The building live channels
rem  arrive as UDP multicast; Windows Firewall drops the inbound
rem  packets for ffmpeg.exe / vlc.exe by default, and then every
rem  channel dies with "Decoding video failed!".
rem ============================================================
setlocal
set "TOOLS=%~dp0..\tools"
netsh advfirewall firewall add rule name="PARDIK IPTV ffmpeg multicast" dir=in action=allow program="%TOOLS%\ffmpeg.exe" enable=yes profile=any >nul 2>&1
if exist "%TOOLS%\vlc\vlc.exe" netsh advfirewall firewall add rule name="PARDIK IPTV vlc multicast" dir=in action=allow program="%TOOLS%\vlc\vlc.exe" enable=yes profile=any >nul 2>&1
for /d %%d in ("%TOOLS%\vlc\*") do if exist "%%~d\vlc.exe" netsh advfirewall firewall add rule name="PARDIK IPTV vlc multicast" dir=in action=allow program="%%~d\vlc.exe" enable=yes profile=any >nul 2>&1
if exist "%LOCALAPPDATA%\Programs\VideoLAN\VLC\vlc.exe" netsh advfirewall firewall add rule name="PARDIK IPTV vlc multicast" dir=in action=allow program="%LOCALAPPDATA%\Programs\VideoLAN\VLC\vlc.exe" enable=yes profile=any >nul 2>&1
if exist "%ProgramFiles%\VideoLAN\VLC\vlc.exe" netsh advfirewall firewall add rule name="PARDIK IPTV vlc multicast" dir=in action=allow program="%ProgramFiles%\VideoLAN\VLC\vlc.exe" enable=yes profile=any >nul 2>&1
rem the multicast probe runs INSIDE python - without its own rule the probe
rem can read 0 bytes while playback through ffmpeg is fine (or vice versa)
set "RTPY=%~dp0..\runtime\python\python.exe"
if exist "%RTPY%" netsh advfirewall firewall add rule name="PARDIK IPTV python multicast" dir=in action=allow program="%RTPY%" enable=yes profile=any >nul 2>&1
netsh advfirewall firewall add rule name="PARDIK IPTV udp multicast 10000-10200" dir=in action=allow protocol=udp localport=10000-10200 enable=yes profile=any >nul 2>&1
echo Multicast firewall rules added.
pause
