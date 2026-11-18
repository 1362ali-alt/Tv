# PARDIK SMART IPTV — Windows 10 (x64) edition

A full, standalone re-implementation of the Android app **PARDIK SMART IPTV**
(`com.dexin.wanchuan.iptv3`, v2.7.1.71) for Windows 10 64-bit, produced by
reverse-engineering the supplied APK (see `../analysis/REVERSE_ENGINEERING_REPORT.md`).
Full Persian documentation: `README-FA.md`.

## Install
1. Unzip anywhere.
2. Double-click **`install\Setup.bat`** — it copies the app to
   `%LOCALAPPDATA%\PARDIK-SMART-IPTV`, creates Desktop + Start-Menu shortcuts,
   registers an uninstaller, auto-downloads an embeddable CPython if none is
   present, auto-downloads FFmpeg (for RTSP/TS sources), then launches the app.
3. Re-launch any time from the **"PARDIK SMART IPTV"** Desktop shortcut.
   Uninstall via Settings → Apps, or `install\Uninstall.bat`.

## Defaults (identical to the APK)
- Server `10.21.0.10`, port `8030`, RTSP port `554`
- Settings password **`111999`**
- API base `/iptv2/` (falls back to `/iptv2/manager/`), VOD `/iptv2/vod/`
- WebSocket control `ws://{ip}:{port}/dx-admin/websocket/{mac}` and `/iptv2/websocket/{room}`
- Change IP/port/room in **System settings** (password-gated).

## What it does
Boot/ping → welcome (language fa/en/zh, clock, weather, guest greeting) → home
(logo/room/Wi-Fi/weather/clock bar + icon menu) → Live TV (packages, numbered
channel list, watermark, favourites, EPG polling, RTSP/HLS/HTTP/UDP), VOD
(categories, poster grid, detail, playlist), Playback/Timeshift, Scenery,
Catering, Room service (housekeeping, laundry, goods, wake-up, folio/billing,
check-out), Hotel intro, Music, Consumption bill, password-protected Settings.
All original icons/backgrounds are reused; UI is a native-looking borderless
Edge app window with full D-pad/keyboard navigation.

## Performance on the target box (i5-3337U / 6 GB / GT 720M)
- Video decoding is hardware-accelerated by the browser (MF/DXVA).
- RTSP/UDP/MPEG-TS are remuxed to HLS with FFmpeg `-c copy` (no re-encode) → ~0% CPU.
- Backend is Python **stdlib only** — no third-party packages, tiny footprint.

## Controls
Arrows/Tab move · Enter = OK · Esc/Backspace = back (twice in live to exit) ·
↑/↓ volume · M mute · F favourite · L channel list · Enter (in player) fullscreen.
